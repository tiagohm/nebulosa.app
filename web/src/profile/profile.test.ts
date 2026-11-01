import { describe, expect, test } from 'bun:test'
import { proxy, snapshot } from 'valtio'
import type { Stores } from '../storage'
import { MemoryStorage } from '../storage.memory'
// oxfmt-ignore
import { DEFAULT_STAR_PROFILE_SETTINGS } from '../stars/starprofile.settings'
import type { DisplaySettings } from 'api'
import { ORIGINAL_DISPLAY_SETTINGS } from '../images/display'
import { createOperation } from '../images/imageprocessing.catalog'
import { DEFAULT_IMAGE_ASTROMETRY } from '../platesolving/preferences'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import { DEFAULT_STREAK_SETTINGS } from '../streaks/streaks'
import {
	mountRemoteBinding,
	setMountRemoteBinding,
	acquisitionSettings,
	ACTIVE_PROFILE_KEY,
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
	LAST_PROFILE_KEY,
	loadProfiles,
	newProfile,
	panelOpen,
	persistProfiles,
	type ProfileState,
	PROFILES_KEY,
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
	setSkyObserver,
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
	DEFAULT_MOUNT_REMOTE_BINDINGS,
	DEFAULT_TPPA_SETTINGS,
	DEFAULT_TARGET_CENTERING_SETTINGS,
	FRAMING_REFERENCES_MAXIMUM,
	type FramingReference,
	PROFILES_VERSION,
	DEFAULT_ASTRO_WEATHER_PREFERENCES,
	DEFAULT_CLOSE_APPROACH_PREFERENCES,
} from './schema'

function dev(id: string) {
	return { id, name: `${id} name` }
}

function newStores(local = new MemoryStorage()): Stores {
	return { local, session: new MemoryStorage() }
}

function newState(): ProfileState {
	return proxy<ProfileState>({ profiles: [], activeId: '', open: false })
}

function load(stores: Stores) {
	const state = newState()
	loadProfiles(state, stores)
	persistProfiles(state, stores)
	return state
}

function stored(stores: Stores) {
	return JSON.parse(stores.local.getItem(PROFILES_KEY)!) as { version: number; profiles: { id: string; name: string }[] }
}

describe('load', () => {
	test('first run creates and stores a Default profile', () => {
		const stores = newStores()
		const state = load(stores)

		expect(state.profiles).toHaveLength(1)
		expect(state.profiles[0]).toMatchObject({ name: 'Default', equipment: {}, settings: {} })
		expect(state.profiles[0].connectionId).toBeUndefined()
		expect(state.activeId).toBe(state.profiles[0].id)
		expect(stored(stores)).toEqual({ version: PROFILES_VERSION, profiles: [expect.objectContaining({ name: 'Default' })] })
	})

	test('invalid JSON falls back to Default without overwriting the stored data', () => {
		const stores = newStores()
		stores.local.setItem(PROFILES_KEY, '{oops')
		const state = load(stores)

		expect(state.profiles.map((p) => p.name)).toEqual(['Default'])
		expect(stores.local.getItem(PROFILES_KEY)).toBe('{oops')
	})

	test('a document of another version falls back to Default and is replaced by the next change', async () => {
		for (const version of [PROFILES_VERSION - 1, PROFILES_VERSION + 1]) {
			const stores = newStores()
			const document = JSON.stringify({ version, profiles: [newProfile('Old')] })
			stores.local.setItem(PROFILES_KEY, document)
			const state = load(stores)

			expect(state.profiles.map((p) => p.name)).toEqual(['Default'])
			expect(stores.local.getItem(PROFILES_KEY)).toBe(document)

			renameProfile(state, state.profiles[0].id, 'Renamed')
			await Bun.sleep(0)
			expect(stored(stores)).toMatchObject({ version: PROFILES_VERSION, profiles: [{ name: 'Renamed' }] })
		}
	})

	test('a document of the current version is read as written', () => {
		const stores = newStores()
		const profile = { ...newProfile('A'), connectionId: 'c', equipment: { c: { MAIN_CAMERA: dev('cam') } } }
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: PROFILES_VERSION, profiles: [profile] }))

		expect(snapshot(load(stores)).profiles).toEqual([profile])
	})
})

describe('active profile', () => {
	function seeded() {
		const local = new MemoryStorage()
		local.setItem(PROFILES_KEY, JSON.stringify({ version: PROFILES_VERSION, profiles: [newProfile('A'), newProfile('B'), newProfile('C')] }))
		return local
	}

	test('a reload keeps the tab profile', async () => {
		const stores = newStores(seeded())
		const state = load(stores)
		const b = state.profiles[1].id
		selectProfile(state, b)
		await Bun.sleep(0)

		expect(load(stores).activeId).toBe(b)
	})

	test('two tabs keep separate active profiles', async () => {
		const local = seeded()
		const tab1 = newStores(local)
		const tab2 = newStores(local)
		const state1 = load(tab1)
		const state2 = load(tab2)
		const [a, b, c] = state1.profiles.map((p) => p.id)

		selectProfile(state1, b)
		selectProfile(state2, c)
		await Bun.sleep(0)

		expect(load(tab1).activeId).toBe(b)
		expect(load(tab2).activeId).toBe(c)
		expect(a).toBeDefined()
	})

	test('a new tab opens the last selected profile, or the first when it was deleted', async () => {
		const local = seeded()
		const state = load(newStores(local))
		const [a, b] = state.profiles.map((p) => p.id)
		selectProfile(state, b)
		await Bun.sleep(0)

		expect(local.getItem(LAST_PROFILE_KEY)).toBe(b)
		expect(load(newStores(local)).activeId).toBe(b)

		local.setItem(LAST_PROFILE_KEY, 'deleted')
		expect(load(newStores(local)).activeId).toBe(a)
	})

	test('the tab profile wins over the last selection', () => {
		const stores = newStores(seeded())
		const ids = load(stores).profiles.map((p) => p.id)
		stores.session.setItem(ACTIVE_PROFILE_KEY, ids[2])
		stores.local.setItem(LAST_PROFILE_KEY, ids[1])

		expect(load(stores).activeId).toBe(ids[2])
	})
})

describe('management', () => {
	test('create, rename, duplicate, and delete', async () => {
		const stores = newStores()
		const state = load(stores)
		const original = state.profiles[0]

		expect(createProfile(state, '  ')).toBeUndefined()
		const deep = createProfile(state, ' Deep Sky ')!
		expect(deep.name).toBe('Deep Sky')
		expect(deep.connectionId).toBeUndefined()

		expect(renameProfile(state, deep.id, '')).toBeFalse()
		expect(renameProfile(state, deep.id, 'Planetary')).toBeTrue()
		expect(state.profiles[1]).toMatchObject({ id: deep.id, name: 'Planetary' })

		await Bun.sleep(0)
		expect(stored(stores).profiles.map((p) => p.name)).toEqual(['Default', 'Planetary'])
		expect(original.id).toBe(state.activeId)
	})

	test('a duplicate is independent of its source', () => {
		const state = load(newStores())
		selectConnection(state, 'conn')
		assignDevice(state, 'MOUNT', dev('mount-1'))
		const source = activeProfile(state)
		const copy = duplicateProfile(state, source.id)!

		expect(copy.id).not.toBe(source.id)
		expect(copy).toMatchObject({ name: 'Default (copy)', connectionId: 'conn', equipment: { conn: { MOUNT: dev('mount-1') } } })

		assignDevice(state, 'MOUNT', dev('mount-2'))
		expect(state.profiles[1].equipment.conn.MOUNT).toEqual(dev('mount-1'))
	})

	test('the last profile cannot be deleted; deleting the active one selects another', () => {
		const state = load(newStores())
		const first = state.profiles[0].id

		expect(deleteProfile(state, first)).toBeFalse()

		const second = createProfile(state, 'Second')!
		selectProfile(state, second.id)
		expect(deleteProfile(state, second.id)).toBeTrue()
		expect(state.activeId).toBe(first)
	})

	test('a failed write is reported', async () => {
		const stores = newStores()
		const state = load(stores)
		const failing: Stores = { local: new MemoryStorage(true), session: stores.session }
		persistProfiles(state, failing)

		createProfile(state, 'X')
		await Bun.sleep(0)

		expect(state.error).toContain('Unable to save profiles')
	})
})

describe('equipment', () => {
	test('each connection keeps its own setup', () => {
		const state = load(newStores())

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
		const state = load(newStores())
		selectConnection(state, 'c')

		expect(assignDevice(state, 'MAIN_CAMERA', dev('cam'))).toEqual({ ok: true })
		expect(assignDevice(state, 'GUIDE_CAMERA', dev('cam'))).toEqual({ ok: false, reason: 'conflict', role: 'MAIN_CAMERA' })
		expect(assignDevice(state, 'GUIDE_CAMERA', dev('cam-2'))).toEqual({ ok: true })
		expect(assignDevice(state, 'MAIN_CAMERA', undefined)).toEqual({ ok: true })
		expect(activeSetup(activeProfile(state))).toEqual({ GUIDE_CAMERA: dev('cam-2') })
	})

	test('missing assignment names are filled from the listed devices', () => {
		const state = load(newStores())
		selectConnection(state, 'c')
		activeProfile(state).equipment.c = { MOUNT: { id: 'm', name: '' }, FOCUSER: { id: 'gone', name: '' }, MAIN_CAMERA: dev('cam') }

		rememberDeviceNames(state, [
			{ id: 'm', name: 'EQ6-R' },
			{ id: 'cam', name: 'other' },
		])

		expect(activeSetup(activeProfile(state))).toEqual({ MOUNT: { id: 'm', name: 'EQ6-R' }, FOCUSER: { id: 'gone', name: '' }, MAIN_CAMERA: dev('cam') })
	})

	test('a removed connection is forgotten by every profile', () => {
		const state = load(newStores())
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
		const stores = newStores()
		const state = load(stores)
		const before = state.profiles[0].updatedAt

		expect(panelOpen(state.profiles[0].settings, 'images')).toBe(true)
		setPanelOpen(state, 'images', true)
		expect(state.profiles[0].updatedAt).toBe(before)

		setPanelOpen(state, 'images', false)
		const other = createProfile(state, 'Other')!

		expect(panelOpen(state.profiles[0].settings, 'images')).toBe(false)
		expect(panelOpen(other.settings, 'images')).toBe(true)
	})

	test('remembers the last image directory', () => {
		const state = load(newStores())
		setLastImageDirectory(state, '/data/m31')
		expect(state.profiles[0].settings.lastImageDirectory).toBe('/data/m31')
	})

	test('remembers the last save directory per profile, apart from the one images are opened from', async () => {
		const stores = newStores()
		const state = load(stores)
		setLastImageDirectory(state, '/data/m31')
		setLastSaveDirectory(state, '/out/processed')
		await Bun.sleep(0)

		const { settings } = load({ local: stores.local, session: new MemoryStorage() }).profiles[0]
		expect(settings.lastSaveDirectory).toBe('/out/processed')
		expect(settings.lastImageDirectory).toBe('/data/m31')
		expect(createProfile(state, 'Other')?.settings.lastSaveDirectory).toBeUndefined()
	})

	test('Annotation is kept per profile, merging its groups', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(annotationPreferences(activeProfile(state).settings)).toEqual(DEFAULT_ANNOTATION_PREFERENCES)

		setAnnotationPreferences(state, { magnitudeLimit: 9.5, density: 'minimal', layers: { stars: false }, bodies: { satellite: false } })
		setAnnotationPreferences(state, { labels: false })
		await Bun.sleep(0)

		const defaults = DEFAULT_ANNOTATION_PREFERENCES
		const saved = annotationPreferences(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)
		expect(saved).toEqual({ ...defaults, magnitudeLimit: 9.5, density: 'minimal', labels: false, layers: { ...defaults.layers, stars: false }, bodies: { ...defaults.bodies, satellite: false } })
		expect(annotationPreferences(createProfile(state, 'Other')!.settings)).toEqual(defaults)
	})

	test('the plate solving of images is kept per profile, apart from those of the cameras', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(imagePlateSolving(activeProfile(state).settings)).toEqual(DEFAULT_CAMERA_PLATE_SOLVING)

		setImagePlateSolving(state, { provider: 'nova', strategy: 'blind', downsample: 2 })
		await Bun.sleep(0)

		const { settings } = load({ local: stores.local, session: new MemoryStorage() }).profiles[0]
		expect(imagePlateSolving(settings)).toEqual({ provider: 'nova', strategy: 'blind', downsample: 2 })
		expect(cameraPlateSolving(settings, { connectionId: 'c', deviceId: 'd' })).toEqual(DEFAULT_CAMERA_PLATE_SOLVING)
	})

	test('the Image Processing pipeline survives a reload, in order, disabled steps included', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(imageProcessingPipeline(activeProfile(state).settings)).toEqual([])

		const steps = [
			{ enabled: true, operation: { ...createOperation('backgroundNeutralization') } },
			{ enabled: false, operation: createOperation('debayer') },
		]
		setImageProcessingPipeline(state, steps)
		await Bun.sleep(0)

		expect(imageProcessingPipeline(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual(steps)
	})
})

describe('sky settings', () => {
	test('sets, validates, and clears the observer of the active profile', () => {
		const state = load(newStores())
		const before = state.profiles[0].updatedAt

		expect(setSkyObserver(state, { latitude: 100, longitude: 0, elevation: 0 })).toBe(false)
		expect(setSkyObserver(state, { latitude: 0, longitude: -181, elevation: 0 })).toBe(false)
		expect(setSkyObserver(state, { latitude: 0, longitude: 0, elevation: 10_000 })).toBe(false)
		expect(state.profiles[0].settings.sky).toEqual({})
		expect(state.profiles[0].updatedAt).toBe(before)

		expect(setSkyObserver(state, { latitude: 51.4779, longitude: -0.0015, elevation: 46 })).toBe(true)
		expect(state.profiles[0].settings.sky.observer).toEqual({ latitude: 51.4779, longitude: -0.0015, elevation: 46 })

		const other = createProfile(state, 'Other')!
		expect(other.settings.sky).toEqual({})

		selectProfile(state, state.profiles[0].id)
		setSkyObserver(state, undefined)
		expect(state.profiles[0].settings.sky).toEqual({})
	})

	test('keeps a known time zone of the observer and drops an unknown one', () => {
		const state = load(newStores())

		setSkyObserver(state, { latitude: 10, longitude: 20, elevation: 30, timeZone: 'Asia/Tokyo' })
		expect(state.profiles[0].settings.sky.observer?.timeZone).toBe('Asia/Tokyo')

		setSkyObserver(state, { latitude: 10, longitude: 20, elevation: 30, timeZone: 'Mars/Olympus_Mons' })
		expect(state.profiles[0].settings.sky.observer).toEqual({ latitude: 10, longitude: 20, elevation: 30 })
	})

	test('sets display preferences of the active profile', () => {
		const state = load(newStores())
		setSkyLayerVisible(state, 'constellationBoundaries', true)
		setSkyMagnitudeLimit(state, 0)
		expect(state.profiles[0].settings.sky.display).toEqual({ layers: { constellationBoundaries: true }, magnitudeLimit: 1 })
	})

	test('keeps the time bar hidden unless it was shown', () => {
		const state = load(newStores())
		expect(state.profiles[0].settings.sky).toEqual({})

		setSkyTimeBarVisible(state, true)
		expect(state.profiles[0].settings.sky.timeBar).toBeTrue()
		setSkyTimeBarVisible(state, false)
		expect(state.profiles[0].settings.sky).toEqual({})
		setSkyTimeBarVisible(state, true)
		expect(state.profiles[0].settings.sky.timeBar).toBeTrue()
	})

	test('manages optical presets without touching the equipment setup', () => {
		const state = load(newStores())
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

	test('the guide telescope belongs to the active profile and is persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		setGuideTelescopeOptics(state, { focalLength: 240, focalMultiplier: 0.8, aperture: 60 })
		const copy = duplicateProfile(state, state.profiles[0].id)!
		selectProfile(state, copy.id)
		setGuideTelescopeOptics(state, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() })
		expect(reloaded.profiles.map((profile) => profile.settings.guideTelescope)).toEqual([
			{ focalLength: 240, focalMultiplier: 0.8, aperture: 60 },
			{ focalLength: 400, focalMultiplier: 1, aperture: 80 },
		])
	})

	test('Equipment Setup framing choices and telescope belong to the active profile', () => {
		const state = load(newStores())
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
		const state = load(newStores())
		const preset = createOpticalPreset(state, 'Newtonian')!
		const copy = duplicateProfile(state, state.profiles[0].id)!

		selectProfile(state, copy.id)
		updateOpticalPreset(state, preset.id, { name: 'Changed' })

		expect(state.profiles[0].settings.sky.framing?.presets[0].name).toBe('Newtonian')
		expect(copy.settings.sky.framing?.presets[0].name).toBe('Changed')
	})

	test('a duplicated profile keeps its own observer', () => {
		const state = load(newStores())
		setSkyObserver(state, { latitude: 10, longitude: 20, elevation: 30 })
		const copy = duplicateProfile(state, state.profiles[0].id)!

		selectProfile(state, copy.id)
		setSkyObserver(state, { latitude: -10, longitude: -20, elevation: 0 })

		expect(state.profiles[0].settings.sky.observer).toEqual({ latitude: 10, longitude: 20, elevation: 30 })
		expect(copy.settings.sky.observer).toEqual({ latitude: -10, longitude: -20, elevation: 0 })
	})
})

// Physical cameras of the saved connection c.
const MAIN = { connectionId: 'c', deviceId: 'cam-main' }
const GUIDE = { connectionId: 'c', deviceId: 'cam-guide' }

describe('camera forms', () => {
	test('start from the defaults and are kept per physical camera, the exposure apart from the acquisition and Auto Focus forms', () => {
		const state = load(newStores())
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
		const state = load(newStores())
		const before = activeProfile(state).updatedAt
		expect(profileCamera(activeProfile(state), 'cam-main')).toBeUndefined()

		setExposureSettings(state, undefined, { gain: 120 })
		expect(activeProfile(state).settings.cameras).toEqual({})
		expect(activeProfile(state).updatedAt).toBe(before)
		expect(profileCamera({ connectionId: 'c' }, 'cam-main')).toEqual(MAIN)
	})

	test('are persisted and restored', async () => {
		const stores = newStores()
		const state = load(stores)
		setExposureSettings(state, MAIN, { exposureTime: 0.0001, binX: 2, binY: 2, subframe: true, width: 100, height: 80 })
		setAcquisitionSettings(state, MAIN, { exposureMode: 'fixed', count: 30, output: { mode: 'preview-save', directory: '/data/allsky', filenameTemplate: 'sky_{seq}', format: 'XISF' } })
		setAutoFocusSettings(state, MAIN, { fittingMode: 'TREND_PARABOLIC', stepSize: 80, initialOffsetSteps: 6, settleDelay: 1.5 })
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(exposureSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 0.0001, binX: 2, binY: 2, subframe: true, width: 100, height: 80 })
		expect(acquisitionSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'fixed', count: 30, output: { mode: 'preview-save', directory: '/data/allsky', filenameTemplate: 'sky_{seq}', format: 'XISF' } })
		expect(autoFocusSettings(reloaded, MAIN)).toMatchObject({ fittingMode: 'TREND_PARABOLIC', stepSize: 80, initialOffsetSteps: 6, settleDelay: 1.5 })
	})

	test('the TPPA form is kept per camera and persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(tppaSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_TPPA_SETTINGS)

		setTppaSettings(state, MAIN, { direction: 'EAST', slewRate: 'SPEED_4', rotation: 10 })
		expect(tppaSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_TPPA_SETTINGS)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(tppaSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_TPPA_SETTINGS, direction: 'EAST', slewRate: 'SPEED_4', rotation: 10 })
	})

	test('the plate solving settings belong to the camera and keep the scale tolerance', async () => {
		const stores = newStores()
		const state = load(stores)
		setCameraPlateSolving(state, MAIN, { provider: 'nova', strategy: 'assisted', scaleTolerance: 0.3 })
		expect(cameraPlateSolving(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_CAMERA_PLATE_SOLVING)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(cameraPlateSolving(reloaded, MAIN)).toEqual({ provider: 'nova', strategy: 'assisted', scaleTolerance: 0.3 })
	})

	test('the DARV form is kept per camera and persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(darvSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_DARV_SETTINGS)

		setDarvSettings(state, MAIN, { axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_1', legDuration: 90 })
		expect(darvSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_DARV_SETTINGS)
		expect(exposureSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_EXPOSURE_SETTINGS)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(darvSettings(reloaded, MAIN)).toEqual({ axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_1', legDuration: 90, stopTracking: true })
	})

	test('the Flat Wizard form is kept per camera and persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(flatWizardSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_FLAT_WIZARD_SETTINGS)

		const filters = [
			{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 2, count: 30, brightness: 120 },
			{ ...DEFAULT_FLAT_WIZARD_FILTER, slot: 3, targetRange: [15000, 25000] as const },
		]
		setFlatWizardSettings(state, MAIN, { filters, directory: '/flats', effectiveClip: 60000, settleTime: 5 })
		expect(flatWizardSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_FLAT_WIZARD_SETTINGS)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(flatWizardSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_FLAT_WIZARD_SETTINGS, filters, directory: '/flats', effectiveClip: 60000, settleTime: 5 })
	})

	test('the guiding form is kept per camera and persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(guidingSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_GUIDING_SETTINGS)

		const settle = { pixels: 0.8, time: 5, timeout: 30 }
		setGuidingSettings(state, GUIDE, { exposureTime: 1.5, trackingMode: 'multiStar', searchRegion: 40, stickyLockPosition: true, recalibrate: false, aggressivenessRA: 0.5, settle, ditherPixels: 3, ditherRaOnly: true, ditherMode: 'spiral', fastRecenter: false, reverseDecOutputAfterMeridianFlip: true })
		expect(guidingSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_GUIDING_SETTINGS)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(guidingSettings(reloaded, GUIDE)).toEqual({
			...DEFAULT_GUIDING_SETTINGS,
			exposureTime: 1.5,
			trackingMode: 'multiStar',
			searchRegion: 40,
			stickyLockPosition: true,
			recalibrate: false,
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

	test('saved framings survive a reload, unchanged by anything but their own actions', async () => {
		const stores = newStores()
		const state = load(stores)
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

		await Bun.sleep(0)
		const reloaded = load({ local: stores.local, session: new MemoryStorage() })
		expect(framingReferences(reloaded.profiles[0].settings)).toEqual([{ ...first, name: 'Orion', updatedAt: 300 }])
		expect(targetCenteringSettings(reloaded.profiles[0].settings, CAMERA)).toEqual({ ...DEFAULT_TARGET_CENTERING_SETTINGS, tolerance: 10, framingId: first.id })
	})

	test('a framing library holds a bounded number of framings', () => {
		const state = load(newStores())
		for (let i = 0; i < FRAMING_REFERENCES_MAXIMUM; i++) expect(saveFramingReference(state, { name: `F${i}`, rightAscension: 0, declination: 0, source: 'manual' })).toBeDefined()
		expect(saveFramingReference(state, { name: 'One too many', rightAscension: 0, declination: 0, source: 'manual' })).toBeUndefined()
	})

	test('the star detection request is the profile one, and is persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(starDetectionSettings(activeProfile(state).settings)).toEqual(DEFAULT_STAR_REQUEST)

		const request = { detector: { provider: 'builtin', maxStars: 50, minSNR: 2, searchRegion: 0, maximumRadius: 24 }, acceptance: { minSNR: 0, minHfd: 1, maxHfd: 0, edgeMargin: 10 } } as const
		setStarDetectionSettings(state, request)
		await Bun.sleep(0)
		expect(starDetectionSettings(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual(request)
	})

	test('the Star Profile Inspector settings are the profile ones, and are persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(starProfileSettings(activeProfile(state).settings)).toEqual(DEFAULT_STAR_PROFILE_SETTINGS)

		setStarProfileSettings(state, { model: 'moments', minSNR: 3, grid: false })
		await Bun.sleep(0)
		expect(starProfileSettings(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual({ ...DEFAULT_STAR_PROFILE_SETTINGS, model: 'moments', minSNR: 3, grid: false })
	})

	test('the streak detector settings are the profile ones, and are persisted', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(streakDetectionSettings(activeProfile(state).settings)).toEqual(DEFAULT_STREAK_SETTINGS)

		const settings = { ...DEFAULT_STREAK_SETTINGS, minLength: 30, plane: 'red', allowBorderClipping: false } as const
		setStreakDetectionSettings(state, settings)
		await Bun.sleep(0)
		expect(streakDetectionSettings(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual(settings)
	})

	test('the notifications read and dismissed are the profile ones, persisted, and pruned', async () => {
		const stores = newStores()
		const state = load(stores)
		const other = createProfile(state, 'Other')!

		markNotificationsRead(state, ['a', 'b', 'a'])
		dismissNotifications(state, ['c'])
		expect(activeProfile(state).settings.notifications).toEqual({ readIds: ['a', 'b', 'c'], dismissedIds: ['c'] })
		expect(other.settings.notifications).toBeUndefined()
		await Bun.sleep(0)
		expect(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings.notifications).toEqual({ readIds: ['a', 'b', 'c'], dismissedIds: ['c'] })

		// Dismissing several at once reads them too and keeps each id once.
		dismissNotifications(state, ['c', 'd', 'e', 'd'])
		expect(activeProfile(state).settings.notifications).toEqual({ readIds: ['a', 'b', 'c', 'd', 'e'], dismissedIds: ['c', 'd', 'e'] })

		const updatedAt = activeProfile(state).updatedAt
		pruneNotificationPreferences(state, ['b', 'c'])
		expect(activeProfile(state).settings.notifications).toEqual({ readIds: ['b', 'c'], dismissedIds: ['c'] })
		expect(activeProfile(state).updatedAt).toBe(updatedAt)
	})

	test('the appearance of the astrometric aids is kept, merging partial changes', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(imageAstrometrySettings(activeProfile(state).settings)).toEqual(DEFAULT_IMAGE_ASTROMETRY)

		setImageAstrometrySettings(state, { grid: { color: 'axes' }, orientation: 'center' })
		setImageAstrometrySettings(state, { grid: { opacity: 0.8 }, coordinates: { format: 'decimal', precision: 3 } })
		await Bun.sleep(0)
		const expected = { ...DEFAULT_IMAGE_ASTROMETRY, coordinates: { format: 'decimal', precision: 3 }, grid: { ...DEFAULT_IMAGE_ASTROMETRY.grid, color: 'axes', opacity: 0.8 }, orientation: 'center' } satisfies typeof DEFAULT_IMAGE_ASTROMETRY
		expect(imageAstrometrySettings(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual(expected)
	})

	test('the status bar clock defaults to the apparent sidereal time, is kept per profile, and never repeats a reading', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(astronomicalClockPreferences(activeProfile(state).settings)).toEqual(DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES)

		setAstronomicalClockPreferences(state, { primary: 'jd', secondary: 'utc', showSeconds: false })
		await Bun.sleep(0)
		const expected = { enabled: true, primary: 'jd', secondary: 'utc', showSeconds: false }
		expect(astronomicalClockPreferences(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual(expected as typeof DEFAULT_ASTRONOMICAL_CLOCK_PREFERENCES)

		setAstronomicalClockPreferences(state, { primary: 'utc' })
		expect(astronomicalClockPreferences(activeProfile(state).settings).secondary).toBe('none')
	})

	test('the preferences of Close Approaches are kept per profile', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(closeApproachPreferences(activeProfile(state).settings)).toEqual(DEFAULT_CLOSE_APPROACH_PREFERENCES)

		setCloseApproachPreferences(state, { distanceDisplay: 'km', body: 'Moon', distanceMax: 2 })
		await Bun.sleep(0)
		expect(closeApproachPreferences(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual({ ...DEFAULT_CLOSE_APPROACH_PREFERENCES, distanceDisplay: 'km', body: 'Moon', distanceMax: 2 })
	})

	test('what the status bar shows for a device is kept per profile and in display order', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(statusChipPreferences(activeProfile(state).settings, 'FOCUSER')).toEqual(DEFAULT_STATUS_CHIPS.FOCUSER)

		setStatusChipPreferences(state, 'FOCUSER', { fields: ['temperature', 'status'] })
		setStatusChipPreferences(state, 'COVER', { visible: false })
		setAstronomicalClockPreferences(state, { primary: 'jd' })
		await Bun.sleep(0)

		const { settings } = load(stores).profiles[0]
		expect(statusChipPreferences(settings, 'FOCUSER')).toEqual({ visible: true, fields: ['status', 'temperature'] })
		expect(statusChipPreferences(settings, 'COVER')).toEqual({ visible: false, fields: ['status'] })
		expect(statusChipPreferences(settings, 'MOUNT')).toEqual(DEFAULT_STATUS_CHIPS.MOUNT)
		expect(astronomicalClockPreferences(settings).primary).toBe('jd')
	})

	test('the mode of Astro Weather is kept in the profile', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(astroWeatherPreferences(activeProfile(state).settings)).toEqual(DEFAULT_ASTRO_WEATHER_PREFERENCES)

		setAstroWeatherPreferences(state, { mode: 'planetary' })
		await Bun.sleep(0)
		expect(astroWeatherPreferences(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual({ mode: 'planetary' })
	})

	test('display settings applied in Images are kept per camera and globally', async () => {
		const stores = newStores()
		const state = load(stores)
		const global = { ...ORIGINAL_DISPLAY_SETTINGS, stretch: { mode: 'manual', stretch: { shadow: 0.1, midtone: 0.3, highlight: 0.9 } }, invert: true } as const satisfies DisplaySettings
		const camera = { ...ORIGINAL_DISPLAY_SETTINGS, debayer: { enabled: true, pattern: 'GRBG' }, gamma: 2 } as const satisfies DisplaySettings
		expect(imageDisplaySettings(activeProfile(state).settings)).toBeUndefined()

		setImageDisplaySettings(state, undefined, global)
		setImageDisplaySettings(state, MAIN, camera)
		await Bun.sleep(0)
		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings

		expect(imageDisplaySettings(reloaded)).toEqual(global)
		expect(imageDisplaySettings(reloaded, MAIN)).toEqual(camera)
		expect(imageDisplaySettings(reloaded, { connectionId: 'c', deviceId: 'other' })).toBeUndefined()
	})
})

describe('mount remote control bindings', () => {
	test('start from the defaults and are remembered per saved connection, mount, and protocol', async () => {
		const stores = newStores()
		const state = load(stores)
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

		await Bun.sleep(0)
		expect(load(stores).profiles[0].settings.mountRemoteControl).toEqual({ c: { 'mount-1': { lx200: { host: '127.0.0.1', port: 4030 } } } })
	})
})
