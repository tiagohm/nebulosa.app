import { describe, expect, test } from 'bun:test'
import { proxy, snapshot } from 'valtio'
import type { Stores } from '../storage'
import { MemoryStorage } from '../storage.memory'
// oxfmt-ignore
import { acquisitionSettings, ACTIVE_PROFILE_KEY, activeProfile, activeSetup, analysisSettings, assignDevice, createOpticalPreset, createProfile, DEFAULT_ACQUISITION_SETTINGS, DEFAULT_ANALYSIS_SETTINGS, deleteOpticalPreset, deleteProfile, duplicateOpticalPreset, duplicateProfile, forgetConnection, LAST_PROFILE_KEY, loadProfiles, newProfile, panelOpen, persistProfiles, type ProfileState, PROFILES_KEY, rememberDeviceNames, renameProfile, selectCameraView, selectConnection, selectOpticalPreset, selectProfile, setAcquisitionSettings, setAnalysisSettings, setCameraReticle, setEquipmentRotation, setFramingSource, setFramingVisible, setLastImageDirectory, setManualSensor, setPanelOpen, setSensorSource, setSkyLayerVisible, setSkyMagnitudeLimit, setSkyObserver, setTelescopeOptics, updateOpticalPreset } from './profile'

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
		expect(stored(stores)).toEqual({ version: 3, profiles: [expect.objectContaining({ name: 'Default' })] })
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

		expect(state.profiles[0].settings).toEqual({ panels: { capture: false, images: true }, lastImageDirectory: '/data', capture: { views: {} }, sky: {} })
		expect(state.profiles[1].settings).toEqual({ panels: {}, capture: { views: {} }, sky: {} })
		expect(state.profiles[2].settings).toEqual({ panels: {}, capture: { views: {} }, sky: {} })
	})

	test('panels are expanded by default and persisted per profile', () => {
		const stores = newStores()
		const state = load(stores)
		const before = state.profiles[0].updatedAt

		expect(panelOpen(state.profiles[0].settings, 'capture')).toBe(true)
		setPanelOpen(state, 'capture', true)
		expect(state.profiles[0].updatedAt).toBe(before)

		setPanelOpen(state, 'capture', false)
		const other = createProfile(state, 'Other')!

		expect(panelOpen(state.profiles[0].settings, 'capture')).toBe(false)
		expect(panelOpen(other.settings, 'capture')).toBe(true)
	})

	test('remembers the last image directory', () => {
		const state = load(newStores())
		setLastImageDirectory(state, '/data/m31')
		expect(state.profiles[0].settings.lastImageDirectory).toBe('/data/m31')
	})
})

describe('capture settings', () => {
	test('restores camera views, renaming version 2 modes, and drops invalid entries', () => {
		const stores = newStores()
		const views = { MAIN_CAMERA: { mode: 'focus-calibrator', reticle: true }, GUIDE_CAMERA: { mode: 'bogus', reticle: 'yes' }, MOUNT: { mode: 'camera' } }
		const profiles = [
			{ id: 'a', name: 'A', settings: { capture: { activeCamera: 'GUIDE_CAMERA', views } } },
			{ id: 'b', name: 'B', settings: { capture: { activeCamera: 'MOUNT', views: 'oops' } } },
		]
		stores.local.setItem(PROFILES_KEY, JSON.stringify({ version: 2, profiles }))
		const state = load(stores)

		expect(state.profiles[0].settings.capture).toEqual({ activeCamera: 'GUIDE_CAMERA', views: { MAIN_CAMERA: { mode: 'auto-focus', reticle: true }, GUIDE_CAMERA: { mode: 'camera' } } })
		expect(state.profiles[1].settings.capture).toEqual({ views: {} })
	})

	test('keeps the mode and reticle of each camera view apart', () => {
		const state = load(newStores())
		selectConnection(state, 'c')
		assignDevice(state, 'MAIN_CAMERA', dev('cam'))
		const equipment = JSON.stringify(activeProfile(state).equipment)

		selectCameraView(state, 'MAIN_CAMERA', 'camera')
		setCameraReticle(state, 'MAIN_CAMERA', true)
		selectCameraView(state, 'GUIDE_CAMERA', 'mount-nudge')
		setCameraReticle(state, 'GUIDE_CAMERA', false)

		expect(activeProfile(state).settings.capture).toEqual({ activeCamera: 'GUIDE_CAMERA', views: { MAIN_CAMERA: { mode: 'camera', reticle: true }, GUIDE_CAMERA: { mode: 'mount-nudge', reticle: false } } })
		expect(JSON.stringify(activeProfile(state).equipment)).toBe(equipment)
	})

	test('selecting another mode clears the reticle choice; reselecting changes nothing', () => {
		const state = load(newStores())
		selectCameraView(state, 'MAIN_CAMERA', 'mount-nudge')
		setCameraReticle(state, 'MAIN_CAMERA', false)
		const before = activeProfile(state).updatedAt

		selectCameraView(state, 'MAIN_CAMERA', 'mount-nudge')
		expect(activeProfile(state).updatedAt).toBe(before)
		expect(activeProfile(state).settings.capture.views.MAIN_CAMERA).toEqual({ mode: 'mount-nudge', reticle: false })

		selectCameraView(state, 'MAIN_CAMERA', 'camera')
		expect(activeProfile(state).settings.capture.views.MAIN_CAMERA).toEqual({ mode: 'camera' })
	})

	test('is persisted per profile', async () => {
		const stores = newStores()
		const state = load(stores)
		selectCameraView(state, 'GUIDE_CAMERA', 'tppa')
		createProfile(state, 'Other')
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() })
		expect(reloaded.profiles[0].settings.capture).toEqual({ activeCamera: 'GUIDE_CAMERA', views: { GUIDE_CAMERA: { mode: 'tppa' } } })
		expect(reloaded.profiles[1].settings.capture).toEqual({ views: {} })
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

describe('camera capture form', () => {
	test('starts from the defaults and keeps the form of each camera view apart', () => {
		const state = load(newStores())
		expect(acquisitionSettings(activeProfile(state).settings.capture, 'MAIN_CAMERA')).toEqual(DEFAULT_ACQUISITION_SETTINGS)

		setAcquisitionSettings(state, 'MAIN_CAMERA', { exposureMode: 'loop', exposureTime: 0.0001, delay: 1.5 })
		setAcquisitionSettings(state, 'GUIDE_CAMERA', { output: { mode: 'preview-only', format: 'FITS' } })
		selectCameraView(state, 'MAIN_CAMERA', 'mount-nudge')

		const capture = activeProfile(state).settings.capture
		expect(acquisitionSettings(capture, 'MAIN_CAMERA')).toEqual({ ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'loop', exposureTime: 0.0001, delay: 1.5 })
		expect(acquisitionSettings(capture, 'GUIDE_CAMERA').output).toEqual({ mode: 'preview-only', format: 'FITS' })
		expect(DEFAULT_ACQUISITION_SETTINGS.exposureMode).toBe('single')
	})

	test('is persisted and restored, replacing invalid fields with defaults', async () => {
		const stores = newStores()
		const state = load(stores)
		setAcquisitionSettings(state, 'MAIN_CAMERA', { exposureMode: 'fixed', count: 30, exposureTime: 0.0001, output: { mode: 'preview-save', directory: '/data/allsky', filenameTemplate: 'sky_{seq}', format: 'XISF' } })
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() })
		expect(acquisitionSettings(reloaded.profiles[0].settings.capture, 'MAIN_CAMERA')).toEqual({ ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'fixed', count: 30, exposureTime: 0.0001, output: { mode: 'preview-save', directory: '/data/allsky', filenameTemplate: 'sky_{seq}', format: 'XISF' } })

		const invalid = newStores()
		const acquisition = { MAIN_CAMERA: { exposureMode: 'burst', count: 2.5, delay: -1, exposureTime: 0, frameType: 'SKY', binX: 0, output: { mode: 'x', format: 'NATIVE', directory: '  ' } }, MOUNT: {} }
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 3, profiles: [{ id: 'a', name: 'A', settings: { capture: { views: {}, acquisition } } }] }))
		expect(load(invalid).profiles[0].settings.capture).toEqual({ views: {}, acquisition: { MAIN_CAMERA: DEFAULT_ACQUISITION_SETTINGS } })
	})
})

describe('post-capture analysis', () => {
	test('is off by default, Every Frame once on, and kept per camera view', () => {
		const state = load(newStores())
		expect(analysisSettings(activeProfile(state).settings.capture, 'MAIN_CAMERA')).toEqual({ enabled: false, policy: 'everyFrame', request: { detector: { provider: 'builtin', maxStars: 500, minSNR: 0, searchRegion: 0 }, acceptance: { minSNR: 0, minHfd: 0, maxHfd: 0, edgeMargin: 0 } }, overlay: true })

		setAnalysisSettings(state, 'MAIN_CAMERA', { enabled: true })
		setAnalysisSettings(state, 'GUIDE_CAMERA', { overlay: false })

		const capture = activeProfile(state).settings.capture
		expect(analysisSettings(capture, 'MAIN_CAMERA')).toMatchObject({ enabled: true, policy: 'everyFrame', overlay: true })
		expect(analysisSettings(capture, 'GUIDE_CAMERA')).toMatchObject({ enabled: false, overlay: false })
		expect(DEFAULT_ANALYSIS_SETTINGS.enabled).toBeFalse()
	})

	test('is persisted and restored, replacing invalid fields with defaults and staying off unless on', async () => {
		const stores = newStores()
		const state = load(stores)
		const request = { detector: { provider: 'astap', maxStars: 200, minSNR: 15 }, acceptance: { minSNR: 5, minHfd: 1, maxHfd: 12, edgeMargin: 20 } } as const
		setAnalysisSettings(state, 'MAIN_CAMERA', { enabled: true, policy: 'latestFrame', request, overlay: false })
		await Bun.sleep(0)

		const reloaded = load({ local: stores.local, session: new MemoryStorage() })
		expect(analysisSettings(reloaded.profiles[0].settings.capture, 'MAIN_CAMERA')).toEqual({ enabled: true, policy: 'latestFrame', request, overlay: false })

		const invalid = newStores()
		const analysis = { MAIN_CAMERA: { enabled: 'yes', policy: 'sometimes', request: { detector: { provider: 'other', maxStars: -1, minSNR: 'high' }, acceptance: { minHfd: -2 } }, overlay: 0 }, MOUNT: { enabled: true } }
		invalid.local.setItem(PROFILES_KEY, JSON.stringify({ version: 3, profiles: [{ id: 'a', name: 'A', settings: { capture: { views: {}, analysis } } }] }))
		expect(load(invalid).profiles[0].settings.capture).toEqual({ views: {}, analysis: { MAIN_CAMERA: DEFAULT_ANALYSIS_SETTINGS } })

		// Profiles written before the analysis existed have none, which reads as off.
		const older = newStores()
		older.local.setItem(PROFILES_KEY, JSON.stringify({ version: 3, profiles: [{ id: 'a', name: 'A', settings: { capture: { views: {} } } }] }))
		expect(analysisSettings(load(older).profiles[0].settings.capture, 'MAIN_CAMERA').enabled).toBeFalse()
	})
})
