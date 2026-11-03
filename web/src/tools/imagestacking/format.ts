import type { StackingCohort, StackingFindingSeverity, StackingFrameSummary, StackingImportCandidate, StackingMasterCandidate, StackingRegistration, StackingRole, StackingSettings } from 'api'
import type { StatusTone } from '../../ui/StatusBadge'

// Presentation helpers of Image Stacking: labels and texts of what the server answers, which candidates of an import a
// commit would add, and the settings a threshold form describes. Nothing here decides a role, a filter, a calibration, or
// whether a frame is stacked; the server does.

// Sections of the tool.
export const STACKING_SECTIONS = ['filters', 'frames', 'calibration', 'quality'] as const

// Section of the tool.
export type StackingSection = (typeof STACKING_SECTIONS)[number]

// Label of each section.
export const SECTION_LABELS: Readonly<Record<StackingSection, string>> = { filters: 'Filters', frames: 'Frames', calibration: 'Calibration', quality: 'Quality' }

// Label of each role.
export const ROLE_LABELS: Readonly<Record<StackingRole, string>> = { light: 'Light', unclassified: 'Unclassified' }

// Text of a total integration time in seconds: hours and minutes, or minutes and seconds below one hour.
export function integrationText(seconds: number) {
	const total = Math.round(seconds)
	if (total < 3600) return `${Math.floor(total / 60)} min ${total % 60} s`
	return `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min`
}

// Text of a group key: its name, or Unassigned for the lights without a filter.
export function groupLabel(key: string, name: string) {
	return key === '' ? 'Unassigned' : name
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

// Counts the candidates a commit adds: lights, and unclassified files either declared lights or kept unclassified.
export function committedCounts(candidates: readonly StackingImportCandidate[], declared: ReadonlySet<string>) {
	let lights = 0
	let unclassified = 0

	for (const candidate of candidates) {
		if (!candidateUsable(candidate)) continue
		if (candidate.role === 'light' || declared.has(candidate.path)) lights++
		else unclassified++
	}

	return { lights, unclassified }
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

// Quality thresholds an operator edits, with their labels and units.
export const THRESHOLDS = [
	{ key: 'minStars', label: 'Minimum Stars', unit: '' },
	{ key: 'minMedianSNR', label: 'Minimum SNR', unit: '' },
	{ key: 'maxMedianHFD', label: 'Maximum HFD', unit: 'px' },
	{ key: 'maxMedianEccentricity', label: 'Maximum Eccentricity', unit: '' },
	{ key: 'maxBackground', label: 'Maximum Background', unit: '' },
] as const satisfies readonly { readonly key: keyof StackingSettings['selection']; readonly label: string; readonly unit: string }[]

// Threshold an operator edits.
export type ThresholdKey = (typeof THRESHOLDS)[number]['key']

// Returns the thresholds written in a form: a blank or unreadable field sets none.
export function selectionOf(fields: Readonly<Partial<Record<ThresholdKey, string>>>): StackingSettings['selection'] {
	const selection: Partial<Record<ThresholdKey, number>> = {}

	for (const { key } of THRESHOLDS) {
		const text = fields[key]?.trim()
		const value = text ? Number(text) : Number.NaN
		if (Number.isFinite(value)) selection[key] = value
	}

	return selection
}

// Returns the form fields of thresholds.
export function selectionFields(selection: StackingSettings['selection']): Partial<Record<ThresholdKey, string>> {
	const fields: Partial<Record<ThresholdKey, string>> = {}
	for (const { key } of THRESHOLDS) if (selection[key] !== undefined) fields[key] = String(selection[key])
	return fields
}

// Text of a measured value with a precision; a missing or unbounded value is a dash. JSON writes Infinity as null.
export function metricText(value: number | null | undefined, digits: number = 2) {
	return value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits)
}

// Text of a registration: the shift in pixels and the rotation in degrees, or why it failed.
export function registrationText(registration: StackingRegistration | undefined) {
	if (!registration) return '—'
	if (!registration.success) return `Failed: ${registration.reason}`
	const { translationX, translationY, rotation, rmsError } = registration.transform.summary
	return `${translationX.toFixed(1)}, ${translationY.toFixed(1)} px · ${((rotation * 180) / Math.PI).toFixed(2)}° · ${rmsError.toFixed(2)} px rms`
}

// Text of a master revision offered to a cohort.
export function masterText(candidate: Pick<StackingMasterCandidate, 'kind' | 'masterId' | 'revision' | 'preferred'>) {
	return `${LIGHT_MASTER_LABELS[candidate.kind]} ${candidate.masterId.slice(0, 8)} · revision ${candidate.revision}${candidate.preferred ? ' · preferred' : ''}`
}

// Key of a master revision in a choice list.
export function masterKey(reference: { readonly masterId: string; readonly revision: number }) {
	return `${reference.masterId}:${reference.revision}`
}

// Title of a cohort: its filter, exposure, and frames.
export function cohortText(cohort: Pick<StackingCohort, 'groupName' | 'target' | 'frames'>) {
	const exposure = cohort.target.exposure === undefined ? 'unknown exposure' : `${cohort.target.exposure} s`
	return `${cohort.groupName} · ${exposure} · ${cohort.frames === 1 ? '1 frame' : `${cohort.frames} frames`}`
}
