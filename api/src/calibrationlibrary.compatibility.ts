// Scientific compatibility of calibration frames and masters: what a frame declares about itself and how sure it is, which
// of those facts must agree before frames can be combined, and what a group of them is ready for. Everything here is
// pure, so the policy can be read and tested apart from files and jobs. Exposures are integer microseconds, because
// comparing canonical integers never merges 179.9 s with 180 s by a rounded label; temperatures are degrees Celsius.
// Unknown is never a wildcard: it stays visible, asks for a review, and never agrees with a known value.

// Role of a calibration frame or master.
export type CalibrationKind = 'dark' | 'bias' | 'darkFlat' | 'flat'

// How a value is known:
// - verified: read from the metadata of the file.
// - planDeclared: recorded by an immutable capture plan, for what a driver leaves out of its files.
// - operatorDeclared: an audited override, which never becomes a measurement.
// - unknown: nothing says.
export type EvidenceLevel = 'verified' | 'planDeclared' | 'operatorDeclared' | 'unknown'

// A value and how it is known.
export interface Evidenced<T> {
	// The value; absent when unknown.
	readonly value?: T
	// How it is known.
	readonly evidence: EvidenceLevel
}

// What is known about a frame or master. Sample geometry is always read from the file.
export interface CalibrationMetadata {
	// Camera hardware id, as the capture plans use it; a model name in a header never fills it.
	readonly cameraId: Evidenced<string>
	// Name of the camera, shown to people and never matched across a known hardware id.
	readonly cameraName?: string
	// Exposure, in integer microseconds.
	readonly exposure: Evidenced<number>
	// Target sensor temperature, in degrees Celsius.
	readonly setTemperature: Evidenced<number>
	// Observed sensor temperature, in degrees Celsius.
	readonly sensorTemperature: Evidenced<number>
	// Gain, in driver units; never converted to e-/ADU.
	readonly gain: Evidenced<number>
	// Offset, in driver units.
	readonly offset: Evidenced<number>
	// Binning factors.
	readonly binX: Evidenced<number>
	readonly binY: Evidenced<number>
	// Readout mode of the driver.
	readonly readoutMode: Evidenced<string>
	// Filter in the beam when the frame was taken.
	readonly filter: Evidenced<string>
	// Telescope the frame was taken through.
	readonly telescope: Evidenced<string>
	// Focal length, in millimeters.
	readonly focalLength: Evidenced<number>
	// Image size of the file, in pixels, and channels per pixel.
	readonly width: number
	readonly height: number
	readonly channels: number
	// BITPIX of the file; an equal size does not make equal samples.
	readonly bitpix: number
	// Subframe origin (XORGSUBF, YORGSUBF), in pixels; absent when the file does not say.
	readonly originX?: number
	readonly originY?: number
	// CFA pattern; absent for a mono or interleaved sensor.
	readonly cfa?: string
	// CFA origin offsets (XBAYROFF, YBAYROFF), in pixels.
	readonly bayerOffsetX?: number
	readonly bayerOffsetY?: number
}

// Fields an audited override can set, each only while its value is unknown.
export const OVERRIDABLE_FIELDS = ['cameraId', 'exposure', 'setTemperature', 'sensorTemperature', 'gain', 'offset', 'binX', 'binY', 'readoutMode', 'filter', 'telescope', 'focalLength'] as const satisfies readonly (keyof CalibrationMetadata)[]

// Field an audited override can set.
export type OverridableField = (typeof OVERRIDABLE_FIELDS)[number]

// How much a finding stops:
// - blocker: the frames cannot be combined.
// - review: an operator must accept it, and automatic generation stops.
// - notice: shown, and stops nothing.
export type FindingSeverity = 'blocker' | 'review' | 'notice'

// Stable code of a finding.
export type FindingCode = 'incompatibleFrames' | 'unknownMetadata' | 'unverifiedTemperature' | 'temperatureSpread' | 'lowSampleCount' | 'warnedFrames' | 'operatorMetadata' | 'incompleteGroup' | 'sourceMissing' | 'insufficientFrames' | 'invalidFlatCorrection'

// One explained reason about a set of frames.
export interface CompatibilityFinding {
	// Field it is about.
	readonly field: string
	// Stable code.
	readonly code: FindingCode
	// How much it stops.
	readonly severity: FindingSeverity
	// Sentence for the operator.
	readonly message: string
}

// Explained state of a group:
// - ready: a master can be built with nothing to accept.
// - needsReview: an operator must accept what cannot be verified.
// - incomplete: fewer usable frames than its plan required.
// - incompatible: its frames disagree.
// - missingFiles: some of its files are gone or changed.
// - notSupported: no frame can be read by the integrator.
export type GroupReadiness = 'ready' | 'needsReview' | 'incomplete' | 'incompatible' | 'missingFiles' | 'notSupported'

// Combination settings of a master, part of its identity.
export interface CalibrationRecipe {
	// How samples are combined.
	readonly method: 'sigmaClip' | 'median' | 'mean'
	// Rejection limits, in robust standard deviations; positive.
	readonly sigmaLow: number
	readonly sigmaHigh: number
	// Most rejection passes per pixel.
	readonly maxIterations: number
}

// Immutable reference to one revision of a master.
export interface MasterReference {
	// Id of the master.
	readonly masterId: string
	// Revision of the master.
	readonly revision: number
	// SHA-256 of its FITS file.
	readonly digest: string
}

// Version of the compatibility policy. A change regroups frames and makes other masters, never older ones wrong.
export const COMPATIBILITY_VERSION = 1

// Version of the integration algorithm, part of the identity of a recipe.
export const INTEGRATION_ALGORITHM_VERSION = 1

// Default combination of a master: 3 sigma on both sides, which keeps almost all Gaussian samples and removes impulses.
export const DEFAULT_RECIPE: CalibrationRecipe = { method: 'sigmaClip', sigmaLow: 3, sigmaHigh: 3, maxIterations: 5 }

// Frames below which a master carries a lowSampleCount notice; about 30 samples make a stable clipped mean.
export const RECOMMENDED_FRAMES = 30

// Largest spread of observed temperatures in a thermal group, in degrees Celsius, before it asks for a review.
export const TEMPERATURE_SPREAD_LIMIT = 1

// Unitless placeholder of an unknown value in a key, which never equals a known one.
const UNKNOWN_VALUE = '?'

// One physical property compared across frames.
interface CompatibilityField {
	// Name in findings and keys.
	readonly name: string
	// Label for the operator.
	readonly label: string
	// Reads the comparable value; undefined when unknown.
	readonly read: (metadata: CalibrationMetadata) => string | number | undefined
	// What an unknown value asks for; absent when an unknown value is ordinary, as without a CFA.
	readonly unknown?: FindingSeverity
}

// Properties every kind shares: identity, sample geometry, and the operating point of the sensor. A subframe origin an
// old file leaves out stays unknown, and only a known different origin separates frames.
const SENSOR_FIELDS: readonly CompatibilityField[] = [
	{ name: 'cameraId', label: 'Camera', read: ({ cameraId }) => cameraId.value, unknown: 'review' },
	{ name: 'instrument', label: 'Camera name', read: ({ cameraId, cameraName }) => (cameraId.value === undefined ? cameraName : undefined) },
	{ name: 'size', label: 'Image size', read: ({ width, height, channels }) => `${width}x${height}x${channels}` },
	{ name: 'bitpix', label: 'Sample format', read: ({ bitpix }) => bitpix },
	{ name: 'origin', label: 'Subframe origin', read: ({ originX, originY }) => (originX === undefined && originY === undefined ? undefined : `${originX ?? 0},${originY ?? 0}`) },
	{ name: 'cfa', label: 'CFA pattern', read: ({ cfa, bayerOffsetX, bayerOffsetY }) => (cfa === undefined ? undefined : `${cfa}+${bayerOffsetX ?? 0}+${bayerOffsetY ?? 0}`) },
	{ name: 'binning', label: 'Binning', read: ({ binX, binY }) => (binX.value === undefined || binY.value === undefined ? undefined : `${binX.value}x${binY.value}`), unknown: 'review' },
	{ name: 'gain', label: 'Gain', read: ({ gain }) => gain.value, unknown: 'review' },
	{ name: 'offset', label: 'Offset', read: ({ offset }) => offset.value, unknown: 'review' },
	{ name: 'readoutMode', label: 'Readout mode', read: ({ readoutMode }) => readoutMode.value, unknown: 'notice' },
]

// Properties of frames whose signal grows in the dark: the exposure must be the one of the frames they correct, and a
// target temperature separates groups. Without a target, the observed temperature groups by whole degrees.
const THERMAL_FIELDS: readonly CompatibilityField[] = [
	{ name: 'exposure', label: 'Exposure', read: ({ exposure }) => exposure.value, unknown: 'review' },
	{ name: 'temperature', label: 'Temperature', read: temperatureGroup, unknown: 'review' },
]

// Properties of a flat, which records an optical path. Missing ones ask for a review and are never made up.
const OPTICAL_FIELDS: readonly CompatibilityField[] = [
	{ name: 'filter', label: 'Filter', read: ({ filter }) => filter.value, unknown: 'review' },
	{ name: 'telescope', label: 'Telescope', read: ({ telescope }) => telescope.value, unknown: 'review' },
	{ name: 'focalLength', label: 'Focal length', read: ({ focalLength }) => focalLength.value, unknown: 'notice' },
]

// Properties that must agree, per kind.
const KIND_FIELDS: Readonly<Record<CalibrationKind, readonly CompatibilityField[]>> = {
	dark: [...SENSOR_FIELDS, ...THERMAL_FIELDS],
	darkFlat: [...SENSOR_FIELDS, ...THERMAL_FIELDS],
	bias: SENSOR_FIELDS,
	flat: [...SENSOR_FIELDS, ...OPTICAL_FIELDS],
}

// Returns the temperature a frame groups by: its target, else its observed reading rounded to whole degrees.
function temperatureGroup({ setTemperature, sensorTemperature }: CalibrationMetadata) {
	if (setTemperature.value !== undefined) return `set ${setTemperature.value}`
	return sensorTemperature.value === undefined ? undefined : `observed ${Math.round(sensorTemperature.value)}`
}

// Returns the hexadecimal SHA-256 of text.
export function sha256(text: string) {
	return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

// Returns a stable id for text, short enough for routes and directories.
export function stableId(text: string) {
	return sha256(text).slice(0, 32)
}

// Serializes everything that must agree between frames of a kind, in a versioned canonical form. Equal keys mean equal
// known properties and the same fields unknown. Filenames, labels, and frame counts play no part.
export function compatibilityKey(kind: CalibrationKind, metadata: CalibrationMetadata) {
	const fields = KIND_FIELDS[kind].map(({ name, read }) => `${name}=${read(metadata) ?? UNKNOWN_VALUE}`)
	return `v${COMPATIBILITY_VERSION}|${kind}|${fields.join('|')}`
}

// Returns the identity of a master or group of frames sharing a compatibility key.
export function groupIdOf(key: string) {
	return stableId(key)
}

// Serializes the identity of a product: what went in, how it was combined, and what corrected it. Equal fingerprints
// return the same product; any other input, setting, algorithm, or dependency makes a new revision. Inputs are named by
// their source id, size, and modification time, which a job compares again right before publishing.
export function recipeFingerprint(key: string, inputs: readonly string[], recipe: CalibrationRecipe, dependencies: readonly MasterReference[]) {
	const canonical = {
		algorithm: INTEGRATION_ALGORITHM_VERSION,
		key,
		inputs: inputs.toSorted(),
		recipe: { method: recipe.method, sigmaLow: recipe.sigmaLow, sigmaHigh: recipe.sigmaHigh, maxIterations: recipe.maxIterations },
		dependencies: dependencies.map(({ masterId, revision, digest }) => `${masterId}:${revision}:${digest}`).toSorted(),
	}

	return sha256(JSON.stringify(canonical))
}

// Explains why frames of a kind can or cannot be combined. Every known difference blocks, unknown properties follow
// their field, and values only an operator declared are always shown. A wider temperature spread than the limit asks
// for a review, because the frames are then not the same thermal state, whatever their target says.
export function compareFrames(kind: CalibrationKind, frames: readonly CalibrationMetadata[]): CompatibilityFinding[] {
	const findings: CompatibilityFinding[] = []

	for (const { name, label, read, unknown } of KIND_FIELDS[kind]) {
		const known = new Set<string | number>()
		let missing = 0

		for (const frame of frames) {
			const value = read(frame)
			if (value === undefined) missing++
			else known.add(value)
		}

		if (known.size > 1) findings.push({ field: name, code: 'incompatibleFrames', severity: 'blocker', message: `${label} differs between frames: ${[...known].join(', ')}` })
		else if (missing > 0 && known.size > 0 && unknown !== undefined) findings.push({ field: name, code: 'incompatibleFrames', severity: 'blocker', message: `${label} is known for some frames and unknown for ${missing}` })
		else if (missing > 0 && unknown !== undefined) findings.push({ field: name, code: 'unknownMetadata', severity: unknown, message: `${label} is unknown` })
	}

	if (kind === 'dark' || kind === 'darkFlat') {
		if (frames.some(({ setTemperature }) => setTemperature.value === undefined)) {
			findings.push({ field: 'temperature', code: 'unverifiedTemperature', severity: 'notice', message: 'No target temperature: these frames are not known to be at a setpoint' })
		}

		const readings = frames.flatMap(({ sensorTemperature }) => sensorTemperature.value ?? [])

		if (readings.length > 1) {
			const spread = Math.max(...readings) - Math.min(...readings)
			if (spread > TEMPERATURE_SPREAD_LIMIT) findings.push({ field: 'temperature', code: 'temperatureSpread', severity: 'review', message: `Observed temperatures span ${spread.toFixed(1)} °C` })
		}
	}

	if (frames.some((frame) => OVERRIDABLE_FIELDS.some((field) => frame[field].evidence === 'operatorDeclared'))) {
		findings.push({ field: 'metadata', code: 'operatorMetadata', severity: 'review', message: 'Some values were declared by an operator, not measured' })
	}

	return findings
}

// Returns the explained state of a group. `usable` counts frames that can enter a master, and `required` what their plan
// asked for, when a plan did. Blockers come first, then files, then incompleteness, because an incomplete group of
// conflicting frames must not read as if more frames would fix it.
export function groupReadiness(findings: readonly CompatibilityFinding[], usable: number, unavailable: number, required: number | undefined, supported: boolean): GroupReadiness {
	if (!supported) return 'notSupported'
	if (findings.some(({ severity }) => severity === 'blocker')) return 'incompatible'
	if (unavailable > 0) return 'missingFiles'
	if (required !== undefined && usable < required) return 'incomplete'
	if (findings.some(({ severity }) => severity === 'review')) return 'needsReview'
	return 'ready'
}

// Whether a correction master can correct a flat of these frames: the same sensor operating point, and for a dark-flat
// the exposure of the flats. Returns the reason it cannot, or undefined. A dark-flat is light-blocked, so its filter does
// not have to be the one of the flats.
export function flatCorrectionMismatch(kind: 'bias' | 'darkFlat', master: CalibrationMetadata, flats: readonly CalibrationMetadata[]) {
	for (const flat of flats) {
		for (const { label, read } of SENSOR_FIELDS) {
			if (read(master) !== read(flat)) return `${label} of the correction does not match the flats`
		}

		if (kind === 'darkFlat' && master.exposure.value !== flat.exposure.value) return 'The exposure of the dark-flat does not match the flats'
	}

	return undefined
}

// Light, or another target, described for a metadata-only preview of which masters could calibrate it.
export interface CalibrationTarget {
	// Camera hardware id.
	readonly cameraId?: string
	// Image size in pixels and channels per pixel.
	readonly width: number
	readonly height: number
	readonly channels: number
	// CFA pattern.
	readonly cfa?: string
	// Binning factors.
	readonly binX?: number
	readonly binY?: number
	// Gain and offset, in driver units.
	readonly gain?: number
	readonly offset?: number
	// Readout mode.
	readonly readoutMode?: string
	// Exposure, in seconds.
	readonly exposure?: number
	// Sensor temperature, in degrees Celsius.
	readonly temperature?: number
	// Filter in the beam.
	readonly filter?: string
}

// Verdict of one master for a target.
export type MatchVerdict = 'compatible' | 'reviewRequired' | 'incompatible'

// Explains whether a master matches a target exactly. There is no closest match: any known difference is incompatible,
// and anything either side does not know asks for a review, because unknown never matches. Temperature uses the spread
// limit of a group, and a bias ignores exposure and temperature.
export function matchMaster(kind: CalibrationKind, master: CalibrationMetadata, target: CalibrationTarget): { readonly verdict: MatchVerdict; readonly reasons: readonly string[] } {
	const conflicts: string[] = []
	const unknowns: string[] = []

	function compare(label: string, ours: string | number | undefined, theirs: string | number | undefined) {
		if (ours === undefined || theirs === undefined) unknowns.push(`${label} is unknown`)
		else if (ours !== theirs) conflicts.push(`${label}: ${ours} differs from ${theirs}`)
	}

	compare('Camera', master.cameraId.value, target.cameraId)
	compare('Image size', `${master.width}x${master.height}x${master.channels}`, `${target.width}x${target.height}x${target.channels}`)
	if (master.cfa !== target.cfa) conflicts.push(`CFA pattern: ${master.cfa ?? 'none'} differs from ${target.cfa ?? 'none'}`)
	compare('Binning', master.binX.value === undefined ? undefined : `${master.binX.value}x${master.binY.value}`, target.binX === undefined ? undefined : `${target.binX}x${target.binY ?? target.binX}`)
	compare('Gain', master.gain.value, target.gain)
	compare('Offset', master.offset.value, target.offset)
	compare('Readout mode', master.readoutMode.value, target.readoutMode)

	if (kind === 'dark') {
		compare('Exposure', master.exposure.value, target.exposure === undefined ? undefined : Math.round(target.exposure * 1000000))
		const temperature = master.setTemperature.value ?? master.sensorTemperature.value

		if (temperature === undefined || target.temperature === undefined) unknowns.push('Temperature is unknown')
		else if (Math.abs(temperature - target.temperature) > TEMPERATURE_SPREAD_LIMIT) conflicts.push(`Temperature: ${temperature} °C differs from ${target.temperature} °C`)
	}

	if (kind === 'flat') compare('Filter', master.filter.value, target.filter)

	if (conflicts.length > 0) return { verdict: 'incompatible', reasons: conflicts }
	return { verdict: unknowns.length > 0 ? 'reviewRequired' : 'compatible', reasons: unknowns }
}
