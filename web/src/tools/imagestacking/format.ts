// oxfmt-ignore
import type { StackingJobSummary, StackingCohort, StackingFinding, StackingFindingSeverity, StackingFrameSummary, StackingImportCandidate, StackingMasterCandidate, StackingProductStatus, StackingRecipe, StackingRegistration, StackingRole, StackingSettings } from 'api'
import { MISSING } from '../../format'
import type { StatusTone } from '../../ui/StatusBadge'
import { masterName } from '../calibrationlibrary/library'

// Presentation helpers of Image Stacking: labels and texts of what the server answers, which candidates of an import a
// commit would add, and the settings a threshold form describes. Nothing here decides a role, a filter, a calibration, or
// whether a frame is stacked; the server does.

// Sections of the tool.
export const STACKING_SECTIONS = ['filters', 'frames', 'calibration', 'quality', 'integration', 'results', 'composition'] as const

// Section of the tool.
export type StackingSection = (typeof STACKING_SECTIONS)[number]

// Label of each section.
export const SECTION_LABELS: Readonly<Record<StackingSection, string>> = { filters: 'Filters', frames: 'Frames', calibration: 'Calibration', quality: 'Quality', integration: 'Integration', results: 'Results', composition: 'Color' }

// Label of each role.
export const ROLE_LABELS: Readonly<Record<StackingRole, string>> = { light: 'Light', unclassified: 'Unclassified' }

// Text of a total integration time in seconds: hours and minutes, or minutes and seconds below one hour.
export function integrationText(seconds: number) {
	const total = Math.round(seconds)
	if (total < 3600) return `${Math.floor(total / 60)} min ${total % 60} s`
	return `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min`
}

// What a candidate of an import is, for its review.
export function candidateText(candidate: StackingImportCandidate) {
	if (candidate.error !== undefined) return candidate.error
	if (candidate.rejected !== undefined) return candidate.rejected
	if (candidate.known) return 'Already in this project'
	return candidate.role === undefined ? 'Unknown' : ROLE_LABELS[candidate.role]
}

// Returns whether a candidate can enter a project.
export function candidateUsable(candidate: StackingImportCandidate) {
	return candidate.error === undefined && candidate.rejected === undefined && !candidate.known && candidate.role !== undefined
}

// Candidates of an import checked for its commit, across every page of its review.
export interface ImportSelection {
	// Whether a candidate is checked unless it is in `except`; when false, only those in `except` are.
	readonly all: boolean
	// Role of each usable candidate checked the other way, by path.
	readonly except: ReadonlyMap<string, StackingRole>
}

// Every usable candidate checked, as a review starts.
export const ALL_CANDIDATES: ImportSelection = { all: true, except: new Map() }

// No candidate checked.
export const NO_CANDIDATES: ImportSelection = { all: false, except: new Map() }

// Returns whether a candidate of an import is checked.
export function candidateChecked(selection: ImportSelection, path: string) {
	return selection.all !== selection.except.has(path)
}

// Returns a selection with a usable candidate, of a role, checked or unchecked.
export function withCandidate(selection: ImportSelection, path: string, role: StackingRole, checked: boolean): ImportSelection {
	const except = new Map(selection.except)
	if (checked === selection.all) except.delete(path)
	else except.set(path, role)
	return { all: selection.all, except }
}

// Counts the frames a commit adds from the counts of its import and the candidates checked, with `declared` checked
// unclassified files declared lights.
export function committedCounts(job: Pick<StackingJobSummary, 'lights' | 'unclassified'>, selection: ImportSelection, declared: number) {
	let lights = selection.all ? (job.lights ?? 0) : 0
	let unclassified = selection.all ? (job.unclassified ?? 0) : 0

	for (const role of selection.except.values()) {
		const change = selection.all ? -1 : 1
		if (role === 'light') lights += change
		else unclassified += change
	}

	return { lights: Math.max(0, lights) + declared, unclassified: Math.max(0, unclassified - declared) }
}

// Kinds of master a light is calibrated with, in the order they are shown.
export const LIGHT_MASTER_KINDS = ['dark', 'flat', 'bias'] as const

// Kind of master a light is calibrated with.
export type LightMaster = (typeof LIGHT_MASTER_KINDS)[number]

// Label of each kind of master.
export const LIGHT_MASTER_LABELS: Readonly<Record<LightMaster, string>> = { dark: 'Dark', flat: 'Flat', bias: 'Bias' }

// Tone and label of each severity of a finding.
export const SEVERITY_TONES: Readonly<Record<StackingFindingSeverity, StatusTone>> = { blocker: 'danger', review: 'warning', warning: 'neutral' }
export const SEVERITY_LABELS: Readonly<Record<StackingFindingSeverity, string>> = { blocker: 'Blocker', review: 'Review', warning: 'Note' }

// Whether a finding of the validation also keeps an analysis from starting, as the server refuses one: no included light
// with an available file at all (the project-wide noLights, without a group), or a chosen master that is no longer
// available. Every other blocker, such as a stale analysis or a group left without frames, only blocks a stack.
export function blocksAnalysis(finding: StackingFinding) {
	return finding.severity === 'blocker' && ((finding.code === 'noLights' && finding.groupKey === undefined) || finding.code === 'masterUnavailable')
}

// Label of each quality threshold a frame can fail.
export const REJECTION_LABELS: Readonly<Record<NonNullable<StackingFrameSummary['rejected']>[number], string>> = {
	'too-few-stars': 'Too few stars',
	'median-snr-too-low': 'SNR too low',
	'median-hfd-too-high': 'HFD too high',
	'median-hfd-unavailable': 'No HFD',
	'median-fwhm-too-high': 'FWHM too high',
	'median-fwhm-unavailable': 'No FWHM',
	'median-eccentricity-too-high': 'Too elongated',
	'median-eccentricity-unavailable': 'No eccentricity',
	'median-elongation-too-high': 'Too elongated',
	'median-elongation-unavailable': 'No elongation',
	'background-too-high': 'Background too high',
	'noise-too-high': 'Noise too high',
	'normalized-score-too-low': 'Score too low',
}

// Quality thresholds an operator edits, with their labels, units, the step of their field, and their largest value
// (eccentricity is 0 to 1, and the background is a fraction of the full scale). No threshold is meaningful at 0, which
// stands for none: a minimum of 0 rejects nothing, and a maximum of 0 would reject every frame.
export const THRESHOLDS = [
	{ key: 'minStars', label: 'Minimum Stars', unit: '', step: 1 },
	{ key: 'minMedianSNR', label: 'Minimum SNR', unit: '', step: 0.5 },
	{ key: 'maxMedianHFD', label: 'Maximum HFD', unit: 'px', step: 0.1 },
	{ key: 'maxMedianEccentricity', label: 'Maximum Eccentricity', unit: '', step: 0.01, max: 1 },
	{ key: 'maxBackground', label: 'Maximum Background', unit: '', step: 0.001, max: 1 },
] as const satisfies readonly { readonly key: keyof StackingSettings['selection']; readonly label: string; readonly unit: string; readonly step: number; readonly max?: number }[]

// Threshold an operator edits.
export type ThresholdKey = (typeof THRESHOLDS)[number]['key']

// Returns the thresholds of a form: a field at 0 or below sets none.
export function selectionOf(fields: Readonly<Record<ThresholdKey, number>>): StackingSettings['selection'] {
	const selection: Partial<Record<ThresholdKey, number>> = {}
	for (const { key } of THRESHOLDS) if (fields[key] > 0) selection[key] = fields[key]
	return selection
}

// Returns the form fields of thresholds, 0 for a threshold not set.
export function selectionFields(selection: StackingSettings['selection']): Record<ThresholdKey, number> {
	const { minStars = 0, minMedianSNR = 0, maxMedianHFD = 0, maxMedianEccentricity = 0, maxBackground = 0 } = selection
	return { minStars, minMedianSNR, maxMedianHFD, maxMedianEccentricity, maxBackground }
}

// Text of a measured value with a precision; a missing or unbounded value is a dash. JSON writes Infinity as null.
export function metricText(value: number | null | undefined, digits: number = 2) {
	return value === null || value === undefined || !Number.isFinite(value) ? MISSING : value.toFixed(digits)
}

// Text of a registration: the shift in pixels and the rotation in degrees, or why it failed.
export function registrationText(registration: StackingRegistration | undefined) {
	if (!registration) return MISSING
	if (!registration.success) return `Failed: ${registration.reason}`
	const { translationX, translationY, rotation, rmsError } = registration.transform.summary
	return `${translationX.toFixed(1)}, ${translationY.toFixed(1)} px · ${((rotation * 180) / Math.PI).toFixed(2)}° · ${rmsError.toFixed(2)} px rms`
}

// Text of a master offered to a cohort: its id, when it was published, the frames it integrated, and whether it carries
// warnings.
export function masterText(candidate: Pick<StackingMasterCandidate, 'masterId' | 'createdAt' | 'frames' | 'status'>) {
	return `${masterName(candidate)} · ${candidate.frames === 1 ? '1 frame' : `${candidate.frames} frames`}${candidate.status === 'warning' ? ' · warnings' : ''}`
}

// Title of a cohort: its filter, exposure, and frames.
export function cohortText(cohort: Pick<StackingCohort, 'groupKey' | 'target' | 'frames'>) {
	const exposure = cohort.target.exposure === undefined ? 'unknown exposure' : `${cohort.target.exposure} s`
	return `${cohort.groupKey} · ${exposure} · ${cohort.frames === 1 ? '1 frame' : `${cohort.frames} frames`}`
}

// Combination methods, in the order they are offered.
export const METHODS = ['weighted-sigma-clip', 'sigma-clip', 'winsorized-mean', 'percentile-clip-average', 'min-max-average', 'median', 'weighted-average', 'average', 'sum'] as const satisfies readonly StackingRecipe['method'][]

// Label of each combination method.
export const METHOD_LABELS: Readonly<Record<StackingRecipe['method'], string>> = {
	'weighted-sigma-clip': 'Weighted Sigma Clip',
	'sigma-clip': 'Sigma Clip',
	'winsorized-mean': 'Winsorized Mean',
	'percentile-clip-average': 'Percentile Clip',
	'min-max-average': 'Min/Max Rejection',
	median: 'Median',
	'weighted-average': 'Weighted Average',
	average: 'Average',
	sum: 'Sum',
}

// Methods whose rejection limits are set in standard deviations.
export const SIGMA_METHODS: ReadonlySet<StackingRecipe['method']> = new Set(['weighted-sigma-clip', 'sigma-clip'])

// Weighting modes and their labels.
export const WEIGHTINGS = ['quality', 'snr', 'inverse-hfd', 'stars', 'none'] as const satisfies readonly StackingRecipe['weighting'][]
export const WEIGHTING_LABELS: Readonly<Record<StackingRecipe['weighting'], string>> = { quality: 'Quality', snr: 'SNR', 'inverse-hfd': 'Sharpness', stars: 'Star Count', none: 'Equal' }

// Normalization modes and their labels.
export const NORMALIZATIONS = ['background-scale', 'percentile', 'scale', 'none'] as const satisfies readonly StackingRecipe['normalization'][]
export const NORMALIZATION_LABELS: Readonly<Record<StackingRecipe['normalization'], string>> = { 'background-scale': 'Background and Scale', percentile: 'Percentile', scale: 'Scale', none: 'None' }

// Interpolation kernels and their labels.
export const INTERPOLATIONS = ['bilinear', 'bicubic', 'nearest'] as const satisfies readonly StackingRecipe['interpolation'][]
export const INTERPOLATION_LABELS: Readonly<Record<StackingRecipe['interpolation'], string>> = { bilinear: 'Bilinear', bicubic: 'Bicubic', nearest: 'Nearest' }

// Tone and label of each state of a product.
export const PRODUCT_TONES: Readonly<Record<StackingProductStatus, StatusTone>> = { ready: 'success', stale: 'warning', unavailable: 'danger' }
export const PRODUCT_LABELS: Readonly<Record<StackingProductStatus, string>> = { ready: 'Ready', stale: 'Stale', unavailable: 'Unavailable' }

// Text of a size in bytes, in MiB or GiB.
export function memoryText(bytes: number) {
	return bytes < 1024 ** 3 ? `${Math.ceil(bytes / 1024 ** 2)} MiB` : `${(bytes / 1024 ** 3).toFixed(1)} GiB`
}
