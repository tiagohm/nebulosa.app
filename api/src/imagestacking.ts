import { mkdir, rename, rm, stat, statfs } from 'fs/promises'
import { basename, join, relative } from 'path'
import { type ChannelMixIssueCode, validateChannelMix } from 'nebulosa/src/imaging/processing/channel.composition'
import { composeRegistrationTransforms } from 'nebulosa/src/imaging/processing/registration'
import { frameWeight } from 'nebulosa/src/imaging/processing/stacking.combination'
import { type SubframeRejectionReason, subframeRejectionReasons } from 'nebulosa/src/imaging/processing/subframe.selector'
import { medianOf } from 'nebulosa/src/math/numerical/statistics'
import type { CalibrationMasterDetail, ResolvePreview } from './calibrationlibrary'
import { fileDigest } from './calibrationlibrary.analysis'
import { type CalibrationKind, type CalibrationMetadata, type CalibrationTarget, type MasterReference, stableId } from './calibrationlibrary.compatibility'
import { fileIdentity, type FileInspection, inspectFile, scanDirectory } from './calibrationlibrary.sources'
import { MAX_PAGE_SIZE, type Page, type ProductStatus, type SourceFormat, type SourceStatus } from './calibrationlibrary.store'
import { errorResponse } from './http'
import { ANALYSIS_VERSION, type AnalysisCalibration, type AnalysisFrame, type FrameAnalyzer, REFERENCE_MIN_STARS, registerProject, type RegistrationFrame, type RegistrationGroup, StackingAnalyzer } from './imagestacking.analysis'
// oxfmt-ignore
import { DEFAULT_STACK_MEMORY_BUDGET, type FrameIntegrator, INTEGRATION_VERSION, type IntegrationFrame, type IntegrationPlan, integrationPlan, type IntegrationWorkerRequest, productHeader, StackingIntegrator, type StagedProduct } from './imagestacking.integration'
import { cohortKeyOf, filterKeyOf, filterSynonyms, isWithin, lightRoleOf, type StackingRole, stackingSourceId } from './imagestacking.sources'
// oxfmt-ignore
import { COMPOSITE_FILE, DEFAULT_STACKING_RECIPE, DEFAULT_STACKING_SETTINGS, type ImageStackingStore, PRODUCT_COVERAGE_FILE, type StackingComposite, type StackingComposition, PRODUCT_MASTER_FILE, type StackingCalibration, type StackingProduct, type StackingProductSource, type StackingRecipe, type StackingRun, type StackingRunGroup, type StackingCohortDecision, type StackingFilterAlias, type StackingFrameAnalysis, type StackingProject, type StackingProjectAnalysis, type StackingSettings, type StackingSource, type StackingSourceFacts, type StackingSourceFilter, type StackingSourceSummary, stackingSourceSummary } from './imagestacking.store'
// oxfmt-ignore
import { COMPOSITION_MEMORY_BUDGET, COMPOSITION_VERSION, type CompositionInput, type FrameCompositor, PREVIEW_SIZE, StackingCompositor } from './imagestacking.composition'
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
// blocks a stack, what an operator must accept, and what is only worth knowing. A run integrates every filter group that
// nothing blocks into an immutable linear master on the project grid, published one group at a time as it ends, so a
// cancelled run keeps what it published, and reuses a published master whose inputs are the same. Projects, frames,
// decisions, measurements, runs, and products are rows of the operational database; products are directories of
// products/. A composition mixes masters of one grid into a linear color composite without reading a light frame; a
// master stays while a composite reads it. Jobs live in memory and end with the process.

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
export type ImageStackingErrorCode = 'notFound' | 'conflict' | 'jobConflict' | 'managedPath' | 'verifiedMetadata' | 'invalidAlias' | 'calibrationUndecided' | 'masterUnavailable' | 'incompatibleMaster' | 'notReady' | 'insufficientMemory' | 'insufficientSpace' | 'productInUse' | 'superseded' | 'processingFailed'

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
// - integrating: integrating and publishing filter groups.
// - composing: composing and publishing a composite.
// - completed: did what it could; an import waits for its review.
// - failed, cancelled: ended early; an analysis keeps what it measured, and a run what it published.
export type StackingJobState = 'scanning' | 'analyzing' | 'integrating' | 'composing' | 'completed' | 'failed' | 'cancelled'

// States of a job still working.
const ACTIVE_JOB_STATES: ReadonlySet<StackingJobState> = new Set(['scanning', 'analyzing', 'integrating', 'composing'])

// Stable code of a problem of a composition.
export type StackingCompositionIssueCode = ChannelMixIssueCode | 'unknownProduct' | 'otherGrid' | 'productUnavailable' | 'productStale' | 'invalidLuminance'

// A problem of a composition: a blocker stops it, a warning is worth knowing.
export interface StackingCompositionIssue {
	readonly severity: 'blocker' | 'warning'
	readonly code: StackingCompositionIssueCode
	readonly message: string
}

// What a composition would do.
export interface StackingCompositionValidation {
	readonly issues: readonly StackingCompositionIssue[]
	// Whether nothing blocks it.
	readonly ready: boolean
	// Identity of its inputs, and a published composite with the same one, reused instead of composed again.
	readonly fingerprint: string
	readonly reusedCompositeId?: string
}

// State of a composite now: as a product, stale while a master it mixes is stale.
export interface StackingCompositeSummary extends StackingComposite {
	readonly status: StackingProductStatus
	readonly staleReasons?: readonly string[]
}

// A composite with the path of its file, to open it in Images.
export interface StackingCompositeDetail extends StackingCompositeSummary {
	readonly path: string
}

// Request of a run.
export interface StackingRunRequest {
	// Key of the request, so sending it again answers the same run instead of starting another.
	readonly token: string
	// Changes to the default recipe.
	readonly recipe?: Partial<StackingRecipe>
	// Keys of the filter groups to integrate; every group nothing blocks when absent.
	readonly groups?: readonly string[]
	// Memory of the integration, in bytes; 2 GiB when absent.
	readonly memoryBudget?: number
}

// What a run of one filter group would do.
export interface StackingPreflightGroup {
	readonly groupKey: string
	readonly name: string
	// Frames it integrates, and their exposure, in seconds.
	readonly frames: number
	readonly exposure: number
	// Published master with the same inputs, reused instead of integrated.
	readonly reusedProductId?: string
	// How it integrates within the memory budget.
	readonly plan: IntegrationPlan
}

// What a run would do, and what stops it.
export interface StackingPreflight {
	readonly recipe: StackingRecipe
	// Memory of the integration and free space of the staging disk, in bytes.
	readonly memoryBudget: number
	readonly freeBytes: number
	readonly groups: readonly StackingPreflightGroup[]
	// Why it cannot start, in words; empty when it can.
	readonly problems: readonly string[]
}

// State of a product now:
// - ready: its files and inputs are what it integrated.
// - stale: a frame or a pinned master changed or went away since; the file is still the one published.
// - unavailable: its file is missing or of another size.
export type StackingProductStatus = 'ready' | 'stale' | 'unavailable'

// A product with its state.
export interface StackingProductSummary extends StackingProduct {
	readonly status: StackingProductStatus
	// Why it is stale.
	readonly staleReasons?: readonly string[]
}

// A product with what is only for one who asks: the paths of its files, to open them in Images, and its frames.
export interface StackingProductDetail extends StackingProductSummary {
	readonly path: string
	readonly coveragePath: string
	readonly sources: readonly StackingProductSource[]
}

// How a run integrates one filter group, with what its publication checks again.
interface GroupPlan extends StackingPreflightGroup {
	readonly frames: number
	// Frames in integration order, the reference of the group first, with the sources a product records.
	readonly integration: readonly IntegrationFrame[]
	readonly sources: readonly StackingProductSource[]
	// Header of the master and identity of its inputs.
	readonly header: IntegrationWorkerRequest['groups'][number]['header']
	readonly fingerprint: string
	// Calibration of each cohort integrated, by cohort id.
	readonly calibration: Readonly<Record<string, StackingCalibration>>
}

// Plan of a run: the preflight with what starting it needs.
interface RunPlan extends StackingPreflight {
	readonly groups: readonly GroupPlan[]
	// Project grid, in pixels, and its reference frame.
	readonly width: number
	readonly height: number
	readonly referenceSourceId: string
	// Masters of each cohort integrated, by cohort id, and their pins, which the run leases.
	readonly calibrations: Readonly<Record<string, AnalysisCalibration>>
	readonly pins: readonly MasterReference[]
	// Code of the first problem.
	readonly code?: ImageStackingErrorCode
}

// What lists and events show of a job: no paths.
export interface StackingJobSummary {
	readonly jobId: string
	// Project it works for.
	readonly projectId: string
	// What it does.
	readonly type: 'import' | 'analysis' | 'integration' | 'composition'
	readonly state: StackingJobState
	// When it was requested, and last changed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly updatedAt: number
	// Files found, or frames to measure, and their total size, in bytes.
	readonly found: number
	readonly bytes: number
	// Frames an analysis measured or a run read so far, and those an analysis could not measure.
	readonly measured?: number
	readonly failures?: number
	// Name of the filter group a run integrates, the rows it or a composition combined of the total, and the masters it
	// published.
	readonly group?: string
	readonly rowsCombined?: number
	readonly rowsTotal?: number
	readonly published?: number
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
	// the directories whose files belong to the application, which an import never reads; analyzer measures frames and
	// integrator integrates them, and compositor mixes masters.
	constructor(
		readonly store: ImageStackingStore,
		readonly listener: (event: ImageStackingEvent) => void,
		readonly masters: StackingMasters,
		readonly managed: readonly string[] = [store.directory],
		readonly analyzer: FrameAnalyzer = new StackingAnalyzer(),
		readonly integrator: FrameIntegrator = new StackingIntegrator(),
		readonly compositor: FrameCompositor = new StackingCompositor(),
	) {}

	// Preview being computed, aborted by the next one.
	#preview?: AbortController
	// Masters a composition or a preview is reading, with how many readers.
	readonly #reading = new Map<string, number>()

	// Finishes what the end of the last process interrupted and compares the frames with the disk, once. A failure leaves
	// the next request to try again.
	ready() {
		this.#opened ??= this.#recoverProducts()
			.then(() => this.#refreshFiles())
			.then(
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

	// Deletes a project with its products and stops its jobs; its frames stay on the disk.
	async deleteProject(projectId: string) {
		await this.ready()
		this.#project(projectId)

		for (const job of this.#jobs.values()) {
			if (job.projectId === projectId) this.#scans.get(job.jobId)?.abort(new DOMException('Project deleted', 'AbortError'))
		}

		for (const { compositeId } of this.store.composites(projectId)) {
			this.store.setCompositePublication(compositeId, 'deleting')
			await rm(this.store.compositeDirectory(compositeId), { recursive: true, force: true })
		}

		for (const { productId } of this.store.products(projectId)) {
			this.store.setPublication(productId, 'deleting')
			await rm(this.store.productDirectory(productId), { recursive: true, force: true })
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
		this.#ensureIdle()

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

	// Throws while an analysis or a run works, since both read and write the measurements of frames.
	#ensureIdle() {
		if ([...this.#jobs.values()].some((job) => (job.type === 'analysis' || job.type === 'integration') && ACTIVE_JOB_STATES.has(job.state))) throw new StackingError('Another analysis or integration is running', 409, 'jobConflict')
	}

	// Finishes what a crash interrupted, from the disk: a product or composite being published becomes published when its
	// directory holds the files it recorded, and is forgotten otherwise; one being deleted loses its directory and its row. A product
	// directory without a row is moved to orphaned/ and reported, never adopted nor deleted. Runs still running were
	// interrupted, and staging holds nothing anyone owns. What cannot be finished is reported and tried again next start.
	async #recoverProducts() {
		for (const { product, publication } of this.store.pendingProducts()) {
			const { productId } = product

			try {
				if (publication === 'publishing' && (await this.#intact(product))) {
					this.store.setPublication(productId, 'published')
				} else {
					await rm(this.store.productDirectory(productId), { recursive: true, force: true })
					this.store.discardProduct(productId)
				}
			} catch (error) {
				console.error('image stacking: unable to finish product', productId, error)
			}
		}

		for (const { composite, publication } of this.store.pendingComposites()) {
			const { compositeId } = composite
			const path = join(this.store.compositeDirectory(compositeId), COMPOSITE_FILE)

			try {
				if (publication === 'publishing' && (await stat(path).catch(() => undefined))?.size === composite.bytes && (await fileDigest(path)) === composite.contentDigest) {
					this.store.setCompositePublication(compositeId, 'published')
				} else {
					await rm(this.store.compositeDirectory(compositeId), { recursive: true, force: true })
					this.store.discardComposite(compositeId)
				}
			} catch (error) {
				console.error('image stacking: unable to finish composite', compositeId, error)
			}
		}

		for (const composites of [false, true]) {
			for (const name of await this.store.productDirectories(composites)) {
				if (composites ? this.store.hasComposite(name) : this.store.hasProduct(name)) continue
				const target = join(this.store.orphanedDirectory, `${name}-${crypto.randomUUID()}`)

				try {
					await mkdir(this.store.orphanedDirectory, { recursive: true })
					await rename(composites ? this.store.compositeDirectory(name) : this.store.productDirectory(name), target)
					console.warn(`image stacking: ${name} has no record and was moved to ${target}`)
				} catch (error) {
					console.error('image stacking: unable to move an orphaned product', name, error)
				}
			}
		}

		this.store.interruptRuns(Date.now())
		await this.store.clearStaging()
	}

	// Returns whether the files of a product are the ones it recorded: the master by size and SHA-256, its coverage by size.
	async #intact(product: StackingProduct) {
		const directory = this.store.productDirectory(product.productId)
		const master = await stat(join(directory, PRODUCT_MASTER_FILE)).catch(() => undefined)
		const coverage = await stat(join(directory, PRODUCT_COVERAGE_FILE)).catch(() => undefined)
		return master?.size === product.bytes && coverage?.size === product.coverageBytes && (await fileDigest(join(directory, PRODUCT_MASTER_FILE))) === product.contentDigest
	}

	// Describes a product now: unavailable while a file is missing or of another size, stale while a frame it integrated
	// left the project, is not available, or was measured with another SHA-256, or while a pinned master is no longer
	// available as pinned.
	async #productSummary(product: StackingProduct): Promise<StackingProductSummary> {
		const directory = this.store.productDirectory(product.productId)
		const master = await stat(join(directory, PRODUCT_MASTER_FILE)).catch(() => undefined)
		const coverage = await stat(join(directory, PRODUCT_COVERAGE_FILE)).catch(() => undefined)
		if (master?.size !== product.bytes || coverage?.size !== product.coverageBytes) return { ...product, status: 'unavailable' }
		const reasons = new Set<string>()

		for (const { sourceId, digest } of this.store.productSources(product.productId)) {
			const source = this.store.source(sourceId)
			if (!source) reasons.add('A frame it integrated left the project')
			else if (source.status !== 'available') reasons.add('A frame it integrated is missing or changed')
			else if (source.analysis?.digest !== undefined && source.analysis.digest !== digest) reasons.add('A frame it integrated was measured with other content')
		}

		for (const calibration of Object.values(product.calibration)) {
			for (const [, pin] of pinsOf(calibration)) if (!(await this.masters.pinnedMaster(pin))) reasons.add('A master it was calibrated with is no longer available as pinned')
		}

		return reasons.size === 0 ? { ...product, status: 'ready' } : { ...product, status: 'stale', staleReasons: [...reasons] }
	}

	// Lists the products of a project, newest first, with their state.
	async products(projectId: string) {
		await this.ready()
		this.#project(projectId)
		const products: StackingProductSummary[] = []
		for (const product of this.store.products(projectId)) products.push(await this.#productSummary(product))
		return products
	}

	// Returns a product with the paths of its files and its frames. Throws when unknown.
	async product(productId: string): Promise<StackingProductDetail> {
		await this.ready()
		const product = this.store.product(productId)
		if (!product) throw new StackingError('Unknown product', 404, 'notFound')
		const directory = this.store.productDirectory(productId)
		return { ...(await this.#productSummary(product)), path: join(directory, PRODUCT_MASTER_FILE), coveragePath: join(directory, PRODUCT_COVERAGE_FILE), sources: this.store.productSources(productId) }
	}

	// Deletes a product with its directory. It is recorded as deleting before its directory goes, so a crash between them
	// is finished on the next start.
	async deleteProduct(productId: string) {
		await this.ready()
		if (!this.store.product(productId)) throw new StackingError('Unknown product', 404, 'notFound')
		if (this.store.compositesOf(productId) > 0 || this.#reading.has(productId)) throw new StackingError('A composite is mixed from this master; delete the composite first', 409, 'productInUse')
		this.store.setPublication(productId, 'deleting')
		await rm(this.store.productDirectory(productId), { recursive: true, force: true })
		this.store.discardProduct(productId)
		this.#changed()
		return { deleted: productId }
	}

	// Checks a composition of masters of a project: every source must be a published master of the project with the plane
	// named, every master on one grid and available, and the mix and luminance composable. A stale master is only a
	// warning. Answers the fingerprint of the inputs and a published composite with the same one.
	async validateComposition(projectId: string, composition: StackingComposition): Promise<StackingCompositionValidation> {
		await this.ready()
		this.#project(projectId)
		const issues: StackingCompositionIssue[] = []
		const products: StackingProductSummary[] = []

		for (const [index, source] of composition.sources.entries()) {
			const product = this.store.product(source.productId)

			if (product?.projectId !== projectId) {
				issues.push({ severity: 'blocker', code: 'unknownProduct', message: `Source ${index + 1} is not a master of this project` })
				continue
			}

			const summary = await this.#productSummary(product)
			products.push(summary)
			if (source.plane >= product.channels) issues.push({ severity: 'blocker', code: 'unknownPlane', message: `${product.name} has no channel ${source.plane + 1}` })
			if (summary.status === 'unavailable') issues.push({ severity: 'blocker', code: 'productUnavailable', message: `The master of ${product.name} is not available` })
			if (summary.status === 'stale') issues.push({ severity: 'warning', code: 'productStale', message: `The master of ${product.name} is stale: ${summary.staleReasons?.join('; ')}` })
		}

		if (products.some((product) => product.width !== products[0].width || product.height !== products[0].height || product.referenceSourceId !== products[0].referenceSourceId)) {
			issues.push({ severity: 'blocker', code: 'otherGrid', message: 'The masters are not on one grid; integrate them in one run of this project' })
		}

		for (const issue of validateChannelMix(composition.mix, composition.sources)) {
			const channel = issue.channel === undefined ? '' : ` of ${issue.channel}`
			const source = issue.plane === undefined ? '' : ` (source ${issue.plane + 1})`
			const messages: Readonly<Record<ChannelMixIssueCode, string>> = {
				emptyChannel: `The channel${channel} has no source with a positive weight`,
				invalidWeight: `A weight${channel}${source} is not a finite non-negative number`,
				unknownPlane: `A term${channel} names no source${source}`,
				invalidGain: `The gain${source} must be positive`,
				invalidOffset: `The offset${source} must be finite`,
			}
			issues.push({ severity: 'blocker', code: issue.code, message: messages[issue.code] })
		}

		const { luminance } = composition
		if (luminance && (!Number.isInteger(luminance.source) || luminance.source < 0 || luminance.source >= composition.sources.length || !(luminance.alpha >= 0 && luminance.alpha <= 1)))
			issues.push({ severity: 'blocker', code: 'invalidLuminance', message: 'The luminance must name a source and a weight between 0 and 1' })

		const digests = composition.sources.map((source) => this.store.product(source.productId)?.contentDigest ?? '')
		const fingerprint = stableId(JSON.stringify({ version: COMPOSITION_VERSION, composition: { ...composition, preset: undefined }, digests }))
		const published = this.store.compositeByFingerprint(projectId, fingerprint)
		const reused = published && (await this.#compositeSummary(published)).status === 'ready' ? published : undefined
		return { issues, ready: !issues.some((issue) => issue.severity === 'blocker'), fingerprint, ...(reused && { reusedCompositeId: reused.compositeId }) }
	}

	// Returns what the worker reads of a composition: the grid and the file of each source. Throws while it is not ready.
	async #compositionInput(projectId: string, composition: StackingComposition, jobId: string) {
		const validation = await this.validateComposition(projectId, composition)
		const blocker = validation.issues.find((issue) => issue.severity === 'blocker')
		if (blocker) throw new StackingError(blocker.message, 409, 'notReady')
		const products = composition.sources.map((source) => this.store.product(source.productId)!)
		const planes = composition.sources.map((source) => ({ path: join(this.store.productDirectory(source.productId), PRODUCT_MASTER_FILE), plane: source.plane, gain: source.gain, offset: source.offset }))
		const input: CompositionInput = { jobId, width: products[0].width, height: products[0].height, planes, mix: composition.mix, ...(composition.luminance && { luminance: composition.luminance }) }
		return { validation, products, input }
	}

	// Holds masters while a composition or a preview reads them, so none of them can be deleted meanwhile. Returns the
	// release, which is safe to call more than once.
	#read(productIds: readonly string[]) {
		for (const productId of productIds) this.#reading.set(productId, (this.#reading.get(productId) ?? 0) + 1)
		let released = false

		return () => {
			if (released) return
			released = true

			for (const productId of productIds) {
				const count = (this.#reading.get(productId) ?? 1) - 1
				if (count > 0) this.#reading.set(productId, count)
				else this.#reading.delete(productId)
			}
		}
	}

	// Previews a composition as a JPEG at most PREVIEW_SIZE pixels on its longest side. Only the latest preview is
	// computed: a newer request aborts this one, which then answers 409 superseded.
	async previewComposition(projectId: string, composition: StackingComposition) {
		await this.ready()
		const { products, input } = await this.#compositionInput(projectId, composition, crypto.randomUUID())
		this.#preview?.abort(new DOMException('Superseded', 'AbortError'))
		const controller = new AbortController()
		this.#preview = controller
		const release = this.#read(products.map((product) => product.productId))

		try {
			return await this.compositor.preview({ ...input, size: PREVIEW_SIZE }, controller.signal)
		} catch (error) {
			if (controller.signal.aborted) throw new StackingError('A newer preview was asked for', 409, 'superseded')
			throw error
		} finally {
			release()
			if (this.#preview === controller) this.#preview = undefined
		}
	}

	// Starts composing a composition of a project, or answers the published composite with the same inputs. One
	// composition runs at a time; its masters cannot be deleted until it ends.
	async startComposition(projectId: string, composition: StackingComposition) {
		await this.ready()
		const project = this.#project(projectId)
		if ([...this.#jobs.values()].some((job) => job.type === 'composition' && ACTIVE_JOB_STATES.has(job.state))) throw new StackingError('Another composition is running', 409, 'jobConflict')
		const jobId = crypto.randomUUID()
		const { validation, products, input } = await this.#compositionInput(projectId, composition, jobId)
		if (validation.reusedCompositeId !== undefined) return { composite: await this.#compositeSummary(this.store.composite(validation.reusedCompositeId)!), reused: true }

		const objects = [...new Set(this.store.facts(projectId).flatMap((fact) => (fact.role === 'light' && fact.object ? fact.object : [])))]
		const channels = (['red', 'green', 'blue'] as const).map((channel) => `${channel[0].toUpperCase()} = ${composition.mix[channel].flatMap(({ plane, weight }) => (weight > 0 ? `${weight}·${products[plane].name}` : [])).join(' + ')}`)
		const header = {
			SOFTWARE: 'Nebulosa',
			...(objects.length === 1 && { OBJECT: objects[0] }),
			COLORSPC: 'linear RGB',
			HISTORY: `Linear color composite (${composition.preset}) of the masters of ${project.name}: ${channels.join(', ')}${composition.luminance && composition.luminance.alpha > 0 ? `, luminance ${products[composition.luminance.source].name} at ${composition.luminance.alpha}` : ''}`,
		}
		const now = Date.now()
		const job = this.#saveJob({ jobId, projectId, type: 'composition', state: 'composing', createdAt: now, updatedAt: now, found: products.length, bytes: 0, truncated: false, rowsCombined: 0, rowsTotal: input.height * 2 })
		const controller = new AbortController()
		this.#scans.set(jobId, controller)
		const release = this.#read(products.map((product) => product.productId))
		const staging = this.store.stagingDirectory(jobId)
		void this.#compose(job, composition, validation.fingerprint, { ...input, header, staging, memoryBudget: COMPOSITION_MEMORY_BUDGET }, controller.signal).finally(release)
		return { job: jobSummary(job) }
	}

	// Runs a composition to its end and publishes it like a product: recorded as publishing, renamed into composites/,
	// then published; a failure ends in its job.
	async #compose(job: StackingJob, composition: StackingComposition, fingerprint: string, request: Parameters<FrameCompositor['compose']>[0], signal: AbortSignal) {
		let current = job

		try {
			const image = await this.compositor.compose(request, ({ rows, rowsTotal }) => (current = this.#saveJob(current, { rowsCombined: rows, rowsTotal })), signal)
			if (!this.store.project(job.projectId)) throw new Error('The project was deleted')
			const compositeId = crypto.randomUUID()
			const composite: StackingComposite = { compositeId, projectId: job.projectId, fingerprint, createdAt: Date.now(), contentDigest: image.contentDigest, bytes: image.bytes, width: image.width, height: image.height, left: image.left, top: image.top, composition, diagnostics: image.diagnostics }
			this.store.beginComposite(composite)

			try {
				await mkdir(this.store.compositesDirectory, { recursive: true })
				await rename(image.directory, this.store.compositeDirectory(compositeId))
			} catch {
				this.store.discardComposite(compositeId)
				throw new Error('The composite could not be published')
			}

			this.store.setCompositePublication(compositeId, 'published')
			this.#saveJob(current, { state: 'completed', published: 1 })
		} catch (error) {
			if (signal.aborted) this.#saveJob(current, { state: 'cancelled' })
			else this.#saveJob(current, { state: 'failed', code: 'processingFailed', error: Error.isError(error) ? error.message : 'The composition failed' })
		} finally {
			this.#scans.delete(job.jobId)
			await rm(request.staging, { recursive: true, force: true }).catch(() => undefined)
			this.#changed()
		}
	}

	// Describes a composite now: unavailable while its file is missing or of another size, stale while a master it mixes
	// is not ready.
	async #compositeSummary(composite: StackingComposite): Promise<StackingCompositeSummary> {
		const info = await stat(join(this.store.compositeDirectory(composite.compositeId), COMPOSITE_FILE)).catch(() => undefined)
		if (info?.size !== composite.bytes) return { ...composite, status: 'unavailable' }
		const reasons = new Set<string>()

		for (const { productId } of composite.composition.sources) {
			const product = this.store.product(productId)
			if (!product) reasons.add('A master it mixes is gone')
			else if ((await this.#productSummary(product)).status !== 'ready') reasons.add(`The master of ${product.name} is not ready`)
		}

		return reasons.size === 0 ? { ...composite, status: 'ready' } : { ...composite, status: 'stale', staleReasons: [...reasons] }
	}

	// Lists the composites of a project, newest first, with their state.
	async composites(projectId: string) {
		await this.ready()
		this.#project(projectId)
		const composites: StackingCompositeSummary[] = []
		for (const composite of this.store.composites(projectId)) composites.push(await this.#compositeSummary(composite))
		return composites
	}

	// Returns a composite with the path of its file. Throws when unknown.
	async composite(compositeId: string): Promise<StackingCompositeDetail> {
		await this.ready()
		const composite = this.store.composite(compositeId)
		if (!composite) throw new StackingError('Unknown composite', 404, 'notFound')
		return { ...(await this.#compositeSummary(composite)), path: join(this.store.compositeDirectory(compositeId), COMPOSITE_FILE) }
	}

	// Deletes a composite with its directory, recorded as deleting first; the masters it mixed stay.
	async deleteComposite(compositeId: string) {
		await this.ready()
		if (!this.store.composite(compositeId)) throw new StackingError('Unknown composite', 404, 'notFound')
		this.store.setCompositePublication(compositeId, 'deleting')
		await rm(this.store.compositeDirectory(compositeId), { recursive: true, force: true })
		this.store.discardComposite(compositeId)
		this.#changed()
		return { deleted: compositeId }
	}

	// Lists the latest runs of a project, newest first.
	async runs(projectId: string) {
		await this.ready()
		this.#project(projectId)
		return this.store.runs(projectId, KEPT_JOBS)
	}

	// Plans a run: every filter group nothing blocks, or those asked for, with the frames that stay in after the analysis
	// and the thresholds, the reference of each group first, each with the transform from the project grid to its pixels
	// and its weight; a published master with the same inputs is reused. Reports what stops it: a blocker of validation,
	// a group that does not fit the memory budget, or a spill larger than the free space of the staging disk.
	async #planRun(project: StackingProject, request: Omit<StackingRunRequest, 'token'>): Promise<RunPlan> {
		const { projectId, analysis, settings } = project
		const recipe: StackingRecipe = { ...DEFAULT_STACKING_RECIPE, ...request.recipe }
		const memoryBudget = request.memoryBudget ?? DEFAULT_STACK_MEMORY_BUDGET
		await mkdir(this.store.directory, { recursive: true })
		const { bavail, bsize } = await statfs(this.store.directory)
		const freeBytes = bavail * bsize
		const problems: string[] = []
		let code: ImageStackingErrorCode | undefined
		const problem = (message: string, problemCode: ImageStackingErrorCode) => {
			problems.push(message)
			code ??= problemCode
		}

		for (const finding of (await this.validate(projectId)).findings) if (finding.severity === 'blocker') problem(finding.message, 'notReady')
		const reference = analysis?.referenceSourceId === undefined ? undefined : this.store.source(analysis.referenceSourceId)
		const empty = { recipe, memoryBudget, freeBytes, groups: [], width: 0, height: 0, referenceSourceId: '', calibrations: {}, pins: [] }
		if (!analysis || !reference) return { ...empty, problems: problems.length > 0 ? problems : ['Analyze the project first'], code: code ?? 'notReady' }

		const { width, height } = reference.metadata
		const cohorts = await this.#cohorts(projectId)
		const calibrations: Record<string, AnalysisCalibration> = {}
		const pins: MasterReference[] = []
		const groups: GroupPlan[] = []
		const keys = [...new Set(cohorts.map((cohort) => cohort.groupKey))].filter((key) => request.groups === undefined || request.groups.includes(key))

		for (const key of keys) {
			const outcome = analysis.groups[key]
			const toProject = outcome?.toProject
			if (!outcome?.referenceSourceId || !toProject?.success) continue
			const members = cohorts.filter((cohort) => cohort.groupKey === key)
			const frames: { source: StackingSource; cohortId: string; inverse: IntegrationFrame['inverse'] }[] = []

			for (const cohort of members) {
				for (const source of cohort.sources) {
					const measured = source.analysis
					if (measured?.fingerprint !== analysisFingerprint(source, cohort.calibration) || !measured.quality || !measured.digest || !measured.registration?.success) continue
					if (subframeRejectionReasons(measured.quality, settings.selection).length > 0) continue
					const composed = composeRegistrationTransforms(measured.registration.transform, toProject.transform)
					if (composed) frames.push({ source, cohortId: cohort.cohortId, inverse: composed.inverseTransform })
				}
			}

			if (frames.length === 0) continue
			frames.sort((a, b) => (a.source.sourceId === outcome.referenceSourceId ? -1 : b.source.sourceId === outcome.referenceSourceId ? 1 : (a.source.observedAt ?? 0) - (b.source.observedAt ?? 0) || a.source.sourceId.localeCompare(b.source.sourceId)))
			if (frames[0].source.sourceId !== outcome.referenceSourceId) continue

			const name = members[0].groupName
			const calibration: Record<string, StackingCalibration> = {}
			const integration: IntegrationFrame[] = []
			const sources: StackingProductSource[] = []
			const exposures = new Set<number>()
			let exposure = 0

			for (const { source, cohortId, inverse } of frames) {
				const weight = frameWeight(1, source.analysis!.quality!, recipe.weighting, settings.selection.minStars ?? REFERENCE_MIN_STARS)
				integration.push({ sourceId: source.sourceId, path: source.path, bytes: source.bytes, mtimeMillis: source.mtimeMillis, cohortId, inverse, weight })
				sources.push({ sourceId: source.sourceId, digest: source.analysis!.digest!, weight })
				const seconds = (source.metadata.exposure.value ?? 0) / 1000000
				exposures.add(seconds)
				exposure += seconds
				calibration[cohortId] = members.find((cohort) => cohort.cohortId === cohortId)!.calibration!
			}

			const metadata = frames[0].source.metadata
			const channels = frames.some(({ source }) => source.metadata.cfa !== undefined) ? 3 : metadata.channels
			const objects = [...new Set(frames.flatMap(({ source }) => source.object ?? []))]
			const fingerprint = stableId(JSON.stringify({ version: INTEGRATION_VERSION, key, grid: [width, height, reference.sourceId], frames: integration.map(({ sourceId, weight, inverse }, index) => [sourceId, sources[index].digest, weight, inverse]), calibration, recipe }))
			const published = this.store.productByFingerprint(projectId, fingerprint)
			const reused = published && (await this.#productSummary(published)).status === 'ready' ? published : undefined
			const plan = integrationPlan(width, height, channels, frames.length, recipe.method, memoryBudget)
			if (!reused && !plan.fits) problem(`${name} needs about ${Math.ceil(plan.memoryBytes / 1024 ** 2)} MiB of memory; raise the memory budget or choose an average`, 'insufficientMemory')
			if (!reused && plan.diskBytes > freeBytes) problem(`${name} spills about ${Math.ceil(plan.diskBytes / 1024 ** 2)} MiB to a disk with ${Math.floor(freeBytes / 1024 ** 2)} MiB free`, 'insufficientSpace')

			if (!reused) {
				for (const [cohortId, cohortCalibration] of Object.entries(calibration)) {
					if (calibrations[cohortId]) continue
					const masters: { -readonly [K in keyof AnalysisCalibration]: AnalysisCalibration[K] } = {}

					for (const [kind, pin] of pinsOf(cohortCalibration)) {
						const master = await this.masters.pinnedMaster(pin)
						if (!master) problem(`A ${kind} pinned for the ${name} frames is no longer available as pinned`, 'masterUnavailable')
						else masters[kind] = { path: master.path, fullScale: master.units === 'dimensionless' ? 1 : master.fullScaleDn }
						pins.push(pin)
					}

					calibrations[cohortId] = masters
				}
			}

			const header = productHeader(metadata, name, frames.length, { each: exposures.size === 1 ? [...exposures][0] : undefined, total: exposure }, objects.length === 1 ? objects[0] : undefined)
			groups.push({ groupKey: key, name, frames: frames.length, exposure, ...(reused && { reusedProductId: reused.productId }), plan, integration, sources, header, fingerprint, calibration })
		}

		if (groups.length === 0 && problems.length === 0) problem('No filter group has a frame to integrate', 'notReady')
		return { recipe, memoryBudget, freeBytes, groups, problems, width, height, referenceSourceId: reference.sourceId, calibrations, pins, code }
	}

	// Answers what a run of a project would do, without starting it.
	async preflight(projectId: string, request: Omit<StackingRunRequest, 'token'>): Promise<StackingPreflight> {
		await this.ready()
		const { recipe, memoryBudget, freeBytes, groups, problems } = await this.#planRun(this.#project(projectId), request)
		const summaries: StackingPreflightGroup[] = []
		for (const { groupKey, name, frames, exposure, reusedProductId, plan } of groups) summaries.push({ groupKey, name, frames, exposure, ...(reusedProductId !== undefined && { reusedProductId }), plan })
		return { recipe, memoryBudget, freeBytes, groups: summaries, problems }
	}

	// Starts integrating a project. A request sent again with its token answers the run it started. Refuses while another
	// analysis or run works, and while preflight reports a problem. Groups already published with the same inputs are
	// reused; the others are integrated on the worker, and each is published as soon as it is staged. The pinned masters
	// are leased until the run ends.
	async startRun(projectId: string, request: StackingRunRequest) {
		await this.ready()
		const project = this.#project(projectId)
		const known = this.store.runByToken(projectId, request.token)
		if (known) return { run: known }
		this.#ensureIdle()

		const plan = await this.#planRun(project, request)
		if (plan.problems.length > 0) throw new StackingError(plan.problems[0], 409, plan.code ?? 'notReady')

		const now = Date.now()
		const runId = crypto.randomUUID()
		const groups: StackingRunGroup[] = plan.groups.map(({ groupKey, name, frames, reusedProductId }) => ({ groupKey, name, frames, ...(reusedProductId !== undefined && { productId: reusedProductId, reused: true }) }))
		const run: StackingRun = { runId, projectId, token: request.token, state: 'running', createdAt: now, recipe: plan.recipe, groups }
		const pending = plan.groups.filter((group) => group.reusedProductId === undefined)
		this.store.putRun(run)
		const job = this.#saveJob({ jobId: runId, projectId, type: 'integration', state: 'integrating', createdAt: now, updatedAt: now, found: pending.reduce((sum, group) => sum + group.frames, 0), bytes: 0, truncated: false, measured: 0, published: 0 })

		if (pending.length === 0) {
			this.store.putRun({ ...run, state: 'completed', endedAt: Date.now() })
			const ended = this.#saveJob(job, { state: 'completed' })
			this.#changed()
			return { run: this.store.run(runId)!, job: jobSummary(ended) }
		}

		const staging = this.store.stagingDirectory(runId)
		const work: IntegrationWorkerRequest = {
			jobId: runId,
			width: plan.width,
			height: plan.height,
			groups: pending.map((group, index) => ({ key: group.groupKey, frames: group.integration, header: group.header, staging: join(staging, String(index)) })),
			calibrations: plan.calibrations,
			recipe: plan.recipe,
			memoryBudget: plan.memoryBudget,
		}

		const controller = new AbortController()
		this.#scans.set(runId, controller)
		const release = this.masters.lease(plan.pins)
		void this.#integrate(job, run, plan, work, controller.signal).finally(release)
		return { run, job: jobSummary(job) }
	}

	// Runs an integration to its end, publishing each staged group in order; a failure ends in the run and its job, and
	// the groups published before stay.
	async #integrate(job: StackingJob, run: StackingRun, plan: RunPlan, request: IntegrationWorkerRequest, signal: AbortSignal) {
		const byKey = new Map(plan.groups.map((group) => [group.groupKey, group]))
		const offsets = new Map<string, number>()
		let offset = 0
		let current = job
		let state = run
		let published = 0
		let publishing = Promise.resolve()

		for (const group of request.groups) {
			offsets.set(group.key, offset)
			offset += group.frames.length
		}

		const outcome = (groupKey: string, patch: Partial<StackingRunGroup>) => {
			state = { ...state, groups: state.groups.map((group) => (group.groupKey === groupKey ? { ...group, ...patch } : group)) }
			this.store.putRun(state)
		}

		const handlers = {
			onProgress: ({ group, frames, rowsCombined, rowsTotal }: { group: string; frames: number; rowsCombined: number; rowsTotal: number }) => {
				current = this.#saveJob(current, { group: byKey.get(group)?.name, measured: (offsets.get(group) ?? 0) + frames, rowsCombined, rowsTotal })
			},
			onStaged: (staged: StagedProduct) => {
				const group = byKey.get(staged.group)!
				// Publications run one after another; each one's failure stays in its group.
				publishing = publishing
					.then(async () => {
						outcome(group.groupKey, { productId: await this.#publishProduct(run, plan, group, staged) })
						current = this.#saveJob(current, { published: ++published })
					})
					.catch((error: unknown) => outcome(group.groupKey, { error: Error.isError(error) ? error.message : 'The master could not be published' }))
			},
			onGroupFailed: (group: string, error: string) => outcome(group, { error }),
		}

		let error: string | undefined

		try {
			await this.integrator.integrate(request, handlers, signal)
		} catch (failure) {
			if (!signal.aborted) error = Error.isError(failure) ? failure.message : 'The integration failed'
		} finally {
			await publishing
			this.#scans.delete(run.runId)
			await rm(this.store.stagingDirectory(run.runId), { recursive: true, force: true }).catch(() => undefined)
		}

		const complete = state.groups.every((group) => group.productId !== undefined)
		const ended = signal.aborted ? 'cancelled' : error === undefined && complete ? 'completed' : 'failed'
		const failed = error ?? (ended === 'failed' ? 'A filter group could not be integrated' : undefined)
		state = { ...state, state: ended, endedAt: Date.now(), ...(failed !== undefined && { error: failed }) }
		if (this.store.project(run.projectId)) this.store.putRun(state)
		this.#saveJob(current, { state: ended, ...(failed !== undefined && { code: 'processingFailed' as const, error: failed }) })
		this.#changed()
	}

	// Makes a staged master visible: its frames and pinned masters are compared with what the run planned, the product is
	// recorded as publishing, the rename moves its directory into products/, and only then is it published. A crash between
	// them is finished on the next start from what the directory holds. Returns the product id; throws with a message that
	// holds no path, leaving what is published untouched.
	async #publishProduct(run: StackingRun, plan: RunPlan, group: GroupPlan, staged: StagedProduct) {
		for (const frame of group.integration) {
			const info = await stat(frame.path).catch(() => undefined)
			if (info?.size !== frame.bytes || info.mtimeMs !== frame.mtimeMillis) throw new Error('A frame changed while it was integrated')
		}

		for (const calibration of Object.values(group.calibration)) {
			for (const [, pin] of pinsOf(calibration)) if (!(await this.masters.pinnedMaster(pin))) throw new Error('A pinned master changed while it was integrated')
		}

		if (!this.store.project(run.projectId)) throw new Error('The project was deleted')
		const productId = crypto.randomUUID()

		const product: StackingProduct = {
			productId,
			projectId: run.projectId,
			runId: run.runId,
			groupKey: group.groupKey,
			name: group.name,
			fingerprint: group.fingerprint,
			createdAt: Date.now(),
			contentDigest: staged.contentDigest,
			bytes: staged.bytes,
			coverageDigest: staged.coverageDigest,
			coverageBytes: staged.coverageBytes,
			width: plan.width,
			height: plan.height,
			channels: staged.channels,
			referenceSourceId: plan.referenceSourceId,
			frames: group.frames,
			exposure: group.exposure,
			recipe: plan.recipe,
			calibration: group.calibration,
			diagnostics: staged.diagnostics,
		}

		this.store.beginProduct(product, group.sources)

		try {
			await mkdir(this.store.productsDirectory, { recursive: true })
			await rename(staged.directory, this.store.productDirectory(productId))
		} catch {
			this.store.discardProduct(productId)
			throw new Error('The master could not be published')
		}

		this.store.setPublication(productId, 'published')
		this.#changed()
		return productId
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
		'/api/image-stacking/projects/:projectId/preflight': {
			POST: async (request) => {
				const body = (await request.json()) as Omit<StackingRunRequest, 'token'>
				return answer(() => stacking.preflight(request.params.projectId, body))
			},
		},
		'/api/image-stacking/projects/:projectId/runs': {
			GET: ({ params }) => answer(() => stacking.runs(params.projectId)),
			POST: async (request) => {
				const body = (await request.json()) as StackingRunRequest
				return answer(() => stacking.startRun(request.params.projectId, body), 202)
			},
		},
		'/api/image-stacking/projects/:projectId/products': {
			GET: ({ params }) => answer(() => stacking.products(params.projectId)),
		},
		'/api/image-stacking/products/:productId': {
			GET: ({ params }) => answer(() => stacking.product(params.productId)),
			DELETE: ({ params }) => answer(() => stacking.deleteProduct(params.productId)),
		},
		'/api/image-stacking/projects/:projectId/compositions/validate': {
			POST: async (request) => {
				const body = (await request.json()) as StackingComposition
				return answer(() => stacking.validateComposition(request.params.projectId, body))
			},
		},
		'/api/image-stacking/projects/:projectId/compositions/preview': {
			POST: async (request) => {
				const body = (await request.json()) as StackingComposition

				try {
					return new Response(await stacking.previewComposition(request.params.projectId, body), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' } })
				} catch (error) {
					return failure(error)
				}
			},
		},
		'/api/image-stacking/projects/:projectId/compositions': {
			POST: async (request) => {
				const body = (await request.json()) as StackingComposition
				return answer(() => stacking.startComposition(request.params.projectId, body), 202)
			},
		},
		'/api/image-stacking/projects/:projectId/composites': {
			GET: ({ params }) => answer(() => stacking.composites(params.projectId)),
		},
		'/api/image-stacking/composites/:compositeId': {
			GET: ({ params }) => answer(() => stacking.composite(params.compositeId)),
			DELETE: ({ params }) => answer(() => stacking.deleteComposite(params.compositeId)),
		},
		'/api/image-stacking/compositions/:jobId/cancel': {
			POST: ({ params }) => answer(() => stacking.cancel(params.jobId)),
		},
		'/api/image-stacking/runs/:runId/cancel': {
			POST: ({ params }) => answer(() => stacking.cancel(params.runId)),
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
