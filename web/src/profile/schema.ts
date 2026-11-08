import type {
	AnnotationBodies,
	ImageProcessingOperation,
	AutoFocusRequest,
	CaptureDither,
	CaptureRequest,
	CloseApproachBody,
	DarkGroup,
	DisplaySettings,
	FlatWizardFilter,
	GuidingClientSettings,
	GuidingStartRequest,
	LiveStackingCalibration,
	LiveStackingRecipe,
	MeridianFlipExecutorPolicy,
	MeridianFlipSettings,
	MountCaptureDither,
	MountRemoteProtocol,
	MountRemoteStartRequest,
	PlateSolveRequest,
	PulseCaptureDither,
	StarDetectionRequest,
	StreakDetectorSettings,
} from 'api'
import type { EquipmentSetup } from '../equipment/roles'
import type { AnnotationDensity, AnnotationLayers } from '../images/images'
import type { DisplayZoneOverride } from '../location/zone'
import type { ImageAstrometrySettings } from '../platesolving/preferences'
import type { WorkspaceId } from '../shell/route'
import type { SkyDisplaySettings } from '../sky/display'
import type { OpticalPreset, SensorGeometry, SensorSource, TelescopeOptics } from '../sky/framing'
import type { StarProfileSettings } from '../stars/starprofile.settings'

// What a profile holds, the defaults of its preferences and camera forms, and the version of the shape of the values the
// server keeps for them. Profiles hold selections and preferences only, never operational device state. Some fields are
// view state: never written to the server, they are kept in browser storage as VIEW_STORAGE of view.ts says.

// Version of the shape of the preferences and camera forms the server keeps (sync.ts). A value of any other version is
// read as absent, never migrated, so a change to the shape of what is kept only raises this number; an added optional
// field, which reads as its default, does not.
export const PROFILE_SETTINGS_VERSION = 5

// Application preferences that belong to a profile. Each preference is added here, with its default in
// defaultSettings when it is not optional, and either kept by the server (PREFERENCES and the camera forms of sync.ts) or
// marked as view state and added to VIEW_FIELDS of view.ts.
export interface ProfileSettings {
	// Whether the contextual panel of each workspace is expanded on wide screens; an absent workspace
	// shows it expanded. Narrow screens open the panel as a drawer. View state.
	panels: Partial<Record<WorkspaceId, boolean>>
	// Server directory an image was opened from last, where the file explorer starts; absent before the
	// first image is opened. View state.
	lastImageDirectory?: string
	// Server directory an image of Images was saved to last, where the save dialog starts; absent before the first save.
	// View state.
	lastSaveDirectory?: string
	// Server directory listed last when directories or files were added to an Image Stacking import, where both choosers
	// start; absent before the first one is added. View state.
	lastStackingDirectory?: string
	// Server directory listed last when directories or files were added to a Calibration Library import, where both
	// choosers start; absent before the first one is added. View state.
	lastCalibrationDirectory?: string
	// How the guiding graph under the camera tabs is shown; absent until changed, and then DEFAULT_GUIDING_GRAPH_VIEW
	// holds. View state.
	guidingGraph?: GuidingGraphView
	// Forms of each physical camera edited so far, by saved connection id, then device id.
	cameras: Record<string, Record<string, CameraSettings>>
	// Targets saved to recover a framing, at most FRAMING_REFERENCES_MAXIMUM; absent until one is saved.
	framingReferences?: readonly FramingReference[]
	// Star detection request edited in Images → Star Detection, shared by every document and by the frames of Auto
	// Focus; absent until edited, and then DEFAULT_STAR_REQUEST holds.
	starDetection?: StarDetectionRequest
	// Settings of the Star Profile Inspector, shared by every document; absent until edited, and then
	// DEFAULT_STAR_PROFILE_SETTINGS holds. The stars it measured are never stored.
	starProfile?: StarProfileSettings
	// Streak detector settings edited in Images → Streak Detection, shared by every document; absent until edited, and
	// then DEFAULT_STREAK_SETTINGS holds. The context jobs of a detection are chosen per document, never stored here.
	streakDetection?: StreakDetectorSettings
	// How Annotation draws and what it searches, which every document opened next starts with; absent until edited, and
	// then DEFAULT_ANNOTATION_PREFERENCES holds. Results and the selected object are never stored.
	imageAnnotation?: AnnotationPreferences
	// Plate solving settings shared by every document outside a camera tab, each of which keeps its own hints; absent until
	// edited, and then DEFAULT_CAMERA_PLATE_SOLVING holds. A camera tab uses those of its camera (CameraSettings plateSolving).
	imagePlateSolving?: CameraPlateSolvingSettings
	// Whether the camera tabs of Images hide their bottom area (the frames carousel or the Focus Curve); absent shows it.
	// View state.
	framesHidden?: boolean
	// Image Processing pipeline edited last, which every document opened next starts with; absent until edited. Tab
	// memory; jobs and their outputs are never stored.
	imageProcessing?: readonly ImageProcessingPresetStep[]
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
	// Settings each Meridian Flip Monitor was last applied with, by saved connection id, then mount id; absent until
	// edited, and then DEFAULT_MERIDIAN_FLIP_SETTINGS holds. A preference only: it never enables, disables, or changes a
	// running monitor, whose settings stay the ones it was enabled or updated with.
	meridianFlipMonitor?: Record<string, Record<string, MeridianFlipSettings>>
	// Policy of the Meridian Flip Executor of each mount, by saved connection id, then mount id; absent until edited, and then
	// DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY holds. A preference only: it never arms, disarms, or changes a running execution,
	// which keeps the policy it was asked with.
	meridianFlipExecutor?: Record<string, Record<string, MeridianFlipExecutorPolicy>>
	// Guide pulse settings of the Mount dithers of each mount, by saved connection id, then mount id; absent until edited,
	// and then DEFAULT_MOUNT_DITHER_SETTINGS holds. A preference only: a running capture keeps the snapshot of its request.
	mountDither?: Record<string, Record<string, MountDitherSettings>>
	// Notifications of the server history the profile read or dismissed; absent until the first one is read. The server
	// keeps one history for every profile and these states for each one (profile_notification_state), which only grow.
	notifications?: NotificationPreferences
	// Appearance of the astrometric aids of solved images in Images (coordinates, grid, crosshair, scale bar, orientation);
	// absent until edited, and then DEFAULT_IMAGE_ASTROMETRY holds. Whether a document shows its grid is the document's.
	imageAstrometry?: ImageAstrometrySettings
	// Preferences of the status bar; absent until edited, and then DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES and
	// DEFAULT_STATUS_CHIPS hold.
	statusBar?: StatusBarPreferences
	// How civil times are shown (Settings → Date & Time); absent until edited, and then DEFAULT_DATE_TIME_PREFERENCES
	// holds. Display only: it never changes an instant or a calculation.
	dateTime?: DateTimePreferences
	// NORAD catalog numbers (canonical decimal strings) of the artificial satellites marked as favorites, in the order they
	// were marked, at most SATELLITE_FAVORITES_MAXIMUM; absent until the first one. A refresh of the satellite catalog never
	// removes one, even when the catalog no longer lists it.
	satelliteFavorites?: readonly string[]
	// Preferences of the Close Approaches tool; absent until edited, and then DEFAULT_CLOSE_APPROACH_PREFERENCES holds. Tab
	// memory, like the results, the selection, and the dates of a search.
	closeApproaches?: CloseApproachPreferences
	// Preferences of the Astro Weather tool; absent until edited, and then DEFAULT_ASTRO_WEATHER_PREFERENCES holds. Tab
	// memory, like the forecasts, the sites typed in, and the night shown.
	astroWeather?: AstroWeatherPreferences
}

// How Annotation draws its results and what its next runs ask for.
export interface AnnotationPreferences {
	// Groups drawn.
	readonly layers: AnnotationLayers
	// Whether the objects are labeled.
	readonly labels: boolean
	// Whether the extent of a deep-sky object of known size is drawn as its outline.
	readonly outlines: boolean
	// Whether the predicted motion of a solar-system object during the exposure is drawn.
	readonly motion: boolean
	// How many labels are placed.
	readonly density: AnnotationDensity
	// Faintest magnitude of the next run.
	readonly magnitudeLimit: number
	// Groups the next solar-system search lists.
	readonly bodies: AnnotationBodies
}

// Annotation of a profile that has not edited it: every group but the constellation names, and the stars of the catalog
// and the brighter deep-sky objects.
export const DEFAULT_ANNOTATION_PREFERENCES: AnnotationPreferences = {
	layers: { stars: true, deepSky: true, solarSystem: true, satellites: true, minorBodies: true, constellations: true, constellationLabels: false },
	labels: true,
	outlines: true,
	motion: true,
	density: 'balanced',
	magnitudeLimit: 12,
	bodies: { solarSystem: true, satellite: true, minorBody: true },
}

// Step of the Image Processing pipeline a profile keeps.
export interface ImageProcessingPresetStep {
	// Whether Run applies it.
	readonly enabled: boolean
	// Operation and its parameters.
	readonly operation: ImageProcessingOperation
}

// Observing modes of the Astro Weather tool, in the order offered.
export const ASTRO_WEATHER_MODES = ['visual', 'deepSky', 'planetary'] as const

// Observing mode of the Astro Weather tool: how a forecast is read, never what it holds.
export type AstroWeatherMode = (typeof ASTRO_WEATHER_MODES)[number]

// Preferences of the Astro Weather tool.
export interface AstroWeatherPreferences {
	// Observing mode chosen last.
	readonly mode: AstroWeatherMode
}

// Preferences of a profile that has not edited them.
export const DEFAULT_ASTRO_WEATHER_PREFERENCES: AstroWeatherPreferences = { mode: 'visual' }

// Target bodies of the Close Approaches tool, in the order offered, every body last.
export const CLOSE_APPROACH_BODIES: readonly CloseApproachBody[] = ['Earth', 'Moon', 'Merc', 'Venus', 'Mars', 'Juptr', 'Satrn', 'Urnus', 'Neptn', 'Pluto', 'ALL']

// Units of a largest distance: AU, or lunar distances.
export const CLOSE_APPROACH_DISTANCE_UNITS = ['LD', 'au'] as const

// Units a distance is shown in.
export const CLOSE_APPROACH_DISTANCE_DISPLAYS = ['LD', 'au', 'km'] as const

// Unit a distance is shown in.
export type CloseApproachDistanceDisplay = (typeof CLOSE_APPROACH_DISTANCE_DISPLAYS)[number]

// Preferences of the Close Approaches tool: how values are shown, and what a new tab searches first.
export interface CloseApproachPreferences {
	// Unit of the distances shown.
	readonly distanceDisplay: CloseApproachDistanceDisplay
	// Zone the times of the encounters are shown in, resolved by resolveDisplayZone against the active observing site:
	// the profile's default (Settings → Date & Time), the site's, UTC, the browser's, or an IANA zone. Display only: it
	// never changes an instant or a request.
	readonly timeDisplay: DisplayZoneOverride
	// Target body of the first search.
	readonly body: CloseApproachBody
	// Largest nominal distance of the first search, in `distanceUnit`, above 0.
	readonly distanceMax: number
	// Unit of `distanceMax`.
	readonly distanceUnit: (typeof CLOSE_APPROACH_DISTANCE_UNITS)[number]
}

// Preferences of a profile that has not edited them: lunar distances, the profile's default zone, and the Earth within
// 10 LD.
export const DEFAULT_CLOSE_APPROACH_PREFERENCES: CloseApproachPreferences = { distanceDisplay: 'LD', timeDisplay: { mode: 'default' }, body: 'Earth', distanceMax: 10, distanceUnit: 'LD' }

// Zones civil times can be shown in by default: the observing site's (the browser's when there is none), UTC, or the
// browser's.
export const DISPLAY_TIME_ZONE_MODES = ['site', 'utc', 'browser'] as const

// Zone civil times are shown in by default.
export type DisplayTimeZoneMode = (typeof DISPLAY_TIME_ZONE_MODES)[number]

// How a profile shows civil times.
export interface DateTimePreferences {
	// Zone of the civil times every screen shows unless a tool overrides it.
	readonly displayTimeZone: DisplayTimeZoneMode
}

// Preferences of a profile that has not edited them: times in the observing site's zone.
export const DEFAULT_DATE_TIME_PREFERENCES: DateTimePreferences = { displayTimeZone: 'site' }

// Readings the status bar clock can show: local apparent and mean sidereal time, Julian and Modified Julian Date in UTC,
// and the UTC and local civil time. All of them are the real current time, never the Sky simulation clock.
export const ASTRONOMICAL_CLOCK_READINGS = ['last', 'lmst', 'jd', 'mjd', 'utc', 'local'] as const

// Reading of the status bar clock.
export type AstronomicalClockReading = (typeof ASTRONOMICAL_CLOCK_READINGS)[number]

// What the status bar clock shows.
export interface AstronomicalClockPreferences {
	// Whether the clock is shown.
	readonly enabled: boolean
	// Reading shown first.
	readonly primary: AstronomicalClockReading
	// Reading shown after it when room is left, never the primary one.
	readonly secondary: AstronomicalClockReading | 'none'
	// Whether time-of-day readings show seconds.
	readonly showSeconds: boolean
}

// Readings the status bar can show for the device of each role, in the order they are shown. The status is what the
// device is doing, such as Slewing, Tracking, or Exposing; the other ones are its measurements.
export const STATUS_CHIP_FIELDS = {
	MAIN_CAMERA: ['status', 'temperature', 'cooler'],
	FILTER_WHEEL: ['status', 'filter'],
	FOCUSER: ['status', 'position', 'temperature'],
	ROTATOR: ['status', 'angle'],
	MOUNT: ['status', 'coordinates'],
	GUIDE_CAMERA: ['status', 'temperature'],
	DOME: ['status', 'shutter', 'azimuth'],
	COVER: ['status'],
	FLAT_PANEL: ['status', 'brightness'],
} as const

// Role with a device chip in the status bar.
export type StatusChipRole = keyof typeof STATUS_CHIP_FIELDS

// Reading of a device chip.
export type StatusChipField = (typeof STATUS_CHIP_FIELDS)[StatusChipRole][number]

// What the status bar shows for the device of a role.
export interface StatusChipPreferences {
	// Whether the device has a chip at all.
	readonly visible: boolean
	// Readings shown after the icon; none shows the icon alone.
	readonly fields: readonly StatusChipField[]
}

// Chips of a profile that has not edited them: every device, with its status and main measurement.
export const DEFAULT_STATUS_CHIPS: Readonly<Record<StatusChipRole, StatusChipPreferences>> = {
	MAIN_CAMERA: { visible: true, fields: ['status', 'temperature'] },
	FILTER_WHEEL: { visible: true, fields: ['status', 'filter'] },
	FOCUSER: { visible: true, fields: ['status', 'position'] },
	ROTATOR: { visible: true, fields: ['status', 'angle'] },
	MOUNT: { visible: true, fields: ['status'] },
	GUIDE_CAMERA: { visible: true, fields: ['status'] },
	DOME: { visible: true, fields: ['status', 'shutter'] },
	COVER: { visible: true, fields: ['status'] },
	FLAT_PANEL: { visible: true, fields: ['status'] },
}

// Preferences of the status bar.
export interface StatusBarPreferences {
	// What the clock shows.
	readonly astronomicalClock: AstronomicalClockPreferences
	// What each role shows; a role absent here has its DEFAULT_STATUS_CHIPS.
	readonly chips?: Readonly<Partial<Record<StatusChipRole, StatusChipPreferences>>>
}

// Clock of a profile that has not edited it: the local apparent sidereal time, with seconds.
export const DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES: AstronomicalClockPreferences = { enabled: true, primary: 'last', secondary: 'none', showSeconds: true }

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

// Settings of a Meridian Flip Monitor before any were applied, the defaults of the server: warn 15 minutes before the
// transit, a preferred window from 5 to 15 minutes after it, the deadline near 3 minutes before it closes, and 2 seconds
// to settle. Wall-clock seconds.
export const DEFAULT_MERIDIAN_FLIP_SETTINGS: MeridianFlipSettings = { earlyWarningSeconds: 900, minimumSeconds: 300, maximumSeconds: 900, deadlineWarningSeconds: 180, settleSeconds: 2 }

// Policy of a Meridian Flip Executor before any was edited, the defaults of the server: the driver's own flip when it has
// one, recentering, no Auto Focus, 5 seconds of mount settle, and no inference without the operator's consent.
export const DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY: MeridianFlipExecutorPolicy = { strategy: 'auto', recenterAfterFlip: true, autofocusAfterFlip: false, mountSettleSeconds: 5, allowInferredVerification: false, allowInferredAutoResume: false, treatUnknownMountAsGem: false }

// Largest early warning and window offset the server accepts, in wall-clock seconds: 6 sidereal hours
// (MAXIMUM_OFFSET_SECONDS of the server).
export const MERIDIAN_FLIP_MAXIMUM_SECONDS = 21541

// Sky preferences of a profile. Where the Sky observes from is the profile's observing site (Profile.activeSiteId).
export interface SkySettings {
	// What the star map shows; absent until the user changes a preference, and then every default holds.
	display?: SkyDisplaySettings
	// Field of view drawn around the selection; absent until the user creates a preset.
	framing?: SkyFramingSettings
	// Whether the time bar of the simulation clock is shown under the star map; absent hides it. View state.
	timeBar?: boolean
}

// Field of view preferences of the Sky workspace: custom optical presets, independent of the equipment
// setup, which one is drawn, and how the Equipment Setup source builds its field.
export interface SkyFramingSettings {
	// Presets in display order.
	presets: readonly OpticalPreset[]
	// Id of the preset drawn; absent when there is none. View state.
	activePresetId?: string
	// Whether the field of view is drawn on the map. View state.
	visible: boolean
	// Where the drawn field comes from: a custom preset, or the Equipment Setup; absent means custom. View state.
	source?: 'custom' | 'equipment'
	// Sensor of the Equipment Setup source; absent means the main camera. View state.
	sensorSource?: SensorSource
	// Sensor entered for the Equipment Setup source when sensorSource is manual, to simulate a camera.
	manualSensor?: SensorGeometry
	// Position angle of the Equipment Setup field's top edge in degrees, from north towards east, [0, 360);
	// absent means 0.
	equipmentRotation?: number
}

// Exposure and camera settings of one physical camera, edited in Camera Acquisition. The other operations that take
// its frames share the camera settings, with an exposure time of their own or none; each operation fits them to the
// camera's capabilities when it starts and keeps that snapshot while it runs, so editing them never changes a running
// operation. Exposure time in seconds; subframe in pixels of the unbinned sensor.
export type CameraExposureSettings = Pick<CaptureRequest, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Exposure and camera settings of a camera that has none yet: a 1 s exposure at the driver's defaults, unbinned, on
// the whole sensor.
export const DEFAULT_EXPOSURE_SETTINGS: CameraExposureSettings = { exposureTime: 1, gain: 0, offset: 0, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '' }

// Camera Acquisition form of one physical camera besides its exposure: the acquisition mode, the frame type, the output
// the next capture starts with, and its dithering. Delay in seconds.
export interface CameraAcquisitionSettings extends Pick<CaptureRequest, 'exposureMode' | 'count' | 'delay' | 'frameType' | 'output'> {
	// Automatic dithering of the fixed and loop LIGHT captures; absent until edited, and then DEFAULT_DITHER_SETTINGS holds.
	// Kept while a single exposure or another frame type is selected, which never dither.
	dither?: CameraDitherSettings
}

// Dithering preferences of the Camera Acquisition form. A Guided dither takes its amount, RA only, and settle from the
// Guiding form of the setup's guide camera, and pulses take their directions and limit from the mount (MountDitherSettings);
// what a running capture uses is the snapshot of its request.
export interface CameraDitherSettings {
	// Whether the next fixed or loop LIGHT capture dithers.
	enabled: boolean
	// Frames taken between two dithers, an integer in [1, DITHER_MAXIMUM_EVERY_FRAMES].
	everyFrames: number
	// Whether the guiding session of the guide camera dithers, or the capture moves the unguided mount itself.
	method: CaptureDither['method']
	// How a Mount dither moves the mount: guide pulses, or a small GoTo.
	movement: MountCaptureDither['movement']
	// Size of each Mount dither on the sky, in arcseconds, in [DITHER_MINIMUM_AMOUNT, DITHER_MAXIMUM_AMOUNT].
	amount: number
	// Whether each Mount dither moves the RA axis only.
	raOnly: boolean
	// Pattern of the successive Mount dithers.
	pattern: MountCaptureDither['pattern']
	// Mechanical settle after each Mount dither, in seconds, in [0, DITHER_MAXIMUM_SETTLE].
	settleTime: number
}

// Largest number of frames between two dithers of the form.
export const DITHER_MAXIMUM_EVERY_FRAMES = 1000

// Smallest Mount dither of the form, in arcseconds.
export const DITHER_MINIMUM_AMOUNT = 0.1

// Largest Mount dither of the form, in arcseconds (2 arcminutes).
export const DITHER_MAXIMUM_AMOUNT = 120

// Longest mechanical settle of the form, in seconds.
export const DITHER_MAXIMUM_SETTLE = 120

// Dithering of a camera that has none yet: off; when enabled, every 3 frames through the guiding session, or for a
// Mount dither by guide pulses of 10″ at random on both axes followed by a 5 s settle.
export const DEFAULT_DITHER_SETTINGS: CameraDitherSettings = { enabled: false, everyFrames: 3, method: 'guided', movement: 'pulse', amount: 10, raOnly: false, pattern: 'random', settleTime: 5 }

// Guide pulse settings of the Mount dithers of one mount: the guide direction that moves the mount toward a positive
// (east) right ascension and a positive (north) declination offset, which no calibration measures, so the nominal
// convention of the mount's commands holds until the operator reverses one, and the longest pulse of one axis in
// milliseconds.
export interface MountDitherSettings {
	// Guide direction moving the mount toward a positive (east) right ascension offset.
	rightAscensionDirection: PulseCaptureDither['rightAscensionDirection']
	// Guide direction moving the mount toward a positive (north) declination offset.
	declinationDirection: PulseCaptureDither['declinationDirection']
	// Longest pulse of one axis, in milliseconds, in [GUIDING_MINIMUM_PULSE, GUIDING_MAXIMUM_PULSE].
	maxPulseDuration: number
}

// Guide pulse settings of a mount that has none yet: the nominal convention of the mount's commands, East for a positive
// right ascension and North for a positive declination, and pulses of at most 5 s.
export const DEFAULT_MOUNT_DITHER_SETTINGS: MountDitherSettings = { rightAscensionDirection: 'EAST', declinationDirection: 'NORTH', maxPulseDuration: 5000 }

// Camera Acquisition form of a camera that has none yet: one light frame, previewed and saved in the server's default
// directory with the server's default names, as FITS.
export const DEFAULT_ACQUISITION_SETTINGS: CameraAcquisitionSettings = { exposureMode: 'single', count: 10, delay: 0, frameType: 'LIGHT', output: { mode: 'preview-save', format: 'FITS' } }

// Plate solving settings of one physical camera, shared by Images → Plate Solver on its camera tab and by the operations
// that solve its frames. They hold how to solve, never where: positional hints stay with each image or come from the
// operation. Scale tolerance is a fraction of the scale, which only nova takes.
export type CameraPlateSolvingSettings = Pick<PlateSolveRequest, 'provider' | 'strategy' | 'downsample' | 'scaleTolerance'>

// Plate solving settings of a camera that has none yet: ASTAP around the header pointing.
export const DEFAULT_CAMERA_PLATE_SOLVING: CameraPlateSolvingSettings = { provider: 'astap', strategy: 'assisted' }

// Forms of one physical camera; a form not edited yet is absent and its defaults apply.
export interface CameraSettings {
	// Exposure and camera settings shared by the operations of the camera.
	exposure?: CameraExposureSettings
	// Camera Acquisition form.
	acquisition?: CameraAcquisitionSettings
	// Plate solving settings shared by the operations of the camera.
	plateSolving?: CameraPlateSolvingSettings
	// Auto Focus form.
	autoFocus?: AutoFocusSettings
	// TPPA form.
	tppa?: TppaSettings
	// Pointing Model Builder form.
	pointingModel?: PointingModelSettings
	// Target Centering form; absent until edited, and then DEFAULT_TARGET_CENTERING_SETTINGS holds.
	targetCentering?: TargetCenteringSettings
	// DARV form.
	darv?: DarvSettings
	// Flat Wizard form.
	flatWizard?: FlatWizardSettings
	// Dark Library Wizard form.
	darkLibraryWizard?: DarkLibraryWizardSettings
	// Live Stacking form.
	liveStacking?: LiveStackingSettings
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
// camera settings of the camera and measured with the star detection request of the profile, which this form never
// holds. Durations are in seconds, positions in focuser steps.
export interface AutoFocusSettings {
	// Exposure of each frame, in seconds; > 0.
	exposureTime: number
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

// Auto Focus form of a camera that has none yet: 1 s frames and a hyperbolic fit over 4 positions on each side.
export const DEFAULT_AUTO_FOCUS_SETTINGS: AutoFocusSettings = {
	exposureTime: 1,
	fittingMode: 'HYPERBOLIC',
	initialOffsetSteps: 4,
	reversed: false,
	rmsdThreshold: 0,
	settleDelay: 0,
	measureTimeout: 60,
	restoreOnStop: true,
}

// TPPA form of one physical camera: how the next three-point polar alignment moves the mount. The frames are taken with
// the camera settings and solved with the plate solving settings of the camera, which this form never holds. Angles are
// in degrees and durations in seconds, as edited.
export interface TppaSettings {
	// Exposure of each frame, in seconds; > 0.
	exposureTime: number
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
	// Whether the tracking the session starts on a mount that was not tracking is stopped when the session ends.
	stopTracking: boolean
}

// Smallest RA rotation of the TPPA form, in degrees: the least rotation the server accepts between two poses.
export const TPPA_MINIMUM_ROTATION = 6

// Largest RA rotation of the TPPA form, in degrees: two steps stay within the 30° of total motion the server allows.
export const TPPA_MAXIMUM_ROTATION = 15

// TPPA form of a camera that has none yet: 1 s frames and westward motions of 8°.
export const DEFAULT_TPPA_SETTINGS: TppaSettings = {
	exposureTime: 1,
	direction: 'WEST',
	rotation: 8,
	settleDelay: 2,
	refinementDelay: 1,
	stopTracking: true,
}

// Pointing Model Builder form of one physical camera: the sky the next mount pointing session samples. The frames are taken
// with the camera settings and solved with the plate solving settings of the camera, which this form never holds. Angles
// are in degrees and durations in seconds, as edited.
export interface PointingModelSettings {
	// Exposure of each frame, in seconds; > 0.
	exposureTime: number
	// Pattern of the waypoints.
	pattern: 'goldenSpiral' | 'altAzGrid'
	// Number of waypoints asked for, in [POINTING_MODEL_MINIMUM_POINTS, POINTING_MODEL_MAXIMUM_POINTS].
	count: number
	// Lowest altitude of a waypoint, in degrees.
	minimumAltitude: number
	// Hour angle half width left free around the meridian, in degrees; >= 0.
	meridianAvoidance: number
	// Wait after the mount stopped and before each exposure, in seconds; >= 0.
	settleDelay: number
	// Whether the tracking the session starts on a mount that was not tracking is stopped when the session ends.
	stopTracking: boolean
}

// Fewest waypoints of the Pointing Model Builder form.
export const POINTING_MODEL_MINIMUM_POINTS = 6

// Most waypoints of the Pointing Model Builder form.
export const POINTING_MODEL_MAXIMUM_POINTS = 120

// Starting points of the number of waypoints, not scientific guarantees.
export const POINTING_MODEL_PRESETS = [
	{ label: 'Quick', count: 20 },
	{ label: 'Standard', count: 30 },
	{ label: 'Advanced', count: 60 },
] as const

// Pointing Model Builder form of a camera that has none yet: 30 waypoints on a golden spiral above 25°.
export const DEFAULT_POINTING_MODEL_SETTINGS: PointingModelSettings = { exposureTime: 5, pattern: 'goldenSpiral', count: 30, minimumAltitude: 25, meridianAvoidance: 5, settleDelay: 2, stopTracking: true }

// Target Centering form of one physical camera. The frames take the camera settings of the camera, which this form never
// holds, and its solver settings; the target being edited is kept for the tab only (view.ts), and only a saved framing lasts.
export interface TargetCenteringSettings {
	// Exposure of each frame, in seconds; > 0.
	exposureTime: number
	// Accepted distance between the solved center and the target, in arcseconds.
	tolerance: number
	// Corrections allowed.
	maximumCorrections: number
	// Exposures repeated at one position after a frame without a solution.
	noSolutionRetries: number
	// Frames allowed, failed solves included.
	maximumFrames: number
	// Wait after each motion and before the next exposure, in seconds.
	settleDelay: number
	// Largest correction a session makes by itself, in degrees.
	maximumCorrection: number
	// Whether a frame an assisted solve left without a solution is searched again over the whole sky, with the same provider.
	blindRetry: boolean
	// Whether guiding that is correcting the mount is stopped for the session and restored after, recalibrating; otherwise it
	// refuses the start.
	coordinateGuiding: boolean
	// Saved framing selected; absent when the target is not one.
	framingId?: string
}

// Bounds of the Target Centering form, [minimum, maximum], in the units of each field.
export const TARGET_CENTERING_LIMITS = { tolerance: [1, 3600], maximumCorrections: [1, 10], noSolutionRetries: [0, 5], maximumFrames: [1, 30], settleDelay: [0, 120], maximumCorrection: [0.1, 10] } as const

// Target Centering form of a camera that has none yet; the values are provisional starting points.
export const DEFAULT_TARGET_CENTERING_SETTINGS: TargetCenteringSettings = { exposureTime: 3, tolerance: 30, maximumCorrections: 4, noSolutionRetries: 1, maximumFrames: 10, settleDelay: 2, maximumCorrection: 1, blindRetry: false, coordinateGuiding: true }

// Target saved to recover a framing. It is a definition, never a reference to an image, so it outlives any frame.
export interface FramingReference {
	// Id of the framing, unique across every profile: the server keeps each framing as a row keyed by it.
	id: string
	// Name of the framing, not blank.
	name: string
	// Right ascension, J2000, in radians, in [0, 2π).
	rightAscension: number
	// Declination, J2000, in radians, in [−π/2, π/2].
	declination: number
	// Where the coordinates came from: typed, or a catalog object of Sky.
	source: 'manual' | 'sky'
	// When it was saved, Unix milliseconds.
	createdAt: number
	// When it was last changed, Unix milliseconds.
	updatedAt: number
}

// Most framings a profile keeps.
export const FRAMING_REFERENCES_MAXIMUM = 128

// Most artificial satellites a profile keeps as favorites.
export const SATELLITE_FAVORITES_MAXIMUM = 500

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

// Live Stacking form of one physical camera: the integration recipe and the masters chosen per filter of the next
// session it starts. The recipe is locked into the stacks of a session; a change of masters during a session starts
// other stacks for the frames that follow.
export interface LiveStackingSettings {
	readonly recipe: LiveStackingRecipe
	readonly calibration: LiveStackingCalibration
}

// Live Stacking form of a camera that has none yet: the permissive recipe of the server, no masters, and the frames
// of every filter integrated uncalibrated.
export const DEFAULT_LIVE_STACKING_SETTINGS: LiveStackingSettings = {
	recipe: { method: 'average', weighting: 'quality', normalization: 'background-scale', interpolation: 'bilinear', minStars: 6, minOverlap: 0.25 },
	calibration: { filters: {}, otherwise: 'uncalibrated' },
}

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
	// Whether the Calibration Library builds a master flat of each completed filter after the acquisition; absent is off.
	generateMasters?: boolean
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

// Effective clipping level the Flat Wizard form proposes once the operator declares one, in DN: under the 65520 and
// 65532 DN at which left-aligned 12-bit and 14-bit cameras top out in a 16-bit file, which a limit of 65535 would miss.
export const DEFAULT_FLAT_WIZARD_EFFECTIVE_CLIP = 65000

// Flat Wizard form of a camera that has none yet: one luminance group, a 2 s settle, and the default limits.
export const DEFAULT_FLAT_WIZARD_SETTINGS: FlatWizardSettings = { filters: [DEFAULT_FLAT_WIZARD_FILTER], settleTime: 2, maximumTrials: 8, maximumRejections: 5 }

// Dark Library Wizard form of one physical camera: the groups of the next plan and how it protects the sensor. The gain,
// offset, binning, subframe, and readout mode come from Camera Acquisition; the wheel, panel, and cover are those of the
// setup. A plan keeps its own copy of all this, so editing the form never changes a plan, and no progress of a plan is
// kept here.
export interface DarkLibraryWizardSettings {
	// Groups of frames, in acquisition order; exposures in seconds, temperatures in degrees Celsius.
	groups: readonly DarkGroup[]
	// Whether the wheel moves to a dark slot.
	useDarkFilter: boolean
	// Dark slot of the wheel, 0-based.
	darkSlot: number
	// Whether the dust cover closes.
	closeCover: boolean
	// Whether the flat panel light is switched off.
	panelOff: boolean
	// Whether the operator confirms a manual opaque cap.
	manualCap: boolean
	// Whether a suspicion of light on the first frame of a group stops for a decision.
	verifyFirstFrame: boolean
	// Largest distance from a target temperature, in degrees Celsius; positive.
	tolerance: number
	// Time the sensor must stay inside the tolerance, in seconds.
	hold: number
	// Longest wait for a stable temperature, in seconds.
	timeout: number
	// Absolute server directory the frames are saved under; absent uses the server's default captures directory.
	directory?: string
	// Rejected frames allowed per group, in [0, DARK_LIBRARY_WIZARD_MAXIMUM_REJECTIONS].
	maximumRejections: number
	// Whether the frames are dark-flats for the flats of the same exposure; absent takes ordinary darks.
	purpose?: 'darkFlat'
	// Whether the Calibration Library builds the masters of complete groups after the acquisition; absent is off.
	generateMasters?: boolean
}

// Most groups of a plan. A matrix grows fast, and each group is a directory and a thermal stage of a run.
export const DARK_LIBRARY_WIZARD_MAXIMUM_GROUPS = 64

// Most accepted frames requested per group.
export const DARK_LIBRARY_WIZARD_MAXIMUM_COUNT = 500

// Most accepted frames of a plan, which keeps a mistyped matrix from filling a disk.
export const DARK_LIBRARY_WIZARD_MAXIMUM_FRAMES = 20000

// Most rejected frames allowed per group.
export const DARK_LIBRARY_WIZARD_MAXIMUM_REJECTIONS = 100

// Group a new row of the Dark Library Wizard form starts with.
export const DEFAULT_DARK_LIBRARY_WIZARD_GROUP: DarkGroup = { exposure: 60, count: 30 }

// Dark Library Wizard form of a camera that has none yet: common exposures of 30 frames, protected by a manual
// cap, since no device may be assigned. Tolerance, hold, and timeout are provisional defaults of ±0.5 °C, 2 min, and 30 min.
export const DEFAULT_DARK_LIBRARY_WIZARD_SETTINGS: DarkLibraryWizardSettings = {
	groups: [60, 120, 180, 300].map((exposure) => ({ exposure, count: DEFAULT_DARK_LIBRARY_WIZARD_GROUP.count })),
	useDarkFilter: false,
	darkSlot: 0,
	closeCover: false,
	panelOff: false,
	manualCap: true,
	verifyFirstFrame: true,
	tolerance: 0.5,
	hold: 120,
	timeout: 1800,
	maximumRejections: 5,
}

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
	// Whether Start Guiding without a calibration restores the best saved calibration of the same equipment and geometry,
	// transformed for the declination and side of the pier the mount reports, instead of calibrating.
	autoRestoreCalibration: boolean
	// Whether every Start Guiding calibrates again, ignoring the calibration in use and the saved ones.
	recalibrateOnEveryStart: boolean
	// Whether a calibration reused at another declination has its RA response scaled by the cosine of the declination;
	// off for a mount whose RA guide rate already follows the declination.
	declinationCompensation: boolean
	// Whether a calibration solves DEC perpendicular to the measured RA axis instead of the measured DEC axis.
	assumeDecOrthogonalToRa: boolean
	// Whether guiding stops when the mount slews, parks or homes while guiding, which only something outside the
	// application can command then.
	stopGuidingOnSlew: boolean
	// Whether the best matching master dark of the Calibration Library is subtracted from the guide frames before their
	// stars are detected.
	useCalibrationLibraryDark: boolean
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
	// Adaptive compensation of the DEC backlash on reversals: whether it is on, the estimate it starts from and its
	// largest value, in milliseconds (0 <= initial <= maximum), and the fraction of the residual error it learns by, in [0, 1].
	decBacklash: GuidingDecBacklashSettings
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

// How the guiding graph under the camera tabs is shown.
export interface GuidingGraphView {
	// The errors of the latest guide steps along time (history), or around the lock (target).
	readonly mode: 'history' | 'target'
	// Latest guide steps the target shows, one of GUIDING_TARGET_POINTS.
	readonly points: number
}

// Numbers of latest guide steps the target of the guiding graph can show.
export const GUIDING_TARGET_POINTS = [25, 50, 100, 250, 500] as const

// Guiding graph of a profile that never changed it: the history, and 100 steps on the target.
export const DEFAULT_GUIDING_GRAPH_VIEW: GuidingGraphView = { mode: 'history', points: 100 }

// Adaptive DEC backlash compensation of the guiding form.
export interface GuidingDecBacklashSettings {
	// Whether the compensation is on.
	readonly enabled: boolean
	// Estimate it starts from, in milliseconds; within [0, maximumMs].
	readonly initialMs: number
	// Largest compensation of one pulse, in milliseconds; >= 0.
	readonly maximumMs: number
	// Fraction of the residual error of a reversal it learns by, within [0, 1].
	readonly adaptationRate: number
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
// and 0.65, ceilings 2000 and 2500 ms, no DEC backlash compensation, 650 ms calibration pulses), restoring a matching saved calibration with declination
// compensation and calibrating only without one, DEC solved as measured, stopping when the mount slews, subtracting a matching master dark, settling within 1.5 px
// for 10 s in at most 60 s, and dithering by 5 px on both axes at random with a fast recenter; the toolkit's 64 px
// search square, a lock that follows the star, and a meridian flip that keeps the DEC output.
export const DEFAULT_GUIDING_SETTINGS: GuidingSettings = {
	exposureTime: 2,
	trackingMode: 'singleStar',
	searchRegion: 64,
	stickyLockPosition: false,
	autoRestoreCalibration: true,
	recalibrateOnEveryStart: false,
	declinationCompensation: true,
	assumeDecOrthogonalToRa: false,
	stopGuidingOnSlew: true,
	useCalibrationLibraryDark: true,
	calibrationPulse: 650,
	aggressivenessRA: 0.7,
	aggressivenessDEC: 0.65,
	maximumPulseRA: 2000,
	maximumPulseDEC: 2500,
	decBacklash: { enabled: false, initialMs: 0, maximumMs: 1000, adaptationRate: 0.3 },
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
	// Id of the observing site (location/site.ts) the profile observes from; absent when none is selected, and then
	// nothing assumes a place. Selecting one never commands a device.
	activeSiteId?: string
	// Equipment setup of each saved connection the profile has used, keyed by saved connection id. Only
	// the setup of connectionId is active; the others are restored when that connection is selected again.
	equipment: Record<string, EquipmentSetup>
	// Preferences of the profile.
	settings: ProfileSettings
}

// Returns the default preferences of a new profile.
export function defaultSettings(): ProfileSettings {
	return { panels: {}, cameras: {}, sky: {} }
}
