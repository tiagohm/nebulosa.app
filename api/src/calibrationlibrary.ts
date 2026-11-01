import { constants } from 'fs'
import { copyFile, mkdir, rename, stat } from 'fs/promises'
import { join, relative } from 'path'
import { type IntegrationProgress, type IntegrationResult, IntegrationError, masterHeader, MasterIntegrator, type MasterWorkerRequest } from './calibrationlibrary.analysis'
import {
	type CalibrationKind,
	type CalibrationMetadata,
	type CalibrationRecipe,
	type CalibrationTarget,
	compareFrames,
	type CompatibilityFinding,
	DEFAULT_RECIPE,
	type Evidenced,
	flatCorrectionMismatch,
	groupReadiness,
	type GroupReadiness,
	matchMaster,
	type MasterReference,
	type MatchVerdict,
	type OverridableField,
	OVERRIDABLE_FIELDS,
	RECOMMENDED_FRAMES,
	recipeFingerprint,
	stableId,
} from './calibrationlibrary.compatibility'
import { ACTIVE_JOB_STATES, type CalibrationJob, CalibrationJobs, type CalibrationJobSummary, type Integrator, jobSummary, type MasterBuild, NO_PROGRESS } from './calibrationlibrary.jobs'
import { darkPlanSource, type FileInspection, inspectFile, makeSource, regrouped, type ScanCandidate, scanDirectory } from './calibrationlibrary.sources'
import {
	type CalibrationJournalRecord,
	CalibrationLibraryStore,
	type CalibrationMaster,
	type CalibrationSource,
	type CalibrationSourceSummary,
	fileNameOf,
	MASTER_FILE,
	type MasterCalibrationState,
	type MasterFilter,
	type Page,
	type SourceFilter,
	type SourceStatus,
	sourceSummary,
	type StoredGroup,
} from './calibrationlibrary.store'
import type { DarkCapturePlan, DarkPlanStore } from './darklibrarywizard.store'
import { errorResponse } from './http'
import { errorCode } from './util'

// Calibration Library: the single owner of what calibration frames exist, whether they can be combined, and which masters
// were made of them. It needs no camera and claims no device: frames come from the Dark Library plans through their store,
// from what the Flat Wizard publishes, and from directories an operator imports, always by reference and never modified.
// Masters are immutable revisions built by jobs that survive the tab and the server. A wizard may ask for a master, through
// the same path as a person. Applying a master to a light is outside this service: it only explains which masters would match.

// Rows of a page unless a request asks otherwise.
const DEFAULT_PAGE_SIZE = 50

// Latest jobs a snapshot looks at for the ones of the wizards.
const RECENT_JOBS = 50

// Files checked at once when refreshing what is on the disk.
const REFRESH_CONCURRENCY = 32

// Stable code of a failed request.
export type CalibrationLibraryErrorCode =
	| 'incompatibleFrames'
	| 'unknownMetadata'
	| 'sourceMissing'
	| 'sourceChanged'
	| 'unsupportedFormat'
	| 'insufficientFrames'
	| 'invalidFlatCorrection'
	| 'invalidFlatSignal'
	| 'jobConflict'
	| 'processingFailed'
	| 'publicationFailed'
	| 'productUnavailable'
	| 'newerVersion'
	| 'notFound'
	| 'verifiedMetadata'
	| 'importFailed'

// Failure of a request, with its status and stable code.
class LibraryError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: CalibrationLibraryErrorCode,
	) {
		super(message)
	}
}

// Counts of frames or masters by state.
export type StateCounts = Readonly<Record<string, number>>

// Everything a tab needs to mirror the library, with no paths.
export interface CalibrationLibrarySnapshot {
	// Id of this process; a new one invalidates everything a tab holds.
	readonly epoch: string
	// Monotonic change counter of this process.
	readonly revision: number
	// Whether a newer version owns the catalog.
	readonly unavailable: boolean
	// Frames by state, and by role.
	readonly frames: StateCounts
	readonly framesByKind: StateCounts
	// Masters by state, and by role.
	readonly masters: StateCounts
	readonly mastersByKind: StateCounts
	// Hardware ids of the cameras with frames.
	readonly cameras: readonly string[]
	// Jobs still working.
	readonly activeJobs: readonly CalibrationJobSummary[]
	// Latest jobs of the wizards, so a reloaded tab still shows how their masters ended.
	readonly recentJobs: readonly CalibrationJobSummary[]
}

// What lists and events show of a revision.
export interface CalibrationMasterSummary {
	// Master and revision.
	readonly masterId: string
	readonly revision: number
	// Role.
	readonly kind: CalibrationKind
	// What its pixels contain, and their units.
	readonly calibrationState: MasterCalibrationState
	readonly units: 'DN' | 'dimensionless'
	// What is known about it.
	readonly metadata: CalibrationMetadata
	// Frames in it.
	readonly frames: number
	// How they were combined.
	readonly method: CalibrationRecipe['method']
	// Whether it is the preferred revision.
	readonly preferred: boolean
	// When it was published.
	readonly createdAt: number
	// State.
	readonly status: CalibrationMaster['status']
	// Group of its frames.
	readonly groupId: string
	// Masters it depends on.
	readonly dependencies: readonly MasterReference[]
}

// A revision with what is only for one who asks: its path, for opening it in Images.
export interface CalibrationMasterDetail extends CalibrationMaster {
	// Absolute path of its FITS file.
	readonly path: string
	// Whether it is the preferred revision.
	readonly preferred: boolean
}

// Event of the library.
export type CalibrationLibraryEvent =
	// Anything of the catalog changed.
	| { readonly type: 'calibrationLibrary:changed'; readonly revision: number; readonly summary: CalibrationLibrarySnapshot }
	// A job changed.
	| { readonly type: 'calibrationLibrary:jobUpdated'; readonly epoch: string; readonly revision: number; readonly job: CalibrationJobSummary }
	// A revision was published.
	| { readonly type: 'calibrationLibrary:masterUpdated'; readonly epoch: string; readonly revision: number; readonly master: CalibrationMasterSummary }

// Explained group of frames.
export interface CalibrationGroupSummary {
	// Id of the group, which is also the id of its master.
	readonly groupId: string
	// Role.
	readonly kind: CalibrationKind
	// What its frames share.
	readonly metadata: CalibrationMetadata
	// Frames, and those a master can use.
	readonly total: number
	readonly usable: number
	// Frames gone or changed, frames left out, and frames with warnings.
	readonly unavailable: number
	readonly excluded: number
	readonly warned: number
	// Frames its plan required, when one did.
	readonly required?: number
	// Explained state.
	readonly readiness: GroupReadiness
	// Why.
	readonly findings: readonly CompatibilityFinding[]
	// Revisions of its master, newest first.
	readonly masters: readonly CalibrationMasterSummary[]
}

// A group with its frames, without paths.
export interface CalibrationGroupDetail extends CalibrationGroupSummary {
	// Its frames.
	readonly sources: readonly CalibrationSourceSummary[]
}

// A master request, or the preview of one.
export interface MasterRequest {
	// Group to integrate; its usable frames unless sourceIds chooses.
	readonly groupId?: string
	// Frames to integrate.
	readonly sourceIds?: readonly string[]
	// Combination, over the defaults.
	readonly recipe?: Partial<CalibrationRecipe>
	// Master that corrects a flat.
	readonly correction?: { readonly masterId: string; readonly revision: number }
	// Whether the operator accepts everything that asks for a review, including an incomplete group.
	readonly acknowledged?: boolean
	// Token of the request, so a repeated one meets the same job.
	readonly token?: string
}

// What a master request would do. Nothing is written to answer it.
export interface RecipeValidation {
	// Whether it could start as it is.
	readonly valid: boolean
	// Role, group, and frames it would use.
	readonly kind?: CalibrationKind
	readonly groupId?: string
	readonly frames: number
	// Combination it would apply.
	readonly recipe: CalibrationRecipe
	// Why not, or what to accept.
	readonly findings: readonly CompatibilityFinding[]
	// Whether something must be accepted before it can start.
	readonly needsAcknowledgement: boolean
	// Largest disk a job may need beyond the master, in bytes, for files it must spill.
	readonly spillBytes: number
	// Published revision of an identical request.
	readonly existing?: { readonly masterId: string; readonly revision: number }
}

// Answer of a master request.
export interface MasterRequestResult {
	// Job doing it; absent when the product already exists.
	readonly jobId?: string
	// Master it makes.
	readonly masterId: string
	// Revision, when it exists.
	readonly revision?: number
	// State of the job, or completed.
	readonly state: CalibrationJob['state']
}

// A request to import a directory.
export interface ImportRequest {
	// Directory on the server.
	readonly path: string
	// Whether to enter subdirectories.
	readonly recursive?: boolean
	// Deepest directory.
	readonly depth?: number
}

// File an import found, as it is shown for review.
export interface ImportCandidate {
	// Absolute path.
	readonly path: string
	// Path under the scanned directory.
	readonly name: string
	// Size, in bytes.
	readonly bytes: number
	// Modification time, in milliseconds since the epoch.
	readonly mtimeMillis: number
	// Format of the file.
	readonly format?: 'fits' | 'xisf'
	// Role its header says.
	readonly kind?: CalibrationKind
	// Whether it is not a calibration frame, and cannot be imported.
	readonly rejectedRole?: 'light' | 'master'
	// What is known about it.
	readonly metadata?: CalibrationMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
	// Why it could not be read.
	readonly error?: string
	// Whether the library already knows it.
	readonly known: boolean
}

// How the frames of an import enter the library.
export interface ImportCommit {
	// Files to add; all the recognized ones when absent.
	readonly paths?: readonly string[]
	// Roles an operator declares, by path, with the reason.
	readonly classifications?: Readonly<Record<string, { readonly kind: CalibrationKind; readonly reason: string }>>
	// Whether to copy the files into the library instead of referencing them.
	readonly copy?: boolean
}

// Candidates of a metadata-only preview for a target.
export interface ResolvePreview {
	// One row per master considered.
	readonly candidates: readonly { readonly masterId: string; readonly revision: number; readonly kind: CalibrationKind; readonly verdict: MatchVerdict; readonly reasons: readonly string[] }[]
	// Kinds with no compatible master.
	readonly missingKinds: readonly CalibrationKind[]
}

// A frame the Flat Wizard published.
export interface FlatFrameRegistration {
	// Absolute path of the frame.
	readonly path: string
	// Session it came from.
	readonly sessionId: string
	// Hardware id and name of the camera.
	readonly cameraId: string
	readonly cameraName: string
	// Name of the filter in the beam, which a file taken without a wheel leaves out.
	readonly filter?: string
}

// Whether a frame can enter a master.
function usable(source: CalibrationSource) {
	return source.status === 'available' && source.supported && source.excluded === undefined
}

// Returns what a master contains by its role.
function masterContent(kind: CalibrationKind): Pick<CalibrationMaster, 'calibrationState' | 'units' | 'usage'> {
	switch (kind) {
		case 'dark':
			return { calibrationState: 'rawBiasIncluded', units: 'DN', usage: 'Holds bias and dark signal. Subtract once from a raw light of the same exposure; never subtract a bias as well.' }
		case 'darkFlat':
			return { calibrationState: 'rawBiasIncluded', units: 'DN', usage: 'Holds bias and dark signal at the exposure of its flats. Subtract once from raw flats; never from a light.' }
		case 'bias':
			return { calibrationState: 'rawBias', units: 'DN', usage: 'Holds the electronic pedestal. Subtract only where no bias-containing dark is subtracted.' }
		case 'flat':
			return { calibrationState: 'calibratedNormalized', units: 'dimensionless', usage: 'Corrected response with a median of 1 per plane. Divide a dark-subtracted light by it; never subtract a bias or dark-flat from it.' }
	}
}

// Returns metadata for a set of compatible frames: what they share, with the observed temperature averaged.
function mergedMetadata(frames: readonly CalibrationMetadata[]): CalibrationMetadata {
	const readings = frames.flatMap(({ sensorTemperature }) => sensorTemperature.value ?? [])
	if (readings.length === 0) return frames[0]
	let sum = 0
	for (const reading of readings) sum += reading
	return { ...frames[0], sensorTemperature: { value: Math.round((sum / readings.length) * 100) / 100, evidence: frames[0].sensorTemperature.evidence } }
}

// Returns the most frames a plan required of these frames, 0 when none did.
function requiredFrames(sources: readonly CalibrationSource[]) {
	let required = 0
	for (const source of sources) required = Math.max(required, source.required ?? 0)
	return required
}

// Returns the stable identity of the file state of a frame.
function frameIdentity({ sourceId, bytes, mtimeMillis }: CalibrationSource) {
	return `${sourceId}:${bytes}:${mtimeMillis}`
}

// Returns what a list shows of a revision.
function masterSummary(master: CalibrationMaster, preferred: number | undefined): CalibrationMasterSummary {
	const { masterId, revision, kind, calibrationState, units, metadata, recipe, createdAt, status, groupId, dependencies, sourceIds } = master
	return { masterId, revision, kind, calibrationState, units, metadata, frames: sourceIds.length, method: recipe.method, preferred: preferred === revision, createdAt, status, groupId, dependencies }
}

// The service. Work waits for the first open of the catalog, so importing this module touches no file.
export class CalibrationLibrary {
	// Id of this process.
	readonly #epoch = crypto.randomUUID()
	// Change counter.
	#revision = 0
	// First open of the catalog and the reconciliation after it.
	#opened?: Promise<void>
	// Import scans running, by job.
	readonly #scans = new Map<string, AbortController>()
	// Queue of the master jobs.
	readonly jobs: CalibrationJobs

	// Creates the service. plans is the one store of the Dark Library, read and never changed; listener receives every change
	// synchronously; busy says whether a camera operation is running, which holds automatic jobs back.
	constructor(
		readonly store: CalibrationLibraryStore,
		readonly plans: DarkPlanStore,
		readonly listener: (event: CalibrationLibraryEvent) => void,
		readonly busy: () => boolean = () => false,
		integrator: Integrator = new MasterIntegrator(),
	) {
		this.jobs = new CalibrationJobs(store, integrator, {
			request: (job, staging) => this.#workerRequest(job, staging),
			publish: (job, result, staging) => this.#publish(job, result, staging),
			busy: () => this.busy(),
			updated: (job) => this.#jobUpdated(job),
		})
	}

	// Opens the catalog once, rebuilding what can be derived, and brings it in line with the disk. Fails nothing that a retry
	// could fix: a request after a failure opens it again.
	ready() {
		this.#opened ??= this.#open().catch((error: unknown) => {
			this.#opened = undefined
			throw error
		})
		return this.#opened
	}

	// Opens the catalog and resumes the jobs.
	async #open() {
		const rebuild = this.store.open()
		if (this.store.newerVersion) return

		await this.#indexPlans()
		if (rebuild) await this.#replay()
		await this.#reconcileMasters()
		await this.jobs.recover()
		await this.#refreshFiles()
		await this.#generatePending()
		this.#changed()
	}

	// Throws when a newer version owns the catalog.
	async #usable() {
		await this.ready()
		if (this.store.newerVersion) throw new LibraryError('A newer version of Nebulosa owns the calibration catalog', 409, 'newerVersion')
	}

	// Applies the journal to an empty catalog. Frames of plans were indexed first, so overrides find them.
	async #replay() {
		for (const record of await this.store.journal()) this.#apply(record)
	}

	// Applies a journal record to the catalog.
	#apply(record: CalibrationJournalRecord) {
		switch (record.type) {
			case 'source':
				this.store.putSources([record.source])
				return
			case 'override': {
				const source = this.store.source(record.sourceId)
				if (source) this.store.putSources([regrouped(source, source.kind, { ...source.metadata, [record.field]: { value: record.value, evidence: 'operatorDeclared' } })])
				return
			}
			case 'classification': {
				const source = this.store.source(record.sourceId)
				if (source) this.store.putSources([regrouped(source, record.kind, source.metadata)])
				return
			}
			case 'exclusion': {
				const source = this.store.source(record.sourceId)
				if (source) this.store.putSources([{ ...source, excluded: record.reason }])
				return
			}
			case 'preferred':
				this.store.setPreferred(record.masterId, record.revision)
		}
	}

	// Adopts every manifest the catalog does not know, and marks revisions whose file went away or whose dependency did.
	// A manifest found here means a crash came after a publish and before its row.
	async #reconcileMasters() {
		for (const manifest of await this.store.manifests()) {
			const { version: _, ...master } = manifest
			if (!this.store.master(master.masterId, master.revision)) this.store.putMaster(master)
		}

		const masters = this.store.allMasters()
		const unavailable = new Set<string>()

		for (const master of masters) {
			const info = await stat(this.#masterFile(master)).catch(() => undefined)
			const status = info?.size === master.bytes ? master.status : 'unavailable'
			if (status === 'unavailable') unavailable.add(`${master.masterId}:${master.revision}`)
			if (status !== master.status) this.store.putMaster({ ...master, status })
		}

		for (const master of masters) {
			if (master.status !== 'unavailable' && master.dependencies.some(({ masterId, revision }) => unavailable.has(`${masterId}:${revision}`))) this.store.putMaster({ ...master, status: 'stale' })
		}
	}

	// Path of the FITS file of a revision.
	#masterFile({ masterId, revision }: Pick<CalibrationMaster, 'masterId' | 'revision'>) {
		return join(this.store.revisionDirectory(masterId, revision), MASTER_FILE)
	}

	// Indexes the frames of the plans the library does not know. A plan a session works on waits until it ends.
	async #indexPlans(onlyPlanId?: string) {
		const summaries = await this.plans.list(onlyPlanId === undefined ? undefined : ({ planId }) => planId === onlyPlanId)

		for (const { planId, status } of summaries) {
			if (status === 'running' || status === 'paused') continue
			const plan = await this.plans.plan(planId)
			const frames = await this.plans.frames(planId)
			if (!plan || !frames) continue

			const added: CalibrationSource[] = []

			for (const frame of frames.frames) {
				const group = plan.groups.find(({ groupId }) => groupId === frame.groupId)
				if (!group || (frame.verdict !== 'accepted' && frame.verdict !== 'acceptedWithWarnings')) continue

				const known = this.store.source(makeKnownId(frame.path))
				if (known) continue

				const info = await stat(frame.path).catch(() => undefined)
				let inspection: FileInspection | undefined

				try {
					inspection = info && (await inspectFile(frame.path))
				} catch {
					inspection = undefined
				}

				if (!inspection || !info) continue
				const source = darkPlanSource(plan, group, frame, inspection, info.size, info.mtimeMs)
				if (source) added.push({ ...source, supported: inspection.metadata.bitpix !== 64 })
			}

			if (added.length > 0) this.store.putSources(added)
		}
	}

	// Compares every indexed file with the disk, which can bring a missing file back. Returns whether anything changed.
	async #refreshFiles() {
		const sources = this.store.sourcesOf()
		const changed: CalibrationSource[] = []
		let next = 0

		const check = async () => {
			for (let index = next++; index < sources.length; index = next++) {
				const source = sources[index]
				const info = await stat(source.path).catch((error: unknown) => (errorCode(error) === 'ENOENT' ? undefined : null))
				if (info === null) continue

				const status: SourceStatus = info === undefined ? 'missing' : info.size === source.bytes && info.mtimeMs === source.mtimeMillis ? 'available' : 'changed'
				if (status !== source.status) changed.push({ ...source, status })
			}
		}

		await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, check))
		if (changed.length > 0) this.store.putSources(changed)
		return changed.length > 0
	}

	// Re-reads plans and files on request.
	async refresh() {
		await this.#usable()
		await this.#indexPlans()
		await this.#refreshFiles()
		this.#changed()
		return this.snapshot()
	}

	// Builds the snapshot.
	snapshot(): CalibrationLibrarySnapshot {
		const empty = { frames: {}, framesByKind: {}, masters: {}, mastersByKind: {}, cameras: [], activeJobs: [], recentJobs: [] }
		if (this.store.newerVersion) return { epoch: this.#epoch, revision: this.#revision, unavailable: true, ...empty }

		const { sources, masters, cameras } = this.store.counts()
		const frames: Record<string, number> = {}
		const framesByKind: Record<string, number> = {}
		const mastersByState: Record<string, number> = {}
		const mastersByKind: Record<string, number> = {}

		for (const { kind, status, count } of sources) {
			frames[status] = (frames[status] ?? 0) + count
			framesByKind[kind] = (framesByKind[kind] ?? 0) + count
		}

		for (const { kind, status, count } of masters) {
			mastersByState[status] = (mastersByState[status] ?? 0) + count
			mastersByKind[kind] = (mastersByKind[kind] ?? 0) + count
		}

		const activeJobs = this.store.jobsIn(ACTIVE_JOB_STATES).map(jobSummary)
		const recentJobs = this.store
			.jobs(0, RECENT_JOBS)
			.items.filter(({ automatic }) => automatic)
			.map(jobSummary)
		return { epoch: this.#epoch, revision: this.#revision, unavailable: false, frames, framesByKind, masters: mastersByState, mastersByKind, cameras, activeJobs, recentJobs }
	}

	// Publishes a change of the catalog.
	#changed() {
		const revision = ++this.#revision
		this.listener({ type: 'calibrationLibrary:changed', revision, summary: this.snapshot() })
	}

	// Publishes a change of a job.
	#jobUpdated(job: CalibrationJob) {
		this.listener({ type: 'calibrationLibrary:jobUpdated', epoch: this.#epoch, revision: ++this.#revision, job: jobSummary(job) })
	}

	// Lists frames.
	async sources(filter: SourceFilter, offset: number, limit: number): Promise<Page<CalibrationSourceSummary>> {
		await this.#usable()
		const { items, total } = this.store.sources(filter, offset, limit)
		return { items: items.map(sourceSummary), total }
	}

	// Returns a frame with its path. Throws when unknown.
	async source(sourceId: string) {
		await this.#usable()
		const source = this.store.source(sourceId)
		if (!source) throw new LibraryError('Unknown frame', 404, 'notFound')
		return source
	}

	// Records a value of a frame that was unknown, with the reason, and regroups it. A value the file or a plan states cannot
	// be replaced: a conflict with a measurement is an incompatibility, not an edit. Throws LibraryError.
	async override(sourceId: string, field: OverridableField, value: string | number, reason: string) {
		const source = await this.source(sourceId)
		if (!OVERRIDABLE_FIELDS.includes(field)) throw new LibraryError(`${field} cannot be declared`, 409, 'verifiedMetadata')

		const { evidence } = source.metadata[field] as Evidenced<unknown>
		if (evidence === 'verified' || evidence === 'planDeclared') throw new LibraryError(`${field} is ${evidence} and cannot be replaced`, 409, 'verifiedMetadata')

		const record: CalibrationJournalRecord = { type: 'override', at: Date.now(), sourceId, field, value, reason }
		await this.store.append([record])
		this.#apply(record)
		this.#changed()
		return sourceSummary(this.store.source(sourceId)!)
	}

	// Leaves a frame out of masters, with the reason, or brings it back when reason is absent.
	async exclude(sourceId: string, reason: string | undefined) {
		await this.source(sourceId)
		const record: CalibrationJournalRecord = { type: 'exclusion', at: Date.now(), sourceId, reason }
		await this.store.append([record])
		this.#apply(record)
		this.#changed()
		return sourceSummary(this.store.source(sourceId)!)
	}

	// Explains a group.
	#describeGroup({ groupId, sources }: StoredGroup): CalibrationGroupSummary {
		const included = sources.filter((source) => source.excluded === undefined)
		const candidates = included.filter(usable)
		const compared = candidates.length > 0 ? candidates : sources
		const findings = compareFrames(
			sources[0].kind,
			compared.map(({ metadata }) => metadata),
		)
		const required = requiredFrames(sources) || undefined
		const unavailable = sources.filter(({ status }) => status !== 'available').length
		const warned = candidates.filter(({ warnings }) => warnings.length > 0).length

		if (candidates.length > 0 && candidates.length < RECOMMENDED_FRAMES) findings.push({ field: 'frames', code: 'lowSampleCount', severity: 'notice', message: `${candidates.length} frames; ${RECOMMENDED_FRAMES} are recommended` })
		if (warned > 0) findings.push({ field: 'frames', code: 'warnedFrames', severity: 'notice', message: `${warned} frames carry warnings` })

		const preferred = this.store.preferred(groupId)
		const masters = this.store.masters({ masterId: groupId }, 0, 20).items.map((master) => masterSummary(master, preferred))
		const metadata = mergedMetadata(compared.map(({ metadata }) => metadata))
		return {
			groupId,
			kind: sources[0].kind,
			metadata,
			total: sources.length,
			usable: candidates.length,
			unavailable,
			excluded: sources.length - included.length,
			warned,
			required,
			readiness: groupReadiness(
				findings,
				candidates.length,
				unavailable,
				required,
				sources.some(({ supported }) => supported),
			),
			findings,
			masters,
		}
	}

	// Lists groups, with what explains them.
	async groups(filter: SourceFilter, offset: number, limit: number): Promise<Page<CalibrationGroupSummary>> {
		await this.#usable()
		const { items, total } = this.store.groups(filter, offset, limit)
		return { items: items.map((group) => this.#describeGroup(group)), total }
	}

	// Returns a group and its frames. Throws when unknown.
	async group(groupId: string): Promise<CalibrationGroupDetail> {
		await this.#usable()
		const group = this.store.group(groupId)
		if (group.sources.length === 0) throw new LibraryError('Unknown group', 404, 'notFound')
		return { ...this.#describeGroup(group), sources: group.sources.map(sourceSummary) }
	}

	// Resolves the frames of a request.
	#requestedFrames({ groupId, sourceIds }: MasterRequest) {
		if (sourceIds !== undefined) return this.store.sourcesById(sourceIds)
		return groupId === undefined ? [] : this.store.group(groupId).sources.filter(usable)
	}

	// Explains a request, writing nothing. A bias or dark-flat keeps the sensor scale; a flat needs its correction.
	#validate(request: MasterRequest) {
		const recipe: CalibrationRecipe = { ...DEFAULT_RECIPE, ...request.recipe }
		const sources = this.#requestedFrames(request)
		const findings: CompatibilityFinding[] = []
		const kinds = new Set(sources.map(({ kind }) => kind))
		const kind = sources[0]?.kind
		let correction: CalibrationMaster | undefined

		if (sources.length === 0) findings.push({ field: 'frames', code: 'insufficientFrames', severity: 'blocker', message: 'No frame can enter this master' })
		if (kinds.size > 1) findings.push({ field: 'kind', code: 'incompatibleFrames', severity: 'blocker', message: `The frames have different roles: ${[...kinds].join(', ')}` })

		const gone = sources.filter(({ status }) => status !== 'available').length
		if (gone > 0) findings.push({ field: 'frames', code: 'sourceMissing', severity: 'blocker', message: `${gone} frames are missing or changed` })

		const excluded = sources.filter(({ excluded }) => excluded !== undefined).length
		if (excluded > 0) findings.push({ field: 'frames', code: 'incompatibleFrames', severity: 'blocker', message: `${excluded} frames were left out by an operator` })

		const unsupported = sources.filter(({ supported }) => !supported).length
		if (unsupported > 0) findings.push({ field: 'frames', code: 'incompatibleFrames', severity: 'blocker', message: `${unsupported} frames have a sample format the integrator cannot read` })

		if (sources.length > 0 && kinds.size === 1) {
			findings.push(
				...compareFrames(
					sources[0].kind,
					sources.map(({ metadata }) => metadata),
				),
			)
			const required = requiredFrames(sources)

			if (sources.length < required) findings.push({ field: 'frames', code: 'incompleteGroup', severity: 'review', message: `${sources.length} of ${required} planned frames: this would be a provisional master` })
			if (sources.length < RECOMMENDED_FRAMES) findings.push({ field: 'frames', code: 'lowSampleCount', severity: 'notice', message: `${sources.length} frames; ${RECOMMENDED_FRAMES} are recommended` })

			const warned = sources.filter(({ warnings }) => warnings.length > 0).length
			if (warned > 0) findings.push({ field: 'frames', code: 'warnedFrames', severity: 'notice', message: `${warned} frames carry warnings` })
		}

		if (kind === 'flat') {
			const reference = request.correction
			correction = reference && this.store.master(reference.masterId, reference.revision)

			if (!correction) {
				findings.push({ field: 'correction', code: 'invalidFlatCorrection', severity: 'blocker', message: 'A master flat needs a master dark-flat or master bias; without one the flats stay uncalibrated' })
			} else if (correction.kind !== 'bias' && correction.kind !== 'darkFlat') {
				findings.push({ field: 'correction', code: 'invalidFlatCorrection', severity: 'blocker', message: 'Only a master dark-flat or a master bias can correct a flat' })
			} else if (correction.status === 'unavailable') {
				findings.push({ field: 'correction', code: 'invalidFlatCorrection', severity: 'blocker', message: 'The file of the correction master is not available' })
			} else {
				const mismatch = flatCorrectionMismatch(
					correction.kind,
					correction.metadata,
					sources.map(({ metadata }) => metadata),
				)
				if (mismatch !== undefined) findings.push({ field: 'correction', code: 'invalidFlatCorrection', severity: 'blocker', message: mismatch })
			}
		}

		const dependencies: MasterReference[] = correction ? [{ masterId: correction.masterId, revision: correction.revision, digest: correction.contentDigest }] : []
		const key = sources[0]?.key
		const fingerprint = key === undefined ? undefined : recipeFingerprint(key, sources.map(frameIdentity), recipe, dependencies)
		const existing = fingerprint === undefined ? undefined : this.store.masterByFingerprint(fingerprint)
		const blocked = findings.some(({ severity }) => severity === 'blocker')
		const needsAcknowledgement = findings.some(({ severity }) => severity === 'review')
		let spillBytes = 0
		for (const { format, bytes } of sources) if (format === 'xisf') spillBytes += bytes
		const validation: RecipeValidation = { valid: !blocked && (!needsAcknowledgement || request.acknowledged === true), kind, groupId: sources[0]?.groupId, frames: sources.length, recipe, findings, needsAcknowledgement, spillBytes, existing: existing && { masterId: existing.masterId, revision: existing.revision } }
		return { validation, sources, correction, dependencies, fingerprint }
	}

	// Explains a request without starting anything.
	async validate(request: MasterRequest) {
		await this.#usable()
		return this.#validate(request).validation
	}

	// Starts a master, or answers with what already does it: a repeated token meets its job, an identical recipe its product or
	// its running job. The job is durable before this returns. Throws LibraryError when frames cannot be combined or something
	// was not accepted.
	async requestMaster(request: MasterRequest, automatic = false): Promise<MasterRequestResult> {
		await this.#usable()
		return this.#requestMaster(request, automatic)
	}

	// Starts a master over an open catalog.
	#requestMaster(request: MasterRequest, automatic: boolean, planId?: string): MasterRequestResult {
		if (request.token !== undefined) {
			const job = this.store.jobByToken(request.token)
			if (job?.build) return { jobId: job.jobId, masterId: job.build.masterId, revision: job.revision, state: job.state }
		}

		const { validation, sources, correction, dependencies, fingerprint } = this.#validate(request)

		if (validation.existing) return { ...validation.existing, state: 'completed' }

		const active = this.store.jobsIn(ACTIVE_JOB_STATES).find((job) => job.fingerprint === fingerprint)
		if (active?.build) return { jobId: active.jobId, masterId: active.build.masterId, state: active.state }

		if (!validation.valid) {
			const blocker = validation.findings.find(({ severity }) => severity === 'blocker')
			if (blocker) throw new LibraryError(blocker.message, 409, blocker.code === 'incompatibleFrames' || blocker.code === 'sourceMissing' || blocker.code === 'insufficientFrames' || blocker.code === 'invalidFlatCorrection' ? blocker.code : 'incompatibleFrames')
			throw new LibraryError(validation.findings.find(({ severity }) => severity === 'review')?.message ?? 'Something must be accepted first', 409, 'unknownMetadata')
		}

		const [{ kind, groupId, key }] = sources
		const now = Date.now()
		const job: CalibrationJob = {
			jobId: crypto.randomUUID(),
			type: 'master',
			state: 'queued',
			createdAt: now,
			updatedAt: now,
			automatic,
			token: request.token,
			fingerprint,
			progress: NO_PROGRESS,
			build: { ...this.#build(kind, groupId, key, sources, validation.recipe, validation.findings, correction, dependencies, request), planId },
		}
		this.jobs.enqueue(job)
		return { jobId: job.jobId, masterId: groupId, state: job.state }
	}

	// Freezes what a job builds. A master of a subset keeps the identity of its group: it is another revision of it.
	#build(kind: CalibrationKind, groupId: string, key: string, sources: readonly CalibrationSource[], recipe: CalibrationRecipe, findings: readonly CompatibilityFinding[], correction: CalibrationMaster | undefined, dependencies: readonly MasterReference[], request: MasterRequest): MasterBuild {
		return {
			masterId: groupId,
			kind,
			groupId,
			key,
			metadata: mergedMetadata(sources.map(({ metadata }) => metadata)),
			frames: sources.map(({ sourceId, path, bytes, mtimeMillis }) => ({ sourceId, path, bytes, mtimeMillis })),
			frameNames: sources.map(({ path }) => fileNameOf(path)),
			recipe,
			correction: correction && (correction.kind === 'bias' || correction.kind === 'darkFlat') ? { ...dependencies[0], kind: correction.kind } : undefined,
			acknowledged: request.acknowledged ? findings.filter(({ severity }) => severity === 'review') : [],
			partial: findings.some(({ code }) => code === 'incompleteGroup'),
		}
	}

	// Builds the message of a job to its worker.
	#workerRequest(job: CalibrationJob, staging: string): MasterWorkerRequest {
		const build = job.build!
		const { units } = masterContent(build.kind)
		const correction = build.correction && this.#masterFile(build.correction)
		return { jobId: job.jobId, kind: build.kind, frames: build.frames, recipe: build.recipe, correction, staging, header: masterHeader(build.kind, build.metadata, build.frames.length, units, build.correction?.kind), memoryBudget: this.jobs.memoryBudget }
	}

	// Makes a staged product visible. The frames are compared with what the job saw, the manifest goes next to the master, and the
	// rename publishes both at once; only then does the catalog say ready. A crash between them leaves a manifest the next start
	// adopts. Throws with a stable code, leaving what is published untouched.
	async #publish(job: CalibrationJob, result: IntegrationResult, staging: string) {
		const build = job.build!

		for (const { path, bytes, mtimeMillis } of build.frames) {
			const info = await stat(path).catch(() => undefined)
			if (!info) throw new IntegrationError('sourceMissing', `A frame is missing: ${fileNameOf(path)}`)
			if (info.size !== bytes || info.mtimeMs !== mtimeMillis) throw new IntegrationError('sourceChanged', `A frame changed: ${fileNameOf(path)}`)
		}

		if (build.correction && !(await stat(this.#masterFile(build.correction)).catch(() => undefined))) throw new IntegrationError('sourceMissing', 'The correction master is not available')

		const revision = this.store.latestRevision(build.masterId) + 1
		const warned = build.acknowledged.length > 0 || build.partial || result.diagnostics.lowSampleCount

		const master: CalibrationMaster = {
			masterId: build.masterId,
			revision,
			kind: build.kind,
			...masterContent(build.kind),
			fullScaleDn: result.fullScale,
			sourceIds: build.frames.map(({ sourceId }) => sourceId),
			sourceDigests: result.digests,
			sourceNames: build.frameNames,
			dependencies: build.correction ? [{ masterId: build.correction.masterId, revision: build.correction.revision, digest: build.correction.digest }] : [],
			recipe: build.recipe,
			fingerprint: job.fingerprint!,
			metadata: build.metadata,
			key: build.key,
			groupId: build.groupId,
			diagnostics: result.diagnostics,
			acknowledged: build.acknowledged,
			contentDigest: result.contentDigest,
			bytes: result.bytes,
			createdAt: Date.now(),
			status: warned ? 'warning' : 'ready',
		}

		const product = join(staging, 'product')

		try {
			await this.store.writeManifest(product, master)
			await mkdir(join(this.store.productsDirectory, build.masterId), { recursive: true })
			await rename(product, this.store.revisionDirectory(build.masterId, revision))
		} catch (error) {
			throw Object.assign(new Error(`The master could not be published (${errorCode(error) ?? 'unexpected error'})`), { code: 'publicationFailed' })
		}

		this.store.putMaster(master)
		this.store.putSources(this.#withDigests(master))
		this.listener({ type: 'calibrationLibrary:masterUpdated', epoch: this.#epoch, revision: ++this.#revision, master: masterSummary(master, this.store.preferred(master.masterId)) })
		this.#changed()
		return revision
	}

	// Returns the frames of a master with the digests its job read.
	#withDigests({ sourceIds, sourceDigests }: CalibrationMaster) {
		const sources: CalibrationSource[] = []

		for (const [index, sourceId] of sourceIds.entries()) {
			const source = this.store.source(sourceId)
			if (source) sources.push({ ...source, digest: sourceDigests[index] })
		}

		return sources
	}

	// Lists revisions, newest first.
	async masters(filter: MasterFilter, offset: number, limit: number): Promise<Page<CalibrationMasterSummary>> {
		await this.#usable()
		const { items, total } = this.store.masters(filter, offset, limit)
		return { items: items.map((master) => masterSummary(master, this.store.preferred(master.masterId))), total }
	}

	// Returns a revision with everything about it. Throws when unknown.
	async master(masterId: string, revision: number): Promise<CalibrationMasterDetail> {
		await this.#usable()
		const master = this.store.master(masterId, revision)
		if (!master) throw new LibraryError('Unknown master', 404, 'notFound')
		return { ...master, path: this.#masterFile(master), preferred: this.store.preferred(masterId) === revision }
	}

	// Makes a revision the preferred one. It changes a pointer and no data. Throws when unknown or not usable.
	async prefer(masterId: string, revision: number) {
		const master = await this.master(masterId, revision)
		if (master.status === 'unavailable') throw new LibraryError('The file of this master is not available', 409, 'productUnavailable')
		const record: CalibrationJournalRecord = { type: 'preferred', at: Date.now(), masterId, revision }
		await this.store.append([record])
		this.#apply(record)
		this.#changed()
		return { ...master, preferred: true }
	}

	// Lists jobs, newest first.
	async listJobs(offset: number, limit: number): Promise<Page<CalibrationJobSummary>> {
		await this.#usable()
		const { items, total } = this.store.jobs(offset, limit)
		return { items: items.map(jobSummary), total }
	}

	// Returns a job. Throws when unknown.
	async job(jobId: string) {
		await this.#usable()
		const job = this.store.job(jobId)
		if (!job) throw new LibraryError('Unknown job', 404, 'notFound')
		return jobSummary(job)
	}

	// Cancels a job. Throws when it already ended.
	async cancel(jobId: string) {
		const scan = this.#scans.get(jobId)
		const summary = await this.job(jobId)

		if (scan) {
			scan.abort(new DOMException('Cancelled', 'AbortError'))
			return summary
		}

		const job = await this.jobs.cancel(jobId)
		if (!job) throw new LibraryError('This job has ended', 409, 'jobConflict')
		return jobSummary(job)
	}

	// Retries a failed or interrupted job. Throws when it cannot.
	async retry(jobId: string) {
		await this.job(jobId)
		const job = await this.jobs.retry(jobId)
		if (!job) throw new LibraryError('Only a failed or interrupted master can be retried', 409, 'jobConflict')
		return jobSummary(job)
	}

	// Starts scanning a directory. The scan keeps running after this returns, reports through its job, and leaves candidates to review.
	async startImport({ path, recursive = true, depth }: ImportRequest) {
		await this.#usable()
		const info = await stat(path).catch(() => undefined)
		if (!info?.isDirectory()) throw new LibraryError('The directory cannot be read', 404, 'notFound')

		const now = Date.now()
		const scan = { path, recursive, depth, found: 0, bytes: 0, truncated: false }
		const job: CalibrationJob = { jobId: crypto.randomUUID(), type: 'import', state: 'validating', createdAt: now, updatedAt: now, automatic: false, progress: NO_PROGRESS, scan }
		this.store.putJob(job)
		this.#jobUpdated(job)

		const controller = new AbortController()
		this.#scans.set(job.jobId, controller)
		void this.#scan(job, controller.signal)
		return jobSummary(job)
	}

	// Saves a change of an import job and publishes it.
	#saveImport(job: CalibrationJob, patch: Partial<CalibrationJob>) {
		const next = { ...job, ...patch, updatedAt: Date.now() }
		this.store.putJob(next)
		this.#jobUpdated(next)
		return next
	}

	// Runs a scan to its end; a failure ends in its job.
	async #scan(job: CalibrationJob, signal: AbortSignal) {
		const { path, recursive, depth } = job.scan!
		let current = job
		let reported = 0

		try {
			const { candidates, truncated } = await scanDirectory({
				path,
				recursive,
				depth,
				signal,
				progress: (found, bytes) => {
					if (found - reported < 100) return
					reported = found
					current = this.#saveImport(current, { scan: { ...current.scan!, found, bytes } })
				},
			})

			this.store.putCandidates(
				job.jobId,
				candidates.map((candidate) => this.#candidate(path, candidate)),
			)
			let bytes = 0
			for (const candidate of candidates) bytes += candidate.bytes
			this.#saveImport(current, { state: 'completed', scan: { ...current.scan!, found: candidates.length, bytes, truncated } })
		} catch (error) {
			if (signal.aborted) this.#saveImport(current, { state: 'cancelled' })
			else this.#saveImport(current, { state: 'failed', code: 'processingFailed', error: `The directory could not be read (${errorCode(error) ?? 'unexpected error'})` })
		} finally {
			this.#scans.delete(job.jobId)
		}
	}

	// Describes a scanned file for review.
	#candidate(root: string, { path, bytes, mtimeMillis, inspection, error }: ScanCandidate): ImportCandidate {
		const known = this.store.source(makeKnownId(path)) !== undefined
		return { path, name: relative(root, path), bytes, mtimeMillis, format: inspection?.format, kind: inspection?.kind, rejectedRole: inspection?.rejectedRole, metadata: inspection?.metadata, warnings: inspection?.warnings ?? [], error, known }
	}

	// Lists what an import found. Paths are shown because the operator named their directory.
	async importCandidates(jobId: string, offset: number, limit: number): Promise<Page<ImportCandidate>> {
		await this.job(jobId)
		return this.store.candidates(jobId, offset, limit)
	}

	// Adds reviewed files to the library. A role comes from the file or from an audited classification, never from a name; a file
	// with neither stays out, as does a light or a master. Copies leave the original where it is. Returns how many frames entered.
	async commitImport(jobId: string, { paths, classifications = {}, copy = false }: ImportCommit) {
		await this.job(jobId)
		const job = this.store.job(jobId)!
		if (job.type !== 'import' || job.state !== 'completed' || job.scan?.committed !== undefined) throw new LibraryError('This import cannot be committed', 409, 'jobConflict')

		const chosen = paths && new Set(paths)
		const records: CalibrationJournalRecord[] = []
		const sources: CalibrationSource[] = []
		const at = Date.now()

		for (const candidate of this.store.allCandidates(jobId)) {
			if (chosen && !chosen.has(candidate.path)) continue
			const classification = classifications[candidate.path]
			const kind = classification?.kind ?? candidate.kind
			if (kind === undefined || candidate.known || candidate.error !== undefined || candidate.rejectedRole !== undefined || !candidate.metadata || !candidate.format) continue

			const warnings = [...candidate.warnings]
			if (classification) warnings.push(`Role declared by an operator: ${classification.reason}`)
			if (classification && candidate.kind !== undefined && candidate.kind !== kind) warnings.push(`The file says ${candidate.kind}`)

			let path = candidate.path
			let { bytes, mtimeMillis } = candidate

			if (copy) {
				const directory = this.store.sourcesDirectory(jobId)
				await mkdir(directory, { recursive: true })
				path = join(directory, `${stableId(candidate.path).slice(0, 8)}-${fileNameOf(candidate.path)}`)
				await copyFile(candidate.path, path, constants.COPYFILE_EXCL)
				const info = await stat(path)
				bytes = info.size
				mtimeMillis = info.mtimeMs
				warnings.push(`Copied from ${candidate.path}`)
			}

			const source = makeSource('import', jobId, kind, path, candidate.format, bytes, mtimeMillis, candidate.metadata, warnings, { supported: candidate.metadata.bitpix !== 64 })
			sources.push(source)
			records.push({ type: 'source', at, source })
			if (classification) records.push({ type: 'classification', at, sourceId: source.sourceId, kind, reason: classification.reason })
		}

		await this.store.append(records)
		this.store.putSources(sources)
		this.store.dropCandidates(jobId)
		this.#saveImport(job, { scan: { ...job.scan!, committed: sources.length } })
		this.#changed()
		return { committed: sources.length }
	}

	// Registers a frame the Flat Wizard published, as it is on the disk. What a file taken without a wheel leaves out comes from the
	// session, as declared by its plan. Failures are the caller's to swallow: a flat that cannot be indexed stays on the disk.
	async registerFlat({ path, sessionId, cameraId, cameraName, filter }: FlatFrameRegistration) {
		await this.#usable()
		const [inspection, info] = await Promise.all([inspectFile(path), stat(path)])
		if (!inspection) return

		const metadata: CalibrationMetadata = { ...inspection.metadata, cameraId: { value: cameraId, evidence: 'planDeclared' }, cameraName, filter: inspection.metadata.filter.value === undefined && filter !== undefined ? { value: filter, evidence: 'planDeclared' } : inspection.metadata.filter }
		const source = makeSource('flatWizard', sessionId, 'flat', path, inspection.format, info.size, info.mtimeMs, metadata, inspection.warnings)
		await this.store.append([{ type: 'source', at: Date.now(), source }])
		this.store.putSources([source])
		this.#changed()
	}

	// Indexes a plan whose acquisition ended and starts the masters it asked for. A master that cannot start never touches the plan
	// or the session; the group shows why.
	async planEnded(planId: string) {
		await this.#usable()
		await this.#indexPlans(planId)
		await this.#generate(planId)
		this.#changed()
	}

	// Starts the masters of the plans that asked for them and ended while the server was down. Idempotent, so it can run on every start.
	async #generatePending() {
		for (const { planId, status } of await this.plans.list(({ generateMasters }) => generateMasters === true)) {
			if (status !== 'running' && status !== 'paused') await this.#generate(planId)
		}
	}

	// Requests one master per complete group of a plan, from that group's frames alone. An incomplete group is never built on its own:
	// it stays a state of the group, and a provisional master is a person's decision. Only an unknown temperature is accepted
	// here, since a plan without a target or a thermometer records exactly that and the master says so.
	async #generate(planId: string) {
		const plan = await this.plans.plan(planId)
		if (!plan?.generateMasters) return

		for (const group of plan.groups) {
			const prefix = `${planId}/${group.groupId}/`
			const sources = this.store.sourcesOf('darkPlan').filter((source) => source.originId?.startsWith(prefix) && usable(source))
			if (sources.length < group.count) continue

			const reviews = compareFrames(
				sources[0].kind,
				sources.map(({ metadata }) => metadata),
			).filter(({ severity, field }) => severity === 'review' && field !== 'temperature')
			if (reviews.length > 0) continue

			try {
				this.#requestMaster({ sourceIds: sources.map(({ sourceId }) => sourceId), acknowledged: true }, true, planId)
			} catch {
				continue
			}
		}
	}

	// Explains which masters match a target, from metadata alone. Nothing is chosen for it.
	async resolvePreview(target: CalibrationTarget): Promise<ResolvePreview> {
		await this.#usable()
		const candidates: ResolvePreview['candidates'][number][] = []

		for (const { masterId, revision, kind, metadata, status } of this.store.allMasters()) {
			if (status !== 'unavailable') candidates.push({ masterId, revision, kind, ...matchMaster(kind, metadata, target) })
		}

		const kinds: readonly CalibrationKind[] = ['dark', 'bias', 'flat']
		return { candidates, missingKinds: kinds.filter((kind) => !candidates.some((candidate) => candidate.kind === kind && candidate.verdict === 'compatible')) }
	}

	// Stops the running job and closes the catalog.
	close() {
		this.jobs.stop()
		for (const scan of this.#scans.values()) scan.abort(new DOMException('Stopped', 'AbortError'))
		this.store.close()
	}
}

// Returns the id a frame at a path has, whatever else is known about it.
function makeKnownId(path: string) {
	return stableId(process.platform === 'win32' ? path.toLowerCase() : path)
}

// Answers a failure of a route with its status and code.
function failure(error: unknown) {
	if (error instanceof LibraryError) return errorResponse(error.message, error.status, error.code)
	return errorResponse(Error.isError(error) ? error.message : String(error), 500, 'processingFailed')
}

// Runs a handler, answering its result as JSON.
async function answer(handler: () => Promise<unknown>, status = 200) {
	try {
		return Response.json(await handler(), { status })
	} catch (error) {
		return failure(error)
	}
}

// Reads a page and the filters of a query string.
function pageOf(request: Request) {
	const { searchParams } = new URL(request.url)
	const offset = Number(searchParams.get('offset')) || 0
	const limit = Number(searchParams.get('limit')) || DEFAULT_PAGE_SIZE
	return { searchParams, offset, limit }
}

// Reads the frame filters of a query string.
function sourceFilter(searchParams: URLSearchParams): SourceFilter {
	return {
		kind: (searchParams.get('kind') as CalibrationKind | null) ?? undefined,
		camera: searchParams.get('camera') ?? undefined,
		status: (searchParams.get('status') as SourceStatus | null) ?? undefined,
		groupId: searchParams.get('groupId') ?? undefined,
		search: searchParams.get('search') || undefined,
	}
}

// Routes of the Calibration Library. None of them needs a connection or touches a device.
export function createCalibrationLibraryRoutes(library: CalibrationLibrary) {
	return {
		'/api/calibration-library': {
			GET: () =>
				answer(async () => {
					await library.ready()
					return library.snapshot()
				}),
		},
		'/api/calibration-library/refresh': {
			POST: () => answer(() => library.refresh()),
		},
		'/api/calibration-library/sources': {
			GET: (request) => {
				const { searchParams, offset, limit } = pageOf(request)
				return answer(() => library.sources(sourceFilter(searchParams), offset, limit))
			},
		},
		'/api/calibration-library/sources/:sourceId': {
			GET: ({ params }) => answer(() => library.source(params.sourceId)),
		},
		'/api/calibration-library/sources/:sourceId/overrides': {
			POST: async (request) => {
				const { field, value, reason } = (await request.json()) as { readonly field: OverridableField; readonly value: string | number; readonly reason: string }
				return answer(() => library.override(request.params.sourceId, field, value, reason))
			},
		},
		'/api/calibration-library/sources/:sourceId/exclusion': {
			POST: async (request) => {
				const { reason } = (await request.json()) as { readonly reason?: string }
				return answer(() => library.exclude(request.params.sourceId, reason))
			},
		},
		'/api/calibration-library/imports': {
			POST: async (request) => {
				const body = (await request.json()) as ImportRequest
				return answer(() => library.startImport(body), 202)
			},
		},
		'/api/calibration-library/imports/:jobId/candidates': {
			GET: (request) => {
				const { offset, limit } = pageOf(request)
				return answer(() => library.importCandidates(request.params.jobId, offset, limit))
			},
		},
		'/api/calibration-library/imports/:jobId/commit': {
			POST: async (request) => {
				const body = (await request.json()) as ImportCommit
				return answer(() => library.commitImport(request.params.jobId, body))
			},
		},
		'/api/calibration-library/groups': {
			GET: (request) => {
				const { searchParams, offset, limit } = pageOf(request)
				return answer(() => library.groups(sourceFilter(searchParams), offset, limit))
			},
		},
		'/api/calibration-library/groups/:groupId': {
			GET: ({ params }) => answer(() => library.group(params.groupId)),
		},
		'/api/calibration-library/recipes/validate': {
			POST: async (request) => {
				const body = (await request.json()) as MasterRequest
				return answer(() => library.validate(body))
			},
		},
		'/api/calibration-library/masters': {
			GET: (request) => {
				const { searchParams, offset, limit } = pageOf(request)
				const filter: MasterFilter = { kind: (searchParams.get('kind') as CalibrationKind | null) ?? undefined, camera: searchParams.get('camera') ?? undefined, filter: searchParams.get('filter') ?? undefined, masterId: searchParams.get('masterId') ?? undefined }
				return answer(() => library.masters(filter, offset, limit))
			},
			POST: async (request) => {
				const body = (await request.json()) as MasterRequest

				try {
					const result = await library.requestMaster(body)
					return Response.json(result, { status: result.jobId === undefined ? 200 : 202 })
				} catch (error) {
					return failure(error)
				}
			},
		},
		'/api/calibration-library/masters/:masterId/revisions/:revision': {
			GET: ({ params }) => answer(() => library.master(params.masterId, Number(params.revision))),
		},
		'/api/calibration-library/masters/:masterId/preferred': {
			POST: async (request) => {
				const { revision } = (await request.json()) as { readonly revision: number }
				return answer(() => library.prefer(request.params.masterId, revision))
			},
		},
		'/api/calibration-library/jobs': {
			GET: (request) => {
				const { offset, limit } = pageOf(request)
				return answer(() => library.listJobs(offset, limit))
			},
		},
		'/api/calibration-library/jobs/:jobId': {
			GET: ({ params }) => answer(() => library.job(params.jobId)),
		},
		'/api/calibration-library/jobs/:jobId/cancel': {
			POST: ({ params }) => answer(() => library.cancel(params.jobId)),
		},
		'/api/calibration-library/jobs/:jobId/retry': {
			POST: ({ params }) => answer(() => library.retry(params.jobId)),
		},
		'/api/calibration-library/resolve-preview': {
			POST: async (request) => {
				const target = (await request.json()) as CalibrationTarget
				return answer(() => library.resolvePreview(target))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
