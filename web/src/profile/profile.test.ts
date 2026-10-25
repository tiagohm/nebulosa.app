import { describe, expect, test } from 'bun:test'
import { proxy, snapshot } from 'valtio'
import type { Stores } from '../storage'
import { MemoryStorage } from '../storage.memory'
// oxfmt-ignore
import { DEFAULT_AUTO_FOCUS_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_ACQUISITION_SETTINGS, DEFAULT_DARV_SETTINGS, DEFAULT_FLAT_WIZARD_FILTER, DEFAULT_FLAT_WIZARD_SETTINGS, DEFAULT_GUIDING_SETTINGS, DEFAULT_TPPA_SETTINGS } from './schema'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import {
	acquisitionSettings,
	ACTIVE_PROFILE_KEY,
	activeProfile,
	activeSetup,
	assignDevice,
	autoFocusSettings,
	exposureSettings,
	profileCamera,
	setAutoFocusSettings,
	setExposureSettings,
	setTppaSettings,
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
	setManualSensor,
	setPanelOpen,
	setSensorSource,
	setSkyLayerVisible,
	setSkyTimeBarVisible,
	setSkyMagnitudeLimit,
	setSkyObserver,
	setStarDetectionSettings,
	setGuideTelescopeOptics,
	setTelescopeOptics,
	starDetectionSettings,
	updateOpticalPreset,
} from './profile'

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
		expect(stored(stores)).toEqual({ version: 9, profiles: [expect.objectContaining({ name: 'Default' })] })
	})

	test('invalid JSON falls back to Default without overwriting the stored data', () => {
		const stores = newStores()
		stores.local.setItem(PROFILES_KEY, '{oops')
		const state = load(stores)

		expect(state.profiles.map((p) => p.name)).toEqual(['Default'])
		expect(stores.local.getItem(PROFILES_KEY)).toBe('{oops')
	})

	test('fills missing fields and drops invalid or duplicate profiles', () => {
		const stores = newStores()
		const profiles = [{ id: 'a', name: ' A ', connectionId: 'c', equipment: { c: { MAIN_CAMERA: 'cam', BOGUS: 'x', MOUNT: 3 } } }, { name: 'no id' }, { id: 'a', name: 'dup' }, { id: 'b' }]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 1, profiles }))
		const state = load(stores)

		expect(state.profiles.map((p) => [p.id, p.name])).toEqual([
			['a', 'A'],
			['b', 'Unnamed'],
		])
		expect(state.profiles[0]).toMatchObject({ connectionId: 'c', equipment: { c: { MAIN_CAMERA: { id: 'cam', name: '' } } }, settings: {} })
		expect(state.profiles[1]).toMatchObject({ equipment: {}, settings: {}, createdAt: expect.any(String) })
	})

	test('version 2 restores assigned device names', () => {
		const stores = newStores()
		const profiles = [{ id: 'a', name: 'A', equipment: { c: { MAIN_CAMERA: { id: 'cam', name: 'ZWO ASI2600' }, MOUNT: { name: 'no id' }, FOCUSER: { id: 'f' } } } }]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles }))

		expect(load(stores).profiles[0].equipment).toEqual({ c: { MAIN_CAMERA: { id: 'cam', name: 'ZWO ASI2600' }, FOCUSER: { id: 'f', name: '' } } })
	})

	test('an unknown version falls back to Default', () => {
		const stores = newStores()
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 99, profiles: [{ id: 'a', name: 'A' }] }))

		expect(load(stores).profiles.map((p) => p.name)).toEqual(['Default'])
	})
})

describe('active profile', () => {
	function seeded() {
		const local = new MemoryStorage()
		local.setItem(PROFILES_KEY, JSON.stringify({ version: 1, profiles: [newProfile('A'), newProfile('B'), newProfile('C')] }))
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
	test('restores panel visibility and drops invalid entries', () => {
		const stores = newStores()
		const profiles = [
			{ id: 'a', name: 'A', settings: { panels: { capture: false, images: true, sky: 'no', bogus: false }, lastImageDirectory: '/data' } },
			{ id: 'b', name: 'B', settings: { lastImageDirectory: 3 } },
			{ id: 'c', name: 'C', settings: 'oops' },
		]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles }))
		const state = load(stores)

		// The Capture workspace and its preferences are gone, so its panel and views are dropped.
		expect(state.profiles[0].settings).toEqual({ panels: { images: true }, lastImageDirectory: '/data', cameras: {}, sky: {} })
		expect(state.profiles[1].settings).toEqual({ panels: {}, cameras: {}, sky: {} })
		expect(state.profiles[2].settings).toEqual({ panels: {}, cameras: {}, sky: {} })
	})

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
})

describe('sky settings', () => {
	test('restores the observer and drops invalid ones', () => {
		const stores = newStores()
		const profiles = [
			{ id: 'a', name: 'A', settings: { sky: { observer: { name: ' Backyard ', latitude: -23.5, longitude: -46.6, elevation: 760 } } } },
			{ id: 'b', name: 'B', settings: { sky: { observer: { latitude: 91, longitude: 0, elevation: 0 } } } },
			{ id: 'c', name: 'C', settings: { sky: { observer: { latitude: 10, longitude: 20 } } } },
		]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles }))
		const state = load(stores)

		expect(state.profiles[0].settings.sky).toEqual({ observer: { name: 'Backyard', latitude: -23.5, longitude: -46.6, elevation: 760 } })
		expect(state.profiles[1].settings.sky).toEqual({})
		expect(state.profiles[2].settings.sky).toEqual({})
	})

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

	test('restores display preferences, dropping unknown layers and limits out of range', () => {
		const stores = newStores()
		const profiles = [
			{ id: 'a', name: 'A', settings: { sky: { display: { layers: { deepSky: false, milkyWay: true, grid: 'no' }, magnitudeLimit: 5 } } } },
			{ id: 'b', name: 'B', settings: { sky: { display: { layers: { stars: false }, magnitudeLimit: 12 } } } },
		]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles }))
		const state = load(stores)

		expect(state.profiles[0].settings.sky.display).toEqual({ layers: { deepSky: false }, magnitudeLimit: 5 })
		expect(state.profiles[1].settings.sky.display).toEqual({ layers: { stars: false } })
	})

	test('sets display preferences of the active profile', () => {
		const state = load(newStores())
		setSkyLayerVisible(state, 'constellationBoundaries', true)
		setSkyMagnitudeLimit(state, 0)
		expect(state.profiles[0].settings.sky.display).toEqual({ layers: { constellationBoundaries: true }, magnitudeLimit: 1 })
	})

	test('keeps the time bar hidden unless it was shown', () => {
		const stores = newStores()
		const profiles = [
			{ id: 'a', name: 'A', settings: { sky: { timeBar: true } } },
			{ id: 'b', name: 'B', settings: { sky: { timeBar: 'yes' } } },
		]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles }))
		const state = load(stores)

		expect(state.profiles[0].settings.sky.timeBar).toBeTrue()
		expect(state.profiles[1].settings.sky).toEqual({})

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

	test('restores presets, dropping invalid ones and a missing active preset', () => {
		const stores = newStores()
		const optics = { focalLength: 600, focalMultiplier: 1, aperture: 0, sensor: { kind: 'physical' as const, width: 23.5, height: 15.6 }, rotation: -90 }
		const framing = {
			presets: [
				{ id: 'p', name: 'P', optics },
				{ id: '', name: 'X', optics },
				{ id: 'q', name: 'Q', optics: { ...optics, sensor: { kind: 'film' } } },
			],
			activePresetId: 'gone',
			visible: true,
		}
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles: [{ id: 'a', name: 'A', settings: { sky: { framing } } }] }))
		const state = load(stores)

		expect(state.profiles[0].settings.sky.framing).toEqual({ presets: [{ id: 'p', name: 'P', optics: { ...optics, rotation: 270 } }], visible: true })
	})

	test('restores the Equipment Setup framing and telescope, dropping invalid values', () => {
		const stores = newStores()
		const framing = { presets: [], visible: false, source: 'equipment', sensorSource: 'GUIDE_CAMERA', manualSensor: { kind: 'pixels', width: 100, height: 50, pixelSize: 2 }, equipmentRotation: -30 }
		const telescope = { focalLength: 800, focalMultiplier: 0.8, aperture: 'wide' }
		stores.local.setItem(
			PROFILES_KEY,
			JSON.stringify({
				version: 2,
				profiles: [
					{ id: 'a', name: 'A', settings: { sky: { framing }, telescope } },
					{ id: 'b', name: 'B', settings: { sky: { framing: { ...framing, source: 'other', sensorSource: 'ROTATOR' } } } },
				],
			}),
		)
		const state = load(stores)

		expect(state.profiles[0].settings.sky.framing).toEqual({ presets: [], visible: false, source: 'equipment', sensorSource: 'GUIDE_CAMERA', manualSensor: { kind: 'pixels', width: 100, height: 50, pixelSize: 2 }, equipmentRotation: 330 })
		expect(state.profiles[0].settings.telescope).toEqual({ focalLength: 800, focalMultiplier: 0.8, aperture: 0 })
		expect(state.profiles[1].settings.sky.framing?.source).toBeUndefined()
		expect(state.profiles[1].settings.sky.framing?.sensorSource).toBeUndefined()
		expect(state.profiles[1].settings.telescope).toBeUndefined()
	})

	test('the guide telescope belongs to the active profile, is persisted, and takes the guide focal length of version 8', async () => {
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

		// Version 8 kept the focal length in the guiding form of each camera: the Guide Camera of the active setup wins,
		// else the first form with one.
		const guiding = (focalLength: unknown) => ({ guiding: { ...DEFAULT_GUIDING_SETTINGS, focalLength } })
		const cameras = { c: { 'cam-main': guiding(1000), 'cam-guide': guiding(200) }, d: { other: guiding(-1) } }
		const older = newStores()
		older.local.setItem(
			PROFILES_KEY,
			JSON.stringify({
				version: 8,
				profiles: [
					{ id: 'a', name: 'A', connectionId: 'c', equipment: { c: { GUIDE_CAMERA: { id: 'cam-guide', name: 'Guide' } } }, settings: { cameras } },
					{ id: 'b', name: 'B', settings: { cameras } },
					{ id: 'c', name: 'C', settings: { cameras: { d: { other: guiding(-1) } } } },
					{ id: 'd', name: 'D', settings: { cameras, guideTelescope: { focalLength: 50, focalMultiplier: 1, aperture: 0 } } },
				],
			}),
		)
		const migrated = load(older).profiles
		expect(migrated.map((profile) => profile.settings.guideTelescope?.focalLength)).toEqual([200, 1000, undefined, 50])
		expect(migrated[0].settings.guideTelescope).toEqual({ focalLength: 200, focalMultiplier: 1, aperture: 0 })
		expect(guidingSettings(migrated[0].settings, GUIDE)).toEqual(DEFAULT_GUIDING_SETTINGS)
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

	test('are persisted and restored, replacing invalid fields with defaults', async () => {
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

		const invalid = newStores()
		const cameras = {
			c: {
				'cam-main': {
					exposure: { exposureTime: 0, binX: 0, gain: 'high' },
					acquisition: { exposureMode: 'burst', count: 2.5, delay: -1, frameType: 'SKY', output: { mode: 'x', format: 'NATIVE', directory: '  ' } },
					autoFocus: { fittingMode: 'CUBIC', stepSize: 0, initialOffsetSteps: 0, measureTimeout: 0, detection: { detector: { provider: 'astap' } } },
				},
				'cam-empty': 'oops',
			},
			d: 'oops',
		}
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 4, profiles: [{ id: 'a', name: 'A', settings: { cameras } }] }))
		expect(load(invalid).profiles[0].settings.cameras).toEqual({
			c: {
				'cam-main': {
					exposure: DEFAULT_EXPOSURE_SETTINGS,
					acquisition: DEFAULT_ACQUISITION_SETTINGS,
					autoFocus: DEFAULT_AUTO_FOCUS_SETTINGS,
				},
			},
		})
	})

	test('the TPPA form is kept per camera, persisted, and restored with defaults for invalid fields', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(tppaSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_TPPA_SETTINGS)

		setTppaSettings(state, MAIN, { direction: 'EAST', slewRate: 'SPEED_4', rotation: 10, solver: { provider: 'nova', strategy: 'blind', downsample: 2 } })
		expect(tppaSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_TPPA_SETTINGS)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(tppaSettings(reloaded, MAIN)).toEqual({ ...DEFAULT_TPPA_SETTINGS, direction: 'EAST', slewRate: 'SPEED_4', rotation: 10, solver: { provider: 'nova', strategy: 'blind', downsample: 2 } })

		const invalid = newStores()
		const cameras = { c: { 'cam-main': { tppa: { direction: 'NORTH', slewRate: '', rotation: 40, settleDelay: -1, refinementDelay: 'x', solver: { provider: 'gaia', strategy: 'x', downsample: 0 } } } } }
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 4, profiles: [{ id: 'a', name: 'A', settings: { cameras } }] }))
		expect(load(invalid).profiles[0].settings.cameras).toEqual({ c: { 'cam-main': { tppa: DEFAULT_TPPA_SETTINGS } } })
	})

	test('the DARV form is kept per camera, persisted, restored with defaults for invalid fields, and a version 5 document keeps its forms', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(darvSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_DARV_SETTINGS)

		setDarvSettings(state, MAIN, { axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_1', legDuration: 90 })
		expect(darvSettings(activeProfile(state).settings, GUIDE)).toEqual(DEFAULT_DARV_SETTINGS)
		expect(exposureSettings(activeProfile(state).settings, MAIN)).toEqual(DEFAULT_EXPOSURE_SETTINGS)
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings
		expect(darvSettings(reloaded, MAIN)).toEqual({ axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_1', legDuration: 90, stopTracking: true })

		const invalid = newStores()
		const cameras = { c: { 'cam-main': { darv: { axis: 'roll', direction: 'NORTH', slewRate: '', legDuration: 1 } } } }
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 6, profiles: [{ id: 'a', name: 'A', settings: { cameras } }] }))
		expect(load(invalid).profiles[0].settings.cameras).toEqual({ c: { 'cam-main': { darv: DEFAULT_DARV_SETTINGS } } })

		const older = newStores()
		const forms = { c: { 'cam-main': { exposure: { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 4 }, tppa: { ...DEFAULT_TPPA_SETTINGS, rotation: 12 } } } }
		older.local.setItem(PROFILES_KEY, JSON.stringify({ version: 5, profiles: [{ id: 'a', name: 'A', settings: { cameras: forms } }] }))
		expect(load(older).profiles[0].settings.cameras).toEqual(forms)
	})

	test('the Flat Wizard form is kept per camera, persisted, restored with defaults for invalid fields, and a version 6 document keeps its forms', async () => {
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

		const invalid = newStores()
		const bad = { label: ' ', slot: -1, count: 0, initialExposure: 99, minimumExposure: 5, maximumExposure: 1, targetRange: [3, 2], brightness: -1 }
		const cameras = { c: { 'cam-main': { flatWizard: { filters: [bad, 'x'], settleTime: -1, directory: ' ', effectiveClip: 0, maximumTrials: 0, maximumRejections: 1.5 } } } }
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 7, profiles: [{ id: 'a', name: 'A', settings: { cameras } }] }))
		expect(load(invalid).profiles[0].settings.cameras).toEqual({ c: { 'cam-main': { flatWizard: DEFAULT_FLAT_WIZARD_SETTINGS } } })

		const empty = newStores()
		empty.local.setItem(PROFILES_KEY, JSON.stringify({ version: 7, profiles: [{ id: 'a', name: 'A', settings: { cameras: { c: { 'cam-main': { flatWizard: { filters: [] } } } } } }] }))
		expect(flatWizardSettings(load(empty).profiles[0].settings, MAIN).filters).toEqual([DEFAULT_FLAT_WIZARD_FILTER])

		const older = newStores()
		const forms = { c: { 'cam-main': { darv: { ...DEFAULT_DARV_SETTINGS, legDuration: 90 } } } }
		older.local.setItem(PROFILES_KEY, JSON.stringify({ version: 6, profiles: [{ id: 'a', name: 'A', settings: { cameras: forms } }] }))
		expect(load(older).profiles[0].settings.cameras).toEqual(forms)
	})

	test('the guiding form is kept per camera, persisted, restored with defaults for invalid fields, and a version 7 document keeps its forms', async () => {
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

		const invalid = newStores()
		const bad = {
			exposureTime: 0,
			trackingMode: 'x',
			focalLength: -1,
			recalibrate: 'no',
			calibrationPulse: 0,
			aggressivenessRA: 2,
			aggressivenessDEC: -1,
			maximumPulseRA: 1e9,
			maximumPulseDEC: Number.NaN,
			settle: { pixels: 0, time: -1, timeout: 0 },
			ditherPixels: 0,
			ditherRaOnly: 'yes',
			searchRegion: 200,
			stickyLockPosition: 'yes',
			ditherMode: 'square',
			fastRecenter: 0,
			reverseDecOutputAfterMeridianFlip: 1,
		}
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 9, profiles: [{ id: 'a', name: 'A', settings: { cameras: { c: { 'cam-guide': { guiding: bad } } } } }] }))
		expect(load(invalid).profiles[0].settings.cameras).toEqual({ c: { 'cam-guide': { guiding: DEFAULT_GUIDING_SETTINGS } } })

		const older = newStores()
		const forms = { c: { 'cam-main': { flatWizard: { ...DEFAULT_FLAT_WIZARD_SETTINGS, settleTime: 4 } } } }
		older.local.setItem(PROFILES_KEY, JSON.stringify({ version: 7, profiles: [{ id: 'a', name: 'A', settings: { cameras: forms } }] }))
		expect(load(older).profiles[0].settings.cameras).toEqual(forms)

		const newer = newStores()
		newer.local.setItem(PROFILES_KEY, JSON.stringify({ version: 10, profiles: [{ id: 'a', name: 'A' }] }))
		expect(load(newer).profiles.map((profile) => profile.id)).not.toContain('a')
	})

	test('the star detection request is the profile one, persisted and restored with defaults for invalid fields', async () => {
		const stores = newStores()
		const state = load(stores)
		expect(starDetectionSettings(activeProfile(state).settings)).toEqual(DEFAULT_STAR_REQUEST)

		const request = { detector: { provider: 'builtin', maxStars: 50, minSNR: 2, searchRegion: 0, maximumRadius: 24 }, acceptance: { minSNR: 0, minHfd: 1, maxHfd: 0, edgeMargin: 10 } } as const
		setStarDetectionSettings(state, request)
		await Bun.sleep(0)
		expect(starDetectionSettings(load({ local: stores.local, session: new MemoryStorage() }).profiles[0].settings)).toEqual(request)

		const invalid = newStores()
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 4, profiles: [{ id: 'a', name: 'A', settings: { starDetection: { detector: { provider: 'builtin', maximumRadius: 2 } } } }] }))
		expect(starDetectionSettings(load(invalid).profiles[0].settings)).toEqual(DEFAULT_STAR_REQUEST)
	})

	test('version 3 forms of a camera role move to the camera that role is assigned in each setup', () => {
		const stores = newStores()
		const acquisition = { MAIN_CAMERA: { exposureMode: 'loop', delay: 2, exposureTime: 30, frameType: 'DARK', gain: 120, binX: 2, binY: 2, output: { mode: 'preview-only', format: 'FITS' } }, GUIDE_CAMERA: { exposureTime: 2 } }
		const autoFocus = { MAIN_CAMERA: { stepSize: 40 } }
		const analysis = { MAIN_CAMERA: { enabled: true } }
		const equipment = { c: { MAIN_CAMERA: dev('cam-main'), GUIDE_CAMERA: dev('cam-guide') }, d: { MAIN_CAMERA: dev('other-main') }, e: { MOUNT: dev('mount') } }
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 3, profiles: [{ id: 'a', name: 'A', connectionId: 'c', equipment, settings: { capture: { activeCamera: 'MAIN_CAMERA', views: { MAIN_CAMERA: { mode: 'auto-focus' } }, acquisition, autoFocus, analysis } } }] }))
		const settings = load(stores).profiles[0].settings

		const main = { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 30, gain: 120, binX: 2, binY: 2 }
		expect('capture' in settings).toBeFalse()
		expect(exposureSettings(settings, MAIN)).toEqual(main)
		expect(acquisitionSettings(settings, MAIN)).toEqual({ ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'loop', delay: 2, frameType: 'DARK', output: { mode: 'preview-only', format: 'FITS' } })
		expect(autoFocusSettings(settings, MAIN).stepSize).toBe(40)
		expect(exposureSettings(settings, GUIDE).exposureTime).toBe(2)
		expect(autoFocusSettings(settings, GUIDE)).toEqual(DEFAULT_AUTO_FOCUS_SETTINGS)
		// The Main Camera of another connection's setup took the same role, so it gets the same form.
		expect(exposureSettings(settings, { connectionId: 'd', deviceId: 'other-main' })).toEqual(main)
		expect(Object.keys(settings.cameras).sort()).toEqual(['c', 'd'])
	})

	test('version 3 forms of a role without an assigned camera are dropped', () => {
		const stores = newStores()
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 3, profiles: [{ id: 'a', name: 'A', settings: { capture: { views: {}, acquisition: { MAIN_CAMERA: { exposureTime: 30 } } } } }] }))
		expect(load(stores).profiles[0].settings.cameras).toEqual({})
	})
})
