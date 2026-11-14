import { expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { type CameraBindingEvent, createEquipmentCatalogRoutes, EquipmentCatalog } from './equipmentcatalog'
import { Workspace, type WorkspaceEvent } from './workspace'

// Creates the catalog of a database in memory whose Equipment Catalog holds the cameras a and b, over one open camera
// device (connection c1, device d1) and the events it publishes.
function setup(database = AppDatabase.memory()) {
	const events: CameraBindingEvent[] = []
	const workspaceEvents: WorkspaceEvent[] = []
	const workspace = new Workspace(database, (event) => workspaceEvents.push(event))
	for (const id of ['a', 'b']) workspace.saveCatalogCamera(id, { name: `Camera ${id}`, archived: false, revision: 0 })
	const catalog = new EquipmentCatalog(
		database,
		({ connectionId, deviceId }) => (connectionId === 'c1' && deviceId === 'd1' ? { hardwareId: 'h1', name: 'ZWO ASI2600MM' } : undefined),
		(event) => events.push(event),
	)
	return { catalog, workspace, events, workspaceEvents, database }
}

test('a device is bound to one camera of the catalog, bound again, and unbound, each change published', () => {
	const { catalog, events } = setup()
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBeUndefined()

	expect(catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' }, 10)).toEqual({ status: 'saved', binding: { connectionId: 'c1', deviceId: 'd1', hardwareId: 'h1', deviceName: 'ZWO ASI2600MM', cameraId: 'a', boundAt: 10 } })
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBe('a')
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'b' })
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBe('b')
	catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: null })
	expect(catalog.cameraOf({ connectionId: 'c1', deviceId: 'd1' })).toBeUndefined()

	expect(events.map((event) => event.binding?.cameraId)).toEqual(['a', 'b', undefined])
})

test('only a camera device of an open connection is bound, and only to a camera of the catalog', () => {
	const { catalog, events } = setup()
	expect(catalog.bind({ connectionId: 'c1', deviceId: 'other', cameraId: 'a' })).toEqual({ status: 'notFound', what: 'device' })
	expect(catalog.bind({ connectionId: 'c1', deviceId: 'd1', cameraId: 'missing' })).toEqual({ status: 'notFound', what: 'camera' })
	expect(events).toEqual([])
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
	expect(events.at(-1)).toEqual({ type: 'catalogCamera:bindingChanged', connectionId: 'c1', deviceId: 'd1' })
})

test('the routes list and change the bindings', async () => {
	const { catalog } = setup()
	const routes = createEquipmentCatalogRoutes(catalog)
	const put = (body: unknown) => routes['/api/equipment-catalog/bindings'].PUT(new Request('http://localhost/api/equipment-catalog/bindings', { method: 'PUT', body: JSON.stringify(body) }) as Parameters<(typeof routes)['/api/equipment-catalog/bindings']['PUT']>[0])

	expect((await put({ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' })).status).toBe(200)
	expect((await put({ connectionId: 'c1', deviceId: 'd2', cameraId: 'a' })).status).toBe(404)
	expect(await routes['/api/equipment-catalog/bindings'].GET().json()).toMatchObject({ bindings: [{ connectionId: 'c1', deviceId: 'd1', cameraId: 'a' }] })
})
