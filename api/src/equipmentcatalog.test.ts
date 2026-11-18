import { expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { type CameraBindingEvent, createEquipmentCatalogRoutes, EquipmentCatalog } from './equipmentcatalog'
import { Workspace, type WorkspaceEvent } from './workspace'

// Creates the catalog of a database in memory whose Equipment Catalog holds the cameras a and b, over two open camera
// devices (connection c1, devices d1 and d3 of hardware h1 and h3, d1 also reached through connection c2) and the events
// it publishes.
function setup(database = AppDatabase.memory()) {
	const events: CameraBindingEvent[] = []
	const workspaceEvents: WorkspaceEvent[] = []
	const workspace = new Workspace(database, (event) => workspaceEvents.push(event))
	for (const id of ['a', 'b']) workspace.saveCatalogCamera(id, { name: `Camera ${id}`, archived: false, revision: 0 })
	const catalog = new EquipmentCatalog(
		database,
		({ connectionId, deviceId }) => (connectionId !== 'c1' && connectionId !== 'c2' ? undefined : deviceId === 'd1' ? { hardwareId: 'h1', name: 'ZWO ASI2600MM' } : deviceId === 'd3' && connectionId === 'c1' ? { hardwareId: 'h3', name: 'ZWO ASI120MM' } : undefined),
		(event) => events.push(event),
	)
	return { catalog, workspace, events, workspaceEvents, database }
}

test('a device is bound to one camera of the catalog, bound again, and unbound, each change published', () => {
	const { catalog, events } = setup()
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBeUndefined()

	expect(catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' }, 10)).toEqual({ status: 'saved', binding: { hardwareId: 'h1', connectionId: 'c1', deviceId: 'd1', deviceName: 'ZWO ASI2600MM', cameraId: 'a', boundAt: 10 } })
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBe('a')
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'b' })
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBe('b')
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: null })
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBeUndefined()

	expect(events.map((event) => event.binding?.cameraId)).toEqual(['a', 'b', undefined])
})

test('a camera of the catalog is bound to one device at most, binding it again unbinding the previous device', () => {
	const { catalog, events } = setup()
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' })
	catalog.bind({ connectionId: 'c1', deviceId: 'd3', cameraId: 'a' })

	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBeUndefined()
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd3' })).toBe('a')
	expect(events.slice(1).map(({ hardwareId, binding }) => [hardwareId, binding?.cameraId])).toEqual([
		['h1', undefined],
		['h3', 'a'],
	])
	expect(new EquipmentCatalog(catalog.database, () => undefined).snapshot().bindings.map(({ deviceId }) => deviceId)).toEqual(['d3'])
})

test('only a camera device of an open connection is bound, and only to a camera of the catalog', () => {
	const { catalog, events } = setup()
	expect(catalog.bind({ connectionId: 'c1', deviceId: 'other', cameraId: 'a' })).toEqual({ status: 'notFound', what: 'device' })
	expect(catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'missing' })).toEqual({ status: 'notFound', what: 'camera' })
	expect(events).toEqual([])
})

test('a device has one binding by its hardware, whatever connection reaches it', () => {
	const { catalog } = setup()
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' })
	catalog.bind({ connectionId: 'c2', deviceId: 'd1', cameraId: 'b' })

	expect(catalog.snapshot().bindings).toEqual([{ hardwareId: 'h1', connectionId: 'c2', deviceId: 'd1', deviceName: 'ZWO ASI2600MM', cameraId: 'b', boundAt: expect.any(Number) }])
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBe('b')
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: null })
	expect(catalog.snapshot().bindings).toEqual([])
})

test('the bindings survive a restart', () => {
	const { catalog, database } = setup()
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' })
	const restarted = new EquipmentCatalog(database, () => undefined)
	expect(restarted.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBe('a')
	expect(restarted.snapshot().bindings.map(({ cameraId }) => cameraId)).toEqual(['a'])
})

test('deleting a camera of the catalog removes its bindings, published as unbound', () => {
	const { catalog, workspace, events } = setup()
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' })
	expect(workspace.removeCatalogCamera('a')).toEqual({ status: 'removed' })
	catalog.cameraRemoved('a')

	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBeUndefined()
	expect(new EquipmentCatalog(catalog.database, () => undefined).snapshot().bindings).toEqual([])
	expect(events.at(-1)).toEqual({ type: 'catalogCamera:bindingChanged', hardwareId: 'h1' })
})

test('the routes list and change the bindings', async () => {
	const { catalog } = setup()
	const routes = createEquipmentCatalogRoutes(catalog)
	const put = (body: unknown) => routes['/api/equipment-catalog/bindings'].PUT(new Request('http://localhost/api/equipment-catalog/bindings', { method: 'PUT', body: JSON.stringify(body) }) as Parameters<(typeof routes)['/api/equipment-catalog/bindings']['PUT']>[0])

	expect((await put({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' })).status).toBe(200)
	expect((await put({ connectionId: 'c1', deviceId: 'd2', cameraId: 'a' })).status).toBe(404)
	expect(await routes['/api/equipment-catalog/bindings'].GET().json()).toMatchObject({ bindings: [{ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' }] })
})
