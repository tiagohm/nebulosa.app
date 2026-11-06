import { describe, expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { type CameraFields, type CameraSourceUpdate, ObservatoryCameraStore } from './observatorycameras.store'
import { Workspace } from './workspace'

const FIELDS: CameraFields = { name: 'Roof', enabled: true, rtspTransport: 'tcp' }

function source(byte = 1): CameraSourceUpdate {
	return { ciphertext: new Uint8Array([byte, 2, 3]), nonce: new Uint8Array(12).fill(byte), keyId: '0123456789abcdef', host: '192.0.2.10' }
}

function setup() {
	const database = AppDatabase.memory()
	return { database, store: new ObservatoryCameraStore(database) }
}

describe('save', () => {
	test('creates with an address, then edits keeping it', () => {
		const { store } = setup()
		expect(store.save('c1', FIELDS, undefined, 0)).toEqual({ status: 'sourceRequired' })

		const created = store.save('c1', FIELDS, source(), 0)
		expect(created).toEqual({ status: 'saved', sourceChanged: true, camera: { id: 'c1', name: 'Roof', enabled: true, sortOrder: 0, sourceConfigured: true, sourceHost: '192.0.2.10', rtspTransport: 'tcp', revision: 1 } })

		const renamed = store.save('c1', { ...FIELDS, name: 'Dome' }, undefined, 1)
		expect(renamed).toMatchObject({ status: 'saved', sourceChanged: false, camera: { name: 'Dome', revision: 2 } })
		expect(store.sources()[0].ciphertext).toEqual(new Uint8Array([1, 2, 3]))

		expect(store.save('c1', { ...FIELDS, rtspTransport: 'automatic' }, undefined, 2)).toMatchObject({ status: 'saved', sourceChanged: true })
		expect(store.save('c1', FIELDS, source(9), 3)).toMatchObject({ status: 'saved', sourceChanged: true })
		expect(store.sources()[0]).toMatchObject({ id: 'c1', revision: 4, ciphertext: new Uint8Array([9, 2, 3]) })
	})

	test('a stale revision is a conflict with the current camera', () => {
		const { store } = setup()
		store.save('c1', FIELDS, source(), 0)
		expect(store.save('c1', FIELDS, source(), 0)).toMatchObject({ status: 'conflict', current: { id: 'c1', revision: 1 } })
		expect(store.save('c2', FIELDS, undefined, 3)).toEqual({ status: 'conflict', current: null })
	})

	test('new cameras go last, and an explicit position is kept', () => {
		const { store } = setup()
		store.save('a', FIELDS, source(), 0)
		store.save('b', FIELDS, source(), 0)
		store.save('a', { ...FIELDS, sortOrder: 5 }, undefined, 1)
		expect(store.list().map((camera) => [camera.id, camera.sortOrder])).toEqual([
			['b', 1],
			['a', 5],
		])
	})

	test('only enabled cameras are sources of the gateway', () => {
		const { store } = setup()
		store.save('a', FIELDS, source(), 0)
		store.save('b', { ...FIELDS, enabled: false }, source(), 0)
		expect(store.sources().map((row) => row.id)).toEqual(['a'])
	})
})

describe('sites', () => {
	test('a camera may be shared, and loses its site when the site is deleted', () => {
		const { database, store } = setup()
		const workspace = new Workspace(database)
		workspace.saveSite('s1', { name: 'Home', latitude: 0, longitude: 0, elevation: 0, timeZone: 'UTC', revision: 0 })

		store.save('shared', FIELDS, source(), 0)
		store.save('local', { ...FIELDS, observingSiteId: 's1' }, source(), 0)
		expect(store.get('shared')?.observingSiteId).toBeUndefined()
		expect(store.get('local')?.observingSiteId).toBe('s1')

		workspace.removeSite('s1')
		expect(store.get('local')?.observingSiteId).toBeUndefined()
	})
})

test('remove reports whether the camera existed', () => {
	const { store } = setup()
	store.save('c1', FIELDS, source(), 0)
	expect(store.remove('c1')).toBeTrue()
	expect(store.remove('c1')).toBeFalse()
	expect(store.list()).toEqual([])
})
