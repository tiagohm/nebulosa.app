import type { AutoFocusRequest, CaptureRequest, StarDetectionRequest } from 'api'
import type { EquipmentSetup } from '../equipment/roles'
import type { WorkspaceId } from '../shell/route'
import type { SkyDisplaySettings } from '../sky/display'
import type { OpticalPreset, SensorGeometry, SensorSource, TelescopeOptics } from '../sky/framing'

// Persisted format of the profiles: what a profile holds, the defaults of its preferences and camera forms, and the
// version of the format. Profiles hold selections and preferences only, never operational device state.

// Current version of the persisted format. Version 1 stored each assignment as a bare device id;
// version 2 stores the device id and name; version 3 names the Capture modes auto-focus and tppa,
// which version 2 called focus-calibrator and polar-alignment; version 4 keeps the camera forms by
// physical camera (cameras) instead of by camera role, and drops the post-capture analysis and plate
// solving of the frames of a capture. The preferences of the Capture workspace (capture), removed since, are ignored
// when read.
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
	// Forms of each physical camera edited so far, by saved connection id, then device id.
	cameras: Record<string, Record<string, CameraSettings>>
	// Star detection request edited in Images → Star Detection, shared by every document and by the frames of Auto
	// Focus; absent until edited, and then DEFAULT_STAR_REQUEST holds.
	starDetection?: StarDetectionRequest
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

// Auto Focus form of one physical camera: the routine the next session starts with. The frames are taken with the
// exposure and camera settings of the camera and measured with the star detection request of the profile, which this
// form never holds. Durations are in seconds, positions in focuser steps.
export interface AutoFocusSettings {
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
}

// Auto Focus form of a camera that has none yet: a hyperbolic fit over 4 positions on each side.
export const DEFAULT_AUTO_FOCUS_SETTINGS: AutoFocusSettings = {
	fittingMode: 'HYPERBOLIC',
	initialOffsetSteps: 4,
	reversed: false,
	rmsdThreshold: 0,
	settleDelay: 0,
	measureTimeout: 60,
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

// Returns the default preferences of a new profile.
export function defaultSettings(): ProfileSettings {
	return { panels: {}, cameras: {}, sky: {} }
}
