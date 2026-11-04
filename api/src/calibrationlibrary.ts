import { constants } from 'fs'
import { copyFile, mkdir, rename, rm, stat } from 'fs/promises'
import { basename, join, relative } from 'path'
import { fileDigest, type IntegrationProgress, type IntegrationResult, IntegrationError, masterHeader, MasterIntegrator, type MasterWorkerRequest } from './calibrationlibrary.analysis'
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
	matchesTarget,
	type MasterReference,
	type OverridableField,
	OVERRIDABLE_FIELDS,
	RECOMMENDED_FRAMES,
	stableId,
} from './calibrationlibrary.compatibility'
import { ACTIVE_JOB_STATES, type CalibrationJob, CalibrationJobs, type CalibrationJobSummary, type Integrator, jobSummary, type MasterBuild, NO_PROGRESS } from './calibrationlibrary.jobs'
import { darkPlanSource, type FileInspection, fileIdentity, inspectFile, makeSource, regrouped, type ScanCandidate, scanDirectory } from './calibrationlibrary.sources'
import {
	type CalibrationLibraryStore,
	type CalibrationMaster,
	type CalibrationSource,
	type CalibrationSourceSummary,
	fileNameOf,
	MASTER_FILE,
	MAX_PAGE_SIZE,
	type MasterCalibrationState,
	type MasterFilter,
	type Page,
	type ProductStatus,
	type SourceFilter,
	type SourceStatus,
	sourceSummary,
	type StoredGroup,
} from './calibrationlibrary.store'
import type { DarkCapturePlan, DarkFrameRecord } from './darklibrarywizard.plan'
import { errorResponse } from './http'
import { errorCode } from './util'

// Calibration Library: the single owner of what calibration frames exist, whether they can be combined, and which masters
// were made of them. It needs no camera and claims no device: frames come from what the Dark Library Wizard and the Flat
// Wizard publish, and from directories an operator imports, always by reference and never modified.
// Every build publishes a new immutable master with an incremental id, however many there already are of the same frames;
// jobs live in memory: they survive the tab, never the server. What it indexes and publishes is kept by
// CalibrationLibraryStore in the operational database. A wizard may ask for a master, through the same path as a person.
// Only an operator deletes: a frame or a group with their files, or one master. Applying a master to a light is outside
// this service: it only lists which masters match.

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
	| 'notFound'
	| 'verifiedMetadata'
	| 'importFailed'
	| 'masterInUse'
	| 'deleteFailed'

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
	// Frames by state, and by role.
	readonly frames: StateCounts
	readonly framesByKind: StateCounts
	// Masters by state, and by role.
	readonly masters: StateCounts
	readonly mastersByKind: StateCounts
	// Names of the cameras of the frames, sorted.
	readonly cameras: readonly string[]
	// Jobs still working.
	readonly activeJobs: readonly CalibrationJobSummary[]
	// Latest jobs of the wizards, so a reloaded tab still shows how their masters ended.
	readonly recentJobs: readonly CalibrationJobSummary[]
}

// What lists and events show of a master.
export interface CalibrationMasterSummary {
	// Id of the master, incremental and never reused.
	readonly masterId: number
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
	// When it was published.
	readonly createdAt: number
	// State.
	readonly status: CalibrationMaster['status']
	// Group of its frames.
	readonly groupId: string
	// Masters it depends on.
	readonly dependencies: readonly MasterReference[]
	// SHA-256 of its FITS file, which a reference holds.
	readonly contentDigest: string
}

// A master with what is only for one who asks: its path, for opening it in Images.
export interface CalibrationMasterDetail extends CalibrationMaster {
	// Absolute path of its FITS file.
	readonly path: string
}

// Event of the library.
export type CalibrationLibraryEvent =
	// Anything of the library changed.
	| { readonly type: 'calibrationLibrary:changed'; readonly revision: number; readonly summary: CalibrationLibrarySnapshot }
	// A job changed.
	| { readonly type: 'calibrationLibrary:jobUpdated'; readonly epoch: string; readonly revision: number; readonly job: CalibrationJobSummary }
	// A master was published.
	| { readonly type: 'calibrationLibrary:masterUpdated'; readonly epoch: string; readonly revision: number; readonly master: CalibrationMasterSummary }

// Explained group of frames.
export interface CalibrationGroupSummary {
	// Id of the group.
	readonly groupId: string
	// Role.
	readonly kind: CalibrationKind
	// What its frames share.
	readonly metadata: CalibrationMetadata
	// Shortest and longest exposure of the frames it compares, in integer microseconds, when they differ: a flat group
	// combines frames of any exposure, which only a bias can correct together. Absent when they share one.
	readonly exposures?: readonly [minimum: number, maximum: number]
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
	// Latest masters of its frames, newest first.
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
	// Id of the master that corrects a flat.
	readonly correction?: number
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
}

// Answer of a master request.
export interface MasterRequestResult {
	// Job doing it, whose summary names the master once published.
	readonly jobId: string
	// State of the job.
	readonly state: CalibrationJob['state']
}

// A request to import a directory.
export interface ImportRequest {
	// Directories and files on the server.
	readonly paths: readonly string[]
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
	// Roles an operator declares, by path.
	readonly classifications?: Readonly<Record<string, CalibrationKind>>
	// Whether to copy the files into the library instead of referencing them.
	readonly copy?: boolean
}

// Masters a metadata-only preview finds for a target.
export interface ResolvePreview {
	// Masters that match it and can be read, newest first.
	readonly candidates: readonly CalibrationMasterSummary[]
}

// A frame the Flat Wizard published.
export interface FlatFrameRegistration {
	// Absolute path of the frame.
	readonly path: string
	// Session it came from.
	readonly sessionId: string
	// Name of the camera.
	readonly cameraName: string
	// Name of the filter in the beam, which a file taken without a wheel leaves out.
	readonly filter?: string
}

// Frame the Dark Library Wizard published, with the plan and the record it was taken under.
export interface DarkFrameRegistration {
	// Plan of the session that took it.
	readonly plan: DarkCapturePlan
	// Group of the plan it belongs to.
	readonly groupId: string
	// What the session examined and decided about it.
	readonly frame: DarkFrameRecord
}

// Filters a Flat Wizard session that asked for masters completed, once it ended.
export interface FlatSessionEnd {
	// Session that published the frames.
	readonly sessionId: string
	// Each completed filter, by its name, with the absolute paths of every frame it published.
	readonly groups: readonly { readonly filter: string; readonly paths: readonly string[] }[]
}

// Whether a frame can enter a master.
function usable(source: CalibrationSource) {
	return source.status === 'available' && source.supported && !source.excluded
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

// Returns the shortest and longest known exposure of frames, in integer microseconds, or undefined when they share one.
function exposureRange(frames: readonly CalibrationMetadata[]): readonly [minimum: number, maximum: number] | undefined {
	let minimum = Number.POSITIVE_INFINITY
	let maximum = Number.NEGATIVE_INFINITY

	for (const { exposure } of frames) {
		if (exposure.value === undefined) continue
		minimum = Math.min(minimum, exposure.value)
		maximum = Math.max(maximum, exposure.value)
	}

	return minimum < maximum ? [minimum, maximum] : undefined
}

// Returns the most frames a plan required of these frames, 0 when none did.
function requiredFrames(sources: readonly CalibrationSource[]) {
	let required = 0
	for (const source of sources) required = Math.max(required, source.required ?? 0)
	return required
}

// Returns what a list shows of a master.
function masterSummary(master: CalibrationMaster): CalibrationMasterSummary {
	const { masterId, kind, calibrationState, units, metadata, recipe, createdAt, status, groupId, dependencies, sourceIds, contentDigest } = master
	return { masterId, kind, calibrationState, units, metadata, frames: sourceIds.length, method: recipe.method, createdAt, status, groupId, dependencies, contentDigest }
}

// The service. Work waits for the first open of the library, so importing this module touches no file.
export class CalibrationLibrary {
	// Id of this process.
	readonly #epoch = crypto.randomUUID()
	// Change counter.
	#revision = 0
	// First open of the library and the reconciliation after it.
	#opened?: Promise<void>
	// Import scans running, by job.
	readonly #scans = new Map<string, AbortController>()
	// Masters another tool is reading, by id, with how many holders.
	readonly #leases = new Map<number, number>()
	// Last registration of a flat of each Flat Wizard session, so the end of a session waits for its frames.
	readonly #flatRegistrations = new Map<string, Promise<void>>()
	// Last registration of a dark of each Dark Library plan, so the end of a session waits for its frames.
	readonly #darkRegistrations = new Map<string, Promise<void>>()
	// Queue of the master jobs.
	readonly jobs: CalibrationJobs

	// Creates the service. listener receives every change synchronously; busy says whether a camera operation is running,
	// which holds automatic jobs back.
	constructor(
		readonly store: CalibrationLibraryStore,
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

	// Opens the library once and brings it in line with the disk. Fails nothing that a retry could fix: a request after a
	// failure opens it again.
	ready() {
		this.#opened ??= this.#open().catch((error: unknown) => {
			this.#opened = undefined
			throw error
		})
		return this.#opened
	}

	// Finishes what a crash interrupted, checks the masters, and resumes the jobs.
	async #open() {
		await this.#recoverMasters()
		await this.#reconcileMasters()
		await this.jobs.start()
		await this.#refreshFiles()
		this.#changed()
	}

	// Waits until the library is open.
	async #usable() {
		await this.ready()
	}

	// Finishes what a crash interrupted, from the disk: a master being published becomes published when its directory holds
	// the file it recorded, and is forgotten otherwise, its id staying taken; a master being deleted loses its directory and
	// its row. A master directory without a row is moved to orphaned/ and reported, never adopted nor deleted. What cannot
	// be finished is reported and tried again on the next start.
	async #recoverMasters() {
		for (const { master, publication } of this.store.pending()) {
			const { masterId } = master

			try {
				if (publication === 'deleting') {
					await rm(this.store.masterDirectory(masterId), { recursive: true, force: true })
					this.store.discardMaster(masterId)
				} else if (await this.#intact(master)) {
					this.store.completePublication(masterId, this.#withDigests(master))
				} else {
					this.store.discardMaster(masterId)
				}
			} catch (error) {
				console.error('calibration library: unable to finish master', masterId, error)
			}
		}

		for (const { masterId, name } of await this.store.productDirectories()) {
			if (masterId !== undefined && this.store.hasMaster(masterId)) continue
			const target = join(this.store.orphanedDirectory, `${name}-${crypto.randomUUID()}`)

			try {
				await mkdir(this.store.orphanedDirectory, { recursive: true })
				await rename(join(this.store.productsDirectory, name), target)
				console.warn(`calibration library: ${name} has no record and was moved to ${target}`)
			} catch (error) {
				console.error('calibration library: unable to move an orphaned master', name, error)
			}
		}
	}

	// Returns whether the file of a master is the one it recorded, by size and SHA-256.
	async #intact(master: CalibrationMaster) {
		const file = this.#masterFile(master.masterId)
		const info = await stat(file).catch(() => undefined)
		return info?.size === master.bytes && (await fileDigest(file)) === master.contentDigest
	}

	// Marks a master unavailable while its file is missing or of another size, stale while a master it depends on is
	// unavailable, and gives it back the state it was published with once neither holds.
	async #reconcileMasters() {
		const masters = this.store.allMasters()
		const unavailable = new Set<number>()

		for (const master of masters) {
			const info = await stat(this.#masterFile(master.masterId)).catch(() => undefined)
			if (info?.size !== master.bytes) unavailable.add(master.masterId)
		}

		const changes: { masterId: number; status: 'unavailable' | 'stale' | 'published' }[] = []

		for (const { masterId, status, dependencies } of masters) {
			const next = unavailable.has(masterId) ? 'unavailable' : dependencies.some((dependency) => unavailable.has(dependency.masterId)) ? 'stale' : 'published'
			const current = status === 'unavailable' || status === 'stale' ? status : 'published'
			if (next !== current) changes.push({ masterId, status: next })
		}

		this.store.setStatuses(changes)
	}

	// Path of the FITS file of a master.
	#masterFile(masterId: number) {
		return join(this.store.masterDirectory(masterId), MASTER_FILE)
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

	// Compares the files with the disk on request.
	async refresh() {
		await this.#usable()
		await this.#refreshFiles()
		this.#changed()
		return this.snapshot()
	}

	// Builds the snapshot.
	snapshot(): CalibrationLibrarySnapshot {
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

		const activeJobs = this.jobs.inStates(ACTIVE_JOB_STATES).map(jobSummary)
		const recentJobs = this.jobs
			.latest(RECENT_JOBS)
			.filter(({ automatic }) => automatic)
			.map(jobSummary)
		return { epoch: this.#epoch, revision: this.#revision, frames, framesByKind, masters: mastersByState, mastersByKind, cameras, activeJobs, recentJobs }
	}

	// Publishes a change of the library.
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

	// Records a value of a frame that was unknown, and regroups it. A value the file or a plan states cannot
	// be replaced: a conflict with a measurement is an incompatibility, not an edit. Throws LibraryError.
	async override(sourceId: string, field: OverridableField, value: string | number) {
		const source = await this.source(sourceId)
		if (!OVERRIDABLE_FIELDS.includes(field)) throw new LibraryError(`${field} cannot be declared`, 409, 'verifiedMetadata')

		const { evidence } = source.metadata[field] as Evidenced<unknown>
		if (evidence === 'verified' || evidence === 'planDeclared') throw new LibraryError(`${field} is ${evidence} and cannot be replaced`, 409, 'verifiedMetadata')

		this.store.putSources([regrouped(source, source.kind, { ...source.metadata, [field]: { value, evidence: 'operatorDeclared' } })])
		this.#changed()
		return sourceSummary(this.store.source(sourceId)!)
	}

	// Leaves a frame out of masters, or brings it back.
	async exclude(sourceId: string, excluded: boolean) {
		const source = await this.source(sourceId)
		this.store.putSources([{ ...source, excluded }])
		this.#changed()
		return sourceSummary(this.store.source(sourceId)!)
	}

	// Explains a group.
	#describeGroup({ groupId, sources }: StoredGroup): CalibrationGroupSummary {
		const included = sources.filter((source) => !source.excluded)
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

		const masters = this.store.masters({ groupId }, 0, 20).items.map(masterSummary)
		const metadata = mergedMetadata(compared.map(({ metadata }) => metadata))
		const exposures = exposureRange(compared.map(({ metadata }) => metadata))
		return {
			groupId,
			kind: sources[0].kind,
			metadata,
			...(exposures && { exposures }),
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

	// Deletes a group: the file of every frame, wherever it is, and the frames from the library. Its masters stay, since they
	// are products of their own. A frame whose file cannot be deleted stays in the library. Returns how many frames went away.
	// Throws when the group is unknown, a master of it is being built, or a file could not be deleted.
	async deleteGroup(groupId: string) {
		await this.#usable()
		const { sources } = this.store.group(groupId)
		if (sources.length === 0) throw new LibraryError('Unknown group', 404, 'notFound')
		if (this.jobs.inStates(ACTIVE_JOB_STATES).some(({ build }) => build?.groupId === groupId)) throw new LibraryError('A master of this group is being built', 409, 'jobConflict')
		return await this.#deleteSources(sources)
	}

	// Deletes one frame: its file, wherever it is, and the frame from the library. Masters made with it stay. Throws when the
	// frame is unknown, a master being built uses it, or its file could not be deleted.
	async deleteSource(sourceId: string) {
		const source = await this.source(sourceId)
		if (this.jobs.inStates(ACTIVE_JOB_STATES).some(({ build }) => build?.frames.some((frame) => frame.sourceId === sourceId))) throw new LibraryError('A master being built uses this frame', 409, 'jobConflict')
		return await this.#deleteSources([source])
	}

	// Deletes the files of frames and forgets the frames whose file went away.
	// Returns how many went away; throws deleteFailed after forgetting the others when a file could not be deleted.
	async #deleteSources(sources: readonly CalibrationSource[]) {
		const removed: string[] = []
		const failures = new Set<string>()

		for (const { sourceId, path } of sources) {
			try {
				await rm(path, { force: true })
				removed.push(sourceId)
			} catch (error) {
				failures.add(errorCode(error) ?? 'unexpected error')
			}
		}

		this.store.removeSources(removed)
		this.#changed()

		if (failures.size > 0) throw new LibraryError(`${sources.length - removed.length} frames could not be deleted (${[...failures].join(', ')})`, 500, 'deleteFailed')
		return { deleted: removed.length }
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

		const excluded = sources.filter(({ excluded }) => excluded).length
		if (excluded > 0) findings.push({ field: 'frames', code: 'incompatibleFrames', severity: 'blocker', message: `${excluded} frames are left out` })

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
			correction = request.correction === undefined ? undefined : this.store.master(request.correction)

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

		const dependencies: MasterReference[] = correction ? [{ masterId: correction.masterId, digest: correction.contentDigest }] : []
		const blocked = findings.some(({ severity }) => severity === 'blocker')
		const needsAcknowledgement = findings.some(({ severity }) => severity === 'review')
		let spillBytes = 0
		for (const { format, bytes } of sources) if (format === 'xisf') spillBytes += bytes
		const validation: RecipeValidation = { valid: !blocked && (!needsAcknowledgement || request.acknowledged === true), kind, groupId: sources[0]?.groupId, frames: sources.length, recipe, findings, needsAcknowledgement, spillBytes }
		return { validation, sources, correction, dependencies }
	}

	// Explains a request without starting anything.
	async validate(request: MasterRequest) {
		await this.#usable()
		return this.#validate(request).validation
	}

	// Starts a new master, whatever was built before of the same frames; only a repeated token meets the job it started. The
	// job is queued before this returns. Throws LibraryError when frames cannot be combined or something was not accepted.
	async requestMaster(request: MasterRequest, automatic = false): Promise<MasterRequestResult> {
		await this.#usable()
		return this.#requestMaster(request, automatic)
	}

	// Starts a master over an open library.
	#requestMaster(request: MasterRequest, automatic: boolean, planId?: string): MasterRequestResult {
		if (request.token !== undefined) {
			const job = this.jobs.byToken(request.token)
			if (job?.build) return { jobId: job.jobId, state: job.state }
		}

		const { validation, sources, correction, dependencies } = this.#validate(request)

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
			progress: NO_PROGRESS,
			build: { ...this.#build(kind, groupId, key, sources, validation.recipe, validation.findings, correction, dependencies, request), planId },
		}
		this.jobs.enqueue(job)
		return { jobId: job.jobId, state: job.state }
	}

	// Freezes what a job builds. A master of a subset still belongs to the group of its frames.
	#build(kind: CalibrationKind, groupId: string, key: string, sources: readonly CalibrationSource[], recipe: CalibrationRecipe, findings: readonly CompatibilityFinding[], correction: CalibrationMaster | undefined, dependencies: readonly MasterReference[], request: MasterRequest): MasterBuild {
		return {
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
		const correction = build.correction && this.#masterFile(build.correction.masterId)
		return { jobId: job.jobId, kind: build.kind, frames: build.frames, recipe: build.recipe, correction, staging, header: masterHeader(build.kind, build.metadata, build.frames.length, units, build.correction?.kind), memoryBudget: this.jobs.memoryBudget }
	}

	// Makes a staged product visible as a new master. The frames are compared with what the job saw, the next id is taken and
	// the master recorded as publishing, the rename moves its directory into products/, and only then is it published. A crash
	// between them is finished on the next start from what the directory holds. Returns the id. Throws with a stable code,
	// leaving what is published untouched; an id taken is never used again.
	async #publish(job: CalibrationJob, result: IntegrationResult, staging: string) {
		const build = job.build!

		for (const { path, bytes, mtimeMillis } of build.frames) {
			const info = await stat(path).catch(() => undefined)
			if (!info) throw new IntegrationError('sourceMissing', `A frame is missing: ${fileNameOf(path)}`)
			if (info.size !== bytes || info.mtimeMs !== mtimeMillis) throw new IntegrationError('sourceChanged', `A frame changed: ${fileNameOf(path)}`)
		}

		if (build.correction && !(await stat(this.#masterFile(build.correction.masterId)).catch(() => undefined))) throw new IntegrationError('sourceMissing', 'The correction master is not available')

		const warned = build.acknowledged.length > 0 || build.partial || result.diagnostics.lowSampleCount

		const recorded: Omit<CalibrationMaster, 'masterId'> = {
			kind: build.kind,
			...masterContent(build.kind),
			fullScaleDn: result.fullScale,
			sourceIds: build.frames.map(({ sourceId }) => sourceId),
			sourceDigests: result.digests,
			sourceNames: build.frameNames,
			dependencies: build.correction ? [{ masterId: build.correction.masterId, digest: build.correction.digest }] : [],
			recipe: build.recipe,
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
		const failed = (error: unknown) => Object.assign(new Error(`The master could not be published (${errorCode(error) ?? (Error.isError(error) ? error.message : 'unexpected error')})`), { code: 'publicationFailed' })
		let master: CalibrationMaster

		try {
			master = this.store.beginPublication(recorded)
		} catch (error) {
			throw failed(error)
		}

		const { masterId } = master

		try {
			await mkdir(this.store.productsDirectory, { recursive: true })
			await rename(product, this.store.masterDirectory(masterId))
		} catch (error) {
			try {
				this.store.discardMaster(masterId)
			} catch (discardError) {
				console.error('calibration library: unable to forget an unpublished master', masterId, discardError)
			}

			throw failed(error)
		}

		this.store.completePublication(masterId, this.#withDigests(master))
		this.listener({ type: 'calibrationLibrary:masterUpdated', epoch: this.#epoch, revision: ++this.#revision, master: masterSummary(master) })
		this.#changed()
		return masterId
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

	// Lists masters, newest first.
	async masters(filter: MasterFilter, offset: number, limit: number): Promise<Page<CalibrationMasterSummary>> {
		await this.#usable()
		const { items, total } = this.store.masters(filter, offset, limit)
		return { items: items.map(masterSummary), total }
	}

	// Returns a master with everything about it. Throws when unknown.
	async master(masterId: number): Promise<CalibrationMasterDetail> {
		await this.#usable()
		const master = this.store.master(masterId)
		if (!master) throw new LibraryError('Unknown master', 404, 'notFound')
		return { ...master, path: this.#masterFile(masterId) }
	}

	// Deletes one master with its directory. Its id is never used again, and a master another master depends on, or a master
	// being built depends on, cannot go. The master is recorded as deleting before its directory goes, so a crash between
	// them is finished on the next start. Throws when unknown, in use, or its directory could not be deleted, which leaves it
	// published.
	async deleteMaster(masterId: number) {
		await this.master(masterId)
		if (this.store.isDependency(masterId)) throw new LibraryError('A master flat was corrected by this master; delete that flat first', 409, 'masterInUse')
		if (this.jobs.inStates(ACTIVE_JOB_STATES).some(({ build }) => build?.correction?.masterId === masterId)) throw new LibraryError('A master flat being built is corrected by this master', 409, 'masterInUse')
		if (this.#leases.has(masterId)) throw new LibraryError('A job of Image Stacking is reading this master', 409, 'masterInUse')

		this.store.setDeleting(masterId, true)

		try {
			await rm(this.store.masterDirectory(masterId), { recursive: true, force: true })
		} catch (error) {
			this.store.setDeleting(masterId, false)
			throw new LibraryError(`The master could not be deleted (${errorCode(error) ?? 'unexpected error'})`, 500, 'deleteFailed')
		}

		this.store.discardMaster(masterId)
		this.#changed()
		return { masterId }
	}

	// Returns a job of this process. Throws when unknown, as every job of a previous process is.
	async job(jobId: string) {
		return jobSummary(await this.#job(jobId))
	}

	// Returns a job of this process with what only the server sees. Throws when unknown.
	async #job(jobId: string) {
		await this.#usable()
		const job = this.jobs.get(jobId)
		if (!job) throw new LibraryError('Unknown job', 404, 'notFound')
		return job
	}

	// Cancels the scan of an import. Throws when it already ended.
	async cancelImport(jobId: string) {
		const summary = await this.job(jobId)
		const scan = this.#scans.get(jobId)
		if (!scan) throw new LibraryError('This import has ended', 409, 'jobConflict')
		scan.abort(new DOMException('Cancelled', 'AbortError'))
		return summary
	}

	// Starts scanning directories and single files. The scan keeps running after this returns, reports through its job, and
	// leaves candidates to review. Throws when a path cannot be read.
	async startImport({ paths, recursive = true, depth }: ImportRequest) {
		await this.#usable()

		for (const path of paths) {
			if (!(await stat(path).catch(() => undefined))) throw new LibraryError(`${basename(path)} cannot be read`, 404, 'notFound')
		}

		const now = Date.now()
		const scan = { paths, recursive, depth, found: 0, bytes: 0, truncated: false }
		const job: CalibrationJob = { jobId: crypto.randomUUID(), type: 'import', state: 'validating', createdAt: now, updatedAt: now, automatic: false, progress: NO_PROGRESS, scan }
		this.jobs.save(job)

		const controller = new AbortController()
		this.#scans.set(job.jobId, controller)
		void this.#scan(job, controller.signal)
		return jobSummary(job)
	}

	// Saves a change of an import job and publishes it.
	#saveImport(job: CalibrationJob, patch: Partial<CalibrationJob>) {
		const next = { ...job, ...patch, updatedAt: Date.now() }
		this.jobs.save(next)
		return next
	}

	// Runs a scan to its end, path after path; a file reached through two paths or two names is found once. A failure ends
	// in its job.
	async #scan(job: CalibrationJob, signal: AbortSignal) {
		const { paths, recursive, depth } = job.scan!
		let current = job
		let reported = 0
		const candidates: ImportCandidate[] = []
		const seen = new Set<string>()
		let truncated = false
		let bytes = 0

		// Adds a file once, whichever path found it first.
		const add = (root: string, candidate: ScanCandidate) => {
			if (seen.has(candidate.identity)) return
			seen.add(candidate.identity)
			candidates.push(this.#candidate(root, candidate))
			bytes += candidate.bytes
		}

		try {
			for (const root of paths) {
				const info = await stat(root)

				if (info.isDirectory()) {
					const scan = await scanDirectory({
						path: root,
						recursive,
						depth,
						signal,
						progress: (found, size) => {
							if (candidates.length + found - reported < 100) return
							reported = candidates.length + found
							current = this.#saveImport(current, { scan: { ...current.scan!, found: reported, bytes: bytes + size } })
						},
					})

					truncated ||= scan.truncated
					for (const candidate of scan.candidates) add(root, candidate)
				} else {
					signal.throwIfAborted()
					const identity = await fileIdentity(root)
					const inspection = await inspectFile(root).catch((error: unknown) => (Error.isError(error) ? error.message : String(error)))
					const base = { path: root, bytes: info.size, mtimeMillis: info.mtimeMs, identity }
					add(root, typeof inspection === 'string' ? { ...base, error: inspection } : inspection ? { ...base, inspection } : { ...base, error: 'The file holds no image' })
				}
			}

			this.#saveImport(current, { state: 'completed', candidates, scan: { ...current.scan!, found: candidates.length, bytes, truncated } })
		} catch (error) {
			if (signal.aborted) this.#saveImport(current, { state: 'cancelled' })
			else this.#saveImport(current, { state: 'failed', code: 'processingFailed', error: `The files could not be read (${errorCode(error) ?? 'unexpected error'})` })
		} finally {
			this.#scans.delete(job.jobId)
		}
	}

	// Describes a scanned file for review, named under the directory chosen, or by its own name when it was chosen itself.
	#candidate(root: string, { path, bytes, mtimeMillis, inspection, error }: ScanCandidate): ImportCandidate {
		const known = this.store.source(makeKnownId(path)) !== undefined
		return { path, name: path === root ? basename(path) : relative(root, path), bytes, mtimeMillis, format: inspection?.format, kind: inspection?.kind, rejectedRole: inspection?.rejectedRole, metadata: inspection?.metadata, warnings: inspection?.warnings ?? [], error, known }
	}

	// Lists what an import found. Paths are shown because the operator chose where to look.
	async importCandidates(jobId: string, offset: number, limit: number): Promise<Page<ImportCandidate>> {
		const candidates = (await this.#job(jobId)).candidates ?? []
		return { items: candidates.slice(offset, offset + Math.min(limit, MAX_PAGE_SIZE)), total: candidates.length }
	}

	// Adds reviewed files to the library. A role comes from the file or from an operator, never from a name; a file
	// with neither stays out, as does a light or a master. Copies leave the original where it is. Returns how many frames entered.
	async commitImport(jobId: string, { paths, classifications = {}, copy = false }: ImportCommit) {
		const job = await this.#job(jobId)
		if (job.type !== 'import' || job.state !== 'completed' || job.scan?.committed !== undefined) throw new LibraryError('This import cannot be committed', 409, 'jobConflict')

		const chosen = paths && new Set(paths)
		const sources: CalibrationSource[] = []

		for (const candidate of job.candidates ?? []) {
			if (chosen && !chosen.has(candidate.path)) continue
			const declared = classifications[candidate.path]
			const kind = declared ?? candidate.kind
			if (kind === undefined || candidate.known || candidate.error !== undefined || candidate.rejectedRole !== undefined || !candidate.metadata || !candidate.format) continue

			const warnings = [...candidate.warnings]
			if (declared) warnings.push('Role declared by an operator')
			if (declared && candidate.kind !== undefined && candidate.kind !== kind) warnings.push(`The file says ${candidate.kind}`)

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
		}

		this.store.putSources(sources)
		this.#saveImport(job, { candidates: undefined, scan: { ...job.scan!, committed: sources.length } })
		this.#changed()
		return { committed: sources.length }
	}

	// Registers a frame the Flat Wizard published, as it is on the disk, after the frames of its session registered before. What a
	// file taken without a wheel leaves out comes from the session, as declared by its plan. Failures are the caller's to swallow:
	// a flat that cannot be indexed stays on the disk.
	registerFlat(frame: FlatFrameRegistration) {
		const registered = (this.#flatRegistrations.get(frame.sessionId) ?? Promise.resolve()).then(() => this.#registerFlat(frame))
		this.#flatRegistrations.set(
			frame.sessionId,
			registered.catch(() => undefined),
		)
		return registered
	}

	// Indexes one published flat.
	async #registerFlat({ path, sessionId, cameraName, filter }: FlatFrameRegistration) {
		await this.#usable()
		const [inspection, info] = await Promise.all([inspectFile(path), stat(path)])
		if (!inspection) return

		const metadata: CalibrationMetadata = { ...inspection.metadata, cameraName: inspection.metadata.cameraName ?? cameraName, filter: inspection.metadata.filter.value === undefined && filter !== undefined ? { value: filter, evidence: 'planDeclared' } : inspection.metadata.filter }
		const source = makeSource('flatWizard', sessionId, 'flat', path, inspection.format, info.size, info.mtimeMs, metadata, inspection.warnings)
		this.store.putSources([source])
		this.#changed()
	}

	// Starts a master flat of each filter a Flat Wizard session completed, once its frames are registered. A filter is built from
	// its own frames alone, only when every one of them can enter a master and nothing but the temperature asks for a review, with
	// the correction automaticCorrection finds; otherwise its flats stay, and building one is a person's decision. A master that
	// cannot start never touches the session; the group shows why. Jobs live in memory, so a restart before a build forgets it.
	async flatSessionEnded({ sessionId, groups }: FlatSessionEnd) {
		await this.#flatRegistrations.get(sessionId)
		this.#flatRegistrations.delete(sessionId)
		await this.#usable()

		for (const { paths } of groups) {
			const sources = paths.flatMap((path) => this.store.source(makeKnownId(path)) ?? [])
			if (sources.length === 0 || sources.length < paths.length || !sources.every(usable)) continue

			const metadata = sources.map((source) => source.metadata)
			const reviews = compareFrames('flat', metadata).filter(({ severity, field }) => severity === 'review' && field !== 'temperature')
			const correction = this.#automaticCorrection(metadata)
			if (reviews.length > 0 || !correction) continue

			try {
				this.#requestMaster({ sourceIds: sources.map(({ sourceId }) => sourceId), correction, acknowledged: true }, true)
			} catch {
				continue
			}
		}

		this.#changed()
	}

	// Returns the id of the master that corrects an automatic master flat of these frames: the newest master dark-flat that
	// matches them, or, when no dark-flat does, the newest master bias that does. Undefined when none matches. A master that
	// is stale or unavailable is never chosen.
	#automaticCorrection(flats: readonly CalibrationMetadata[]) {
		const masters = this.store.allMasters().filter(({ status }) => status !== 'stale' && status !== 'unavailable')

		for (const kind of ['darkFlat', 'bias'] as const) {
			const match = masters.find((master) => master.kind === kind && flatCorrectionMismatch(kind, master.metadata, flats) === undefined)
			if (match) return match.masterId
		}

		return undefined
	}

	// Registers a dark the Dark Library Wizard published, after the frames of its plan registered before. Failures are the
	// caller's to swallow: a dark that cannot be indexed stays on the disk.
	registerDark(registration: DarkFrameRegistration) {
		const { planId } = registration.plan
		const registered = (this.#darkRegistrations.get(planId) ?? Promise.resolve()).then(() => this.#registerDark(registration))
		this.#darkRegistrations.set(
			planId,
			registered.catch(() => undefined),
		)
		return registered
	}

	// Indexes one published dark with what its plan declares about it.
	async #registerDark({ plan, groupId, frame }: DarkFrameRegistration) {
		await this.#usable()
		const group = plan.groups.find((candidate) => candidate.groupId === groupId)
		if (!group || this.store.source(makeKnownId(frame.path))) return

		const [inspection, info] = await Promise.all([inspectFile(frame.path), stat(frame.path)])
		if (!inspection) return

		const source = darkPlanSource(plan, group, frame, inspection, info.size, info.mtimeMs)
		if (!source) return
		this.store.putSources([{ ...source, supported: inspection.metadata.bitpix !== 64 }])
		this.#changed()
	}

	// Starts one master per complete group of a plan whose session ended, once its frames are registered, from that group's
	// frames alone. An incomplete group is never built on its own: it stays a state of the group, and a provisional master is a
	// person's decision. Only an unknown temperature is accepted here, since a plan without a target or a thermometer records
	// exactly that and the master says so. A master that cannot start never touches the session; the group shows why. Jobs
	// live in memory, so a restart before a build forgets it.
	async darkSessionEnded(plan: DarkCapturePlan) {
		const { planId } = plan
		await this.#darkRegistrations.get(planId)
		this.#darkRegistrations.delete(planId)
		await this.#usable()
		if (!plan.generateMasters) return

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

		this.#changed()
	}

	// Lists the masters that match a target, from metadata alone, newest first; a master that cannot be read, being
	// unavailable or stale, is left out. Nothing is chosen for it.
	async resolvePreview(target: CalibrationTarget): Promise<ResolvePreview> {
		await this.#usable()
		const candidates = this.store
			.allMasters()
			.filter(({ kind, metadata, status }) => status !== 'unavailable' && status !== 'stale' && matchesTarget(kind, metadata, target))
			.map(masterSummary)
		return { candidates }
	}

	// Returns a published master with the path of its file when its content is the one referenced, so a calibrator never
	// reads another file under the same id. Returns undefined for an unknown master, another content, or a file that is
	// unavailable or depends on an unavailable master.
	async pinnedMaster(reference: MasterReference): Promise<CalibrationMasterDetail | undefined> {
		await this.#usable()
		const master = this.store.master(reference.masterId)
		if (!master || master.contentDigest !== reference.digest || master.status === 'unavailable' || master.status === 'stale') return undefined
		return { ...master, path: this.#masterFile(master.masterId) }
	}

	// Holds masters while another tool reads their files, so none of them can be deleted meanwhile. Returns the function
	// that releases them, which is safe to call more than once.
	lease(references: readonly Pick<MasterReference, 'masterId'>[]) {
		const keys = references.map(({ masterId }) => masterId)
		for (const key of keys) this.#leases.set(key, (this.#leases.get(key) ?? 0) + 1)
		let released = false

		return () => {
			if (released) return
			released = true

			for (const key of keys) {
				const count = (this.#leases.get(key) ?? 1) - 1
				if (count > 0) this.#leases.set(key, count)
				else this.#leases.delete(key)
			}
		}
	}

	// Stops the running job and the scans.
	close() {
		this.jobs.stop()
		for (const scan of this.#scans.values()) scan.abort(new DOMException('Stopped', 'AbortError'))
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
			DELETE: ({ params }) => answer(() => library.deleteSource(params.sourceId)),
		},
		'/api/calibration-library/sources/:sourceId/overrides': {
			POST: async (request) => {
				const { field, value } = (await request.json()) as { readonly field: OverridableField; readonly value: string | number }
				return answer(() => library.override(request.params.sourceId, field, value))
			},
		},
		'/api/calibration-library/sources/:sourceId/exclusion': {
			POST: async (request) => {
				const { excluded } = (await request.json()) as { readonly excluded: boolean }
				return answer(() => library.exclude(request.params.sourceId, excluded))
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
		'/api/calibration-library/imports/:jobId/cancel': {
			POST: ({ params }) => answer(() => library.cancelImport(params.jobId)),
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
			DELETE: ({ params }) => answer(() => library.deleteGroup(params.groupId)),
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
				const filter: MasterFilter = {
					kind: (searchParams.get('kind') as CalibrationKind | null) ?? undefined,
					camera: searchParams.get('camera') ?? undefined,
					filter: searchParams.get('filter') ?? undefined,
					status: (searchParams.get('status') as ProductStatus | null) ?? undefined,
					groupId: searchParams.get('groupId') ?? undefined,
				}
				return answer(() => library.masters(filter, offset, limit))
			},
			POST: async (request) => {
				const body = (await request.json()) as MasterRequest
				return answer(() => library.requestMaster(body), 202)
			},
		},
		'/api/calibration-library/masters/:masterId': {
			GET: ({ params }) => answer(() => library.master(Number(params.masterId))),
			DELETE: ({ params }) => answer(() => library.deleteMaster(Number(params.masterId))),
		},
		'/api/calibration-library/resolve-preview': {
			POST: async (request) => {
				const target = (await request.json()) as CalibrationTarget
				return answer(() => library.resolvePreview(target))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
