import type { AutoFocusRequest, CaptureRequest, StarDetectionRequest } from 'api'
import { nanoid } from 'nanoid'
import { proxy, snapshot, subscribe } from 'valtio'
import { CAMERA_ROLES, type CameraRole, conflictingRole, type DeviceAssignment, type EquipmentRole, type EquipmentSetup, isCameraRole, isEquipmentRole } from '../equipment/roles'
import { type CaptureMode, captureModeOf, WORKSPACE_IDS, type WorkspaceId } from '../shell/route'
import { MAP_STAR_MAGNITUDE_LIMIT, MIN_MAGNITUDE_LIMIT, SKY_LAYER_IDS, type SkyDisplaySettings, type SkyLayerId } from '../sky/display'
import { DEFAULT_OPTICS, type OpticalConfiguration, type OpticalPreset, type SensorGeometry, type SensorSource, type TelescopeOptics } from '../sky/framing'
import { DEFAULT_ASTAP_SETTINGS, DEFAULT_BUILTIN_SETTINGS, DEFAULT_STAR_REQUEST } from '../stars/stars'
import { isRecord, parseJson, readText, type Stores, writeText } from '../storage'

// Profiles of the browser and the profile active in this tab. Profiles are a versioned collection in
// localStorage, shared by every tab with last-write-wins semantics; the active profile id is kept per
// tab in sessionStorage, and also as the browser's last selection so that new tabs open it. Profiles
// hold selections and preferences only, never operational device state.

// localStorage key of the persisted ProfilesStorage.
export const PROFILES_KEY = 'nebulosa:profiles'

// sessionStorage key of the profile active in the tab.
export const ACTIVE_PROFILE_KEY = 'nebulosa:activeProfileId'

// localStorage key of the profile selected last in any tab, opened by new tabs.
export const LAST_PROFILE_KEY = 'nebulosa:lastProfileId'

// Current version of the persisted format. Version 1 stored each assignment as a bare device id;
// version 2 stores the device id and name; version 3 names the Capture modes auto-focus and tppa,
// which version 2 called focus-calibrator and polar-alignment; version 4 keeps the camera forms by
// physical camera (cameras) instead of by camera role, and drops the post-capture analysis and plate
// solving of the frames of a capture.
export const PROFILES_VERSION = 4

// Name of the profile created when none is stored.
export const DEFAULT_PROFILE_NAME = 'Default'

// Application preferences that belong to a profile. Each preference is added here, with its default in
// defaultSettings and its restoration in normalizeSettings.
export interface ProfileSettings {
	// Whether the contextual panel of each workspace is expanded on wide screens; an absent workspace
	// shows it expanded. Narrow screens open the panel as a drawer that is never persisted.
	panels: Partial<Record<WorkspaceId, boolean>>
	// Server directory an image was opened from last, where the file explorer starts; absent before the
	// first image is opened.
	lastImageDirectory?: string
	// Camera view and per-camera presentation preferences of the Capture workspace.
	capture: CaptureSettings
	// Forms of each physical camera edited so far, by saved connection id, then device id.
	cameras: Record<string, Record<string, CameraSettings>>
	// Preferences of the Sky workspace.
	sky: SkySettings
	// Telescope or lens of the profile's Equipment Setup, which no device reports; absent until entered.
	// It is planning data only and never sent to any device.
	telescope?: TelescopeOptics
}

// Location the Sky workspace observes from. Degrees and meters, entered manually; never assumed.
export interface SkyObserverSettings {
	// Name of the place, such as "Backyard"; absent when not named.
	name?: string
	// Geodetic latitude in degrees, north positive, [-90, 90].
	latitude: number
	// Geodetic longitude in degrees, east positive, [-180, 180].
	longitude: number
	// Height above the ellipsoid in meters, [-500, 9000].
	elevation: number
	// IANA time zone the Sky shows and enters times in, such as "America/Sao_Paulo"; absent uses the
	// browser's. It never changes positions, only how instants are read.
	timeZone?: string
}

// Sky preferences of a profile.
export interface SkySettings {
	// Observer location; absent until the user sets one, and then the sky is shown without a horizon
	// and positions are geocentric.
	observer?: SkyObserverSettings
	// What the star map shows; absent until the user changes a preference, and then every default holds.
	display?: SkyDisplaySettings
	// Field of view drawn around the selection; absent until the user creates a preset.
	framing?: SkyFramingSettings
}

// Field of view preferences of the Sky workspace: custom optical presets, independent of the equipment
// setup, which one is drawn, and how the Equipment Setup source builds its field.
export interface SkyFramingSettings {
	// Presets in display order.
	presets: readonly OpticalPreset[]
	// Id of the preset drawn; absent when there is none.
	activePresetId?: string
	// Whether the field of view is drawn on the map.
	visible: boolean
	// Where the drawn field comes from: a custom preset, or the Equipment Setup; absent means custom.
	source?: 'custom' | 'equipment'
	// Sensor of the Equipment Setup source; absent means the main camera.
	sensorSource?: SensorSource
	// Sensor entered for the Equipment Setup source when sensorSource is manual, to simulate a camera.
	manualSensor?: SensorGeometry
	// Position angle of the Equipment Setup field's top edge in degrees, from north towards east, [0, 360);
	// absent means 0.
	equipmentRotation?: number
}

// Presentation preferences of one Capture camera view. They belong to the camera role, not to the
// device assigned to it, so replacing the device keeps them.
export interface CameraViewSettings {
	// Operational mode selected last in the camera view.
	mode: CaptureMode
	// Whether the viewer's reticle is shown; absent follows the mode's default overlays. Selecting
	// another mode clears it.
	reticle?: boolean
}

// Exposure and camera settings of one physical camera, shared by every operation that takes its frames (Camera
// Acquisition, Auto Focus); each operation fits them to the camera's capabilities when it starts and keeps that
// snapshot while it runs, so editing them never changes a running operation. Exposure time in seconds; subframe in
// pixels of the unbinned sensor.
export type CameraExposureSettings = Pick<CaptureRequest, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Exposure and camera settings of a camera that has none yet: a 1 s exposure at the driver's defaults, unbinned, on
// the whole sensor.
export const DEFAULT_EXPOSURE_SETTINGS: CameraExposureSettings = { exposureTime: 1, gain: 0, offset: 0, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '' }

// Camera Acquisition form of one physical camera besides its exposure: the acquisition mode, the frame type, and the
// output the next capture starts with. Delay in seconds.
export type CameraAcquisitionSettings = Pick<CaptureRequest, 'exposureMode' | 'count' | 'delay' | 'frameType' | 'output'>

// Camera Acquisition form of a camera that has none yet: one light frame, previewed and saved in the server's default
// directory with the server's default names, as FITS.
export const DEFAULT_ACQUISITION_SETTINGS: CameraAcquisitionSettings = { exposureMode: 'single', count: 10, delay: 0, frameType: 'LIGHT', output: { mode: 'preview-save', format: 'FITS' } }

// Forms of one physical camera; a form not edited yet is absent and its defaults apply.
export interface CameraSettings {
	// Exposure and camera settings shared by the operations of the camera.
	exposure?: CameraExposureSettings
	// Camera Acquisition form.
	acquisition?: CameraAcquisitionSettings
	// Auto Focus form.
	autoFocus?: AutoFocusSettings
}

// Physical camera the forms of a profile belong to: the saved connection that provides it and its device id, stable
// across reconnections. Never a camera role, so a camera keeps its forms whatever role it takes.
export interface CameraIdentity {
	// Id of the saved connection.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
}

// Auto Focus form of one physical camera: how the frames are measured and the routine the next session starts with.
// The frames are taken with the exposure and camera settings of the camera, which this form never holds. Durations are in seconds, positions in focuser steps.
export interface AutoFocusSettings {
	// Star detector, its settings, and the acceptance criteria of the stars entering the aggregate HFD.
	detection: StarDetectionRequest
	// Curve fitting that places the best focus.
	fittingMode: AutoFocusRequest['fittingMode']
	// Positions sampled on each side of the start, >= 1.
	initialOffsetSteps: number
	// Distance between sampled positions, in steps, >= 1; absent follows the travel of the focuser.
	stepSize?: number
	// Whether the sweep starts inwards instead of outwards.
	reversed: boolean
	// Largest RMSD of a fitted curve over its HFD at the best focus; 0 accepts any fit.
	rmsdThreshold: number
	// Wait after each focuser move before the next exposure, in seconds; >= 0.
	settleDelay: number
	// Longest star detection of one frame, in seconds; > 0.
	measureTimeout: number
	// Whether the Focus Curve is expanded below the viewer.
	curve: boolean
}

// Signal aperture radius of the built-in detector of an Auto Focus, in pixels: large enough to measure the
// defocused stars at the ends of a focus curve, which the fixed 4 px aperture saturates.
export const AUTO_FOCUS_APERTURE = 32

// Auto Focus form of a view that has none yet: frames measured by the built-in detector with a grown aperture, a
// hyperbolic fit over 4 positions on each side, and the Focus Curve shown.
export const DEFAULT_AUTO_FOCUS_SETTINGS: AutoFocusSettings = {
	detection: { ...DEFAULT_STAR_REQUEST, detector: { ...DEFAULT_BUILTIN_SETTINGS, maximumRadius: AUTO_FOCUS_APERTURE } },
	fittingMode: 'HYPERBOLIC',
	initialOffsetSteps: 4,
	reversed: false,
	rmsdThreshold: 0,
	settleDelay: 0,
	measureTimeout: 60,
	curve: true,
}

// Capture workspace preferences of a profile. Only presentation is kept: never images, devices, or operations.
export interface CaptureSettings {
	// Camera role of the view selected last; absent before Capture is first opened.
	activeCamera?: CameraRole
	// Preferences of each camera view used so far, by camera role.
	views: Partial<Record<CameraRole, CameraViewSettings>>
}

// A complete working environment: the selected connection, the equipment assigned on each connection,
// and preferences.
export interface Profile {
	// Unique id, kept across renames.
	readonly id: string
	// Display name, trimmed and non-empty.
	name: string
	// Id of the saved connection the profile works with; absent when none is selected.
	connectionId?: string
	// Equipment setup of each saved connection the profile has used, keyed by saved connection id. Only
	// the setup of connectionId is active; the others are restored when that connection is selected again.
	equipment: Record<string, EquipmentSetup>
	// Preferences of the profile.
	settings: ProfileSettings
	// Creation time, ISO 8601.
	readonly createdAt: string
	// Time of the last change, ISO 8601.
	updatedAt: string
}

// Persisted form of the profile collection.
export interface ProfilesStorage {
	// Format version, PROFILES_VERSION when written by this code.
	readonly version: number
	// Profiles in display order.
	readonly profiles: readonly Profile[]
}

// Profile store of the tab.
export interface ProfileState {
	// Profiles in display order; never empty once loaded.
	profiles: Profile[]
	// Id of the profile active in this tab.
	activeId: string
	// Whether the profile management modal is shown.
	open: boolean
	// Message of the last failed write to storage, cleared by the next successful one.
	error?: string
}

// Profile store of the tab, empty until loadProfiles runs.
export const profileState = proxy<ProfileState>({ profiles: [], activeId: '', open: false })

// Returns the default preferences of a new profile.
export function defaultSettings(): ProfileSettings {
	return { panels: {}, capture: { views: {} }, cameras: {}, sky: {} }
}

// Restores persisted Capture preferences, dropping unknown camera roles and invalid values and reading
// the mode ids of earlier versions. Profiles written before camera views existed have none and get the
// defaults.
function normalizeCapture(value: unknown, capture: CaptureSettings) {
	if (!isRecord(value)) return
	if (isCameraRole(value.activeCamera)) capture.activeCamera = value.activeCamera

	if (!isRecord(value.views)) return

	for (const role of CAMERA_ROLES) {
		const view = value.views[role]
		if (!isRecord(view)) continue
		const settings: CameraViewSettings = { mode: captureModeOf(view.mode) ?? 'camera' }
		if (typeof view.reticle === 'boolean') settings.reticle = view.reticle
		capture.views[role] = settings
	}
}

// Acquisition modes of the Camera Capture form.
const EXPOSURE_MODES: ReadonlySet<string> = new Set<CameraAcquisitionSettings['exposureMode']>(['single', 'fixed', 'loop'])

// Frame types of the Camera Capture form.
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
	if (!exposure && !acquisition && !autoFocus) return undefined
	return { ...(exposure && { exposure }), ...(acquisition && { acquisition }), ...(autoFocus && { autoFocus }) }
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

// Restores a persisted star detection request, filling every invalid field with its default; the aperture of
// the built-in detector is kept only when valid, and fallback is used when the value is not a record.
function normalizeStarRequest(value: unknown, fallback: StarDetectionRequest): StarDetectionRequest {
	if (!isRecord(value)) return JSON.parse(JSON.stringify(fallback)) as StarDetectionRequest

	const detector = isRecord(value.detector) ? value.detector : {}
	const acceptance = isRecord(value.acceptance) ? value.acceptance : {}
	const defaults = DEFAULT_STAR_REQUEST.acceptance
	const maximumRadius = numberAtLeast(detector.maximumRadius, 1, Number.NaN)

	return {
		detector:
			detector.provider === 'astap'
				? { provider: 'astap', maxStars: numberAtLeast(detector.maxStars, 0, DEFAULT_ASTAP_SETTINGS.maxStars, true), minSNR: numberAtLeast(detector.minSNR, 0, DEFAULT_ASTAP_SETTINGS.minSNR) }
				: {
						provider: 'builtin',
						maxStars: numberAtLeast(detector.maxStars, 1, DEFAULT_BUILTIN_SETTINGS.maxStars, true),
						minSNR: numberAtLeast(detector.minSNR, 0, DEFAULT_BUILTIN_SETTINGS.minSNR),
						searchRegion: numberAtLeast(detector.searchRegion, 0, DEFAULT_BUILTIN_SETTINGS.searchRegion),
						...(Number.isFinite(maximumRadius) && { maximumRadius }),
					},
		acceptance: { minSNR: numberAtLeast(acceptance.minSNR, 0, defaults.minSNR), minHfd: numberAtLeast(acceptance.minHfd, 0, defaults.minHfd), maxHfd: numberAtLeast(acceptance.maxHfd, 0, defaults.maxHfd), edgeMargin: numberAtLeast(acceptance.edgeMargin, 0, defaults.edgeMargin) },
	}
}

// Fitting modes of the Auto Focus form.
const FITTING_MODES: ReadonlySet<string> = new Set<AutoFocusSettings['fittingMode']>(['HYPERBOLIC', 'PARABOLIC', 'TRENDLINES', 'TREND_HYPERBOLIC', 'TREND_PARABOLIC'])

// Restores a persisted Auto Focus form, filling every invalid field with its default; undefined for anything
// that is not a record. A step size that is not valid is dropped, so the travel of the focuser sets it again, and the
// frame settings of forms saved when the Auto Focus had its own are dropped too.
function normalizeAutoFocus(value: unknown): AutoFocusSettings | undefined {
	if (!isRecord(value)) return undefined

	const defaults = DEFAULT_AUTO_FOCUS_SETTINGS
	const stepSize = numberAtLeast(value.stepSize, 1, Number.NaN, true)

	return {
		detection: normalizeStarRequest(value.detection, defaults.detection),
		fittingMode: typeof value.fittingMode === 'string' && FITTING_MODES.has(value.fittingMode) ? (value.fittingMode as AutoFocusSettings['fittingMode']) : defaults.fittingMode,
		initialOffsetSteps: numberAtLeast(value.initialOffsetSteps, 1, defaults.initialOffsetSteps, true),
		...(Number.isFinite(stepSize) && { stepSize }),
		reversed: value.reversed === true,
		rmsdThreshold: numberAtLeast(value.rmsdThreshold, 0, defaults.rmsdThreshold),
		settleDelay: numberAtLeast(value.settleDelay, 0, defaults.settleDelay),
		measureTimeout: typeof value.measureTimeout === 'number' && Number.isFinite(value.measureTimeout) && value.measureTimeout > 0 ? value.measureTimeout : defaults.measureTimeout,
		curve: value.curve !== false,
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
	const rotation = finiteOr(optics.rotation, 0)
	return { id: value.id, name: value.name.trim(), optics: { focalLength: finiteOr(optics.focalLength, 0), focalMultiplier: finiteOr(optics.focalMultiplier, 1), aperture: Math.max(0, finiteOr(optics.aperture, 0)), sensor, rotation: ((rotation % 360) + 360) % 360 } }
}

// Normalizes an angle in degrees to [0, 360).
function normalizeDegrees(angle: number) {
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
// preferences.
function normalizeSky(value: unknown, sky: SkySettings) {
	if (!isRecord(value)) return
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

	normalizeCapture(value.capture, settings.capture)
	settings.cameras = normalizeCameras(value.cameras)
	normalizeSky(value.sky, settings.sky)
	const telescope = normalizeTelescope(value.telescope)
	if (telescope) settings.telescope = telescope

	return settings
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

	return profile
}

// Reads the profiles of a persisted document of any known version. Returns undefined for a document
// that is not a known ProfilesStorage, including one written by a newer version.
function migrate(data: unknown, now: string): Profile[] | undefined {
	if (!isRecord(data) || !Array.isArray(data.profiles)) return undefined

	switch (data.version) {
		case 1:
		case 2:
		case 3:
		case 4: {
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

// Returns a new profile with default preferences, no connection, and an empty setup.
export function newProfile(name: string, now = new Date().toISOString()): Profile {
	return { id: nanoid(), name, equipment: {}, settings: defaultSettings(), createdAt: now, updatedAt: now }
}

// Writes the profile collection. Records a failure in state.error and returns false.
function writeProfiles(state: ProfileState, stores: Stores, profiles: readonly Profile[]): boolean {
	const data: ProfilesStorage = { version: PROFILES_VERSION, profiles }
	const ok = writeText(stores.local, PROFILES_KEY, JSON.stringify(data))
	state.error = ok ? undefined : 'Unable to save profiles: browser storage is unavailable or full.'
	return ok
}

// Loads the profiles into state and restores the tab's active profile: this tab's last profile, then
// the browser's last selection, then the first profile. Creates and stores a Default profile when
// nothing is stored. A stored document that cannot be read is left untouched until the next change,
// and a Default profile is used meanwhile.
export function loadProfiles(state: ProfileState, stores: Stores) {
	const now = new Date().toISOString()
	const text = readText(stores.local, PROFILES_KEY)
	let profiles = text === undefined ? undefined : migrate(parseJson(text), now)

	if (!profiles?.length) {
		profiles = [newProfile(DEFAULT_PROFILE_NAME, now)]
		if (text === undefined) writeProfiles(state, stores, profiles)
	}

	const exists = (id: string | undefined) => id !== undefined && profiles.some((p) => p.id === id)
	const session = readText(stores.session, ACTIVE_PROFILE_KEY)
	const last = readText(stores.local, LAST_PROFILE_KEY)

	state.profiles = profiles
	state.activeId = exists(session) ? session! : exists(last) ? last! : profiles[0].id
	writeText(stores.session, ACTIVE_PROFILE_KEY, state.activeId)
}

// Persists every later change of state: the profile collection to localStorage, and the active profile
// to this tab's sessionStorage and as the browser's last selection. Returns a function that stops it.
export function persistProfiles(state: ProfileState, stores: Stores): () => void {
	let { profiles, activeId } = snapshot(state)

	return subscribe(state, () => {
		const current = snapshot(state)

		if (current.profiles !== profiles) {
			profiles = current.profiles
			writeProfiles(state, stores, current.profiles)
		}

		if (current.activeId !== activeId) {
			activeId = current.activeId
			writeText(stores.session, ACTIVE_PROFILE_KEY, activeId)
			writeText(stores.local, LAST_PROFILE_KEY, activeId)
		}
	})
}

// Returns the profile active in the tab, of the state or of a snapshot of it. The state must be loaded.
export function activeProfile<P extends Pick<Profile, 'id'>>(state: { readonly profiles: readonly P[]; readonly activeId: string }): P {
	return state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0]
}

// Returns the equipment setup of the profile's selected connection, of a profile or a snapshot of it;
// empty when none is selected.
export function activeSetup(profile: { readonly connectionId?: string; readonly equipment: { readonly [connectionId: string]: Readonly<EquipmentSetup> } }): Readonly<EquipmentSetup> {
	return (profile.connectionId && profile.equipment[profile.connectionId]) || {}
}

// Marks a profile as changed now.
function touch(profile: Profile) {
	profile.updatedAt = new Date().toISOString()
}

// Makes a profile active in the tab. Ignored for an unknown id.
export function selectProfile(state: ProfileState, id: string) {
	if (state.profiles.some((p) => p.id === id)) state.activeId = id
}

// Adds a profile with default preferences and returns it. Returns undefined for a blank name.
export function createProfile(state: ProfileState, name: string): Profile | undefined {
	const trimmed = name.trim()
	if (!trimmed) return undefined
	const profile = newProfile(trimmed)
	state.profiles.push(profile)
	return profile
}

// Renames a profile, keeping its id. Returns false for a blank name or an unknown id.
export function renameProfile(state: ProfileState, id: string, name: string): boolean {
	const trimmed = name.trim()
	const profile = state.profiles.find((p) => p.id === id)
	if (!trimmed || !profile) return false
	profile.name = trimmed
	touch(profile)
	return true
}

// Adds a copy of a profile, with a new id, right after it: same connection, equipment, and preferences.
// Returns the copy, or undefined for an unknown id.
export function duplicateProfile(state: ProfileState, id: string): Profile | undefined {
	const index = state.profiles.findIndex((p) => p.id === id)
	if (index < 0) return undefined

	const source = structuredClone(snapshot(state).profiles[index]) as Profile
	const now = new Date().toISOString()
	const copy: Profile = { ...source, id: nanoid(), name: `${source.name} (copy)`, createdAt: now, updatedAt: now }
	state.profiles.splice(index + 1, 0, copy)
	return copy
}

// Deletes a profile, never the last one. When it is active, the first remaining profile becomes active.
// Connections and devices are not touched. Returns false when nothing was deleted.
export function deleteProfile(state: ProfileState, id: string): boolean {
	if (state.profiles.length <= 1 || !state.profiles.some((p) => p.id === id)) return false
	state.profiles = state.profiles.filter((p) => p.id !== id)
	if (state.activeId === id) state.activeId = state.profiles[0].id
	return true
}

// Selects the saved connection the active profile works with; undefined clears it. The setup the
// profile used on that connection becomes active again.
export function selectConnection(state: ProfileState, connectionId: string | undefined) {
	const profile = activeProfile(state)
	if (profile.connectionId === connectionId) return
	if (connectionId) profile.connectionId = connectionId
	else delete profile.connectionId
	touch(profile)
}

// Result of an assignment: ok, no connection selected, or the role that already holds the device and
// cannot share it.
export type AssignResult = { readonly ok: true } | { readonly ok: false; readonly reason: 'no-connection' } | { readonly ok: false; readonly reason: 'conflict'; readonly role: EquipmentRole }

// Assigns a device to a role of the active profile's setup on its selected connection; undefined clears
// the role. Selecting a device does not connect it.
export function assignDevice(state: ProfileState, role: EquipmentRole, device: DeviceAssignment | undefined): AssignResult {
	const profile = activeProfile(state)
	const connectionId = profile.connectionId
	if (!connectionId) return { ok: false, reason: 'no-connection' }

	const setup = (profile.equipment[connectionId] ??= {})

	if (device) {
		const conflict = conflictingRole(setup, role, device.id)
		if (conflict) return { ok: false, reason: 'conflict', role: conflict }
		setup[role] = { id: device.id, name: device.name }
	} else {
		delete setup[role]
	}

	touch(profile)
	return { ok: true }
}

// Fills in the missing names of the active profile's assignments (stored before names were kept) from
// the devices of its connection. Changes nothing when every assigned name is known.
export function rememberDeviceNames(state: ProfileState, devices: readonly DeviceAssignment[]) {
	const profile = activeProfile(state)
	const setup = profile.connectionId ? profile.equipment[profile.connectionId] : undefined
	if (!setup) return
	let changed = false

	for (const [role, assignment] of Object.entries(setup)) {
		if (!isEquipmentRole(role) || !assignment || assignment.name) continue
		const device = devices.find((d) => d.id === assignment.id)
		if (!device) continue
		setup[role] = { id: device.id, name: device.name }
		changed = true
	}

	if (changed) touch(profile)
}

// Whether the contextual panel of a workspace is expanded in a profile's settings or a snapshot of them.
export function panelOpen(settings: { readonly panels: Readonly<ProfileSettings['panels']> }, workspace: WorkspaceId): boolean {
	return settings.panels[workspace] ?? true
}

// Expands or collapses the contextual panel of a workspace in the active profile. Only the layout
// preference changes; whatever the panel controls keeps running.
export function setPanelOpen(state: ProfileState, workspace: WorkspaceId, open: boolean) {
	const profile = activeProfile(state)
	if (panelOpen(profile.settings, workspace) === open) return
	profile.settings.panels[workspace] = open
	touch(profile)
}

// Remembers in the active profile the server directory an image was opened from.
export function setLastImageDirectory(state: ProfileState, directory: string) {
	const profile = activeProfile(state)
	if (profile.settings.lastImageDirectory === directory) return
	profile.settings.lastImageDirectory = directory
	touch(profile)
}

// Remembers in the active profile the Capture camera view shown and its mode. Selecting another mode
// clears the view's reticle choice, so the new mode's default overlays apply. The equipment setup is
// never changed, and nothing is started or stopped.
export function selectCameraView(state: ProfileState, role: CameraRole, mode: CaptureMode) {
	const capture = activeProfile(state).settings.capture
	const view = capture.views[role]
	if (capture.activeCamera === role && view?.mode === mode) return
	capture.activeCamera = role
	if (view?.mode !== mode) capture.views[role] = { mode }
	touch(activeProfile(state))
}

// Shows or hides the viewer's reticle of a Capture camera view in the active profile; other camera views
// keep theirs.
export function setCameraReticle(state: ProfileState, role: CameraRole, reticle: boolean) {
	const profile = activeProfile(state)
	const view = (profile.settings.capture.views[role] ??= { mode: 'camera' })
	if (view.reticle === reticle) return
	view.reticle = reticle
	touch(profile)
}

// Returns the identity of a camera of a profile's saved connection, or undefined when the profile has no connection
// selected or there is no camera.
export function profileCamera(profile: Pick<Profile, 'connectionId'>, deviceId: string | undefined): CameraIdentity | undefined {
	return profile.connectionId && deviceId ? { connectionId: profile.connectionId, deviceId } : undefined
}

// Returns the forms of a camera, or undefined when it has none.
function cameraSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraSettings> | undefined {
	return camera && settings.cameras[camera.connectionId]?.[camera.deviceId]
}

// Replaces fields of a form of a camera in the active profile with a plain copy (the stored form is a proxy, and a
// default must never be shared with a camera); other cameras and forms keep theirs. Does nothing without a camera.
function setCameraForm<K extends keyof CameraSettings>(state: ProfileState, camera: CameraIdentity | undefined, form: K, current: Readonly<NonNullable<CameraSettings[K]>>, patch: Partial<NonNullable<CameraSettings[K]>>) {
	if (!camera) return
	const profile = activeProfile(state)
	const settings = ((profile.settings.cameras[camera.connectionId] ??= {})[camera.deviceId] ??= {})
	settings[form] = JSON.parse(JSON.stringify({ ...current, ...patch })) as CameraSettings[K]
	touch(profile)
}

// Returns the exposure and camera settings of a camera: the ones edited last, or the defaults.
export function exposureSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraExposureSettings> {
	return cameraSettings(settings, camera)?.exposure ?? DEFAULT_EXPOSURE_SETTINGS
}

// Replaces fields of the exposure and camera settings of a camera in the active profile.
export function setExposureSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<CameraExposureSettings>) {
	setCameraForm(state, camera, 'exposure', exposureSettings(activeProfile(state).settings, camera), patch)
}

// Returns the Camera Acquisition form of a camera: the one edited last, or the defaults.
export function acquisitionSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<CameraAcquisitionSettings> {
	return cameraSettings(settings, camera)?.acquisition ?? DEFAULT_ACQUISITION_SETTINGS
}

// Replaces fields of the Camera Acquisition form of a camera in the active profile. The output is replaced as a whole
// when given.
export function setAcquisitionSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<CameraAcquisitionSettings>) {
	setCameraForm(state, camera, 'acquisition', acquisitionSettings(activeProfile(state).settings, camera), patch)
}

// Returns the Auto Focus form of a camera: the one edited last, or the defaults.
export function autoFocusSettings(settings: Pick<ProfileSettings, 'cameras'>, camera: CameraIdentity | undefined): Readonly<AutoFocusSettings> {
	return cameraSettings(settings, camera)?.autoFocus ?? DEFAULT_AUTO_FOCUS_SETTINGS
}

// Replaces fields of the Auto Focus form of a camera in the active profile. The detection is replaced as a whole when
// given.
export function setAutoFocusSettings(state: ProfileState, camera: CameraIdentity | undefined, patch: Partial<AutoFocusSettings>) {
	setCameraForm(state, camera, 'autoFocus', autoFocusSettings(activeProfile(state).settings, camera), patch)
}

// Sets the Sky observer of the active profile, or clears it with undefined. Returns false, changing
// nothing, for an observer out of range.
export function setSkyObserver(state: ProfileState, observer: SkyObserverSettings | undefined): boolean {
	const profile = activeProfile(state)

	if (observer === undefined) {
		if (!profile.settings.sky.observer) return true
		delete profile.settings.sky.observer
		touch(profile)
		return true
	}

	const normalized = normalizeSkyObserver(observer)
	if (!normalized) return false
	const current = profile.settings.sky.observer
	if (current && current.latitude === normalized.latitude && current.longitude === normalized.longitude && current.elevation === normalized.elevation && current.name === normalized.name && current.timeZone === normalized.timeZone) return true
	profile.settings.sky.observer = normalized
	touch(profile)
	return true
}

// Shows or hides a star map layer in the active profile.
export function setSkyLayerVisible(state: ProfileState, layer: SkyLayerId, visible: boolean) {
	const profile = activeProfile(state)
	const display = (profile.settings.sky.display ??= { layers: {} })
	if (display.layers[layer] === visible) return
	display.layers[layer] = visible
	touch(profile)
}

// Sets the faintest star magnitude the star map draws in the active profile, kept within
// [MIN_MAGNITUDE_LIMIT, MAP_STAR_MAGNITUDE_LIMIT].
export function setSkyMagnitudeLimit(state: ProfileState, limit: number) {
	const profile = activeProfile(state)
	const display = (profile.settings.sky.display ??= { layers: {} })
	const value = Math.min(MAP_STAR_MAGNITUDE_LIMIT, Math.max(MIN_MAGNITUDE_LIMIT, limit))
	if (display.magnitudeLimit === value) return
	display.magnitudeLimit = value
	touch(profile)
}

// Copies optics, which may be a store proxy or snapshot, into a plain object.
function copyOptics(optics: OpticalConfiguration): OpticalConfiguration {
	return { ...optics, sensor: { ...optics.sensor } }
}

// Returns the framing preferences of a profile, creating them empty and hidden.
function framingOf(profile: Profile): SkyFramingSettings {
	return (profile.settings.sky.framing ??= { presets: [], visible: false })
}

// Creates an optical preset in the active profile from optics (the defaults when absent), selects it,
// and shows the field of view. Returns the preset, or undefined for a blank name.
export function createOpticalPreset(state: ProfileState, name: string, optics: OpticalConfiguration = DEFAULT_OPTICS): OpticalPreset | undefined {
	const trimmed = name.trim()
	if (!trimmed) return undefined
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	const preset: OpticalPreset = { id: nanoid(), name: trimmed, optics: copyOptics(optics) }
	framing.presets = [...framing.presets, preset]
	framing.activePresetId = preset.id
	framing.visible = true
	touch(profile)
	return preset
}

// Replaces the name or optics of a preset of the active profile; a blank name is ignored. Returns
// whether the preset exists.
export function updateOpticalPreset(state: ProfileState, id: string, changes: { readonly name?: string; readonly optics?: OpticalConfiguration }): boolean {
	const profile = activeProfile(state)
	const framing = profile.settings.sky.framing
	const current = framing?.presets.find((preset) => preset.id === id)
	if (!framing || !current) return false
	const updated: OpticalPreset = { id, name: changes.name?.trim() || current.name, optics: changes.optics ? copyOptics(changes.optics) : current.optics }
	framing.presets = framing.presets.map((preset) => (preset.id === id ? updated : preset))
	touch(profile)
	return true
}

// Copies a preset of the active profile under the name "<name> (copy)" and selects the copy.
export function duplicateOpticalPreset(state: ProfileState, id: string): OpticalPreset | undefined {
	const source = activeProfile(state).settings.sky.framing?.presets.find((preset) => preset.id === id)
	return source && createOpticalPreset(state, `${source.name} (copy)`, source.optics)
}

// Deletes a preset of the active profile; deleting the selected one selects the first left, if any.
export function deleteOpticalPreset(state: ProfileState, id: string) {
	const profile = activeProfile(state)
	const framing = profile.settings.sky.framing
	if (!framing?.presets.some((preset) => preset.id === id)) return
	framing.presets = framing.presets.filter((preset) => preset.id !== id)
	if (framing.activePresetId === id) framing.activePresetId = framing.presets[0]?.id
	touch(profile)
}

// Selects the preset drawn in the active profile.
export function selectOpticalPreset(state: ProfileState, id: string) {
	const profile = activeProfile(state)
	const framing = profile.settings.sky.framing
	if (!framing?.presets.some((preset) => preset.id === id) || framing.activePresetId === id) return
	framing.activePresetId = id
	touch(profile)
}

// Shows or hides the field of view in the active profile.
export function setFramingVisible(state: ProfileState, visible: boolean) {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	if (framing.visible === visible) return
	framing.visible = visible
	touch(profile)
}

// Chooses where the drawn field of view comes from in the active profile.
export function setFramingSource(state: ProfileState, source: 'custom' | 'equipment') {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	if ((framing.source ?? 'custom') === source) return
	framing.source = source
	touch(profile)
}

// Chooses the sensor of the Equipment Setup field of view in the active profile.
export function setSensorSource(state: ProfileState, source: SensorSource) {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	if ((framing.sensorSource ?? 'MAIN_CAMERA') === source) return
	framing.sensorSource = source
	touch(profile)
}

// Replaces the manual sensor of the Equipment Setup field of view in the active profile; it only
// simulates a camera and is never sent to a device.
export function setManualSensor(state: ProfileState, sensor: SensorGeometry) {
	const profile = activeProfile(state)
	framingOf(profile).manualSensor = { ...sensor }
	touch(profile)
}

// Sets the position angle in degrees of the Equipment Setup field of view in the active profile,
// normalized to [0, 360).
export function setEquipmentRotation(state: ProfileState, rotation: number) {
	const profile = activeProfile(state)
	const framing = framingOf(profile)
	const value = normalizeDegrees(rotation)
	if (framing.equipmentRotation === value) return
	framing.equipmentRotation = value
	touch(profile)
}

// Replaces the telescope optics of the active profile's Equipment Setup; planning data only, never sent
// to a device.
export function setTelescopeOptics(state: ProfileState, optics: TelescopeOptics) {
	const profile = activeProfile(state)
	profile.settings.telescope = { focalLength: optics.focalLength, focalMultiplier: optics.focalMultiplier, aperture: optics.aperture }
	touch(profile)
}

// Forgets a removed saved connection in every profile: profiles that selected it lose their selection,
// and its equipment setup is dropped, because the removed entry can never be selected again.
export function forgetConnection(state: ProfileState, connectionId: string) {
	for (const profile of state.profiles) {
		const selected = profile.connectionId === connectionId
		const used = connectionId in profile.equipment
		if (!selected && !used) continue
		if (selected) delete profile.connectionId
		delete profile.equipment[connectionId]
		touch(profile)
	}
}
