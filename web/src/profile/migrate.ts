import type { DisplaySettings, FlatWizardFilter, StarDetectionRequest } from 'api'
import { CAMERA_ROLES, type DeviceAssignment, type EquipmentSetup, isCameraRole, isEquipmentRole } from '../equipment/roles'
import { CFA_PATTERNS, DISPLAY_RANGES, type DisplayRange, ORIGINAL_DISPLAY_SETTINGS, SCNR_CHANNELS, SCNR_METHODS } from '../images/display'
import { WORKSPACE_IDS } from '../shell/route'
import { MAP_STAR_MAGNITUDE_LIMIT, MIN_MAGNITUDE_LIMIT, SKY_LAYER_IDS, type SkyDisplaySettings, type SkyLayerId } from '../sky/display'
import type { OpticalPreset, SensorGeometry, TelescopeOptics } from '../sky/framing'
import { DEFAULT_APERTURE_RADIUS, DEFAULT_ASTAP_SETTINGS, DEFAULT_BUILTIN_SETTINGS, DEFAULT_STAR_REQUEST } from '../stars/stars'
import { isRecord } from '../storage'
import {
	type AutoFocusSettings,
	type CameraAcquisitionSettings,
	type CameraExposureSettings,
	type CameraSettings,
	DEFAULT_ACQUISITION_SETTINGS,
	DEFAULT_AUTO_FOCUS_SETTINGS,
	DEFAULT_EXPOSURE_SETTINGS,
	defaultSettings,
	MOUNT_REMOTE_PROTOCOLS,
	type MountRemoteBinding,
	type Profile,
	type ProfileSettings,
	type SkyFramingSettings,
	type SkyObserverSettings,
	type SkySettings,
	DARV_MAXIMUM_LEG_DURATION,
	DARV_MINIMUM_LEG_DURATION,
	type DarvSettings,
	DEFAULT_DARV_SETTINGS,
	DEFAULT_FLAT_WIZARD_FILTER,
	DEFAULT_FLAT_WIZARD_SETTINGS,
	FLAT_WIZARD_MAXIMUM_COUNT,
	FLAT_WIZARD_MAXIMUM_EXPOSURE,
	FLAT_WIZARD_MAXIMUM_FILTERS,
	FLAT_WIZARD_MAXIMUM_REJECTIONS,
	FLAT_WIZARD_MAXIMUM_TRIALS,
	type FlatWizardSettings,
	DEFAULT_GUIDING_SETTINGS,
	GUIDING_MAXIMUM_EXPOSURE,
	GUIDING_MAXIMUM_PULSE,
	GUIDING_MAXIMUM_SEARCH_REGION,
	GUIDING_MINIMUM_EXPOSURE,
	GUIDING_MINIMUM_PULSE,
	GUIDING_MINIMUM_SEARCH_REGION,
	type GuidingDitherMode,
	type GuidingSettings,
	DEFAULT_TPPA_SETTINGS,
	TPPA_MAXIMUM_ROTATION,
	TPPA_MINIMUM_ROTATION,
	type TppaSettings,
} from './schema'

// Reading of persisted profiles: every version of the format (see PROFILES_VERSION) is restored into the current one,
// field by field, keeping what is valid and falling back to the default of anything missing or invalid. A document
// written by a newer version is never read.

// Dither patterns of the guiding form.
const DITHER_MODES: ReadonlySet<string> = new Set<GuidingDitherMode>(['random', 'spiral', 'golden', 'grid'])

// Acquisition modes of the Camera Acquisition form.
const EXPOSURE_MODES: ReadonlySet<string> = new Set<CameraAcquisitionSettings['exposureMode']>(['single', 'fixed', 'loop'])

// Frame types of the Camera Acquisition form.
const FRAME_TYPES: ReadonlySet<string> = new Set<CameraAcquisitionSettings['frameType']>(['LIGHT', 'DARK', 'FLAT', 'BIAS'])

// Returns a number at least min, or the fallback for anything else; integer keeps whole numbers only.
function numberAtLeast(value: unknown, min: number, fallback: number, integer = false) {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && (!integer || Number.isInteger(value)) ? value : fallback
}

// Restores persisted exposure and camera settings, filling every invalid field with its default; undefined for
// anything that is not a record. Reads the Camera Capture form of earlier versions too, which held them.
function normalizeExposure(value: unknown): CameraExposureSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_EXPOSURE_SETTINGS

	return {
		exposureTime: typeof value.exposureTime === 'number' && Number.isFinite(value.exposureTime) && value.exposureTime > 0 ? value.exposureTime : defaults.exposureTime,
		gain: numberAtLeast(value.gain, -Infinity, defaults.gain),
		offset: numberAtLeast(value.offset, -Infinity, defaults.offset),
		binX: numberAtLeast(value.binX, 1, defaults.binX, true),
		binY: numberAtLeast(value.binY, 1, defaults.binY, true),
		subframe: value.subframe === true,
		x: numberAtLeast(value.x, 0, defaults.x, true),
		y: numberAtLeast(value.y, 0, defaults.y, true),
		width: numberAtLeast(value.width, 0, defaults.width, true),
		height: numberAtLeast(value.height, 0, defaults.height, true),
		frameFormat: typeof value.frameFormat === 'string' ? value.frameFormat : defaults.frameFormat,
	}
}

// Restores a persisted Camera Acquisition form, filling every invalid field with its default; undefined for anything
// that is not a record. Reads the Camera Capture form of earlier versions too.
function normalizeAcquisition(value: unknown): CameraAcquisitionSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_ACQUISITION_SETTINGS
	const output = isRecord(value.output) ? value.output : {}

	return {
		exposureMode: typeof value.exposureMode === 'string' && EXPOSURE_MODES.has(value.exposureMode) ? (value.exposureMode as CameraAcquisitionSettings['exposureMode']) : defaults.exposureMode,
		count: numberAtLeast(value.count, 1, defaults.count, true),
		delay: numberAtLeast(value.delay, 0, defaults.delay),
		frameType: typeof value.frameType === 'string' && FRAME_TYPES.has(value.frameType) ? (value.frameType as CameraAcquisitionSettings['frameType']) : defaults.frameType,
		output: {
			mode: output.mode === 'preview-only' ? 'preview-only' : 'preview-save',
			format: output.format === 'XISF' ? 'XISF' : 'FITS',
			...(typeof output.directory === 'string' && output.directory.trim() && { directory: output.directory.trim() }),
			...(typeof output.filenameTemplate === 'string' && output.filenameTemplate.trim() && { filenameTemplate: output.filenameTemplate.trim() }),
		},
	}
}

// Restores the persisted forms of one camera, keeping only the valid ones; undefined when none is.
function normalizeCamera(value: unknown): CameraSettings | undefined {
	if (!isRecord(value)) return undefined
	const exposure = normalizeExposure(value.exposure)
	const acquisition = normalizeAcquisition(value.acquisition)
	const autoFocus = normalizeAutoFocus(value.autoFocus)
	const tppa = normalizeTppa(value.tppa)
	const darv = normalizeDarv(value.darv)
	const flatWizard = normalizeFlatWizard(value.flatWizard)
	const guiding = normalizeGuiding(value.guiding)
	const display = normalizeDisplaySettings(value.display)
	if (!exposure && !acquisition && !autoFocus && !tppa && !darv && !flatWizard && !guiding && !display) return undefined
	return { ...(exposure && { exposure }), ...(acquisition && { acquisition }), ...(autoFocus && { autoFocus }), ...(tppa && { tppa }), ...(darv && { darv }), ...(flatWizard && { flatWizard }), ...(guiding && { guiding }), ...(display && { display }) }
}

// Returns a number within a display range, or the fallback for anything else.
function displayNumber(value: unknown, range: DisplayRange, fallback: number) {
	return typeof value === 'number' && value >= range.min && value <= range.max ? value : fallback
}

// Returns whether value is one of the options.
function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
	return typeof value === 'string' && (options as readonly string[]).includes(value)
}

// Restores persisted display settings of Images (version 11), filling every invalid field with its value in
// ORIGINAL_DISPLAY_SETTINGS; undefined for anything that is not a record.
function normalizeDisplaySettings(value: unknown): DisplaySettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = ORIGINAL_DISPLAY_SETTINGS
	const debayer = isRecord(value.debayer) ? value.debayer : {}
	const stretch = isRecord(value.stretch) ? value.stretch : {}
	const levels = isRecord(stretch.stretch) ? stretch.stretch : {}
	const scnr = isRecord(value.scnr) ? value.scnr : {}
	const manual = { shadow: displayNumber(levels.shadow, DISPLAY_RANGES.stretch, 0), midtone: displayNumber(levels.midtone, DISPLAY_RANGES.stretch, 0.5), highlight: displayNumber(levels.highlight, DISPLAY_RANGES.stretch, 1) }

	return {
		debayer: debayer.enabled === true && (debayer.pattern === 'auto' || oneOf(debayer.pattern, CFA_PATTERNS)) ? { enabled: true, pattern: debayer.pattern } : defaults.debayer,
		stretch: stretch.mode === 'linear' ? { mode: 'linear' } : stretch.mode === 'manual' && manual.shadow <= manual.highlight ? { mode: 'manual', stretch: manual } : { mode: 'auto', linked: stretch.linked !== false },
		brightness: displayNumber(value.brightness, DISPLAY_RANGES.brightness, defaults.brightness),
		contrast: displayNumber(value.contrast, DISPLAY_RANGES.contrast, defaults.contrast),
		gamma: displayNumber(value.gamma, DISPLAY_RANGES.gamma, defaults.gamma),
		saturation: displayNumber(value.saturation, DISPLAY_RANGES.saturation, defaults.saturation),
		scnr: scnr.enabled === true && oneOf(scnr.channel, SCNR_CHANNELS) && oneOf(scnr.method, SCNR_METHODS) ? { enabled: true, channel: scnr.channel, method: scnr.method, amount: displayNumber(scnr.amount, DISPLAY_RANGES.scnrAmount, 0.5) } : defaults.scnr,
		invert: value.invert === true,
	}
}

// Restores the persisted forms of the cameras (version 4), by saved connection id and device id.
function normalizeCameras(value: unknown): ProfileSettings['cameras'] {
	const cameras: ProfileSettings['cameras'] = {}
	if (!isRecord(value)) return cameras

	for (const [connectionId, devices] of Object.entries(value)) {
		if (!isRecord(devices)) continue

		for (const [deviceId, camera] of Object.entries(devices)) {
			const settings = normalizeCamera(camera)
			if (settings && deviceId) (cameras[connectionId] ??= {})[deviceId] = settings
		}
	}

	return cameras
}

// Moves the camera forms of earlier versions, kept by camera role in the Capture preferences, to the physical
// cameras: the form of a role goes to the camera that role is assigned in each equipment setup, so a form follows
// the device it was used with and never reaches a camera that was not assigned that role. A role without an
// assigned camera loses its form; the post-capture analysis and plate solving are dropped.
function migrateRoleForms(capture: unknown, equipment: Readonly<Record<string, EquipmentSetup>>): ProfileSettings['cameras'] {
	const cameras: ProfileSettings['cameras'] = {}
	if (!isRecord(capture)) return cameras
	const acquisitions = isRecord(capture.acquisition) ? capture.acquisition : {}
	const autoFocuses = isRecord(capture.autoFocus) ? capture.autoFocus : {}

	for (const [connectionId, setup] of Object.entries(equipment)) {
		for (const role of CAMERA_ROLES) {
			const deviceId = setup[role]?.id
			if (!deviceId) continue
			const settings = normalizeCamera({ exposure: acquisitions[role], acquisition: acquisitions[role], autoFocus: autoFocuses[role] })
			if (settings) (cameras[connectionId] ??= {})[deviceId] = settings
		}
	}

	return cameras
}

// Restores a persisted star detection request, filling every invalid field with its default; undefined for anything
// that is not a record. The aperture of the built-in detector is at least the fixed 4 px one.
function normalizeStarRequest(value: unknown): StarDetectionRequest | undefined {
	if (!isRecord(value)) return undefined

	const detector = isRecord(value.detector) ? value.detector : {}
	const acceptance = isRecord(value.acceptance) ? value.acceptance : {}
	const defaults = DEFAULT_STAR_REQUEST.acceptance

	return {
		detector:
			detector.provider === 'astap'
				? { provider: 'astap', maxStars: numberAtLeast(detector.maxStars, 0, DEFAULT_ASTAP_SETTINGS.maxStars, true), minSNR: numberAtLeast(detector.minSNR, 0, DEFAULT_ASTAP_SETTINGS.minSNR) }
				: {
						provider: 'builtin',
						maxStars: numberAtLeast(detector.maxStars, 1, DEFAULT_BUILTIN_SETTINGS.maxStars, true),
						minSNR: numberAtLeast(detector.minSNR, 0, DEFAULT_BUILTIN_SETTINGS.minSNR),
						searchRegion: numberAtLeast(detector.searchRegion, 0, DEFAULT_BUILTIN_SETTINGS.searchRegion),
						maximumRadius: numberAtLeast(detector.maximumRadius, 4, DEFAULT_APERTURE_RADIUS),
					},
		acceptance: { minSNR: numberAtLeast(acceptance.minSNR, 0, defaults.minSNR), minHfd: numberAtLeast(acceptance.minHfd, 0, defaults.minHfd), maxHfd: numberAtLeast(acceptance.maxHfd, 0, defaults.maxHfd), edgeMargin: numberAtLeast(acceptance.edgeMargin, 0, defaults.edgeMargin) },
	}
}

// Fitting modes of the Auto Focus form.
const FITTING_MODES: ReadonlySet<string> = new Set<AutoFocusSettings['fittingMode']>(['HYPERBOLIC', 'PARABOLIC', 'TRENDLINES', 'TREND_HYPERBOLIC', 'TREND_PARABOLIC'])

// Restores a persisted Auto Focus form, filling every invalid field with its default; undefined for anything
// that is not a record. A step size that is not valid is dropped, so the travel of the focuser sets it again, and the
// frame settings and star detection of forms saved when the Auto Focus had its own are dropped too.
function normalizeAutoFocus(value: unknown): AutoFocusSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_AUTO_FOCUS_SETTINGS
	const stepSize = numberAtLeast(value.stepSize, 1, Number.NaN, true)

	return {
		fittingMode: typeof value.fittingMode === 'string' && FITTING_MODES.has(value.fittingMode) ? (value.fittingMode as AutoFocusSettings['fittingMode']) : defaults.fittingMode,
		initialOffsetSteps: numberAtLeast(value.initialOffsetSteps, 1, defaults.initialOffsetSteps, true),
		...(Number.isFinite(stepSize) && { stepSize }),
		reversed: value.reversed === true,
		rmsdThreshold: numberAtLeast(value.rmsdThreshold, 0, defaults.rmsdThreshold),
		settleDelay: numberAtLeast(value.settleDelay, 0, defaults.settleDelay),
		measureTimeout: typeof value.measureTimeout === 'number' && Number.isFinite(value.measureTimeout) && value.measureTimeout > 0 ? value.measureTimeout : defaults.measureTimeout,
		// Forms saved before the option existed return to the start position, its default.
		restoreOnStop: value.restoreOnStop !== false,
	}
}

// Plate solvers of the TPPA form.
const PLATE_SOLVERS: ReadonlySet<string> = new Set<TppaSettings['solver']['provider']>(['astap', 'astrometryLocal', 'nova'])

// Restores a persisted TPPA form, filling every invalid field with its default; undefined for anything that is not a
// record. A slew rate that is not a non-empty name and a downsampling that is not a positive integer are dropped.
function normalizeTppa(value: unknown): TppaSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_TPPA_SETTINGS
	const solver = isRecord(value.solver) ? value.solver : {}
	const rotation = typeof value.rotation === 'number' && value.rotation >= TPPA_MINIMUM_ROTATION && value.rotation <= TPPA_MAXIMUM_ROTATION ? value.rotation : defaults.rotation
	const downsample = numberAtLeast(solver.downsample, 1, Number.NaN, true)

	return {
		direction: value.direction === 'EAST' ? 'EAST' : 'WEST',
		...(typeof value.slewRate === 'string' && value.slewRate && { slewRate: value.slewRate }),
		rotation,
		settleDelay: numberAtLeast(value.settleDelay, 0, defaults.settleDelay),
		refinementDelay: numberAtLeast(value.refinementDelay, 0, defaults.refinementDelay),
		solver: {
			provider: typeof solver.provider === 'string' && PLATE_SOLVERS.has(solver.provider) ? (solver.provider as TppaSettings['solver']['provider']) : defaults.solver.provider,
			strategy: solver.strategy === 'blind' ? 'blind' : 'assisted',
			...(Number.isFinite(downsample) && { downsample }),
		},
		// Forms saved before the option existed stop the tracking, its default.
		stopTracking: value.stopTracking !== false,
	}
}

// Restores a persisted DARV form, filling every invalid field with its default; undefined for anything that is not a
// record. A slew rate that is not a non-empty name is dropped.
function normalizeDarv(value: unknown): DarvSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_DARV_SETTINGS
	const legDuration = typeof value.legDuration === 'number' && value.legDuration >= DARV_MINIMUM_LEG_DURATION && value.legDuration <= DARV_MAXIMUM_LEG_DURATION ? value.legDuration : defaults.legDuration

	return {
		axis: value.axis === 'altitude' ? 'altitude' : value.axis === 'azimuth' ? 'azimuth' : defaults.axis,
		direction: value.direction === 'WEST' ? 'WEST' : value.direction === 'EAST' ? 'EAST' : defaults.direction,
		...(typeof value.slewRate === 'string' && value.slewRate && { slewRate: value.slewRate }),
		legDuration,
		// Forms saved before the option existed stop the tracking, its default.
		stopTracking: value.stopTracking !== false,
	}
}

// Returns value when it is a finite number in [minimum, maximum], else fallback.
function boundedNumber(value: unknown, minimum: number, maximum: number, fallback: number) {
	return typeof value === 'number' && value >= minimum && value <= maximum ? value : fallback
}

// Restores a persisted filter group of the Flat Wizard form, filling every invalid field with its default; undefined
// for anything that is not a record. The exposure bounds stay ordered, the initial exposure inside them, and the
// target ordered; a slot that is not a non-negative integer is the first one, and a brightness that is not a
// non-negative number is dropped. A label of an earlier form is ignored: the filter is named by its slot.
function normalizeFlatWizardFilter(value: unknown): FlatWizardFilter | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_FLAT_WIZARD_FILTER
	let minimumExposure = boundedNumber(value.minimumExposure, Number.MIN_VALUE, FLAT_WIZARD_MAXIMUM_EXPOSURE, defaults.minimumExposure)
	let maximumExposure = boundedNumber(value.maximumExposure, Number.MIN_VALUE, FLAT_WIZARD_MAXIMUM_EXPOSURE, defaults.maximumExposure)
	if (!(minimumExposure < maximumExposure)) [minimumExposure, maximumExposure] = [defaults.minimumExposure, defaults.maximumExposure]
	const initialExposure = boundedNumber(value.initialExposure, minimumExposure, maximumExposure, Math.min(Math.max(defaults.initialExposure, minimumExposure), maximumExposure))
	const range = Array.isArray(value.targetRange) ? value.targetRange : []
	const targetRange: FlatWizardFilter['targetRange'] = typeof range[0] === 'number' && typeof range[1] === 'number' && Number.isFinite(range[0]) && Number.isFinite(range[1]) && range[0] < range[1] ? [range[0], range[1]] : defaults.targetRange

	return {
		slot: Number.isInteger(value.slot) && (value.slot as number) >= 0 ? (value.slot as number) : defaults.slot,
		count: Number.isInteger(value.count) ? boundedNumber(value.count, 1, FLAT_WIZARD_MAXIMUM_COUNT, defaults.count) : defaults.count,
		initialExposure,
		minimumExposure,
		maximumExposure,
		targetRange,
		...(typeof value.brightness === 'number' && Number.isFinite(value.brightness) && value.brightness >= 0 && { brightness: value.brightness }),
	}
}

// Restores a persisted Flat Wizard form, filling every invalid field with its default; undefined for anything that is
// not a record. At most FLAT_WIZARD_MAXIMUM_FILTERS valid filter groups are kept, and the default one when none is.
function normalizeFlatWizard(value: unknown): FlatWizardSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_FLAT_WIZARD_SETTINGS
	const filters = (Array.isArray(value.filters) ? value.filters : []).flatMap((filter) => normalizeFlatWizardFilter(filter) ?? []).slice(0, FLAT_WIZARD_MAXIMUM_FILTERS)

	return {
		filters: filters.length > 0 ? filters : [{ ...DEFAULT_FLAT_WIZARD_FILTER }],
		settleTime: boundedNumber(value.settleTime, 0, 600, defaults.settleTime),
		...(typeof value.directory === 'string' && value.directory.trim() && { directory: value.directory.trim() }),
		...(typeof value.effectiveClip === 'number' && Number.isFinite(value.effectiveClip) && value.effectiveClip > 0 && { effectiveClip: value.effectiveClip }),
		maximumTrials: Number.isInteger(value.maximumTrials) ? boundedNumber(value.maximumTrials, 1, FLAT_WIZARD_MAXIMUM_TRIALS, defaults.maximumTrials) : defaults.maximumTrials,
		maximumRejections: Number.isInteger(value.maximumRejections) ? boundedNumber(value.maximumRejections, 0, FLAT_WIZARD_MAXIMUM_REJECTIONS, defaults.maximumRejections) : defaults.maximumRejections,
	}
}

// Restores a persisted guiding form, filling every invalid field with its default; undefined for anything that is not
// a record. The guide focal length of version 8 is moved to the guide telescope by migrateGuideFocalLength.
function normalizeGuiding(value: unknown): GuidingSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_GUIDING_SETTINGS
	const settle = isRecord(value.settle) ? value.settle : {}
	const pulse = (pulse: unknown, fallback: number) => boundedNumber(pulse, GUIDING_MINIMUM_PULSE, GUIDING_MAXIMUM_PULSE, fallback)

	return {
		exposureTime: boundedNumber(value.exposureTime, GUIDING_MINIMUM_EXPOSURE, GUIDING_MAXIMUM_EXPOSURE, defaults.exposureTime),
		trackingMode: value.trackingMode === 'multiStar' ? 'multiStar' : 'singleStar',
		searchRegion: Number.isInteger(value.searchRegion) ? boundedNumber(value.searchRegion, GUIDING_MINIMUM_SEARCH_REGION, GUIDING_MAXIMUM_SEARCH_REGION, defaults.searchRegion) : defaults.searchRegion,
		stickyLockPosition: value.stickyLockPosition === true,
		recalibrate: value.recalibrate !== false,
		calibrationPulse: pulse(value.calibrationPulse, defaults.calibrationPulse),
		aggressivenessRA: boundedNumber(value.aggressivenessRA, 0, 1, defaults.aggressivenessRA),
		aggressivenessDEC: boundedNumber(value.aggressivenessDEC, 0, 1, defaults.aggressivenessDEC),
		maximumPulseRA: pulse(value.maximumPulseRA, defaults.maximumPulseRA),
		maximumPulseDEC: pulse(value.maximumPulseDEC, defaults.maximumPulseDEC),
		settle: {
			pixels: boundedNumber(settle.pixels, Number.MIN_VALUE, Number.MAX_VALUE, defaults.settle.pixels),
			time: boundedNumber(settle.time, 0, Number.MAX_VALUE, defaults.settle.time),
			timeout: boundedNumber(settle.timeout, Number.MIN_VALUE, Number.MAX_VALUE, defaults.settle.timeout),
		},
		ditherPixels: boundedNumber(value.ditherPixels, Number.MIN_VALUE, Number.MAX_VALUE, defaults.ditherPixels),
		ditherRaOnly: value.ditherRaOnly === true,
		ditherMode: typeof value.ditherMode === 'string' && DITHER_MODES.has(value.ditherMode) ? (value.ditherMode as GuidingDitherMode) : defaults.ditherMode,
		fastRecenter: value.fastRecenter !== false,
		reverseDecOutputAfterMeridianFlip: value.reverseDecOutputAfterMeridianFlip === true,
	}
}

// Lowest elevation accepted for an observer in meters (below the Dead Sea shore, -430 m).
const MIN_OBSERVER_ELEVATION = -500

// Highest elevation accepted for an observer in meters (above Everest, 8849 m).
const MAX_OBSERVER_ELEVATION = 9000

// Returns a valid observer, or undefined for anything out of range or incomplete.
export function normalizeSkyObserver(value: unknown): SkyObserverSettings | undefined {
	if (!isRecord(value)) return undefined

	const { latitude, longitude, elevation, name, timeZone } = value
	if (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return undefined
	if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return undefined
	if (typeof elevation !== 'number' || !Number.isFinite(elevation) || elevation < MIN_OBSERVER_ELEVATION || elevation > MAX_OBSERVER_ELEVATION) return undefined

	const observer: SkyObserverSettings = { latitude, longitude, elevation }
	if (typeof name === 'string' && name.trim()) observer.name = name.trim()
	if (typeof timeZone === 'string' && isKnownTimeZone(timeZone)) observer.timeZone = timeZone
	return observer
}

// Whether a name is an IANA time zone the browser knows; an unknown one is dropped, using the browser's.
function isKnownTimeZone(timeZone: string) {
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}

// Restores persisted display preferences, keeping only known layers and a magnitude limit in range.
function normalizeSkyDisplay(value: unknown): SkyDisplaySettings | undefined {
	if (!isRecord(value)) return undefined

	const display: SkyDisplaySettings = { layers: {} }

	if (isRecord(value.layers)) {
		for (const [id, visible] of Object.entries(value.layers)) {
			if (SKY_LAYER_IDS.has(id) && typeof visible === 'boolean') display.layers[id as SkyLayerId] = visible
		}
	}

	const limit = value.magnitudeLimit
	if (typeof limit === 'number' && limit >= MIN_MAGNITUDE_LIMIT && limit <= MAP_STAR_MAGNITUDE_LIMIT) display.magnitudeLimit = limit
	return display
}

// Returns a finite number, or a fallback for anything else.
function finiteOr(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// Restores a persisted sensor geometry, or undefined when it is neither pixels nor physical.
function normalizeSensor(value: unknown): SensorGeometry | undefined {
	if (!isRecord(value)) return undefined
	if (value.kind === 'pixels') return { kind: 'pixels', width: finiteOr(value.width, 0), height: finiteOr(value.height, 0), pixelSize: finiteOr(value.pixelSize, 0) }
	if (value.kind === 'physical') return { kind: 'physical', width: finiteOr(value.width, 0), height: finiteOr(value.height, 0) }
	return undefined
}

// Restores a persisted optical preset; incomplete optics are kept (the framing panel lists what is
// missing), but a preset without id, name, or sensor kind is dropped.
function normalizeOpticalPreset(value: unknown): OpticalPreset | undefined {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name.trim() || !isRecord(value.optics)) return undefined
	const { optics } = value
	const sensor = normalizeSensor(optics.sensor)
	if (!sensor) return undefined
	return { id: value.id, name: value.name.trim(), optics: { focalLength: finiteOr(optics.focalLength, 0), focalMultiplier: finiteOr(optics.focalMultiplier, 1), aperture: Math.max(0, finiteOr(optics.aperture, 0)), sensor, rotation: normalizeDegrees(finiteOr(optics.rotation, 0)) } }
}

// Normalizes an angle in degrees to [0, 360).
export function normalizeDegrees(angle: number) {
	return ((angle % 360) + 360) % 360
}

// Restores persisted framing preferences, keeping the active preset only when it still exists and the
// Equipment Setup choices only when valid.
function normalizeSkyFraming(value: unknown): SkyFramingSettings | undefined {
	if (!isRecord(value)) return undefined
	const presets = Array.isArray(value.presets) ? value.presets.map(normalizeOpticalPreset).filter((preset) => preset !== undefined) : []
	const framing: SkyFramingSettings = { presets, visible: value.visible === true }
	if (presets.some((preset) => preset.id === value.activePresetId)) framing.activePresetId = value.activePresetId as string
	if (value.source === 'custom' || value.source === 'equipment') framing.source = value.source
	if (value.sensorSource === 'manual' || isCameraRole(value.sensorSource)) framing.sensorSource = value.sensorSource
	const manualSensor = normalizeSensor(value.manualSensor)
	if (manualSensor) framing.manualSensor = manualSensor
	if (typeof value.equipmentRotation === 'number' && Number.isFinite(value.equipmentRotation)) framing.equipmentRotation = normalizeDegrees(value.equipmentRotation)
	return framing
}

// Restores persisted telescope optics, or undefined when they are not a record; invalid numbers fall back
// to the defaults (an unknown focal length, no reducer, an unknown aperture).
function normalizeTelescope(value: unknown): TelescopeOptics | undefined {
	if (!isRecord(value)) return undefined
	return { focalLength: Math.max(0, finiteOr(value.focalLength, 0)), focalMultiplier: finiteOr(value.focalMultiplier, 1), aperture: Math.max(0, finiteOr(value.aperture, 0)) }
}

// Restores persisted Sky preferences, dropping an invalid observer and invalid display and framing
// preferences; the time bar is shown only when it was explicitly shown.
function normalizeSky(value: unknown, sky: SkySettings) {
	if (!isRecord(value)) return
	if (value.timeBar === true) sky.timeBar = true
	const observer = normalizeSkyObserver(value.observer)
	if (observer) sky.observer = observer
	const display = normalizeSkyDisplay(value.display)
	if (display) sky.display = display
	const framing = normalizeSkyFraming(value.framing)
	if (framing) sky.framing = framing
}

// Restores persisted preferences, falling back to the default of every missing or invalid preference.
function normalizeSettings(value: unknown): ProfileSettings {
	const settings = defaultSettings()
	if (!isRecord(value)) return settings

	if (isRecord(value.panels)) {
		for (const workspace of WORKSPACE_IDS) {
			const open = value.panels[workspace]
			if (typeof open === 'boolean') settings.panels[workspace] = open
		}
	}

	if (typeof value.lastImageDirectory === 'string' && value.lastImageDirectory) settings.lastImageDirectory = value.lastImageDirectory

	settings.cameras = normalizeCameras(value.cameras)
	const starDetection = normalizeStarRequest(value.starDetection)
	if (starDetection) settings.starDetection = starDetection
	const imageDisplay = normalizeDisplaySettings(value.imageDisplay)
	if (imageDisplay) settings.imageDisplay = imageDisplay
	normalizeSky(value.sky, settings.sky)
	const telescope = normalizeTelescope(value.telescope)
	if (telescope) settings.telescope = telescope
	const guideTelescope = normalizeTelescope(value.guideTelescope)
	if (guideTelescope) settings.guideTelescope = guideTelescope
	const mountRemoteControl = normalizeMountRemoteControl(value.mountRemoteControl)
	if (mountRemoteControl) settings.mountRemoteControl = mountRemoteControl

	return settings
}

// Restores a Mount Remote Control binding: a non-empty host and an integer port in 1..65535. Returns undefined for
// anything else.
function normalizeMountRemoteBinding(value: unknown): MountRemoteBinding | undefined {
	if (!isRecord(value) || typeof value.host !== 'string' || !value.host.trim()) return undefined
	const { port } = value
	if (typeof port !== 'number' || !Number.isInteger(port) || !(port >= 1 && port <= 65535)) return undefined
	return { host: value.host.trim(), port }
}

// Restores the Mount Remote Control bindings (version 10), by saved connection id, mount id, and protocol, dropping
// invalid entries. Returns undefined when none is left.
function normalizeMountRemoteControl(value: unknown): ProfileSettings['mountRemoteControl'] {
	if (!isRecord(value)) return undefined
	const result: NonNullable<ProfileSettings['mountRemoteControl']> = {}

	for (const [connectionId, mounts] of Object.entries(value)) {
		if (!isRecord(mounts)) continue

		for (const [deviceId, protocols] of Object.entries(mounts)) {
			if (!isRecord(protocols)) continue

			for (const protocol of MOUNT_REMOTE_PROTOCOLS) {
				const binding = normalizeMountRemoteBinding(protocols[protocol])
				if (binding) ((result[connectionId] ??= {})[deviceId] ??= {})[protocol] = binding
			}
		}
	}

	return Object.keys(result).length > 0 ? result : undefined
}

// Restores a persisted assignment: a bare device id (version 1), whose name is unknown, or an id and
// name (version 2). Returns undefined for anything else.
function normalizeAssignment(value: unknown): DeviceAssignment | undefined {
	if (typeof value === 'string') return value ? { id: value, name: '' } : undefined
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return undefined
	return { id: value.id, name: typeof value.name === 'string' ? value.name : '' }
}

// Restores the persisted equipment setups, keeping only valid role assignments.
function normalizeEquipment(value: unknown): Record<string, EquipmentSetup> {
	const equipment: Record<string, EquipmentSetup> = {}
	if (!isRecord(value)) return equipment

	for (const [connectionId, setup] of Object.entries(value)) {
		if (!isRecord(setup)) continue
		const roles: EquipmentSetup = {}

		for (const [role, assignment] of Object.entries(setup)) {
			const device = normalizeAssignment(assignment)
			if (isEquipmentRole(role) && device) roles[role] = device
		}

		equipment[connectionId] = roles
	}

	return equipment
}

// Returns the guide focal length in mm that the version 8 guiding forms held, by saved connection id and device id:
// the form of the Guide Camera of the active setup, else the first form with one; undefined when none is a positive
// number.
function migrateGuideFocalLength(cameras: unknown, profile: Readonly<Profile>): number | undefined {
	if (!isRecord(cameras)) return undefined

	const focalLengths: { readonly connectionId: string; readonly deviceId: string; readonly focalLength: number }[] = []

	for (const [connectionId, devices] of Object.entries(cameras)) {
		if (!isRecord(devices)) continue

		for (const [deviceId, forms] of Object.entries(devices)) {
			const focalLength = isRecord(forms) && isRecord(forms.guiding) ? forms.guiding.focalLength : undefined
			if (typeof focalLength === 'number' && Number.isFinite(focalLength) && focalLength > 0) focalLengths.push({ connectionId, deviceId, focalLength })
		}
	}

	const guideCamera = profile.connectionId ? profile.equipment[profile.connectionId]?.GUIDE_CAMERA?.id : undefined
	return (focalLengths.find((each) => each.connectionId === profile.connectionId && each.deviceId === guideCamera) ?? focalLengths[0])?.focalLength
}

// Restores a persisted profile of a format version, filling missing fields with defaults. Returns undefined when it
// has no id.
function normalizeProfile(value: unknown, now: string, version: number): Profile | undefined {
	if (!isRecord(value) || typeof value.id !== 'string' || !value.id) return undefined

	const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Unnamed'
	const createdAt = typeof value.createdAt === 'string' ? value.createdAt : now
	const profile: Profile = {
		id: value.id,
		name,
		equipment: normalizeEquipment(value.equipment),
		settings: normalizeSettings(value.settings),
		createdAt,
		updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : createdAt,
	}

	if (typeof value.connectionId === 'string' && value.connectionId) profile.connectionId = value.connectionId
	if (version < 4) profile.settings.cameras = migrateRoleForms(isRecord(value.settings) ? value.settings.capture : undefined, profile.equipment)
	if (version === 8 && !profile.settings.guideTelescope) {
		const focalLength = migrateGuideFocalLength(isRecord(value.settings) ? value.settings.cameras : undefined, profile)
		if (focalLength) profile.settings.guideTelescope = { focalLength, focalMultiplier: 1, aperture: 0 }
	}

	return profile
}

// Reads the profiles of a persisted document of any known version. Returns undefined for a document
// that is not a known ProfilesStorage, including one written by a newer version.
export function migrate(data: unknown, now: string): Profile[] | undefined {
	if (!isRecord(data) || !Array.isArray(data.profiles)) return undefined

	switch (data.version) {
		case 1:
		case 2:
		case 3:
		case 4:
		case 5:
		case 6:
		case 7:
		case 8:
		case 9:
		case 10:
		case 11: {
			const profiles: Profile[] = []

			for (const value of data.profiles) {
				const profile = normalizeProfile(value, now, data.version)
				if (profile && !profiles.some((p) => p.id === profile.id)) profiles.push(profile)
			}

			return profiles
		}
		default:
			return undefined
	}
}
