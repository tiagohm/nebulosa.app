import { describe, expect, test } from 'bun:test'
import { proxy, snapshot } from 'valtio'
// oxfmt-ignore
import { DEFAULT_STAR_PROFILE_SETTINGS } from '../stars/starprofile.settings'
import type { DisplaySettings } from 'api'
import { ORIGINAL_DISPLAY_SETTINGS } from '../images/display'
import { createOperation } from '../images/imageprocessing.catalog'
import { DEFAULT_IMAGE_ASTROMETRY } from '../platesolving/preferences'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import { DEFAULT_STREAK_SETTINGS } from '../streaks/streaks'
import {
	meridianFlipSettings,
	ditherSettings,
	mountDitherSettings,
	setDitherSettings,
	setMountDitherSettings,
	mountRemoteBinding,
	satelliteFavorites,
	setMeridianFlipSettings,
	setSatelliteFavorite,
	setMountRemoteBinding,
	acquisitionSettings,
	activeProfile,
	astronomicalClockPreferences,
	astroWeatherPreferences,
	closeApproachPreferences,
	setAstroWeatherPreferences,
	setCloseApproachPreferences,
	setAstronomicalClockPreferences,
	setStatusChipPreferences,
	statusChipPreferences,
	activeSetup,
	assignDevice,
	autoFocusSettings,
	exposureSettings,
	profileCamera,
	setAutoFocusSettings,
	setExposureSettings,
	setTppaSettings,
	setCameraPlateSolving,
	tppaSettings,
	darvSettings,
	flatWizardSettings,
	guidingSettings,
	setDarvSettings,
	setFlatWizardSettings,
	setGuidingSettings,
	createOpticalPreset,
	createProfile,
	deleteOpticalPreset,
	deleteProfile,
	duplicateOpticalPreset,
	duplicateProfile,
	forgetConnection,
	newProfile,
	panelOpen,
	type ProfileState,
	rememberDeviceNames,
	renameProfile,
	selectConnection,
	selectOpticalPreset,
	selectProfile,
	setAcquisitionSettings,
	setEquipmentRotation,
	setFramingSource,
	setFramingVisible,
	setLastImageDirectory,
	setLastSaveDirectory,
	setLastCalibrationDirectory,
	setLastStackingDirectory,
	annotationPreferences,
	cameraPlateSolving,
	imagePlateSolving,
	imageProcessingPipeline,
	setAnnotationPreferences,
	setImagePlateSolving,
	setImageProcessingPipeline,
	setManualSensor,
	setPanelOpen,
	setSensorSource,
	setSkyLayerVisible,
	setSkyTimeBarVisible,
	setSkyMagnitudeLimit,
	setDateTimePreferences,
	dateTimePreferences,
	setStarDetectionSettings,
	setStreakDetectionSettings,
	setImageAstrometrySettings,
	imageAstrometrySettings,
	setGuideTelescopeOptics,
	setTelescopeOptics,
	starDetectionSettings,
	starProfileSettings,
	setStarProfileSettings,
	streakDetectionSettings,
	updateOpticalPreset,
	imageDisplaySettings,
	setImageDisplaySettings,
	dismissNotifications,
	markNotificationsRead,
	pruneNotificationPreferences,
	deleteFramingReference,
	framingReferences,
	renameFramingReference,
	saveFramingReference,
	setTargetCenteringSettings,
	targetCenteringSettings,
} from './profile'
import {
	DEFAULT_AUTO_FOCUS_SETTINGS,
	DEFAULT_CAMERA_PLATE_SOLVING,
	DEFAULT_EXPOSURE_SETTINGS,
	DEFAULT_ACQUISITION_SETTINGS,
	DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES,
	DEFAULT_ANNOTATION_PREFERENCES,
	DEFAULT_DARV_SETTINGS,
	DEFAULT_STATUS_CHIPS,
	DEFAULT_FLAT_WIZARD_FILTER,
	DEFAULT_FLAT_WIZARD_SETTINGS,
	DEFAULT_GUIDING_SETTINGS,
	DEFAULT_MERIDIAN_FLIP_SETTINGS,
	DEFAULT_DITHER_SETTINGS,
	DEFAULT_MOUNT_DITHER_SETTINGS,
	DEFAULT_MOUNT_REMOTE_BINDINGS,
	DEFAULT_TPPA_SETTINGS,
	DEFAULT_TARGET_CENTERING_SETTINGS,
	FRAMING_REFERENCES_MAXIMUM,
	type FramingReference,
	DEFAULT_ASTRO_WEATHER_PREFERENCES,
	DEFAULT_CLOSE_APPROACH_PREFERENCES,
	SATELLITE_FAVORITES_MAXIMUM,
	type MountDitherSettings,
} from './schema'

function dev(id: string) {
	return { id, name: `${id} name` }
}

function newState(): ProfileState {
	return proxy<ProfileState>({ profiles: [], activeId: '', open: false })
}

function load() {
	const state = newState()
	state.profiles = [newProfile('Default')]
	state.activeId = state.profiles[0].id
	return state
}

describe('management', () => {
	test('create, rename, duplicate, and delete', () => {
		const state = load()
		const original = state.profiles[0]

		expect(createProfile(state, '  ')).toBeUndefined()
		const deep = createProfile(state, ' Deep Sky ')!
		expect(deep.name).toBe('Deep Sky')
		expect(deep.connectionId).toBeUndefined()

		expect(renameProfile(state, deep.id, '')).toBeFalse()
		expect(renameProfile(state, deep.id, 'Planetary')).toBeTrue()
		expect(state.profiles[1]).toMatchObject({ id: deep.id, name: 'Planetary' })

		expect(state.profiles.map((p) => p.name)).toEqual(['Default', 'Planetary'])
		expect(original.id).toBe(state.activeId)
	})

	test('a duplicate is independent of its source', () => {
		const state = load()
		selectConnection(state, 'conn')
		assignDevice(state, 'MOUNT', dev('mount-1'))
		const source = activeProfile(state)
		const copy = duplicateProfile(state, source.id)!

		expect(copy.id).not.toBe(source.id)
		expect(copy).toMatchObject({ name: 'Default (copy)', connectionId: 'conn', equipment: { conn: { MOUNT: dev('mount-1') } } })

		assignDevice(state, 'MOUNT', dev('mount-2'))
		expect(state.profiles[1].equipment.conn.MOUNT).toEqual(dev('mount-1'))
	})

	test('a duplicate gives its framing references ids of their own', () => {
		const state = load()
		const source = activeProfile(state)
		source.settings.framingReferences = [{ id: 'm31', name: 'M31', rightAscension: 0.18, declination: 0.72, source: 'manual', createdAt: 1, updatedAt: 1 }]
		const copy = duplicateProfile(state, source.id)!

		expect(copy.settings.framingReferences).toHaveLength(1)
		expect(copy.settings.framingReferences![0]).toMatchObject({ name: 'M31', rightAscension: 0.18, declination: 0.72 })
		expect(copy.settings.framingReferences![0].id).not.toBe('m31')
		expect(source.settings.framingReferences[0].id).toBe('m31')
	})

	test('the last profile cannot be deleted; deleting the active one selects another', () => {
		const state = load()
		const first = state.profiles[0].id

		expect(deleteProfile(state, first)).toBeFalse()

		const second = createProfile(state, 'Second')!
		selectProfile(state, second.id)
		expect(deleteProfile(state, second.id)).toBeTrue()
		expect(state.activeId).toBe(first)
	})
})

describe('equipment', () => {
	test('each connection keeps its own setup', () => {
		const state = load()

		expect(assignDevice(state, 'MOUNT', dev('m'))).toEqual({ ok: false, reason: 'no-connection' })

		selectConnection(state, 'indi')
		assignDevice(state, 'MAIN_CAMERA', dev('cam-indi'))
		selectConnection(state, 'sim')
		expect(activeSetup(activeProfile(state))).toEqual({})
		assignDevice(state, 'MAIN_CAMERA', dev('cam-sim'))

		selectConnection(state, 'indi')
		expect(activeSetup(activeProfile(state))).toEqual({ MAIN_CAMERA: dev('cam-indi') })
	})

	test('main and guide camera cannot share a device', () => {
		const state = load()
		selectConnection(state, 'c')

		expect(assignDevice(state, 'MAIN_CAMERA', dev('cam'))).toEqual({ ok: true })
		expect(assignDevice(state, 'GUIDE_CAMERA', dev('cam'))).toEqual({ ok: false, reason: 'conflict', role: 'MAIN_CAMERA' })
		expect(assignDevice(state, 'GUIDE_CAMERA', dev('cam-2'))).toEqual({ ok: true })
		expect(assignDevice(state, 'MAIN_CAMERA', undefined)).toEqual({ ok: true })
		expect(activeSetup(activeProfile(state))).toEqual({ GUIDE_CAMERA: dev('cam-2') })
	})

	test('missing assignment names are filled from the listed devices', () => {
		const state = load()
		selectConnection(state, 'c')
		activeProfile(state).equipment.c = { MOUNT: { id: 'm', name: '' }, FOCUSER: { id: 'gone', name: '' }, MAIN_CAMERA: dev('cam') }

		rememberDeviceNames(state, [
			{ id: 'm', name: 'EQ6-R' },
			{ id: 'cam', name: 'other' },
		])

		expect(activeSetup(activeProfile(state))).toEqual({ MOUNT: { id: 'm', name: 'EQ6-R' }, FOCUSER: { id: 'gone', name: '' }, MAIN_CAMERA: dev('cam') })
	})

	test('a removed connection is forgotten by every profile', () => {
		const state = load()
		selectConnection(state, 'gone')
		assignDevice(state, 'MOUNT', dev('m'))
		const other = createProfile(state, 'Other')!
		other.equipment.gone = { FOCUSER: dev('f') }
		other.connectionId = 'kept'

		forgetConnection(state, 'gone')

		expect(state.profiles[0].connectionId).toBeUndefined()
		expect(state.profiles[0].equipment).toEqual({})
		expect(state.profiles[1]).toMatchObject({ connectionId: 'kept', equipment: {} })
	})
})

describe('settings', () => {
	test('panels are expanded by default and persisted per profile', () => {
		const state = load()

		expect(panelOpen(state.profiles[0].settings, 'images')).toBe(true)
		setPanelOpen(state, 'images', true)

		setPanelOpen(state, 'images', false)
		const other = createProfile(state, 'Other')!

		expect(panelOpen(state.profiles[0].settings, 'images')).toBe(false)
		expect(panelOpen(other.settings, 'images')).toBe(true)
	})

	test('remembers the last image directory', () => {
		const state = load()
		setLastImageDirectory(state, '/data/m31')
		expect(state.profiles[0].settings.lastImageDirectory).toBe('/data/m31')
	})

	test('remembers the last save directory per profile, apart from the one images are opened from', () => {
		const state = load()
		setLastImageDirectory(state, '/data/m31')
		setLastSaveDirectory(state, '/out/processed')

		const { settings } = state.profiles[0]
		expect(settings.lastSaveDirectory).toBe('/out/processed')
		expect(settings.lastImageDirectory).toBe('/data/m31')
		expect(createProfile(state, 'Other')?.settings.lastSaveDirectory).toBeUndefined()
	})

	test('remembers the last directory of a stacking import per profile', () => {
		const state = load()
		setLastStackingDirectory(state, '/data/lights')
		expect(state.profiles[0].settings.lastStackingDirectory).toBe('/data/lights')
		expect(createProfile(state, 'Other')?.settings.lastStackingDirectory).toBeUndefined()
	})

	test('remembers the last directory of a library import apart from the stacking one', () => {
		const state = load()
		setLastStackingDirectory(state, '/data/lights')
		setLastCalibrationDirectory(state, '/data/darks')
		expect(state.profiles[0].settings).toMatchObject({ lastStackingDirectory: '/data/lights', lastCalibrationDirectory: '/data/darks' })
	})

	test('Annotation is kept per profile, merging its groups', () => {
		const state = load()
		expect(annotationPreferences(activeProfile(state).settings)).toEqual(DEFAULT_ANNOTATION_PREFERENCES)

		setAnnotationPreferences(state, { magnitudeLimit: 9.5, density: 'minimal', layers: { stars: false }, bodies: { satellite: false } })
		setAnnotationPreferences(state, { labels: false })

		const defaults = DEFAULT_ANNOTATION_PREFERENCES
		const saved = annotationPreferences(state.profiles[0].settings)
		expect(saved).toEqual({ ...defaults, magnitudeLimit: 9.5, density: 'minimal', labels: false, layers: { ...defaults.layers, stars: false }, bodies: { ...defaults.bodies, satellite: false } })
		expect(annotationPreferences(createProfile(state, 'Other')!.settings)).toEqual(defaults)
	})

	test('the plate solving of images is kept per profile, apart from those of the cameras', () => {
		const state = load()
		expect(imagePlateSolving(activeProfile(state).settings)).toEqual(DEFAULT_CAMERA_PLATE_SOLVING)

		setImagePlateSolving(state, { provider: 'nova', strategy: 'blind', downsample: 2 })

		const { settings } = state.profiles[0]
		expect(imagePlateSolving(settings)).toEqual({ provider: 'nova', strategy: 'blind', downsample: 2 })
		expect(cameraPlateSolving(settings, { connectionId: 'c', deviceId: 'd' })).toEqual(DEFAULT_CAMERA_PLATE_SOLVING)
	})

	test('the Image Processing pipeline survives a reload, in order, disabled steps included', () => {
		const state = load()
		expect(imageProcessingPipeline(activeProfile(state).settings)).toEqual([])

		const steps = [
			{ enabled: true, operation: { ...createOperation('backgroundNeutralization') } },
			{ enabled: false, operation: createOperation('debayer') },
		]
		setImageProcessingPipeline(state, steps)

		expect(imageProcessingPipeline(state.profiles[0].settings)).toEqual(steps)
	})
})

describe('sky settings', () => {
	test('the display zone of civil times follows the site until changed, per profile', () => {
		const state = load()
		expect(dateTimePreferences(state.profiles[0].settings)).toEqual({ displayTimeZone: 'site' })

		setDateTimePreferences(state, { displayTimeZone: 'utc' })
		expect(state.profiles[0].settings.dateTime).toEqual({ displayTimeZone: 'utc' })

		const other = createProfile(state, 'Other')!
		expect(dateTimePreferences(other.settings).displayTimeZone).toBe('site')
	})

	test('sets display preferences of the active profile', () => {
		const state = load()
		setSkyLayerVisible(state, 'constellationBoundaries', true)
		setSkyMagnitudeLimit(state, 0)
		expect(state.profiles[0].settings.sky.display).toEqual({ layers: { constellationBoundaries: true }, magnitudeLimit: 1 })
	})

	test('keeps the time bar hidden unless it was shown', () => {
		const state = load()
		expect(state.profiles[0].settings.sky).toEqual({})

		setSkyTimeBarVisible(state, true)
		expect(state.profiles[0].settings.sky.timeBar).toBeTrue()
		setSkyTimeBarVisible(state, false)
		expect(state.profiles[0].settings.sky).toEqual({})
		setSkyTimeBarVisible(state, true)
		expect(state.profiles[0].settings.sky.timeBar).toBeTrue()
	})

	test('manages optical presets without touching the equipment setup', () => {
		const state = load()
		selectConnection(state, 'c1')
		assignDevice(state, 'MAIN_CAMERA', dev('cam'))
		const equipment = structuredClone(snapshot(state).profiles[0].equipment)

		const first = createOpticalPreset(state, ' Refractor + APS-C ')!
		expect(createOpticalPreset(state, '  ')).toBeUndefined()
		expect(state.profiles[0].settings.sky.framing).toEqual({ presets: [first], activePresetId: first.id, visible: true })

		expect(updateOpticalPreset(state, first.id, { optics: { ...first.optics, focalLength: 420, focalMultiplier: 0.8 } })).toBe(true)
		const copy = duplicateOpticalPreset(state, first.id)!
		expect(copy.name).toBe('Refractor + APS-C (copy)')
		expect(copy.optics.focalLength).toBe(420)
		expect(state.profiles[0].settings.sky.framing?.activePresetId).toBe(copy.id)

		selectOpticalPreset(state, first.id)
		deleteOpticalPreset(state, first.id)
		expect(state.profiles[0].settings.sky.framing?.presets.map((e) => e.id)).toEqual([copy.id])
		expect(state.profiles[0].settings.sky.framing?.activePresetId).toBe(copy.id)

		setFramingVisible(state, false)
		expect(state.profiles[0].settings.sky.framing?.visible).toBe(false)
		expect(state.profiles[0].equipment).toEqual(equipment)
	})

	test('the guide telescope belongs to the active profile and is persisted', () => {
		const state = load()
		setGuideTelescopeOptics(state, { focalLength: 240, focalMultiplier: 0.8, aperture: 60 })
		const copy = duplicateProfile(state, state.profiles[0].id)!
		selectProfile(state, copy.id)
		setGuideTelescopeOptics(state, { focalLength: 400, focalMultiplier: 1, aperture: 80 })

		const reloaded = state
		expect(reloaded.profiles.map((profile) => profile.settings.guideTelescope)).toEqual([
			{ focalLength: 240, focalMultiplier: 0.8, aperture: 60 },
			{ focalLength: 400, focalMultiplier: 1, aperture: 80 },
		])
	})

	test('Equipment Setup framing choices and telescope belong to the active profile', () => {
		const state = load()
		setFramingSource(state, 'equipment')
		setSensorSource(state, 'manual')
		setManualSensor(state, { kind: 'physical', width: 23.5, height: 15.6 })
		setEquipmentRotation(state, 365)
		setTelescopeOptics(state, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		const copy = duplicateProfile(state, state.profiles[0].id)!

		selectProfile(state, copy.id)
		setTelescopeOptics(state, { focalLength: 1000, focalMultiplier: 1, aperture: 200 })
		setSensorSource(state, 'MAIN_CAMERA')

		expect(state.profiles[0].settings.telescope?.focalLength).toBe(400)
		expect(state.profiles[0].settings.sky.framing).toMatchObject({ source: 'equipment', sensorSource: 'manual', manualSensor: { kind: 'physical', width: 23.5, height: 15.6 }, equipmentRotation: 5 })
		expect(copy.settings.telescope?.focalLength).toBe(1000)
		expect(copy.settings.sky.framing?.sensorSource).toBe('MAIN_CAMERA')
		expect(state.profiles[0].equipment).toEqual({})
	})

	test('a duplicated profile copies its presets independently', () => {
		const state = load()
		const preset = createOpticalPreset(state, 'Newtonian')!
		const copy = duplicateProfile(state, state.profiles[0].id)!

		selectProfile(state, copy.id)
		updateOpticalPreset(state, preset.id, { name: 'Changed' })

		expect(state.profiles[0].settings.sky.framing?.presets[0].name).toBe('Newtonian')
		expect(copy.settings.sky.framing?.presets[0].name).toBe('Changed')
	})

	test('a duplicated profile observes from the same site, and each one changes its own', () => {
		const state = load()
		state.profiles[0].activeSiteId = 'home'
		const copy = duplicateProfile(state, state.profiles[0].id)!
		expect(copy.activeSiteId).toBe('home')

		selectProfile(state, copy.id)
		delete activeProfile(state).activeSiteId

		expect(state.profiles[0].activeSiteId).toBe('home')
		expect(copy.activeSiteId).toBeUndefined()
	})
})

// Physical cameras of the saved connection c.
const MAIN = { connectionId: 'c', deviceId: 'cam-main' }
const GUIDE = { connectionId: 'c', deviceId: 'cam-guide' }

describe('camera forms', () => {
	test('start from the defaults and are kept per physical camera, the exposure apart from the acquisition and Auto Focus forms', () => {
		const state = load()
		const settings = activeProfile(state).settings
		expect(exposureSettings(settings, MAIN)).toEqual(DEFAULT_EXPOSURE_SETTINGS)
		expect(acquisitionSettings(settings, MAIN)).toEqual(DEFAULT_ACQUISITION_SETTINGS)
		expect(autoFocusSettings(settings, MAIN)).toEqual(DEFAULT_AUTO_FOCUS_SETTINGS)

		setExposureSettings(state, MAIN, { exposureTime: 0.0001, gain: 120 })
		setAcquisitionSettings(state, MAIN, { exposureMode: 'loop', delay: 1.5 })
		setAutoFocusSettings(state, MAIN, { stepSize: 50 })
		setAcquisitionSettings(state, GUIDE, { output: { mode: 'preview-only', format: 'FITS' } })

		expect(exposureSettings(settings, MAIN)).toEqual({ ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 0.0001, gain: 120 })
		expect(acquisitionSettings(settings, MAIN)).toEqual({ ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'loop', delay: 1.5 })
		expect(autoFocusSettings(settings, MAIN)).toEqual({ ...DEFAULT_AUTO_FOCUS_SETTINGS, stepSize: 50 })
		expect(exposureSettings(settings, GUIDE)).toEqual(DEFAULT_EXPOSURE_SETTINGS)
		expect(acquisitionSettings(settings, GUIDE).output).toEqual({ mode: 'preview-only', format: 'FITS' })
		expect(autoFocusSettings(settings, GUIDE).stepSize).toBeUndefined()
		expect(DEFAULT_ACQUISITION_SETTINGS.exposureMode).toBe('single')
	})

	test('a camera without a saved connection reads the defaults and keeps nothing', () => {
		const state = load()
		expect(profileCamera(activeProfile(state), 'cam-main')).toBeUndefined()

		setExposureSettings(state, undefined, { gain: 120 })
		expect(activeProfile(state).settings.cameras).toEqual({})
		expect(profileCamera({ connectionId: 'c' }, 'cam-main')).toEqual(MAIN)
	})

	test('are persisted and restored', () => {
		const state = load()
		setExposureSettings(state, MAIN, { exposureTime: 0.0001, binX: 2, binY: 2, subframe: true, width: 100, height: 80 })
		setAcquisitionSettings(state, MAIN, { exposureMode: 'fixed', count: 30, output: { mode: 'preview-save', directory: '/data/allsky', filenameTemplate: 'sky_{seq}', format: 'XISF' } })
		setAutoFocusSettings(state, MAIN, { fittingMode: 'TREND_PARABOLIC', stepSize: 80, initialOffsetSteps: 6, settleDelay: 1.5 })

		const reloaded = state.profiles[0].settings
		expect(exposureSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 0.0001, binX: 2, binY: 2, subframe: true, width: 100, height: 80 })
		expect(acquisitionSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'fixed', count: 30, output: { mode: 'preview-save', directory: '/data/allsky', filenameTemplate: 'sky_{seq}', format: 'XISF' } })
		expect(autoFocusSettings(reloaded, MAIN)).toMatchObject({ fittingMode: 'TREND_PARABOLIC', stepSize: 80, initialOffsetSteps: 6, settleDelay: 1.5 })
	})

	test('the TPPA form is kept per camera and persisted', () => {
		const state = load()
		expect(tppaSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_TPPA_SETTINGS)

		setTppaSettings(state, MAIN, { direction: 'EAST', slewRate: 'SPEED_4', rotation: 10 })
		expect(tppaSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_TPPA_SETTINGS)

		const reloaded = state.profiles[0].settings
		expect(tppaSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_TPPA_SETTINGS, direction: 'EAST', slewRate: 'SPEED_4', rotation: 10 })
	})

	test('the plate solving settings belong to the camera and keep the scale tolerance', () => {
		const state = load()
		setCameraPlateSolving(state, MAIN, { provider: 'nova', strategy: 'assisted', scaleTolerance: 0.3 })
		expect(cameraPlateSolving(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_CAMERA_PLATE_SOLVING)

		const reloaded = state.profiles[0].settings
		expect(cameraPlateSolving(reloaded, MAIN)).toEqual({ provider: 'nova', strategy: 'assisted', scaleTolerance: 0.3 })
	})

	test('the DARV form is kept per camera and persisted', () => {
		const state = load()
		expect(darvSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_DARV_SETTINGS)

		setDarvSettings(state, MAIN, { axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_1', legDuration: 90 })
		expect(darvSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_DARV_SETTINGS)
		expect(exposureSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_EXPOSURE_SETTINGS)

		const reloaded = state.profiles[0].settings
		expect(darvSettings(reloaded, MAIN)).toEqual({ axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_1', legDuration: 90, stopTracking: true })
	})

	test('the Flat Wizard form is kept per camera and persisted', () => {
		const state = load()
		expect(flatWizardSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_FLAT_WIZARD_SETTINGS)

		const filters = [
			{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 2, count: 30, brightness: 120 },
			{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 3, targetRange: [15000, 25000] as const },
		]
		setFlatWizardSettings(state, MAIN, { filters, directory: '/flats', effectiveClip: 60000, settleTime: 5 })
		expect(flatWizardSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_FLAT_WIZARD_SETTINGS)

		const reloaded = state.profiles[0].settings
		expect(flatWizardSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_FLAT_WIZARD_SETTINGS, filters, directory: '/flats', effectiveClip: 60000, settleTime: 5 })
	})

	test('the guiding form is kept per camera and persisted', () => {
		const state = load()
		expect(guidingSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_GUIDING_SETTINGS)

		const settle = { pixels: 0.8, time: 5, timeout: 30 }
		setGuidingSettings(state, GUIDE, {
			exposureTime: 1.5,
			trackingMode: 'multiStar',
			searchRegion: 40,
			stickyLockPosition: true,
			recalibrateOnEveryStart: true,
			assumeDecOrthogonalToRa: true,
			aggressivenessRA: 0.5,
			settle,
			ditherPixels: 3,
			ditherRaOnly: true,
			ditherMode: 'spiral',
			fastRecenter: false,
			reverseDecOutputAfterMeridianFlip: true,
		})
		expect(guidingSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_GUIDING_SETTINGS)

		const reloaded = state.profiles[0].settings
		expect(guidingSettings(reloaded, GUIDE)).toEqual({
			...DEFAULT_GUIDING_SETTINGS,
			exposureTime: 1.5,
			trackingMode: 'multiStar',
			searchRegion: 40,
			stickyLockPosition: true,
			recalibrateOnEveryStart: true,
			assumeDecOrthogonalToRa: true,
			aggressivenessRA: 0.5,
			settle,
			ditherPixels: 3,
			ditherRaOnly: true,
			ditherMode: 'spiral',
			fastRecenter: false,
			reverseDecOutputAfterMeridianFlip: true,
		})
	})

	const CAMERA = { connectionId: 'c', deviceId: 'cam' }

	test('saved framings survive a reload, unchanged by anything but their own actions', () => {
		const state = load()
		const first = saveFramingReference(state, { name: ' M 42 ', rightAscension: 1.46, declination: -0.09, source: 'sky' }, 100)!
		const second = saveFramingReference(state, { name: 'Field', rightAscension: 2, declination: 0.5, source: 'manual' }, 200)!

		expect(first).toMatchObject({ name: 'M 42', createdAt: 100, updatedAt: 100 })
		expect(saveFramingReference(state, { name: '  ', rightAscension: 0, declination: 0, source: 'manual' })).toBeUndefined()
		expect(renameFramingReference(state, first.id, 'Orion', 300)).toBeTrue()
		expect(renameFramingReference(state, first.id, ' ')).toBeFalse()
		expect(renameFramingReference(state, 'unknown', 'x')).toBeFalse()
		deleteFramingReference(state, second.id)
		deleteFramingReference(state, 'unknown')
		setTargetCenteringSettings(state, CAMERA, { tolerance: 10, framingId: first.id })

		const reloaded = state
		expect(framingReferences(reloaded.profiles[0].settings)).toEqual([{ ...first, name: 'Orion', updatedAt: 300 }])
		expect(targetCenteringSettings(reloaded.profiles[0].settings, CAMERA)).toEqual({ ...DEFAULT_TARGET_CENTERING_SETTINGS, tolerance: 10, framingId: first.id })
	})

	test('a framing library holds a bounded number of framings', () => {
		const state = load()
		for (let i = 0; i < FRAMING_REFERENCES_MAXIMUM; i++) expect(saveFramingReference(state, { name: `F${i}`, rightAscension: 0, declination: 0, source: 'manual' })).toBeDefined()
		expect(saveFramingReference(state, { name: 'One too many', rightAscension: 0, declination: 0, source: 'manual' })).toBeUndefined()
	})

	test('the star detection request is the profile one, and is persisted', () => {
		const state = load()
		expect(starDetectionSettings(activeProfile(state).settings)).toEqual(DEFAULT_STAR_REQUEST)

		const request = { detector: { provider: 'builtin', maxStars: 50, minSNR: 2, searchRegion: 0, maximumRadius: 24 }, acceptance: { minSNR: 0, minHfd: 1, maxHfd: 0, edgeMargin: 10 } } as const
		setStarDetectionSettings(state, request)
		expect(starDetectionSettings(state.profiles[0].settings)).toEqual(request)
	})

	test('the Star Profile Inspector settings are the profile ones, and are persisted', () => {
		const state = load()
		expect(starProfileSettings(activeProfile(state).settings)).toEqual(DEFAULT_STAR_PROFILE_SETTINGS)

		setStarProfileSettings(state, { model: 'moments', minSNR: 3, grid: false })
		expect(starProfileSettings(state.profiles[0].settings)).toEqual({ ...DEFAULT_STAR_PROFILE_SETTINGS, model: 'moments', minSNR: 3, grid: false })
	})

	test('the streak detector settings are the profile ones, and are persisted', () => {
		const state = load()
		expect(streakDetectionSettings(activeProfile(state).settings)).toEqual(DEFAULT_STREAK_SETTINGS)

		const settings = { ...DEFAULT_STREAK_SETTINGS, minLength: 30, plane: 'red', allowBorderClipping: false } as const
		setStreakDetectionSettings(state, settings)
		expect(streakDetectionSettings(state.profiles[0].settings)).toEqual(settings)
	})

	test('the notifications read and dismissed are the profile ones, persisted, and pruned', () => {
		const state = load()
		const other = createProfile(state, 'Other')!

		markNotificationsRead(state, ['a', 'b', 'a'])
		dismissNotifications(state, ['c'])
		expect(activeProfile(state).settings.notifications).toEqual({ readIds: ['a', 'b', 'c'], dismissedIds: ['c'] })
		expect(other.settings.notifications).toBeUndefined()
		expect(state.profiles[0].settings.notifications).toEqual({ readIds: ['a', 'b', 'c'], dismissedIds: ['c'] })

		// Dismissing several at once reads them too and keeps each id once.
		dismissNotifications(state, ['c', 'd', 'e', 'd'])
		expect(activeProfile(state).settings.notifications).toEqual({ readIds: ['a', 'b', 'c', 'd', 'e'], dismissedIds: ['c', 'd', 'e'] })

		pruneNotificationPreferences(state, ['b', 'c'])
		expect(activeProfile(state).settings.notifications).toEqual({ readIds: ['b', 'c'], dismissedIds: ['c'] })
	})

	test('the appearance of the astrometric aids is kept, merging partial changes', () => {
		const state = load()
		expect(imageAstrometrySettings(activeProfile(state).settings)).toEqual(DEFAULT_IMAGE_ASTROMETRY)

		setImageAstrometrySettings(state, { grid: { color: 'axes' }, orientation: 'center' })
		setImageAstrometrySettings(state, { grid: { opacity: 0.8 }, coordinates: { format: 'decimal', precision: 3 } })
		const expected = { ...DEFAULT_IMAGE_ASTROMETRY, coordinates: { format: 'decimal', precision: 3 }, grid: { ...DEFAULT_IMAGE_ASTROMETRY.grid, color: 'axes', opacity: 0.8 }, orientation: 'center' } satisfies typeof DEFAULT_IMAGE_ASTROMETRY
		expect(imageAstrometrySettings(state.profiles[0].settings)).toEqual(expected)
	})

	test('the status bar clock defaults to the apparent sidereal time, is kept per profile, and never repeats a reading', () => {
		const state = load()
		expect(astronomicalClockPreferences(activeProfile(state).settings)).toEqual(DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES)

		setAstronomicalClockPreferences(state, { primary: 'jd', secondary: 'utc', showSeconds: false })
		const expected = { enabled: true, primary: 'jd', secondary: 'utc', showSeconds: false }
		expect(astronomicalClockPreferences(state.profiles[0].settings)).toEqual(expected as typeof DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES)

		setAstronomicalClockPreferences(state, { primary: 'utc' })
		expect(astronomicalClockPreferences(activeProfile(state).settings).secondary).toBe('none')
	})

	test('the preferences of Close Approaches are kept per profile', () => {
		const state = load()
		expect(closeApproachPreferences(activeProfile(state).settings)).toEqual(DEFAULT_CLOSE_APPROACH_PREFERENCES)

		setCloseApproachPreferences(state, { distanceDisplay: 'km', body: 'Moon', distanceMax: 2 })
		expect(closeApproachPreferences(state.profiles[0].settings)).toEqual({ ...DEFAULT_CLOSE_APPROACH_PREFERENCES, distanceDisplay: 'km', body: 'Moon', distanceMax: 2 })
	})

	test('what the status bar shows for a device is kept per profile and in display order', () => {
		const state = load()
		expect(statusChipPreferences(activeProfile(state).settings, 'FOCUSER')).toEqual(DEFAULT_STATUS_CHIPS.FOCUSER)

		setStatusChipPreferences(state, 'FOCUSER', { fields: ['temperature', 'status'] })
		setStatusChipPreferences(state, 'COVER', { visible: false })
		setAstronomicalClockPreferences(state, { primary: 'jd' })

		const { settings } = state.profiles[0]
		expect(statusChipPreferences(settings, 'FOCUSER')).toEqual({ visible: true, fields: ['status', 'temperature'] })
		expect(statusChipPreferences(settings, 'COVER')).toEqual({ visible: false, fields: ['status'] })
		expect(statusChipPreferences(settings, 'MOUNT')).toEqual(DEFAULT_STATUS_CHIPS.MOUNT)
		expect(astronomicalClockPreferences(settings).primary).toBe('jd')
	})

	test('the mode of Astro Weather is kept in the profile', () => {
		const state = load()
		expect(astroWeatherPreferences(activeProfile(state).settings)).toEqual(DEFAULT_ASTRO_WEATHER_PREFERENCES)

		setAstroWeatherPreferences(state, { mode: 'planetary' })
		expect(astroWeatherPreferences(state.profiles[0].settings)).toEqual({ mode: 'planetary' })
	})

	test('display settings applied in Images are kept per camera and globally', () => {
		const state = load()
		const global = { ...ORIGINAL_DISPLAY_SETTINGS, stretch: { mode: 'manual', stretch: { shadow: 0.1, midtone: 0.3, highlight: 0.9 } }, invert: true } as const satisfies DisplaySettings
		const camera = { ...ORIGINAL_DISPLAY_SETTINGS, debayer: { enabled: true, pattern: 'GRBG' }, gamma: 2 } as const satisfies DisplaySettings
		expect(imageDisplaySettings(activeProfile(state).settings)).toBeUndefined()

		setImageDisplaySettings(state, undefined, global)
		setImageDisplaySettings(state, MAIN, camera)
		const reloaded = state.profiles[0].settings

		expect(imageDisplaySettings(reloaded)).toEqual(global)
		expect(imageDisplaySettings(reloaded, MAIN)).toEqual(camera)
		expect(imageDisplaySettings(reloaded, { connectionId: 'c', deviceId: 'other' })).toBeUndefined()
	})
})

describe('mount remote control bindings', () => {
	test('start from the defaults and are remembered per saved connection, mount, and protocol', () => {
		const state = load()
		const mount = { connectionId: 'c', deviceId: 'mount-1' }
		const settings = () => activeProfile(state).settings

		expect(mountRemoteBinding(settings(), mount, 'lx200')).toEqual({ host: '0.0.0.0', port: 10002 })
		expect(mountRemoteBinding(settings(), mount, 'stellarium')).toEqual({ host: '0.0.0.0', port: 10001 })
		expect(mountRemoteBinding(settings(), undefined, 'lx200')).toEqual(DEFAULT_MOUNT_REMOTE_BINDINGS.lx200)

		setMountRemoteBinding(state, mount, 'lx200', { host: '127.0.0.1', port: 4030 })
		setMountRemoteBinding(state, undefined, 'stellarium', { host: '127.0.0.1', port: 1 })

		expect(mountRemoteBinding(settings(), mount, 'lx200')).toEqual({ host: '127.0.0.1', port: 4030 })
		expect(mountRemoteBinding(settings(), mount, 'stellarium')).toEqual(DEFAULT_MOUNT_REMOTE_BINDINGS.stellarium)
		expect(mountRemoteBinding(settings(), { connectionId: 'c', deviceId: 'mount-2' }, 'lx200')).toEqual(DEFAULT_MOUNT_REMOTE_BINDINGS.lx200)

		expect(state.profiles[0].settings.mountRemoteControl).toEqual({ c: { 'mount-1': { lx200: { host: '127.0.0.1', port: 4030 } } } })
	})
})

describe('meridian flip monitor settings', () => {
	test('start from the defaults and are remembered per saved connection and mount', () => {
		const state = load()
		const mount = { connectionId: 'c', deviceId: 'mount-1' }
		const settings = () => activeProfile(state).settings

		expect(meridianFlipSettings(settings(), mount)).toEqual(DEFAULT_MERIDIAN_FLIP_SETTINGS)
		expect(meridianFlipSettings(settings(), undefined)).toEqual(DEFAULT_MERIDIAN_FLIP_SETTINGS)

		const applied = { ...DEFAULT_MERIDIAN_FLIP_SETTINGS, minimumSeconds: 0, maximumSeconds: 1800 }
		setMeridianFlipSettings(state, mount, applied)
		setMeridianFlipSettings(state, undefined, DEFAULT_MERIDIAN_FLIP_SETTINGS)

		expect(meridianFlipSettings(settings(), mount)).toEqual(applied)
		expect(meridianFlipSettings(settings(), { connectionId: 'c', deviceId: 'mount-2' })).toEqual(DEFAULT_MERIDIAN_FLIP_SETTINGS)
		expect(state.profiles[0].settings.meridianFlipMonitor).toEqual({ c: { 'mount-1': applied } })
	})
})

describe('dithering settings', () => {
	test('the camera keeps its dithering in its acquisition form, and each mount its guide pulse settings', () => {
		const state = load()
		const camera = { connectionId: 'c', deviceId: 'camera-1' }
		const mount = { connectionId: 'c', deviceId: 'mount-1' }
		const settings = () => activeProfile(state).settings

		expect(ditherSettings(settings(), camera)).toEqual(DEFAULT_DITHER_SETTINGS)
		setDitherSettings(state, camera, { enabled: true, method: 'mount' })
		expect(ditherSettings(settings(), camera)).toEqual({ ...DEFAULT_DITHER_SETTINGS, enabled: true, method: 'mount' })
		expect(acquisitionSettings(settings(), camera)).toMatchObject({ exposureMode: 'single', dither: { enabled: true, method: 'mount' } })

		expect(mountDitherSettings(settings(), mount)).toEqual({ rightAscensionDirection: 'EAST', declinationDirection: 'NORTH', maxPulseDuration: 5000 })
		setMountDitherSettings(state, mount, { rightAscensionDirection: 'WEST' })
		setMountDitherSettings(state, mount, { declinationDirection: 'SOUTH' })
		setMountDitherSettings(state, undefined, { maxPulseDuration: 1 })
		expect(state.profiles[0].settings.mountDither).toEqual({ c: { 'mount-1': { maxPulseDuration: 5000, rightAscensionDirection: 'WEST', declinationDirection: 'SOUTH' } } })
		expect(mountDitherSettings(settings(), { connectionId: 'c', deviceId: 'mount-2' })).toEqual(DEFAULT_MOUNT_DITHER_SETTINGS)
		// A stored record missing a field reads it as its default.
		state.profiles[0].settings.mountDither = { c: { 'mount-3': { maxPulseDuration: 900 } as MountDitherSettings } }
		expect(mountDitherSettings(settings(), { connectionId: 'c', deviceId: 'mount-3' })).toEqual({ rightAscensionDirection: 'EAST', declinationDirection: 'NORTH', maxPulseDuration: 900 })
	})
})

describe('satellite favorites', () => {
	test('are kept in the order they were marked, without repeats, and long NORAD ids stay strings', () => {
		const state = load()
		const settings = () => activeProfile(state).settings
		expect(satelliteFavorites(settings())).toEqual([])

		setSatelliteFavorite(state, '25544', true)
		setSatelliteFavorite(state, '800000001', true)
		setSatelliteFavorite(state, '25544', true)
		expect(satelliteFavorites(settings())).toEqual(['800000001', '25544'])

		setSatelliteFavorite(state, '800000001', false)
		setSatelliteFavorite(state, '1', false)
		expect(settings().satelliteFavorites).toEqual(['25544'])
	})

	test('keep the most recent ones within the limit', () => {
		const state = load()
		for (let i = 0; i <= SATELLITE_FAVORITES_MAXIMUM; i++) setSatelliteFavorite(state, `${i}`, true)
		const favorites = satelliteFavorites(activeProfile(state).settings)
		expect(favorites).toHaveLength(SATELLITE_FAVORITES_MAXIMUM)
		expect(favorites[0]).toBe('1')
		expect(favorites.at(-1)).toBe(`${SATELLITE_FAVORITES_MAXIMUM}`)
	})
})
