import { type CalibrationKind, type CalibrationTarget, type HeaderMetadata, type MasterReference, stableId } from './calibrationlibrary.compatibility'
import { cohortKeyOf, filterKeyOf } from './imagestacking.sources'

// Pure grouping policy of Live Stacking: what a light frame's header says decides its filter, the acquisition cohort
// whose frames may share one accumulator, the calibration that applies to it, and the geometry of the grid it can be
// registered onto. The filter is the exact name of its header, trimmed, as Image Stacking keeps it, so names spelled
// differently are different filters; a frame with no filter in its header is None when no filter wheel was snooped into
// it, and unclassified otherwise, since its filter should have been recorded. Nothing here reads pixels.

// Version of the segment key; a change starts other cohorts, never relabels accumulated pixels.
export const SEGMENT_KEY_VERSION = 1

// Kinds of master a live stack is calibrated with, in the order they are applied.
export const LIVE_MASTER_KINDS = ['dark', 'flat', 'bias'] as const satisfies readonly CalibrationKind[]

// Kind of master a live stack is calibrated with.
export type LiveMasterKind = (typeof LIVE_MASTER_KINDS)[number]

// Masters an operator chose for the frames of one filter; a dark includes its bias, so a bias applies only without one.
export type LiveFilterCalibration = { readonly [K in LiveMasterKind]?: MasterReference }

// What a session does with the frames of a filter it has no masters for: integrate them uncalibrated in cohorts of their
// own, or skip them.
export type LiveCalibrationFallback = 'uncalibrated' | 'skip'

// Calibration of a session: the masters chosen per filter, by exact filter name, and what to do with the others.
export interface LiveStackingCalibration {
	readonly filters: Readonly<Record<string, LiveFilterCalibration>>
	readonly otherwise: LiveCalibrationFallback
}

// How a filter of a frame was classified:
// - filter: the header names it.
// - none: no filter wheel was snooped and the header names none.
// - unclassified: a filter wheel was snooped but the header names none, so its filter is unknown.
export type LiveFilterClass = { readonly kind: 'filter'; readonly name: string } | { readonly kind: 'none' } | { readonly kind: 'unclassified' }

// Returns the filter class of a frame from the filter its header names and whether a filter wheel was snooped into it.
export function classifyFilter(filter: string | undefined, wheelSnooped: boolean): LiveFilterClass {
	const name = filter?.trim()
	if (name) return { kind: 'filter', name }
	return wheelSnooped ? { kind: 'unclassified' } : { kind: 'none' }
}

// Returns the filter group name of a classified filter: its name, or None. An unclassified filter has none.
export function filterGroupOf(filter: LiveFilterClass) {
	return filter.kind === 'unclassified' ? undefined : filterKeyOf(filter.kind === 'filter' ? filter.name : undefined)
}

// Returns why the header of a light frame cannot be grouped, or undefined when it can: its geometry and exposure must be
// known, since a cohort must never take an unknown value for a known one.
export function missingMetadata(metadata: HeaderMetadata) {
	if (!(metadata.width > 0) || !(metadata.height > 0) || (metadata.channels !== 1 && metadata.channels !== 3)) return 'The frame has no usable image size'
	if (metadata.exposure.value === undefined) return 'The frame does not record its exposure'
	return undefined
}

// Returns the identity of the calibration of a filter: the masters chosen, by id and content, or uncalibrated. Frames of
// two policies never share an accumulator, so changing the masters starts other cohorts.
export function calibrationPolicyId(calibration: LiveFilterCalibration | undefined) {
	if (!calibration || LIVE_MASTER_KINDS.every((kind) => calibration[kind] === undefined)) return 'uncalibrated'
	return stableId(LIVE_MASTER_KINDS.map((kind) => (calibration[kind] ? `${kind}=${calibration[kind].masterId}:${calibration[kind].digest}` : '')).join('|'))
}

// Returns the masters chosen for a filter group, or undefined when it has none.
export function filterCalibration(calibration: LiveStackingCalibration, filter: string): LiveFilterCalibration | undefined {
	const chosen = calibration.filters[filter]
	return chosen && LIVE_MASTER_KINDS.some((kind) => chosen[kind] !== undefined) ? chosen : undefined
}

// Returns the segment key of a frame: its filter group, its acquisition cohort (camera, geometry, sample type, CFA
// layout, binning, gain, offset, readout mode, and exposure in integer microseconds, unknowns kept as unknown) and its
// calibration policy. Frames of one segment and one field share an accumulator; temperature is checked against the
// masters, not keyed.
export function segmentKeyOf(filter: string, metadata: HeaderMetadata, policyId: string) {
	return `v${SEGMENT_KEY_VERSION}|filter=${filter}|${cohortKeyOf(metadata)}|calibration=${policyId}`
}

// Returns the geometry key of a frame: the grid it can be registered onto, its size, subframe origin, binning and CFA
// layout. Frames of different geometries never share a field.
export function geometryKeyOf(metadata: HeaderMetadata) {
	return `${metadata.width}x${metadata.height}x${metadata.channels}|origin=${metadata.originX ?? '?'},${metadata.originY ?? '?'}|bin=${metadata.binX.value ?? '?'}x${metadata.binY.value ?? '?'}|cfa=${metadata.cfa ?? ''}@${metadata.bayerOffsetX ?? 0},${metadata.bayerOffsetY ?? 0}`
}

// Returns what the masters of one frame are matched against: the camera of the Equipment Catalog that took it (cameraId),
// and its own geometry, settings, exposure in seconds, sensor temperature in degrees Celsius, and filter, each only when
// its header records it.
export function frameTarget(metadata: HeaderMetadata, cameraId: string): CalibrationTarget {
	const temperature = metadata.sensorTemperature.value ?? metadata.setTemperature.value
	const exposure = metadata.exposure.value

	return {
		cameraId,
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
		...(temperature !== undefined && { temperature }),
		...(metadata.filter.value !== undefined && { filter: metadata.filter.value }),
	}
}
