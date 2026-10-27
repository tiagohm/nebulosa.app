import type { AutoFocusRequest, CaptureRequest, DisplaySettings, FlatWizardFilter, GuidingClientSettings, GuidingStartRequest, MountRemoteProtocol, MountRemoteStartRequest, PlateSolveRequest, StarDetectionRequest, StreakDetectorSettings } from 'api'
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
// when read. Version 5 adds the TPPA form of each camera (tppa), version 6 its DARV form (darv), and version 7 its Flat
// Wizard form (flatWizard). Version 8 adds the guiding form of each camera (guiding), and version 9 moves the guide
// focal length of those forms to the guide telescope of the profile (guideTelescope). Version 10 adds the listener
// bindings of Mount Remote Control of each mount (mountRemoteControl), and version 11 the display settings last applied
// in Images, to the frames of each camera (display) and to every other image (imageDisplay). Version 12 adds the streak
// detector settings of Images (streakDetection), and version 13 the notifications the profile read or dismissed (notifications).
export const PROFILES_VERSION = 13

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
	// Streak detector settings edited in Images → Streak Detection, shared by every document; absent until edited, and
	// then DEFAULT_STREAK_SETTINGS holds. The context jobs of a detection are chosen per document, never stored here.
	streakDetection?: StreakDetectorSettings
	// Display settings applied last in Images to a file or derived image, which every image opened next starts with;
	// absent until the first one is applied. Camera frames use those of their camera (CameraSettings display).
	imageDisplay?: DisplaySettings
	// Preferences of the Sky workspace.
	sky: SkySettings
	// Telescope or lens of the profile's Equipment Setup, which no device reports; absent until entered.
	// It is planning data only and never sent to any device.
	telescope?: TelescopeOptics
	// Guide telescope or lens of the profile's Equipment Setup, whose effective focal length gives guiding its pixel scale
	// and calibration step; absent until entered. With an off-axis guider it holds the optics of the main telescope.
	guideTelescope?: TelescopeOptics
	// Host and port each Mount Remote Control listener was last started with, by saved connection id, then mount id, then
	// protocol; absent until edited, and then DEFAULT_MOUNT_REMOTE_BINDINGS holds. A preference only: it never starts,
	// stops, or rebinds a listener.
	mountRemoteControl?: Record<string, Record<string, Partial<Record<MountRemoteProtocol, MountRemoteBinding>>>>
	// Notifications of the server history the profile read or dismissed; absent until the first one is read. The server
	// keeps one history for every browser, so these states are the profile's own and are never sent back.
	notifications?: NotificationPreferences
}

// Notifications of the server history a profile read or dismissed, by notification id. Ids the history no longer
// retains are dropped, so each list holds at most MAX_NOTIFICATION_IDS ids.
export interface NotificationPreferences {
	// Notifications read; a dismissed notification is read too.
	readIds: readonly string[]
	// Notifications hidden from the lists of the profile.
	dismissedIds: readonly string[]
}

// Most ids kept in each list of NotificationPreferences, the size of the server history.
export const MAX_NOTIFICATION_IDS = 500

// Protocols of the Mount Remote Control listeners, in the order the tool shows them.
export const MOUNT_REMOTE_PROTOCOLS: readonly MountRemoteProtocol[] = ['lx200', 'stellarium']

// Host and port of a Mount Remote Control listener, as started.
export type MountRemoteBinding = MountRemoteStartRequest

// Binding of each protocol before one is entered: every interface, so a planetarium on another machine of the network
// can connect, on the ports Stellarium and most LX200 programs use first (10001 for Stellarium, 10002 for LX200).
export const DEFAULT_MOUNT_REMOTE_BINDINGS: Readonly<Record<MountRemoteProtocol, MountRemoteBinding>> = {
	lx200: { host: '0.0.0.0', port: 10002 },
	stellarium: { host: '0.0.0.0', port: 10001 },
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
	// Whether the time bar of the simulation clock is shown under the star map; absent hides it.
	timeBar?: boolean
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
	// TPPA form.
	tppa?: TppaSettings
	// DARV form.
	darv?: DarvSettings
	// Flat Wizard form.
	flatWizard?: FlatWizardSettings
	// Guiding form.
	guiding?: GuidingSettings
	// Display settings applied last to the frames of the camera in its Images tab, which its tab starts with.
	display?: DisplaySettings
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
	// Whether a stop moves the focuser back to the start position.
	restoreOnStop: boolean
}

// Auto Focus form of a camera that has none yet: a hyperbolic fit over 4 positions on each side.
export const DEFAULT_AUTO_FOCUS_SETTINGS: AutoFocusSettings = {
	fittingMode: 'HYPERBOLIC',
	initialOffsetSteps: 4,
	reversed: false,
	rmsdThreshold: 0,
	settleDelay: 0,
	measureTimeout: 60,
	restoreOnStop: true,
}

// TPPA form of one physical camera: how the next three-point polar alignment moves the mount and solves its frames.
// The frames are taken with the exposure and camera settings of the camera, which this form never holds. Angles are
// in degrees and durations in seconds, as edited.
export interface TppaSettings {
	// Direction of the RA motions between the three poses.
	direction: 'WEST' | 'EAST'
	// Name of the slew-rate preset of the motions, checked again against the presets the mount announces when a
	// session starts; absent before one was chosen.
	slewRate?: string
	// RA rotation aimed at between consecutive poses, in degrees, in [TPPA_MINIMUM_ROTATION, TPPA_MAXIMUM_ROTATION].
	rotation: number
	// Wait after the mount stopped and before each exposure, in seconds; >= 0.
	settleDelay: number
	// Wait before each refinement exposure, in seconds; >= 0.
	refinementDelay: number
	// Plate solver of the frames, its strategy, and its downsampling.
	solver: Pick<PlateSolveRequest, 'provider' | 'strategy' | 'downsample'>
	// Whether the tracking the session starts on a mount that was not tracking is stopped when the session ends.
	stopTracking: boolean
}

// Smallest RA rotation of the TPPA form, in degrees: the least rotation the server accepts between two poses.
export const TPPA_MINIMUM_ROTATION = 6

// Largest RA rotation of the TPPA form, in degrees: two steps stay within the 30° of total motion the server allows.
export const TPPA_MAXIMUM_ROTATION = 15

// TPPA form of a camera that has none yet: westward motions of 8° solved by ASTAP around the header pointing.
export const DEFAULT_TPPA_SETTINGS: TppaSettings = {
	direction: 'WEST',
	rotation: 8,
	settleDelay: 2,
	refinementDelay: 1,
	solver: { provider: 'astap', strategy: 'assisted' },
	stopTracking: true,
}

// DARV form of one physical camera: how the next drift alignment measurement moves the mount. The frame is taken
// with the camera settings of the camera, which this form never holds, and with an exposure derived from the leg
// duration, which never replaces the exposure of Camera Acquisition. Durations are in seconds, as edited.
export interface DarvSettings {
	// Knob being adjusted, which tells the operator where to point: azimuth near the meridian, altitude near the
	// eastern or western horizon.
	axis: 'azimuth' | 'altitude'
	// Direction of the outbound RA motion; the return goes the other way.
	direction: 'WEST' | 'EAST'
	// Name of the slew-rate preset of the motions, checked again against the presets the mount announces when a
	// measurement starts; absent before one was chosen.
	slewRate?: string
	// Duration of each RA motion, in seconds, in [DARV_MINIMUM_LEG_DURATION, DARV_MAXIMUM_LEG_DURATION].
	legDuration: number
	// Whether the finish stops the tracking a measurement started on a mount that was not tracking.
	stopTracking: boolean
}

// Shortest RA motion of the DARV form, in seconds; shorter trails are too short to tell the legs apart.
export const DARV_MINIMUM_LEG_DURATION = 5

// Longest RA motion of the DARV form, in seconds (10 minutes), beyond which the exposure saturates the sky.
export const DARV_MAXIMUM_LEG_DURATION = 600

// DARV form of a camera that has none yet: the classic one-minute legs, eastward first, adjusting the azimuth.
export const DEFAULT_DARV_SETTINGS: DarvSettings = { axis: 'azimuth', direction: 'EAST', legDuration: 60, stopTracking: true }

// Flat Wizard form of one physical camera: the filter groups to acquire and the limits of the next session. The camera
// settings come from Camera Acquisition (without its exposure time); the wheel and panel are those of the setup.
export interface FlatWizardSettings {
	// Filter groups, in acquisition order; at least one. Exposures in seconds, targets in observed DN, brightness in
	// the panel's own units.
	filters: readonly FlatWizardFilter[]
	// Wait after the panel light or brightness changed, in seconds, in [0, 600].
	settleTime: number
	// Absolute server directory the frames are saved into; absent uses the server's default captures directory.
	directory?: string
	// Effective upper clipping code of the camera, in DN; absent leaves saturation evidence unknown.
	effectiveClip?: number
	// Trial frames allowed per filter, in [1, FLAT_WIZARD_MAXIMUM_TRIALS].
	maximumTrials: number
	// Rejected or inconclusive final frames allowed per filter, in [0, FLAT_WIZARD_MAXIMUM_REJECTIONS].
	maximumRejections: number
}

// Most filter groups a Flat Wizard form keeps.
export const FLAT_WIZARD_MAXIMUM_FILTERS = 16

// Most accepted frames requested per filter group.
export const FLAT_WIZARD_MAXIMUM_COUNT = 500

// Most trial frames allowed per filter group.
export const FLAT_WIZARD_MAXIMUM_TRIALS = 20

// Most rejected or inconclusive frames allowed per filter group.
export const FLAT_WIZARD_MAXIMUM_REJECTIONS = 100

// Longest exposure of a Flat Wizard form, in seconds (10 minutes).
export const FLAT_WIZARD_MAXIMUM_EXPOSURE = 600

// Filter group a new row of the Flat Wizard form starts with: the first slot, 20 frames searched from 1 s within [0.01 s, 30 s], aimed
// at 20000–35000 DN, about a third to a half of a 16-bit range; edit the target for cameras of another depth.
export const DEFAULT_FLAT_WIZARD_FILTER: FlatWizardFilter = { slot: 0, count: 20, initialExposure: 1, minimumExposure: 0.01, maximumExposure: 30, targetRange: [20000, 35000] }

// Flat Wizard form of a camera that has none yet: one luminance group, a 2 s settle, and the default limits.
export const DEFAULT_FLAT_WIZARD_SETTINGS: FlatWizardSettings = { filters: [DEFAULT_FLAT_WIZARD_FILTER], settleTime: 2, maximumTrials: 8, maximumRejections: 5 }

// Settle a guiding command waits for: the guide error must stay within a distance for a time, before a timeout.
export interface GuidingSettleSettings {
	// Accepted guide error, in guide-camera pixels; > 0.
	pixels: number
	// Time the error must stay within pixels, in seconds; >= 0.
	time: number
	// Longest settle, in seconds; > 0.
	timeout: number
}

// Guiding form of one physical guide camera: the guide exposures, the controller, and the settle and dither of the
// commands of the next session. The frames take the camera settings of the camera (without its exposure time), which
// this form never holds; the guide output is the GUIDE_OUTPUT of the setup, and the optics the guideTelescope of the
// profile. Controller settings are fixed when a
// session starts; only the exposure changes on a running one.
export interface GuidingSettings {
	// Guide exposure, in seconds, in [GUIDING_MINIMUM_EXPOSURE, GUIDING_MAXIMUM_EXPOSURE].
	exposureTime: number
	// Whether the tracker measures one star or many.
	trackingMode: GuidingStartRequest['trackingMode']
	// Side of the square the guide star is searched in around the lock, in guide-camera pixels, in
	// [GUIDING_MINIMUM_SEARCH_REGION, GUIDING_MAXIMUM_SEARCH_REGION].
	searchRegion: number
	// Whether the lock position stays exactly where it is when the guider re-initializes, instead of following the star.
	stickyLockPosition: boolean
	// Whether Start Guiding calibrates again instead of reusing the calibration solved earlier in the session.
	recalibrate: boolean
	// Duration of each calibration pulse, in milliseconds, in [GUIDING_MINIMUM_PULSE, GUIDING_MAXIMUM_PULSE].
	calibrationPulse: number
	// Proportional gain of the RA corrections, in [0, 1].
	aggressivenessRA: number
	// Proportional gain of the DEC corrections, in [0, 1].
	aggressivenessDEC: number
	// Longest RA correction, in milliseconds, in [GUIDING_MINIMUM_PULSE, GUIDING_MAXIMUM_PULSE].
	maximumPulseRA: number
	// Longest DEC correction, in milliseconds, in [GUIDING_MINIMUM_PULSE, GUIDING_MAXIMUM_PULSE].
	maximumPulseDEC: number
	// Settle of Start Guiding, Resume, and Dither.
	settle: GuidingSettleSettings
	// Size of each dither, in guide-camera pixels; > 0.
	ditherPixels: number
	// Whether a dither moves the RA axis only.
	ditherRaOnly: boolean
	// Pattern of the successive dithers.
	ditherMode: GuidingDitherMode
	// PHD2's fast recenter: whether the RA return of a calibration starts with long pulses instead of calibration steps,
	// and the frames after a dither move the star straight to the new lock instead of leaving it to the corrections.
	fastRecenter: boolean
	// Whether flipping the calibration for a meridian flip also reverses the DEC output, for mounts that do not reverse
	// it themselves.
	reverseDecOutputAfterMeridianFlip: boolean
}

// Pattern of the successive dithers: random offsets, an outward spiral (both as PHD2), a golden-angle spiral, or a grid.
export type GuidingDitherMode = NonNullable<GuidingClientSettings['ditherMode']>

// Smallest side of the star search square, in guide-camera pixels, as the toolkit clamps it.
export const GUIDING_MINIMUM_SEARCH_REGION = 16

// Largest side of the star search square, in guide-camera pixels, as the toolkit clamps it.
export const GUIDING_MAXIMUM_SEARCH_REGION = 128

// Shortest guide exposure of the guiding form, in seconds (10 ms).
export const GUIDING_MINIMUM_EXPOSURE = 0.01

// Longest guide exposure of the guiding form, in seconds (1 minute).
export const GUIDING_MAXIMUM_EXPOSURE = 60

// Shortest calibration pulse or correction ceiling of the guiding form, in milliseconds.
export const GUIDING_MINIMUM_PULSE = 1

// Longest calibration pulse or correction ceiling of the guiding form, in milliseconds (10 s).
export const GUIDING_MAXIMUM_PULSE = 10000

// Guiding form of a camera that has none yet: 2 s exposures on one star, the toolkit's controller defaults (gains 0.7
// and 0.65, ceilings 2000 and 2500 ms, 650 ms calibration pulses), recalibrating on every start, settling within 1.5 px
// for 10 s in at most 60 s, and dithering by 5 px on both axes at random with a fast recenter; the toolkit's 64 px
// search square, a lock that follows the star, and a meridian flip that keeps the DEC output.
export const DEFAULT_GUIDING_SETTINGS: GuidingSettings = {
	exposureTime: 2,
	trackingMode: 'singleStar',
	searchRegion: 64,
	stickyLockPosition: false,
	recalibrate: true,
	calibrationPulse: 650,
	aggressivenessRA: 0.7,
	aggressivenessDEC: 0.65,
	maximumPulseRA: 2000,
	maximumPulseDEC: 2500,
	settle: { pixels: 1.5, time: 10, timeout: 60 },
	ditherPixels: 5,
	ditherRaOnly: false,
	ditherMode: 'random',
	fastRecenter: true,
	reverseDecOutputAfterMeridianFlip: false,
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
