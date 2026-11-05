import type { CalibrationGroupSummary, CalibrationJobSummary, CalibrationMaster, CalibrationKind, CalibrationMetadata, CalibrationRecipe, Evidenced, EvidenceLevel, GroupReadiness, OverridableField, ProductStatus, SourceOrigin, SourceStatus } from 'api'
import { MISSING } from '../../format'
import type { StatusTone } from '../../ui/StatusBadge'

// What the Calibration Library tool shows of what the server decided: labels, tones, and the coverage of a page of groups.
// Pure, so none of it needs a tab. Nothing here judges a frame; every state and reason is the server's.

// Sections of the tool, in control order.
export const LIBRARY_SECTIONS = ['library', 'frames', 'masters'] as const

// Section of the tool.
export type LibrarySection = (typeof LIBRARY_SECTIONS)[number]

// Label of each section.
export const SECTION_LABELS: Readonly<Record<LibrarySection, string>> = { library: 'Library', frames: 'Frames', masters: 'Masters' }

// Roles, in control order.
export const CALIBRATION_KINDS: readonly CalibrationKind[] = ['dark', 'bias', 'darkFlat', 'flat']

// Label of each role.
export const KIND_LABELS: Readonly<Record<CalibrationKind, string>> = { dark: 'Dark', bias: 'Bias', darkFlat: 'Dark-Flat', flat: 'Flat' }

// Choices of the role filter: every role, or one.
export const KIND_FILTERS = ['all', ...CALIBRATION_KINDS] as const

// Choice of the role filter.
export type KindFilter = (typeof KIND_FILTERS)[number]

// Label of each state of a group.
export const READINESS_LABELS: Readonly<Record<GroupReadiness, string>> = { ready: 'Ready', needsReview: 'Needs Review', incomplete: 'Incomplete', incompatible: 'Incompatible', missingFiles: 'Missing Files', notSupported: 'Not Supported' }

// Tone of each state of a group.
export const READINESS_TONES: Readonly<Record<GroupReadiness, StatusTone>> = { ready: 'success', needsReview: 'warning', incomplete: 'muted', incompatible: 'danger', missingFiles: 'danger', notSupported: 'muted' }

// Label of each state of a file.
export const SOURCE_STATUS_LABELS: Readonly<Record<SourceStatus, string>> = { available: 'Available', missing: 'Missing', changed: 'Changed', corrupt: 'Corrupt' }

// Tone of each state of a file.
export const SOURCE_STATUS_TONES: Readonly<Record<SourceStatus, StatusTone>> = { available: 'success', missing: 'danger', changed: 'danger', corrupt: 'danger' }

// Label of each origin of a frame.
export const ORIGIN_LABELS: Readonly<Record<SourceOrigin, string>> = { darkPlan: 'Dark Library', flatWizard: 'Flat Wizard', import: 'Imported' }

// Label of each state of a master.
export const PRODUCT_STATUS_LABELS: Readonly<Record<ProductStatus, string>> = { ready: 'Ready', warning: 'Warnings', stale: 'Stale', unavailable: 'Unavailable' }

// Tone of each state of a master.
export const PRODUCT_STATUS_TONES: Readonly<Record<ProductStatus, StatusTone>> = { ready: 'success', warning: 'warning', stale: 'warning', unavailable: 'danger' }

// Label of each way of knowing a value.
export const EVIDENCE_LABELS: Readonly<Record<EvidenceLevel, string>> = { verified: 'From the file', planDeclared: 'From the plan', operatorDeclared: 'Declared by an operator', unknown: 'Unknown' }

// Combination methods, in control order.
export const RECIPE_METHODS: readonly CalibrationRecipe['method'][] = ['sigmaClip', 'median', 'mean']

// Label of each combination method.
export const METHOD_LABELS: Readonly<Record<CalibrationRecipe['method'], string>> = { sigmaClip: 'Sigma-Clipped Mean', median: 'Median', mean: 'Mean' }

// Fields that can be declared, in control order, with their labels.
export const OVERRIDE_LABELS: Readonly<Record<OverridableField, string>> = {
	exposure: 'Exposure (µs)',
	setTemperature: 'Target Temperature (°C)',
	sensorTemperature: 'Sensor Temperature (°C)',
	gain: 'Gain',
	offset: 'Offset',
	binX: 'Binning X',
	binY: 'Binning Y',
	readoutMode: 'Readout Mode',
	filter: 'Filter',
	telescope: 'Telescope',
	focalLength: 'Focal Length (mm)',
}

// Whether a field holds text rather than a number.
export function overrideIsText(field: OverridableField) {
	return field === 'readoutMode' || field === 'filter' || field === 'telescope'
}

// Text of a value, a dash when unknown.
function valueText<T>({ value }: Evidenced<T>, format: (value: T) => string = String) {
	return value === undefined ? MISSING : format(value)
}

// Text of an exposure in integer microseconds, in the seconds an operator chose.
export function exposureText(metadata: Pick<CalibrationMetadata, 'exposure'>) {
	return valueText(metadata.exposure, (value) => `${value / 1000000} s`)
}

// Text of a temperature: the target when there is one, what was observed otherwise, and unverified without either.
export function temperatureText({ setTemperature, sensorTemperature }: Pick<CalibrationMetadata, 'setTemperature' | 'sensorTemperature'>) {
	if (setTemperature.value !== undefined) return `${setTemperature.value} °C`
	return sensorTemperature.value === undefined ? 'Unverified' : `~${sensorTemperature.value.toFixed(1)} °C`
}

// Text of an operating point.
export function settingsText({ gain, offset, binX, binY, readoutMode }: CalibrationMetadata) {
	return [`Gain ${valueText(gain)}`, `Offset ${valueText(offset)}`, `Bin ${valueText(binX)}×${valueText(binY)}`, ...(readoutMode.value === undefined ? [] : [readoutMode.value])].join(' · ')
}

// Text of what distinguishes a group among those of its role.
export function groupTitle({ kind, metadata, exposures }: Pick<CalibrationGroupSummary, 'kind' | 'metadata' | 'exposures'>) {
	if (kind === 'flat') return `${metadata.filter.value ?? 'No filter'} · ${exposures ? `${exposures[0] / 1000000}–${exposures[1] / 1000000} s` : exposureText(metadata)}`
	if (kind === 'bias') return `${metadata.width}×${metadata.height}`
	return `${exposureText(metadata)} · ${temperatureText(metadata)}`
}

// Name of the camera of a set of frames, as their headers give it.
export function cameraText({ cameraName }: Pick<CalibrationMetadata, 'cameraName'>) {
	return cameraName ?? 'Unknown camera'
}

// Name of a master: its id and when it was published, in local time, which tell apart masters of the same frames.
export function masterName({ masterId, createdAt }: { readonly masterId: number; readonly createdAt: number }) {
	return `#${masterId} · ${new Date(createdAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
}

// Explains the state of a master, in the words shown under its badge: why its file cannot be used, why it is stale, and
// what it was published with that makes it carry warnings (too few frames, and what an operator accepted when building
// it). Empty for a ready master.
export function masterWarnings({ status, diagnostics, acknowledged }: Pick<CalibrationMaster, 'status' | 'diagnostics' | 'acknowledged'>) {
	const warnings: string[] = []
	if (status === 'unavailable') warnings.push('Its file is missing, or is no longer the one published.')
	if (status === 'stale') warnings.push('A master it was corrected with is unavailable.')
	if (diagnostics.lowSampleCount) warnings.push(`Only ${diagnostics.integratedFrames === 1 ? '1 frame was' : `${diagnostics.integratedFrames} frames were`} integrated, fewer than recommended, so its noise and rejection are less reliable.`)
	for (const { message } of acknowledged) warnings.push(`Accepted when built: ${message}.`)
	return warnings
}

// One row of coverage: a camera and operating point, and what exists of each role.
export interface CoverageRow {
	// Stable key of the operating point.
	readonly key: string
	// Camera and settings, as text.
	readonly camera: string
	readonly settings: string
	// Groups and groups with a usable master, by role.
	readonly kinds: Readonly<Record<CalibrationKind, { readonly groups: number; readonly masters: number }>>
}

// Summarizes groups by camera and operating point, which shows where masters are missing without choosing one for anything.
export function coverage(groups: readonly CalibrationGroupSummary[]): readonly CoverageRow[] {
	const rows = new Map<string, { key: string; camera: string; settings: string; kinds: Record<CalibrationKind, { groups: number; masters: number }> }>()

	for (const { kind, metadata, masters } of groups) {
		const camera = cameraText(metadata)
		const settings = settingsText(metadata)
		const key = `${camera}|${settings}|${metadata.width}x${metadata.height}`
		let row = rows.get(key)

		if (!row) {
			row = { key, camera, settings, kinds: { dark: { groups: 0, masters: 0 }, bias: { groups: 0, masters: 0 }, darkFlat: { groups: 0, masters: 0 }, flat: { groups: 0, masters: 0 } } }
			rows.set(key, row)
		}

		row.kinds[kind].groups++
		if (masters.some((master) => master.kind === kind && master.status !== 'unavailable')) row.kinds[kind].masters++
	}

	return Array.from(rows.values())
}

// Share of a job done, from 0 to 1.
export function jobFraction({ progress, frames }: Pick<CalibrationJobSummary, 'progress' | 'frames'>) {
	if (progress.rowsTotal > 0) return Math.min(1, progress.rowsCombined / progress.rowsTotal)
	return frames ? Math.min(1, progress.framesValidated / frames) : 0
}

// Text of a size in bytes.
export function bytesText(bytes: number) {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
	return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
