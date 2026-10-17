import { describe, expect, test } from 'bun:test'
import { proxy } from 'valtio'
import type { Stores } from '../storage'
import { MemoryStorage } from '../storage.memory'
// oxfmt-ignore
import { ACTIVE_PROFILE_KEY, activeProfile, activeSetup, assignDevice, createProfile, deleteProfile, duplicateProfile, forgetConnection, LAST_PROFILE_KEY, loadProfiles, newProfile, persistProfiles, type ProfileState, PROFILES_KEY, renameProfile, selectConnection, selectProfile } from './profile'

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
		expect(stored(stores)).toEqual({ version: 1, profiles: [expect.objectContaining({ name: 'Default' })] })
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
		expect(state.profiles[0]).toMatchObject({ connectionId: 'c', equipment: { c: { MAIN_CAMERA: 'cam' } }, settings: {} })
		expect(state.profiles[1]).toMatchObject({ equipment: {}, settings: {}, createdAt: expect.any(String) })
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
		assignDevice(state, 'MOUNT', 'mount-1')
		const source = activeProfile(state)
		const copy = duplicateProfile(state, source.id)!

		expect(copy.id).not.toBe(source.id)
		expect(copy).toMatchObject({ name: 'Default (copy)', connectionId: 'conn', equipment: { conn: { MOUNT: 'mount-1' } } })

		assignDevice(state, 'MOUNT', 'mount-2')
		expect(state.profiles[1].equipment.conn.MOUNT).toBe('mount-1')
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

		expect(assignDevice(state, 'MOUNT', 'm')).toEqual({ ok: false, reason: 'no-connection' })

		selectConnection(state, 'indi')
		assignDevice(state, 'MAIN_CAMERA', 'cam-indi')
		selectConnection(state, 'sim')
		expect(activeSetup(activeProfile(state))).toEqual({})
		assignDevice(state, 'MAIN_CAMERA', 'cam-sim')

		selectConnection(state, 'indi')
		expect(activeSetup(activeProfile(state))).toEqual({ MAIN_CAMERA: 'cam-indi' })
	})

	test('main and guide camera cannot share a device', () => {
		const state = load(newStores())
		selectConnection(state, 'c')

		expect(assignDevice(state, 'MAIN_CAMERA', 'cam')).toEqual({ ok: true })
		expect(assignDevice(state, 'GUIDE_CAMERA', 'cam')).toEqual({ ok: false, reason: 'conflict', role: 'MAIN_CAMERA' })
		expect(assignDevice(state, 'GUIDE_CAMERA', 'cam-2')).toEqual({ ok: true })
		expect(assignDevice(state, 'MAIN_CAMERA', undefined)).toEqual({ ok: true })
		expect(activeSetup(activeProfile(state))).toEqual({ GUIDE_CAMERA: 'cam-2' })
	})

	test('a removed connection is forgotten by every profile', () => {
		const state = load(newStores())
		selectConnection(state, 'gone')
		assignDevice(state, 'MOUNT', 'm')
		const other = createProfile(state, 'Other')!
		other.equipment.gone = { FOCUSER: 'f' }
		other.connectionId = 'kept'

		forgetConnection(state, 'gone')

		expect(state.profiles[0].connectionId).toBeUndefined()
		expect(state.profiles[0].equipment).toEqual({})
		expect(state.profiles[1]).toMatchObject({ connectionId: 'kept', equipment: {} })
	})
})
