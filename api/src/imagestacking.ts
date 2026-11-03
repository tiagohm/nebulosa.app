import { stat } from 'fs/promises'
import { basename, relative } from 'path'
import { type SubframeRejectionReason, subframeRejectionReasons } from 'nebulosa/src/imaging/processing/subframe.selector'
import { medianOf } from 'nebulosa/src/math/numerical/statistics'
import type { CalibrationMasterDetail, ResolvePreview } from './calibrationlibrary'
import { type CalibrationKind, type CalibrationMetadata, type CalibrationTarget, type MasterReference, stableId } from './calibrationlibrary.compatibility'
import { fileIdentity, type FileInspection, inspectFile, scanDirectory } from './calibrationlibrary.sources'
import { MAX_PAGE_SIZE, type Page, type ProductStatus, type SourceFormat, type SourceStatus } from './calibrationlibrary.store'
import { errorResponse } from './http'
import { ANALYSIS_VERSION, type AnalysisCalibration, type AnalysisFrame, type FrameAnalyzer, registerProject, type RegistrationFrame, type RegistrationGroup, StackingAnalyzer } from './imagestacking.analysis'
import { cohortKeyOf, filterKeyOf, filterSynonyms, isWithin, lightRoleOf, type StackingRole, stackingSourceId } from './imagestacking.sources'
// oxfmt-ignore
import { DEFAULT_STACKING_SETTINGS, type ImageStackingStore, type StackingCalibration, type StackingCohortDecision, type StackingFilterAlias, type StackingFrameAnalysis, type StackingProject, type StackingProjectAnalysis, type StackingSettings, type StackingSource, type StackingSourceFacts, type StackingSourceFilter, type StackingSourceSummary, stackingSourceSummary } from './imagestacking.store'
import { errorCode } from './util'

// Image Stacking: projects of light frames saved on the server, grouped by the physical filter they were taken through,
// for integration and color composition. It needs no connection, claims no device, and takes no part in
// OperationRegistry. Frames enter a project only through an import an operator reviewed: a cancellable scan of headers
// that never reads pixels, never writes a file, and never infers anything from a name. A header without a role leaves
// a frame unclassified until an operator declares it a light; a frame without a filter waits in the Unassigned group
// until an operator declares its filter; filter names that are spelled differently stay apart until an operator merges
// them. Lights of a group that share their acquisition settings form a cohort, which an operator calibrates with pinned
// revisions of the Calibration Library, or decides with a reason not to calibrate. An analysis measures every frame
// calibrated as it will be stacked and registers the stars of each group onto its reference and each group reference onto
// the project reference; a measurement stays valid while its file and the pins of its cohort do. Validation lists what
// blocks a stack, what an operator must accept, and what is only worth knowing. Projects, frames, decisions, and
// measurements are rows of the operational database; jobs live in memory and end with the process.

// Default page size of the lists.
const DEFAULT_PAGE_SIZE = 50

// Files checked at once when comparing the frames with the disk.
const REFRESH_CONCURRENCY = 32

// Ended jobs kept in memory, the latest first.
const KEPT_JOBS = 50

// Files found between two progress events of a scan.
const PROGRESS_STEP = 100

// Bytes of memory a stack needs per pixel of the project grid and channel: the source frame, its calibration masters, the
// warped frame, its validity, and the normalization reference, in single precision. A planning estimate, not a bound.
const STACK_BYTES_PER_PIXEL = 26

// Kinds of master a light is calibrated with.
const LIGHT_MASTER_KINDS = ['dark', 'flat', 'bias'] as const satisfies readonly CalibrationKind[]

// Kind of master a light is calibrated with.
export type LightMasterKind = (typeof LIGHT_MASTER_KINDS)[number]

// What Image Stacking reads of the Calibration Library: matching, pinned revisions, and leases while a job reads them.
export interface StackingMasters {
	// Explains which masters match a target.
	readonly resolvePreview: (target: CalibrationTarget) => Promise<ResolvePreview>
	// Returns the file of a pinned revision while its content is the one pinned.
	readonly pinnedMaster: (reference: MasterReference) => Promise<Pick<CalibrationMasterDetail, 'path' | 'units' | 'fullScaleDn'> | undefined>
	// Holds revisions while a job reads them; returns the release.
	readonly lease: (references: readonly Pick<MasterReference, 'masterId' | 'revision'>[]) => () => void
}

// Stable code of a failed request.
export type ImageStackingErrorCode = 'notFound' | 'conflict' | 'jobConflict' | 'managedPath' | 'verifiedMetadata' | 'invalidAlias' | 'calibrationUndecided' | 'masterUnavailable' | 'incompatibleMaster' | 'processingFailed'

// Failure of a request, with its status and stable code.
class StackingError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly code: ImageStackingErrorCode,
	) {
		super(message)
	}
}

// What a project holds, by counts; its analysis comes only with its detail.
export interface StackingProjectSummary extends Omit<StackingProject, 'analysis'> {
	// Frames, lights among them, and frames waiting for a role.
	readonly frames: number
	readonly lights: number
	readonly unclassified: number
	// Frames left out by an operator, and frames whose file is missing, changed, or unreadable.
	readonly excluded: number
	readonly unavailable: number
	// Filter groups with a filter, and lights without one.
	readonly filters: number
	readonly unassigned: number
	// Exposure of the included lights whose file is available, in seconds.
	readonly exposure: number
	// Targets their headers name, by name; more than one asks the operator to check the project.
	readonly objects: readonly string[]
}

// Lights of one physical filter in a project, after the aliases of the project.
export interface StackingFilterGroup {
	// Canonical key of the group; empty for the lights without a filter.
	readonly key: string
	// Name shown: the most frequent name written for the key, or Unassigned.
	readonly name: string
	// Every canonical key and every name written that the group holds.
	readonly filterKeys: readonly string[]
	readonly names: readonly string[]
	// Lights, those included with an available file, and those whose file is not available.
	readonly frames: number
	readonly usable: number
	readonly unavailable: number
	// Exposure of the usable lights, in seconds.
	readonly exposure: number
	// Distinct acquisition settings among the usable lights.
	readonly cohorts: number
	// Targets their headers name.
	readonly objects: readonly string[]
	// Key of another group whose name is a known synonym of this one, offered as a merge.
	readonly suggestion?: string
}

// A project with its aliases and the outcome of its latest registration.
export interface StackingProjectDetail extends StackingProjectSummary {
	readonly aliases: readonly StackingFilterAlias[]
	readonly analysis?: StackingProjectAnalysis
}

// A compatible master revision offered to a cohort.
export interface StackingMasterCandidate {
	readonly kind: LightMasterKind
	readonly masterId: string
	readonly revision: number
	// SHA-256 of its file, which a pin holds.
	readonly digest: string
	// State in the library, and whether it is the preferred revision of its master.
	readonly status: ProductStatus
	readonly preferred: boolean
}

// Usable lights of one filter group that share their acquisition settings, with what calibrates them.
export interface StackingCohort extends StackingCohortDecision {
	// Name of its filter group.
	readonly groupName: string
	// Included lights with an available file.
	readonly frames: number
	// Name of the camera its headers give, which never stands for a hardware id.
	readonly cameraName?: string
	// What masters are matched against: the declared camera, the geometry and settings of its first frame, its exposure,
	// the median of its sensor temperatures, and its most frequent filter name.
	readonly target: CalibrationTarget
	// Compatible revisions of the library; only these can be pinned.
	readonly candidates: readonly StackingMasterCandidate[]
	// Masters that match only if an operator accepts what either side does not know, such as an undeclared camera.
	readonly reviewCandidates: number
	// Pins offered when one preferred revision of a kind is compatible; no bias is offered with a dark, which includes it.
	readonly suggested: Readonly<Partial<Record<LightMasterKind, MasterReference>>>
}

// Change of a cohort by an operator.
export interface StackingCohortPatch {
	// Hardware id of the camera that took its frames, with why it is known, or null to forget it.
	readonly camera?: { readonly id: string; readonly reason: string } | null
	// Calibration chosen, or null to decide again. Pins must be compatible revisions.
	readonly calibration?: StackingCalibration | null
}

// How much a finding stops:
// - blocker: nothing can be stacked until it is solved.
// - review: an operator must accept it.
// - warning: worth knowing; frames it names stay out of the stack.
export type StackingFindingSeverity = 'blocker' | 'review' | 'warning'

// Stable code of a finding.
export type StackingFindingCode = 'noLights' | 'unassignedLights' | 'multipleTargets' | 'multipleSetups' | 'cameraUndeclared' | 'calibrationUndecided' | 'noCalibration' | 'partialCalibration' | 'masterUnavailable' | 'masterIncompatible' | 'analysisStale' | 'measurementFailed' | 'registrationFailed' | 'belowThresholds'

// One thing validation found.
export interface StackingFinding {
	readonly severity: StackingFindingSeverity
	readonly code: StackingFindingCode
	// What to do about it, in words.
	readonly message: string
	// Filter group and cohort it concerns.
	readonly groupKey?: string
	readonly cohortId?: string
	// Frames it concerns.
	readonly sourceIds?: readonly string[]
}

// What validation found, and what a stack would cost.
export interface StackingValidation {
	readonly findings: readonly StackingFinding[]
	// Whether nothing blocks a stack.
	readonly ready: boolean
	// Samples of the largest frame (width × height × channels), and the memory a stack is estimated to need, in bytes.
	readonly samples: number
	readonly memoryBytes: number
}

// A frame in a list, with what the latest analysis says of it now.
export interface StackingFrameSummary extends StackingSourceSummary {
	// Whether its measurement no longer describes its file or the calibration of its cohort.
	readonly stale?: boolean
	// Quality thresholds of the project it fails.
	readonly rejected?: readonly SubframeRejectionReason[]
}

// State of a job:
// - scanning: reading headers.
// - analyzing: measuring and registering frames.
// - completed: did what it could; an import waits for its review.
// - failed, cancelled: ended early; an analysis keeps what it measured.
export type StackingJobState = 'scanning' | 'analyzing' | 'completed' | 'failed' | 'cancelled'

// States of a job still working.
const ACTIVE_JOB_STATES: ReadonlySet<StackingJobState> = new Set(['scanning', 'analyzing'])

// What lists and events show of a job: no paths.
export interface StackingJobSummary {
	readonly jobId: string
	// Project it works for.
	readonly projectId: string
	// What it does.
	readonly type: 'import' | 'analysis'
	readonly state: StackingJobState
	// When it was requested, and last changed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly updatedAt: number
	// Files found, or frames to measure, and their total size, in bytes.
	readonly found: number
	readonly bytes: number
	// Frames an analysis measured so far, and those that could not be.
	readonly measured?: number
	readonly failures?: number
	// Whether the limit on files stopped a scan.
	readonly truncated: boolean
	// Frames that entered the project once committed.
	readonly committed?: number
	// Why it failed, with a stable code.
	readonly error?: string
	readonly code?: ImageStackingErrorCode
}

// File an import found, for review. Paths are shown because the operator chose where to look.
export interface StackingImportCandidate {
	// Absolute path, and its name under the chosen directory.
	readonly path: string
	readonly name: string
	// Size, in bytes, and modification time, Unix milliseconds.
	readonly bytes: number
	readonly mtimeMillis: number
	// Format, when its header was read.
	readonly format?: SourceFormat
	// Role its header gives it in a project.
	readonly role?: StackingRole
	// Why it cannot join a project.
	readonly rejected?: string
	// Filter, target, and start of its exposure, as its header says.
	readonly filter?: string
	readonly object?: string
	readonly observedAt?: number
	// What is known about it.
	readonly metadata?: CalibrationMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
	// Why its header could not be read.
	readonly error?: string
	// Whether the project already holds this file.
	readonly known: boolean
}

// Everything a tab needs to mirror Image Stacking, with no paths.
export interface ImageStackingSnapshot {
	// Id of this process; a new one invalidates everything a tab holds.
	readonly epoch: string
	// Monotonic change counter of this process.
	readonly revision: number
	// Every project, the latest changed first.
	readonly projects: readonly StackingProjectSummary[]
	// Jobs still working, and the latest ended ones.
	readonly jobs: readonly StackingJobSummary[]
}

// Event of Image Stacking.
export type ImageStackingEvent =
	// A project, its frames, or its aliases changed.
	| { readonly type: 'imageStacking:changed'; readonly revision: number; readonly snapshot: ImageStackingSnapshot }
	// A job changed.
	| { readonly type: 'imageStacking:jobUpdated'; readonly epoch: string; readonly revision: number; readonly job: StackingJobSummary }

// Request of an import.
export interface StackingImportRequest {
	// Directories and files of the server to look at.
	readonly paths: readonly string[]
	// Whether directories are entered recursively; true by default.
	readonly recursive?: boolean
}

// Review of an import.
export interface StackingImportCommit {
	// Candidates to add; every usable one when absent.
	readonly paths?: readonly string[]
	// Unclassified candidates an operator declares lights, with the reason.
	readonly lights?: Readonly<Record<string, { readonly reason: string }>>
}

// Change of a frame by an operator.
export interface StackingSourcePatch {
	// Reason to leave it out of stacks, or null to include it again.
	readonly excluded?: string | null
	// Declares an unclassified frame a light.
	readonly light?: { readonly reason: string }
	// Declares the filter of a frame whose header names none.
	readonly filter?: { readonly value: string; readonly reason: string }
}

// A frame with what is only for one who asks: its path, for opening it in Images.
export interface StackingSourceDetail extends StackingSourceSummary {
	readonly path: string
}

// Job of this process, with what only the review of an import reads.
interface StackingJob extends StackingJobSummary {
	// Files an import found, with their identities, until committed.
	readonly candidates?: readonly (StackingImportCandidate & { readonly identity: string })[]
}

// Usable lights of a cohort, with what an operator decided about it.
interface CohortFrames {
	readonly cohortId: string
	readonly groupKey: string
	readonly cohortKey: string
	readonly sources: readonly StackingSource[]
}

// A cohort with its usable lights.
type CohortState = StackingCohort & { readonly sources: readonly StackingSource[] }

// Returns what lists and events show of a job.
function jobSummary({ candidates: _, ...summary }: StackingJob): StackingJobSummary {
	return summary
}

// Returns the id of a cohort of a project from its filter group and acquisition settings.
export function cohortIdOf(groupKey: string, cohortKey: string) {
	return stableId(`${groupKey}|${cohortKey}`)
}

// Returns the identity of what a measurement of a frame depends on: the measurement version, the file by size and
// modification time, and the pinned masters of its cohort.
export function analysisFingerprint(source: Pick<StackingSource, 'bytes' | 'mtimeMillis'>, calibration: StackingCalibration | undefined) {
	const pins = calibration?.kind === 'masters' ? LIGHT_MASTER_KINDS.map((kind) => (calibration[kind] ? `${calibration[kind].masterId}:${calibration[kind].revision}:${calibration[kind].digest}` : '')) : [calibration?.kind ?? '']
	return stableId(`${ANALYSIS_VERSION}|${source.bytes}|${source.mtimeMillis}|${pins.join('|')}`)
}

// Returns what masters of a cohort are matched against.
function cohortTarget(sources: readonly StackingSource[], cameraId: string | undefined): CalibrationTarget {
	const { metadata } = sources[0]
	const temperatures = sources.flatMap((source) => source.metadata.setTemperature.value ?? source.metadata.sensorTemperature.value ?? []).sort((a, b) => a - b)
	const filter = mostFrequent(sources.flatMap((source) => source.metadata.filter.value ?? []))
	const exposure = metadata.exposure.value
	const camera = cameraId ?? metadata.cameraId.value

	return {
		...(camera !== undefined && { cameraId: camera }),
		width: metadata.width,
		height: metadata.height,
		channels: metadata.channels,
		...(metadata.cfa !== undefined && { cfa: metadata.cfa }),
		...(metadata.binX.value !== undefined && { binX: metadata.binX.value }),
		...(metadata.binY.value !== undefined && { binY: metadata.binY.value }),
		...(metadata.gain.value !== undefined && { gain: metadata.gain.value }),
		...(metadata.offset.value !== undefined && { offset: metadata.offset.value }),
		...(metadata.readoutMode.value !== undefined && { readoutMode: metadata.readoutMode.value }),
		...(exposure !== undefined && { exposure: exposure / 1000000 }),
		...(temperatures.length > 0 && { temperature: medianOf(temperatures) }),
		...(filter !== undefined && { filter }),
	}
}

// Returns the pins offered to a cohort: per kind, the preferred revision when it is the only compatible one.
function suggestedPins(candidates: readonly StackingMasterCandidate[]) {
	const suggested: Partial<Record<LightMasterKind, MasterReference>> = {}

	for (const kind of LIGHT_MASTER_KINDS) {
		const preferred = candidates.filter((candidate) => candidate.kind === kind && candidate.preferred)
		if (preferred.length === 1) suggested[kind] = { masterId: preferred[0].masterId, revision: preferred[0].revision, digest: preferred[0].digest }
	}

	if (suggested.dark) delete suggested.bias
	return suggested
}

// Returns the pins of a calibration, by kind.
function pinsOf(calibration: StackingCalibration | undefined) {
	const pins: [LightMasterKind, MasterReference][] = []
	if (calibration?.kind !== 'masters') return pins
	for (const kind of LIGHT_MASTER_KINDS) if (calibration[kind]) pins.push([kind, calibration[kind]])
	return pins
}

// Returns whether a measured frame can be registered.
function measured(analysis: StackingFrameAnalysis | undefined): analysis is StackingFrameAnalysis {
	return analysis?.quality !== undefined && (analysis.stars?.length ?? 0) > 0
}

// Returns how a frame count reads.
function framesText(count: number) {
	return count === 1 ? '1 frame' : `${count} frames`
}

// Returns the word of a count: the singular for one, the plural otherwise.
function counted(count: number, singular: string, plural: string) {
	return count === 1 ? singular : plural
}

// Returns the decision a cohort holds, without what is computed from its frames.
function decisionOf({ cohortId, groupKey, cohortKey, cameraId, cameraReason, calibration }: StackingCohortDecision): StackingCohortDecision {
	return { cohortId, groupKey, cohortKey, ...(cameraId !== undefined && { cameraId, cameraReason }), ...(calibration !== undefined && { calibration }) }
}

// Returns the most frequent value, ties broken by order of first appearance; undefined for none.
function mostFrequent(values: readonly string[]) {
	const counts = new Map<string, number>()
	let best: string | undefined
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
	for (const [value, count] of counts) if (best === undefined || count > counts.get(best)!) best = value
	return best
}

// Groups the lights of a project by filter after its aliases: a frame's group is the target of its key's alias, or its
// key. Usable lights are included and available. Groups are sorted by name, the Unassigned group last.
export function filterGroups(facts: readonly StackingSourceFacts[], aliases: readonly StackingFilterAlias[]): StackingFilterGroup[] {
	const targets = new Map(aliases.map((alias) => [alias.filterKey, alias.targetKey]))
	const groups = new Map<string, StackingSourceFacts[]>()

	for (const fact of facts) {
		if (fact.role !== 'light') continue
		const key = targets.get(fact.filterKey) ?? fact.filterKey
		const members = groups.get(key)
		if (members) members.push(fact)
		else groups.set(key, [fact])
	}

	const result: StackingFilterGroup[] = []

	for (const [key, members] of groups) {
		const usable = members.filter((fact) => !fact.excluded && fact.status === 'available')
		const own = members.filter((fact) => fact.filterKey === key && fact.filterName !== undefined).map((fact) => fact.filterName!)
		const names = [...new Set(members.flatMap((fact) => fact.filterName ?? []))].sort()
		const exposure = usable.reduce((sum, fact) => sum + (fact.exposure ?? 0), 0) / 1000000
		result.push({
			key,
			name: key === '' ? 'Unassigned' : (mostFrequent(own) ?? names[0] ?? key),
			filterKeys: [...new Set(members.map((fact) => fact.filterKey))].sort(),
			names,
			frames: members.length,
			usable: usable.length,
			unavailable: members.filter((fact) => fact.status !== 'available').length,
			exposure,
			cohorts: new Set(usable.map((fact) => fact.cohortKey)).size,
			objects: [...new Set(members.flatMap((fact) => fact.object || []))].sort(),
		})
	}

	for (const group of result) {
		const suggestion = result.find((other) => other.key !== group.key && filterSynonyms(group.key, other.key))
		if (suggestion) Object.assign(group, { suggestion: suggestion.key })
	}

	return result.sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name)))
}

// Summarizes a project from the facts of its frames.
function projectSummary({ analysis: _, ...project }: StackingProject, facts: readonly StackingSourceFacts[], aliases: readonly StackingFilterAlias[]): StackingProjectSummary {
	const groups = filterGroups(facts, aliases)
	const lights = facts.filter((fact) => fact.role === 'light')

	return {
		...project,
		frames: facts.length,
		lights: lights.length,
		unclassified: facts.length - lights.length,
		excluded: facts.filter((fact) => fact.excluded).length,
		unavailable: facts.filter((fact) => fact.status !== 'available').length,
		filters: groups.filter((group) => group.key !== '').length,
		unassigned: groups.find((group) => group.key === '')?.frames ?? 0,
		exposure: groups.reduce((sum, group) => sum + group.exposure, 0),
		objects: [...new Set(lights.flatMap((fact) => fact.object || []))].sort(),
	}
}

// The service. Work waits for the first open, so importing this module touches no file.
export class ImageStacking {
	// Id of this process.
	readonly #epoch = crypto.randomUUID()
	// Change counter.
	#revision = 0
	// First comparison of the frames with the disk.
	#opened?: Promise<void>
	// Jobs of this process, by id.
	readonly #jobs = new Map<string, StackingJob>()
	// Scans and analyses running, by job.
	readonly #scans = new Map<string, AbortController>()

	// Creates the service. listener receives every change synchronously; masters is the Calibration Library; managed lists
	// the directories whose files belong to the application, which an import never reads; analyzer measures frames.
	constructor(
		readonly store: ImageStackingStore,
		readonly listener: (event: ImageStackingEvent) => void,
		readonly masters: StackingMasters,
		readonly managed: readonly string[] = [store.directory],
		readonly analyzer: FrameAnalyzer = new StackingAnalyzer(),
	) {}

	// Compares the frames with the disk once. A failure leaves the next request to try again.
	ready() {
		this.#opened ??= this.#refreshFiles().then(
			() => this.#changed(),
			(error: unknown) => {
				this.#opened = undefined
				throw error
			},
		)
		return this.#opened
	}

	// Builds the snapshot.
	snapshot(): ImageStackingSnapshot {
		const projects = this.store.projects().map((project) => projectSummary(project, this.store.facts(project.projectId), this.store.aliases(project.projectId)))
		const jobs = [...this.#jobs.values()].toSorted((a, b) => b.createdAt - a.createdAt).map(jobSummary)
		return { epoch: this.#epoch, revision: this.#revision, projects, jobs }
	}

	// Publishes a change of the projects.
	#changed() {
		const revision = ++this.#revision
		this.listener({ type: 'imageStacking:changed', revision, snapshot: this.snapshot() })
	}

	// Saves a job, keeps only the latest ended ones, and publishes it.
	#saveJob(job: StackingJob, patch: Partial<StackingJob> = {}) {
		const next: StackingJob = { ...job, ...patch, updatedAt: Date.now() }
		this.#jobs.set(next.jobId, next)

		const ended = [...this.#jobs.values()].filter((other) => !ACTIVE_JOB_STATES.has(other.state)).toSorted((a, b) => b.updatedAt - a.updatedAt)
		for (const old of ended.slice(KEPT_JOBS)) this.#jobs.delete(old.jobId)

		this.listener({ type: 'imageStacking:jobUpdated', epoch: this.#epoch, revision: ++this.#revision, job: jobSummary(next) })
		return next
	}

	// Returns a project. Throws when unknown.
	#project(projectId: string) {
		const project = this.store.project(projectId)
		if (!project) throw new StackingError('Unknown project', 404, 'notFound')
		return project
	}

	// Returns a frame. Throws when unknown.
	#source(sourceId: string) {
		const source = this.store.source(sourceId)
		if (!source) throw new StackingError('Unknown frame', 404, 'notFound')
		return source
	}

	// Returns a job. Throws when unknown.
	#job(jobId: string) {
		const job = this.#jobs.get(jobId)
		if (!job) throw new StackingError('Unknown job', 404, 'notFound')
		return job
	}

	// Lists every project.
	async projects() {
		await this.ready()
		return this.snapshot().projects
	}

	// Returns a project with its aliases. Throws when unknown.
	async project(projectId: string): Promise<StackingProjectDetail> {
		await this.ready()
		const project = this.#project(projectId)
		const aliases = this.store.aliases(projectId)
		const detail = { ...projectSummary(project, this.store.facts(projectId), aliases), aliases }
		return project.analysis ? { ...detail, analysis: project.analysis } : detail
	}

	// Creates an empty project.
	async createProject({ name }: { readonly name: string }) {
		await this.ready()
		const now = Date.now()
		const project: StackingProject = { projectId: crypto.randomUUID(), name: name.trim(), revision: 1, createdAt: now, updatedAt: now, settings: DEFAULT_STACKING_SETTINGS }
		this.store.putProject(project)
		this.#changed()
		return this.project(project.projectId)
	}

	// Renames a project from the revision it was edited from. Throws 409 with the current project when another edit came first.
	async updateProject(projectId: string, { name, revision }: { readonly name: string; readonly revision: number }) {
		await this.ready()
		const project = this.#project(projectId)
		if (project.revision !== revision) throw new StackingError('The project changed meanwhile', 409, 'conflict')
		this.store.putProject({ ...project, name: name.trim(), revision: revision + 1, updatedAt: Date.now() })
		this.#changed()
		return this.project(projectId)
	}

	// Replaces the reference pins and quality thresholds of a project. Its revision, which guards its name, stays.
	async updateSettings(projectId: string, settings: StackingSettings) {
		await this.ready()
		const project = this.#project(projectId)
		this.store.putProject({ ...project, settings: { ...DEFAULT_STACKING_SETTINGS, ...settings }, updatedAt: Date.now() })
		this.#changed()
		return this.project(projectId)
	}

	// Deletes a project and stops its scans and analyses; its frames stay on the disk.
	async deleteProject(projectId: string) {
		await this.ready()
		this.#project(projectId)

		for (const job of this.#jobs.values()) {
			if (job.projectId === projectId) this.#scans.get(job.jobId)?.abort(new DOMException('Project deleted', 'AbortError'))
		}

		this.store.deleteProject(projectId)
		this.#changed()
		return { deleted: projectId }
	}

	// Lists frames of a project; `group`, when given, is the key of one filter group.
	async frames(projectId: string, filter: Omit<StackingSourceFilter, 'filterKeys'> & { readonly group?: string }, offset: number, limit: number): Promise<Page<StackingFrameSummary>> {
		await this.ready()
		const project = this.#project(projectId)
		const { group, ...rest } = filter
		const filterKeys = group === undefined ? undefined : this.#groupKeys(projectId, group)
		const { items, total } = this.store.sources(projectId, { ...rest, filterKeys }, offset, limit)
		const targets = new Map(this.store.aliases(projectId).map((alias) => [alias.filterKey, alias.targetKey]))
		const decisions = new Map(this.store.cohorts(projectId).map((decision) => [decision.cohortId, decision]))
		const frames: StackingFrameSummary[] = []

		for (const source of items) {
			const summary = stackingSourceSummary(source)
			const { analysis } = source

			if (!analysis) {
				frames.push(summary)
				continue
			}

			const cohortId = cohortIdOf(targets.get(source.filterKey) ?? source.filterKey, source.cohortKey)
			const stale = analysis.fingerprint !== analysisFingerprint(source, decisions.get(cohortId)?.calibration)
			const rejected = analysis.quality ? subframeRejectionReasons(analysis.quality, project.settings.selection) : []
			frames.push({ ...summary, ...(stale && { stale }), ...(rejected.length > 0 && { rejected }) })
		}

		return { items: frames, total }
	}

	// Returns the canonical keys of a filter group: its key, unless merged elsewhere, and the keys merged into it.
	#groupKeys(projectId: string, group: string) {
		const aliases = this.store.aliases(projectId)
		const keys = aliases.filter((alias) => alias.targetKey === group).map((alias) => alias.filterKey)
		if (!aliases.some((alias) => alias.filterKey === group)) keys.push(group)
		return keys
	}

	// Returns a frame with its path. Throws when unknown.
	async frame(sourceId: string): Promise<StackingSourceDetail> {
		await this.ready()
		const source = this.#source(sourceId)
		return { ...stackingSourceSummary(source), path: source.path }
	}

	// Changes what an operator decides about a frame: its exclusion, its role, or its filter when its header names none.
	// Declarations are recorded among its warnings, and never written to its file.
	async updateFrame(sourceId: string, patch: StackingSourcePatch) {
		await this.ready()
		const source = this.#source(sourceId)
		let next: StackingSource = source

		if (patch.excluded !== undefined) {
			const { excluded: _, ...rest } = next
			next = patch.excluded === null ? rest : { ...rest, excluded: patch.excluded }
		}

		if (patch.light) {
			if (next.role === 'light') throw new StackingError('This frame is already a light', 409, 'conflict')
			next = { ...next, role: 'light', warnings: [...next.warnings, `Declared a light by an operator: ${patch.light.reason}`] }
		}

		if (patch.filter) {
			if (next.metadata.filter.evidence !== 'unknown') throw new StackingError('Only a filter the header does not name can be declared', 409, 'verifiedMetadata')
			const metadata = { ...next.metadata, filter: { value: patch.filter.value.trim(), evidence: 'operatorDeclared' as const } }
			next = { ...next, metadata, filterKey: filterKeyOf(metadata.filter.value), warnings: [...next.warnings, `Filter declared by an operator: ${patch.filter.reason}`] }
		}

		this.store.putSources(source.projectId, [next], Date.now())
		this.#changed()
		return this.frame(sourceId)
	}

	// Takes a frame out of its project; its file stays where it is.
	async removeFrame(sourceId: string) {
		await this.ready()
		const source = this.#source(sourceId)
		this.store.removeSource(source.projectId, sourceId, Date.now())
		this.#changed()
		return { removed: sourceId }
	}

	// Lists the filter groups of a project.
	async groups(projectId: string) {
		await this.ready()
		this.#project(projectId)
		return filterGroups(this.store.facts(projectId), this.store.aliases(projectId))
	}

	// Groups the usable lights of the filter groups of a project by cohort: included lights with an available file and a
	// filter, by their group after the aliases and their acquisition settings.
	#cohortFrames(projectId: string) {
		const targets = new Map(this.store.aliases(projectId).map((alias) => [alias.filterKey, alias.targetKey]))
		const cohorts = new Map<string, CohortFrames & { readonly sources: StackingSource[] }>()

		for (const source of this.store.sourcesOf(projectId)) {
			if (source.role !== 'light' || source.excluded !== undefined || source.status !== 'available') continue
			const groupKey = targets.get(source.filterKey) ?? source.filterKey
			if (groupKey === '') continue
			const cohortId = cohortIdOf(groupKey, source.cohortKey)
			const cohort = cohorts.get(cohortId)
			if (cohort) cohort.sources.push(source)
			else cohorts.set(cohortId, { cohortId, groupKey, cohortKey: source.cohortKey, sources: [source] })
		}

		return cohorts
	}

	// Lists the light masters of the library compatible with a target, and counts those that would need a review.
	async #candidates(target: CalibrationTarget) {
		const candidates: StackingMasterCandidate[] = []
		let reviewCandidates = 0

		for (const { kind, masterId, revision, contentDigest, status, preferred, verdict } of (await this.masters.resolvePreview(target)).candidates) {
			if (kind === 'darkFlat') continue
			if (verdict === 'compatible') candidates.push({ kind, masterId, revision, digest: contentDigest, status, preferred })
			else if (verdict === 'reviewRequired') reviewCandidates++
		}

		return { candidates, reviewCandidates }
	}

	// Lists the cohorts of a project with their decisions and the compatible masters of the library, sorted by group name.
	async #cohorts(projectId: string): Promise<CohortState[]> {
		const decisions = new Map(this.store.cohorts(projectId).map((decision) => [decision.cohortId, decision]))
		const names = new Map(filterGroups(this.store.facts(projectId), this.store.aliases(projectId)).map((group) => [group.key, group.name]))
		const cohorts: CohortState[] = []

		for (const { cohortId, groupKey, cohortKey, sources } of this.#cohortFrames(projectId).values()) {
			const decision = decisions.get(cohortId)
			const target = cohortTarget(sources, decision?.cameraId)
			const { candidates, reviewCandidates } = await this.#candidates(target)
			const { cameraName } = sources[0].metadata
			cohorts.push({ ...decision, cohortId, groupKey, cohortKey, groupName: names.get(groupKey) ?? groupKey, frames: sources.length, ...(cameraName !== undefined && { cameraName }), target, candidates, reviewCandidates, suggested: suggestedPins(candidates), sources })
		}

		return cohorts.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.cohortKey.localeCompare(b.cohortKey))
	}

	// Lists the cohorts of a project.
	async cohorts(projectId: string): Promise<StackingCohort[]> {
		await this.ready()
		this.#project(projectId)
		const cohorts: StackingCohort[] = []
		for (const { sources: _, ...cohort } of await this.#cohorts(projectId)) cohorts.push(cohort)
		return cohorts
	}

	// Records what an operator decides about a cohort: the camera that took its frames, and its calibration. Pins must be
	// revisions the library finds compatible for the cohort, under the camera after this change; throws 409 otherwise.
	// A camera changed later leaves the pins for validation to check.
	async updateCohort(projectId: string, cohortId: string, patch: StackingCohortPatch) {
		await this.ready()
		this.#project(projectId)
		const cohort = (await this.#cohorts(projectId)).find((candidate) => candidate.cohortId === cohortId)
		if (!cohort) throw new StackingError('Unknown cohort', 404, 'notFound')
		let decision = decisionOf(cohort)

		if (patch.camera !== undefined) {
			const { cameraId: _, cameraReason: __, ...rest } = decision
			decision = patch.camera === null ? rest : { ...rest, cameraId: patch.camera.id.trim(), cameraReason: patch.camera.reason }
		}

		if (patch.calibration !== undefined) {
			const { calibration: _, ...rest } = decision
			decision = patch.calibration === null ? rest : { ...rest, calibration: patch.calibration }
		}

		if (patch.calibration) {
			const pins = pinsOf(patch.calibration)
			if (patch.calibration.kind === 'masters' && pins.length === 0) throw new StackingError('Pin at least one master, or choose no calibration', 409, 'incompatibleMaster')
			const { candidates } = decision.cameraId === cohort.cameraId ? cohort : await this.#candidates(cohortTarget(cohort.sources, decision.cameraId))

			for (const [kind, pin] of pins) {
				if (!candidates.some((candidate) => candidate.kind === kind && candidate.masterId === pin.masterId && candidate.revision === pin.revision && candidate.digest === pin.digest)) {
					throw new StackingError(`This ${kind} is not a compatible revision for these frames`, 409, 'incompatibleMaster')
				}
			}
		}

		this.store.putCohort(projectId, decision, Date.now())
		this.#changed()
		return (await this.cohorts(projectId)).find((candidate) => candidate.cohortId === cohortId)!
	}

	// Starts measuring the frames of a project whose measurement is missing or stale, then registers every group. Only one
	// analysis runs at a time. Every cohort must have its calibration decided, and every pinned master must still be the
	// revision pinned; those masters are leased until the analysis ends, so none of them can be deleted meanwhile.
	async startAnalysis(projectId: string) {
		await this.ready()
		this.#project(projectId)
		if ([...this.#jobs.values()].some((job) => job.type === 'analysis' && job.state === 'analyzing')) throw new StackingError('Another analysis is running', 409, 'jobConflict')

		const cohorts = await this.#cohorts(projectId)
		if (cohorts.length === 0) throw new StackingError('No included light with an available file belongs to a filter group', 409, 'conflict')
		const undecided = cohorts.find((cohort) => !cohort.calibration)
		if (undecided) throw new StackingError(`Decide how the ${undecided.groupName} frames are calibrated first`, 409, 'calibrationUndecided')

		const calibrations: Record<string, AnalysisCalibration> = {}
		const references: MasterReference[] = []
		const frames: AnalysisFrame[] = []
		const fingerprints = new Map<string, string>()

		for (const cohort of cohorts) {
			const calibration: { -readonly [K in keyof AnalysisCalibration]: AnalysisCalibration[K] } = {}

			for (const [kind, pin] of pinsOf(cohort.calibration)) {
				const master = await this.masters.pinnedMaster(pin)
				if (!master) throw new StackingError(`A ${kind} pinned for the ${cohort.groupName} frames is no longer available as pinned`, 409, 'masterUnavailable')
				calibration[kind] = { path: master.path, fullScale: master.units === 'dimensionless' ? 1 : master.fullScaleDn }
				references.push(pin)
			}

			calibrations[cohort.cohortId] = calibration

			for (const source of cohort.sources) {
				const fingerprint = analysisFingerprint(source, cohort.calibration)
				if (source.analysis?.fingerprint === fingerprint) continue
				frames.push({ sourceId: source.sourceId, path: source.path, bytes: source.bytes, mtimeMillis: source.mtimeMillis, cohortId: cohort.cohortId })
				fingerprints.set(source.sourceId, fingerprint)
			}
		}

		const now = Date.now()
		const job = this.#saveJob({ jobId: crypto.randomUUID(), projectId, type: 'analysis', state: 'analyzing', createdAt: now, updatedAt: now, found: frames.length, bytes: frames.reduce((sum, frame) => sum + frame.bytes, 0), truncated: false, measured: 0, failures: 0 })
		const controller = new AbortController()
		this.#scans.set(job.jobId, controller)
		const release = this.masters.lease(references)
		void this.#analyze(job, { jobId: job.jobId, frames, calibrations }, fingerprints, controller.signal).finally(release)
		return jobSummary(job)
	}

	// Runs an analysis to its end, saving each measurement as it arrives, so an interrupted analysis resumes where it
	// stopped; a failure ends in its job.
	async #analyze(job: StackingJob, request: Parameters<FrameAnalyzer['analyze']>[0], fingerprints: ReadonlyMap<string, string>, signal: AbortSignal) {
		let current = job
		let count = 0
		let failures = 0

		try {
			if (request.frames.length > 0) {
				await this.analyzer.analyze(
					request,
					(sourceId, measurement) => {
						this.store.setAnalyses([{ sourceId, analysis: { fingerprint: fingerprints.get(sourceId)!, analyzedAt: Date.now(), ...measurement } }])
						count++
						if (measurement.error !== undefined) failures++
						current = this.#saveJob(current, { measured: count, failures })
					},
					signal,
				)
			}

			signal.throwIfAborted()
			this.#register(job.projectId)
			this.#saveJob(current, { state: 'completed' })
		} catch (error) {
			if (signal.aborted) this.#saveJob(current, { state: 'cancelled' })
			else this.#saveJob(current, { state: 'failed', code: 'processingFailed', error: Error.isError(error) ? error.message : 'The analysis failed' })
		} finally {
			this.#scans.delete(job.jobId)
			this.#changed()
		}
	}

	// Registers the frames of a project whose measurement is current, and saves each transform and the project outcome.
	#register(projectId: string) {
		const project = this.store.project(projectId)
		if (!project) return
		const decisions = new Map(this.store.cohorts(projectId).map((decision) => [decision.cohortId, decision]))
		const groups = new Map<string, RegistrationFrame[]>()

		for (const { cohortId, groupKey, sources } of this.#cohortFrames(projectId).values()) {
			const calibration = decisions.get(cohortId)?.calibration
			let frames = groups.get(groupKey)

			if (!frames) {
				frames = []
				groups.set(groupKey, frames)
			}

			for (const source of sources) if (source.analysis?.fingerprint === analysisFingerprint(source, calibration)) frames.push({ sourceId: source.sourceId, analysis: source.analysis })
		}

		const input: RegistrationGroup[] = []
		for (const [key, frames] of groups) input.push({ key, frames, reference: project.settings.references[key] })
		const outcome = registerProject(input, project.settings.referenceGroup, Date.now())
		const updates: { sourceId: string; analysis: StackingFrameAnalysis }[] = []

		for (const { frames } of input) {
			for (const { sourceId, analysis } of frames) {
				const { registration: _, ...rest } = analysis
				const registration = outcome.frames.get(sourceId)
				updates.push({ sourceId, analysis: registration ? { ...rest, registration } : rest })
			}
		}

		this.store.setAnalyses(updates)
		this.store.setProjectAnalysis(projectId, outcome.project)
	}

	// Lists what blocks a stack of a project, what an operator must accept, and what is worth knowing, with the memory a
	// stack is estimated to need. Reads no pixel.
	async validate(projectId: string): Promise<StackingValidation> {
		await this.ready()
		const project = this.#project(projectId)
		const findings: StackingFinding[] = []
		const facts = this.store.facts(projectId)
		const groups = filterGroups(facts, this.store.aliases(projectId))
		const cohorts = await this.#cohorts(projectId)
		const unassigned = groups.find((group) => group.key === '')
		const objects = [...new Set(facts.flatMap((fact) => (fact.role === 'light' && fact.object ? fact.object : [])))].sort()

		if (cohorts.length === 0) findings.push({ severity: 'blocker', code: 'noLights', message: 'No included light with an available file belongs to a filter group' })
		if (unassigned && unassigned.frames > 0)
			findings.push({ severity: 'warning', code: 'unassignedLights', groupKey: '', message: `${framesText(unassigned.frames)} ${counted(unassigned.frames, 'names', 'name')} no filter and ${counted(unassigned.frames, 'stays', 'stay')} out of every stack until a filter is declared` })
		if (objects.length > 1) findings.push({ severity: 'review', code: 'multipleTargets', message: `Headers name ${objects.join(', ')}; check that every frame shows the same field` })

		for (const group of groups) {
			if (group.key !== '' && group.cohorts > 1) findings.push({ severity: 'warning', code: 'multipleSetups', groupKey: group.key, message: `${group.name} frames were taken with ${group.cohorts} acquisition settings, each calibrated with its own masters` })
		}

		for (const cohort of cohorts) {
			const where = { groupKey: cohort.groupKey, cohortId: cohort.cohortId }
			const label = `${cohort.groupName} frames${cohort.target.exposure === undefined ? '' : ` of ${cohort.target.exposure} s`}`
			if (cohort.target.cameraId === undefined) findings.push({ severity: 'review', code: 'cameraUndeclared', ...where, message: `Declare the camera of the ${label} so masters can be matched to them` })

			if (!cohort.calibration) {
				findings.push({ severity: 'blocker', code: 'calibrationUndecided', ...where, message: `Pin the masters of the ${label}, or decide they are not calibrated` })
				continue
			}

			if (cohort.calibration.kind === 'none') {
				findings.push({ severity: 'review', code: 'noCalibration', ...where, message: `The ${label} will not be calibrated: ${cohort.calibration.reason}` })
				continue
			}

			if (!cohort.calibration.flat) findings.push({ severity: 'warning', code: 'partialCalibration', ...where, message: `The ${label} have no flat; vignetting and dust stay in the stack` })
			if (!cohort.calibration.dark && !cohort.calibration.bias) findings.push({ severity: 'warning', code: 'partialCalibration', ...where, message: `The ${label} have no dark or bias; their pedestal stays in the stack` })

			for (const [kind, pin] of pinsOf(cohort.calibration)) {
				if (!(await this.masters.pinnedMaster(pin))) findings.push({ severity: 'blocker', code: 'masterUnavailable', ...where, message: `The ${kind} pinned for the ${label} is no longer available as pinned; pin another revision` })
				else if (!cohort.candidates.some((candidate) => candidate.kind === kind && candidate.masterId === pin.masterId && candidate.revision === pin.revision))
					findings.push({ severity: 'blocker', code: 'masterIncompatible', ...where, message: `The ${kind} pinned for the ${label} no longer matches them; pin another revision` })
			}
		}

		findings.push(...this.#analysisFindings(project, cohorts))
		let samples = 0
		for (const { target } of cohorts) samples = Math.max(samples, target.width * target.height * target.channels)
		return { findings, ready: !findings.some((finding) => finding.severity === 'blocker'), samples, memoryBytes: samples * STACK_BYTES_PER_PIXEL }
	}

	// Lists what the latest analysis of a project leaves to do or out, by filter group: frames to measure, groups to
	// register again because frames or reference pins changed since, frames that could not be measured or registered, and
	// frames failing the quality thresholds.
	#analysisFindings(project: StackingProject, cohorts: readonly CohortState[]) {
		const findings: StackingFinding[] = []
		const groups = new Map<string, { name: string; sources: StackingSource[]; stale: string[] }>()

		for (const cohort of cohorts) {
			let group = groups.get(cohort.groupKey)

			if (!group) {
				group = { name: cohort.groupName, sources: [], stale: [] }
				groups.set(cohort.groupKey, group)
			}

			for (const source of cohort.sources) {
				group.sources.push(source)
				if (source.analysis?.fingerprint !== analysisFingerprint(source, cohort.calibration)) group.stale.push(source.sourceId)
			}
		}

		const { analysis, settings } = project
		const projectReference = analysis?.referenceSourceId
		const usable = new Set(cohorts.flatMap((cohort) => cohort.sources.map((source) => source.sourceId)))
		const pinnedGroup = settings.referenceGroup
		const movedGroup = pinnedGroup !== undefined && analysis?.groups[pinnedGroup]?.referenceSourceId !== undefined && analysis.referenceGroup !== pinnedGroup
		const lostReference = projectReference === undefined || !usable.has(projectReference)

		for (const [groupKey, { name, sources, stale }] of groups) {
			if (stale.length > 0) {
				findings.push({ severity: 'blocker', code: 'analysisStale', groupKey, sourceIds: stale, message: `Analyze the project: ${framesText(stale.length)} of ${name} ${counted(stale.length, 'was', 'were')} not measured as ${counted(stale.length, 'it is', 'they are')} now calibrated` })
				continue
			}

			const outcome = analysis?.groups[groupKey]
			const pinned = settings.references[groupKey]
			const pinnedFrame = pinned === undefined ? undefined : sources.find((source) => source.sourceId === pinned)
			const movedReference = pinnedFrame !== undefined && measured(pinnedFrame.analysis) && outcome?.referenceSourceId !== pinned
			const unregistered = sources.some((source) => measured(source.analysis) && (!source.analysis.registration || source.analysis.analyzedAt > analysis!.analyzedAt))

			if (!analysis || !outcome || (outcome.referenceSourceId !== undefined && !usable.has(outcome.referenceSourceId)) || movedReference || movedGroup || lostReference || unregistered) {
				findings.push({ severity: 'blocker', code: 'analysisStale', groupKey, message: `Analyze the project: ${name} must be registered again` })
				continue
			}

			const failed = sources.filter((source) => source.analysis?.error !== undefined).map((source) => source.sourceId)
			const unmatched = sources.filter((source) => source.analysis?.registration?.success === false).map((source) => source.sourceId)
			const rejected = sources.filter((source) => source.analysis?.quality && subframeRejectionReasons(source.analysis.quality, settings.selection).length > 0).map((source) => source.sourceId)
			if (failed.length > 0) findings.push({ severity: 'warning', code: 'measurementFailed', groupKey, sourceIds: failed, message: `${framesText(failed.length)} of ${name} could not be measured and ${counted(failed.length, 'stays', 'stay')} out` })

			if (outcome.toProject?.success === false) {
				findings.push({ severity: 'blocker', code: 'registrationFailed', groupKey, message: `${name} does not register onto the project reference (${outcome.toProject.reason}); pin another reference` })
				continue
			}

			if (unmatched.length > 0)
				findings.push({ severity: 'warning', code: 'registrationFailed', groupKey, sourceIds: unmatched, message: `${framesText(unmatched.length)} of ${name} did not register onto ${counted(unmatched.length, 'its', 'their')} reference and ${counted(unmatched.length, 'stays', 'stay')} out` })
			if (rejected.length > 0) findings.push({ severity: 'warning', code: 'belowThresholds', groupKey, sourceIds: rejected, message: `${framesText(rejected.length)} of ${name} ${counted(rejected.length, 'fails', 'fail')} the quality thresholds and ${counted(rejected.length, 'stays', 'stay')} out` })
			const left = new Set([...failed, ...unmatched, ...rejected])
			if (sources.every((source) => left.has(source.sourceId))) findings.push({ severity: 'blocker', code: 'noLights', groupKey, message: `No frame of ${name} is left to stack` })
		}

		return findings
	}

	// Merges the lights of a filter key into the group of another. Both keys must name lights of the project; a target
	// already merged elsewhere is followed to its group, and keys merged into the merged key follow it, so no alias
	// ever points to a merged key.
	async setAlias(projectId: string, { filterKey, targetKey }: StackingFilterAlias) {
		await this.ready()
		this.#project(projectId)
		const keys = new Set(this.store.facts(projectId).flatMap((fact) => (fact.role === 'light' ? fact.filterKey : [])))
		if (filterKey === '' || targetKey === '' || !keys.has(filterKey) || !keys.has(targetKey)) throw new StackingError('Both filters must name lights of this project', 409, 'invalidAlias')

		const aliases = this.store.aliases(projectId)
		const root = aliases.find((alias) => alias.filterKey === targetKey)?.targetKey ?? targetKey
		if (root === filterKey) throw new StackingError('A filter cannot be merged into itself', 409, 'invalidAlias')

		const next: StackingFilterAlias[] = [{ filterKey, targetKey: root }]
		for (const alias of aliases) if (alias.filterKey !== filterKey) next.push({ filterKey: alias.filterKey, targetKey: alias.targetKey === filterKey ? root : alias.targetKey })
		this.store.setAliases(projectId, next, Date.now())
		this.#changed()
		return this.groups(projectId)
	}

	// Separates a merged filter key again.
	async removeAlias(projectId: string, filterKey: string) {
		await this.ready()
		this.#project(projectId)
		const aliases = this.store.aliases(projectId)
		this.store.setAliases(
			projectId,
			aliases.filter((alias) => alias.filterKey !== filterKey),
			Date.now(),
		)
		this.#changed()
		return this.groups(projectId)
	}

	// Compares the frames of a project, or of every project, with the disk.
	async refresh(projectId?: string) {
		await this.ready()
		if (projectId !== undefined) this.#project(projectId)
		await this.#refreshFiles(projectId)
		this.#changed()
		return this.snapshot()
	}

	// Marks each frame available, missing, or changed by the size and modification time of its file; an unreadable
	// header stays corrupt.
	async #refreshFiles(projectId?: string) {
		const sources = this.store.sourcesOf(projectId)
		const changed = new Map<string, StackingSource[]>()
		let next = 0

		const check = async () => {
			for (let index = next++; index < sources.length; index = next++) {
				const source = sources[index]
				if (source.status === 'corrupt') continue
				const info = await stat(source.path).catch(() => undefined)
				const status: SourceStatus = !info ? 'missing' : info.size === source.bytes && info.mtimeMs === source.mtimeMillis ? 'available' : 'changed'
				if (status === source.status) continue
				const list = changed.get(source.projectId)
				const updated = { ...source, status }
				if (list) list.push(updated)
				else changed.set(source.projectId, [updated])
			}
		}

		await Promise.all(Array.from({ length: REFRESH_CONCURRENCY }, check))
		const now = Date.now()
		for (const [project, list] of changed) this.store.putSources(project, list, now)
	}

	// Starts looking at directories and files of the server for a project. The scan keeps running after this returns,
	// reports through its job, and leaves candidates to review. Throws when a path is missing or managed by the application.
	async startImport(projectId: string, { paths, recursive = true }: StackingImportRequest) {
		await this.ready()
		this.#project(projectId)

		for (const path of paths) {
			if (isWithin(path, this.managed)) throw new StackingError('This directory holds files of Nebulosa, not frames to stack', 400, 'managedPath')
			if (!(await stat(path).catch(() => undefined))) throw new StackingError(`${basename(path)} cannot be read`, 404, 'notFound')
		}

		const now = Date.now()
		const job = this.#saveJob({ jobId: crypto.randomUUID(), projectId, type: 'import', state: 'scanning', createdAt: now, updatedAt: now, found: 0, bytes: 0, truncated: false })
		const controller = new AbortController()
		this.#scans.set(job.jobId, controller)
		void this.#scan(job, paths, recursive, controller.signal)
		return jobSummary(job)
	}

	// Runs a scan to its end; a failure ends in its job.
	async #scan(job: StackingJob, paths: readonly string[], recursive: boolean, signal: AbortSignal) {
		let current = job
		let reported = 0
		const candidates: (StackingImportCandidate & { readonly identity: string })[] = []
		const seen = new Set<string>()
		let truncated = false
		let found = 0
		let bytes = 0

		// Adds a file once, whichever path found it first.
		const add = (root: string, path: string, size: number, mtimeMillis: number, identity: string, inspection?: FileInspection, error?: string) => {
			if (seen.has(identity)) return
			seen.add(identity)
			candidates.push(this.#candidate(job.projectId, root, path, size, mtimeMillis, identity, inspection, error))
		}

		try {
			for (const root of paths) {
				const info = await stat(root)

				if (info.isDirectory()) {
					const scan = await scanDirectory({
						path: root,
						recursive: recursive,
						signal,
						progress: (files, size) => {
							if (found + files - reported < PROGRESS_STEP) return
							reported = found + files
							current = this.#saveJob(current, { found: found + files, bytes: bytes + size })
						},
					})

					truncated ||= scan.truncated
					for (const candidate of scan.candidates) add(root, candidate.path, candidate.bytes, candidate.mtimeMillis, candidate.identity, candidate.inspection, candidate.error)
				} else {
					signal.throwIfAborted()
					const identity = await fileIdentity(root, info)
					const inspection = await inspectFile(root).catch((error: unknown) => (Error.isError(error) ? error.message : String(error)))
					if (typeof inspection === 'string') add(root, root, info.size, info.mtimeMs, identity, undefined, inspection)
					else add(root, root, info.size, info.mtimeMs, identity, inspection, inspection ? undefined : 'The file holds no image')
				}

				found = candidates.length
				bytes = candidates.reduce((sum, candidate) => sum + candidate.bytes, 0)
			}

			this.#saveJob(current, { state: 'completed', found, bytes, truncated, candidates })
		} catch (error) {
			if (signal.aborted) this.#saveJob(current, { state: 'cancelled' })
			else this.#saveJob(current, { state: 'failed', code: 'processingFailed', error: `The files could not be read (${errorCode(error) ?? 'unexpected error'})` })
		} finally {
			this.#scans.delete(job.jobId)
		}
	}

	// Describes a file found for review: its role in a project, or why it cannot join one.
	#candidate(projectId: string, root: string, path: string, bytes: number, mtimeMillis: number, identity: string, inspection?: FileInspection, error?: string) {
		const name = path === root ? basename(path) : relative(root, path)
		const known = this.store.hasIdentity(projectId, identity)
		const base = { path, name, bytes, mtimeMillis, identity, known, warnings: inspection?.warnings ?? [] }
		if (!inspection) return { ...base, error: error ?? 'The header could not be read' }

		const outcome = lightRoleOf(inspection)
		const managed = isWithin(path, this.managed)
		const rejected = managed ? 'A file of Nebulosa, not a frame to stack' : 'rejected' in outcome ? outcome.rejected : inspection.metadata.bitpix === 64 ? 'Frames with BITPIX 64 are not supported' : undefined
		return {
			...base,
			format: inspection.format,
			...('role' in outcome && { role: outcome.role }),
			...(rejected !== undefined && { rejected }),
			...(inspection.metadata.filter.value !== undefined && { filter: inspection.metadata.filter.value }),
			...(inspection.object !== undefined && { object: inspection.object }),
			...(inspection.observedAt !== undefined && Number.isFinite(inspection.observedAt) && { observedAt: inspection.observedAt }),
			metadata: inspection.metadata,
		}
	}

	// Returns a job.
	async job(jobId: string) {
		await this.ready()
		return jobSummary(this.#job(jobId))
	}

	// Lists what an import found.
	importCandidates(jobId: string, offset: number, limit: number): Page<StackingImportCandidate> {
		const candidates = this.#job(jobId).candidates ?? []
		const items: StackingImportCandidate[] = []

		for (const { identity: _, ...candidate } of candidates.slice(offset, offset + Math.min(limit, MAX_PAGE_SIZE))) items.push(candidate)

		return { items, total: candidates.length }
	}

	// Cancels the scan of an import or an analysis. Throws when it already ended.
	cancel(jobId: string) {
		const job = this.#job(jobId)
		const scan = this.#scans.get(jobId)
		if (!scan) throw new StackingError('This job has ended', 409, 'jobConflict')
		scan.abort(new DOMException('Cancelled', 'AbortError'))
		return jobSummary(job)
	}

	// Adds reviewed files to the project of an import: lights, and unclassified files either declared lights with a
	// reason or kept unclassified for later. Rejected, unreadable, and already known files stay out. Returns how many
	// frames entered.
	async commitImport(jobId: string, { paths, lights = {} }: StackingImportCommit) {
		await this.ready()
		const job = this.#job(jobId)
		if (job.type !== 'import' || job.state !== 'completed' || job.committed !== undefined) throw new StackingError('This import cannot be committed', 409, 'jobConflict')
		this.#project(job.projectId)

		const chosen = paths && new Set(paths)
		const sources: StackingSource[] = []
		const identities = new Set<string>()

		for (const candidate of job.candidates ?? []) {
			if (chosen && !chosen.has(candidate.path)) continue
			if (candidate.error !== undefined || candidate.rejected !== undefined || candidate.role === undefined || !candidate.metadata || !candidate.format) continue
			if (identities.has(candidate.identity) || this.store.hasIdentity(job.projectId, candidate.identity)) continue
			identities.add(candidate.identity)

			const declared = candidate.role === 'unclassified' ? lights[candidate.path] : undefined
			const warnings = declared ? [...candidate.warnings, `Declared a light by an operator: ${declared.reason}`] : candidate.warnings

			sources.push({
				sourceId: stackingSourceId(job.projectId, candidate.path),
				projectId: job.projectId,
				path: candidate.path,
				format: candidate.format,
				identity: candidate.identity,
				bytes: candidate.bytes,
				mtimeMillis: candidate.mtimeMillis,
				status: 'available',
				role: declared ? 'light' : candidate.role,
				filterKey: filterKeyOf(candidate.metadata.filter.value),
				cohortKey: cohortKeyOf(candidate.metadata),
				...(candidate.object !== undefined && { object: candidate.object }),
				...(candidate.observedAt !== undefined && { observedAt: candidate.observedAt }),
				metadata: candidate.metadata,
				warnings,
			})
		}

		this.store.putSources(job.projectId, sources, Date.now())
		this.#saveJob(job, { candidates: undefined, committed: sources.length })
		this.#changed()
		return { committed: sources.length }
	}
}

// Answers a failure of a route with its status and code.
function failure(error: unknown) {
	if (error instanceof StackingError) return errorResponse(error.message, error.status, error.code)
	return errorResponse(Error.isError(error) ? error.message : String(error), 500, 'processingFailed')
}

// Runs a handler, answering its result as JSON.
async function answer(handler: () => unknown, status = 200) {
	try {
		return Response.json(await handler(), { status })
	} catch (error) {
		return failure(error)
	}
}

// Reads a page of a query string.
function pageOf(request: Request) {
	const { searchParams } = new URL(request.url)
	return { searchParams, offset: Number(searchParams.get('offset')) || 0, limit: Number(searchParams.get('limit')) || DEFAULT_PAGE_SIZE }
}

// Routes of Image Stacking. None of them needs a connection or touches a device.
export function createImageStackingRoutes(stacking: ImageStacking) {
	return {
		'/api/image-stacking': {
			GET: () =>
				answer(async () => {
					await stacking.ready()
					return stacking.snapshot()
				}),
		},
		'/api/image-stacking/refresh': {
			POST: () => answer(() => stacking.refresh()),
		},
		'/api/image-stacking/projects': {
			GET: () => answer(() => stacking.projects()),
			POST: async (request) => {
				const body = (await request.json()) as { readonly name: string }
				return answer(() => stacking.createProject(body), 201)
			},
		},
		'/api/image-stacking/projects/:projectId': {
			GET: ({ params }) => answer(() => stacking.project(params.projectId)),
			PATCH: async (request) => {
				const body = (await request.json()) as { readonly name: string; readonly revision: number }
				return answer(() => stacking.updateProject(request.params.projectId, body))
			},
			DELETE: ({ params }) => answer(() => stacking.deleteProject(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/settings': {
			PUT: async (request) => {
				const body = (await request.json()) as StackingSettings
				return answer(() => stacking.updateSettings(request.params.projectId, body))
			},
		},
		'/api/image-stacking/projects/:projectId/cohorts': {
			GET: ({ params }) => answer(() => stacking.cohorts(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/cohorts/:cohortId': {
			PATCH: async (request) => {
				const body = (await request.json()) as StackingCohortPatch
				return answer(() => stacking.updateCohort(request.params.projectId, request.params.cohortId, body))
			},
		},
		'/api/image-stacking/projects/:projectId/analyses': {
			POST: ({ params }) => answer(() => stacking.startAnalysis(params.projectId), 202),
		},
		'/api/image-stacking/projects/:projectId/validation': {
			GET: ({ params }) => answer(() => stacking.validate(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/refresh': {
			POST: ({ params }) => answer(() => stacking.refresh(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/imports': {
			POST: async (request) => {
				const body = (await request.json()) as StackingImportRequest
				return answer(() => stacking.startImport(request.params.projectId, body), 202)
			},
		},
		'/api/image-stacking/projects/:projectId/frames': {
			GET: (request) => {
				const { searchParams, offset, limit } = pageOf(request)
				const included = searchParams.get('included')
				const filter = {
					group: searchParams.get('group') ?? undefined,
					role: (searchParams.get('role') as StackingRole | null) ?? undefined,
					status: (searchParams.get('status') as SourceStatus | null) ?? undefined,
					included: included === null ? undefined : included === 'true',
					search: searchParams.get('search') || undefined,
				}
				return answer(() => stacking.frames(request.params.projectId, filter, offset, limit))
			},
		},
		'/api/image-stacking/projects/:projectId/groups': {
			GET: ({ params }) => answer(() => stacking.groups(params.projectId)),
		},
		'/api/image-stacking/projects/:projectId/aliases': {
			POST: async (request) => {
				const body = (await request.json()) as StackingFilterAlias
				return answer(() => stacking.setAlias(request.params.projectId, body))
			},
		},
		'/api/image-stacking/projects/:projectId/aliases/:filterKey': {
			DELETE: ({ params }) => answer(() => stacking.removeAlias(params.projectId, params.filterKey)),
		},
		'/api/image-stacking/frames/:sourceId': {
			GET: ({ params }) => answer(() => stacking.frame(params.sourceId)),
			PATCH: async (request) => {
				const body = (await request.json()) as StackingSourcePatch
				return answer(() => stacking.updateFrame(request.params.sourceId, body))
			},
			DELETE: ({ params }) => answer(() => stacking.removeFrame(params.sourceId)),
		},
		'/api/image-stacking/imports/:jobId': {
			GET: ({ params }) => answer(() => stacking.job(params.jobId)),
		},
		'/api/image-stacking/imports/:jobId/candidates': {
			GET: (request) => {
				const { offset, limit } = pageOf(request)
				return answer(() => stacking.importCandidates(request.params.jobId, offset, limit))
			},
		},
		'/api/image-stacking/imports/:jobId/cancel': {
			POST: ({ params }) => answer(() => stacking.cancel(params.jobId)),
		},
		'/api/image-stacking/analyses/:jobId/cancel': {
			POST: ({ params }) => answer(() => stacking.cancel(params.jobId)),
		},
		'/api/image-stacking/imports/:jobId/commit': {
			POST: async (request) => {
				const body = (await request.json()) as StackingImportCommit
				return answer(() => stacking.commitImport(request.params.jobId, body))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
