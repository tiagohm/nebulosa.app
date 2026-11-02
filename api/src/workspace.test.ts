import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import { createWorkspaceRoutes, DEFAULT_PROFILE_NAME, type ProfileRecord, type SavedConnection, Workspace, type WorkspaceEvent, type WorkspaceSnapshot } from './workspace'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-workspace-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

type Routes = ReturnType<typeof createWorkspaceRoutes>
type Handler = (req: Request) => Response | Promise<Response>

// Creates a workspace over a database in memory, with its Default profile, recording its events.
function setup(database = AppDatabase.memory()) {
	const events: WorkspaceEvent[] = []
	const workspace = new Workspace(database, (event) => events.push(event))
	workspace.ensureProfile()
	const routes = createWorkspaceRoutes(workspace)
	const profileId = workspace.snapshot().profiles[0].id
	return { workspace, routes, events, database, profileId }
}

// Calls a route of the workspace with its path parameters.
function call(routes: Routes, path: keyof Routes, method: string, params: Record<string, string> = {}, body?: unknown) {
	const handler = (routes[path] as unknown as Record<string, Handler>)[method]
	const req = new Request(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
	return handler(Object.assign(req, { params }))
}

// Saves a simulator connection and returns it.
async function saveSimulator(routes: Routes, id = 'sim') {
	const response = await call(routes, '/api/saved-connections/:id', 'PUT', { id }, { name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624, revision: 0 })
	expect(response.status).toBe(200)
	return (await response.json()) as SavedConnection
}

test('a new database has one Default profile, and only one', async () => {
	const { workspace, routes } = setup()
	expect(workspace.ensureProfile()).toBeFalse()

	const snapshot = (await (await call(routes, '/api/workspace', 'GET')).json()) as WorkspaceSnapshot
	expect(snapshot.connections).toEqual([])
	expect(snapshot.profiles).toEqual([{ id: expect.any(String), name: DEFAULT_PROFILE_NAME, sortOrder: 0, revision: 1, createdAt: expect.any(Number), equipment: {}, preferences: {}, cameras: {}, mountBindings: {}, framings: [], notifications: { readIds: [], dismissedIds: [] } }])
})

test('the workspace survives a restart', async () => {
	const file = join(root, 'restart', 'nebulosa.sqlite')
	const first = setup(new AppDatabase(file))
	await saveSimulator(first.routes)
	await call(first.routes, '/api/profiles/:id', 'PUT', { id: first.profileId }, { name: 'Deep Sky', connectionId: 'sim', sortOrder: 0, revision: 1 })
	await call(first.routes, '/api/profiles/:id/preferences/:key', 'PUT', { id: first.profileId, key: 'telescope' }, { version: 1, value: { focalLength: 800, focalMultiplier: 1, aperture: 200 }, revision: 0 })
	const before = first.workspace.snapshot()
	first.database.close()

	const second = setup(new AppDatabase(file))
	expect(second.workspace.snapshot()).toEqual(before)
	second.database.close()
})

test('saved connections are created, edited from their revision, and refused when outdated', async () => {
	const { routes, events } = setup()
	expect(await saveSimulator(routes)).toEqual({ id: 'sim', name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624, revision: 1 })

	const edited = await call(routes, '/api/saved-connections/:id', 'PUT', { id: 'sim' }, { name: 'Sim', type: 'SIMULATOR', host: '', port: 7624, revision: 1 })
	expect(await edited.json()).toMatchObject({ name: 'Sim', revision: 2 })

	const stale = await call(routes, '/api/saved-connections/:id', 'PUT', { id: 'sim' }, { name: 'Other', type: 'SIMULATOR', host: '', port: 7624, revision: 1 })
	expect(stale.status).toBe(409)
	expect(await stale.json()).toMatchObject({ code: 'conflict', connection: { name: 'Sim', revision: 2 } })
	expect(events.filter((event) => event.type === 'savedConnection:updated')).toHaveLength(2)
})

test('a profile edit from an outdated revision is refused with the current profile', async () => {
	const { routes, profileId } = setup()
	expect((await call(routes, '/api/profiles/:id', 'PUT', { id: profileId }, { name: 'A', connectionId: null, sortOrder: 0, revision: 1 })).status).toBe(200)

	const stale = await call(routes, '/api/profiles/:id', 'PUT', { id: profileId }, { name: 'B', connectionId: null, sortOrder: 0, revision: 1 })
	expect(stale.status).toBe(409)
	expect(await stale.json()).toMatchObject({ code: 'conflict', profile: { name: 'A', revision: 2 } })
})

test('a profile cannot work with a connection that is not saved', async () => {
	const { routes, profileId } = setup()
	const response = await call(routes, '/api/profiles/:id', 'PUT', { id: profileId }, { name: 'A', connectionId: 'missing', sortOrder: 0, revision: 1 })
	expect(response.status).toBe(404)
})

test('the last profile is never deleted', async () => {
	const { routes, profileId, events } = setup()
	const refused = await call(routes, '/api/profiles/:id', 'DELETE', { id: profileId })
	expect(refused.status).toBe(409)
	expect(await refused.json()).toMatchObject({ code: 'lastProfile' })

	await call(routes, '/api/profiles/:id', 'PUT', { id: 'second' }, { name: 'Second', connectionId: null, sortOrder: 1, revision: 0 })
	expect((await call(routes, '/api/profiles/:id', 'DELETE', { id: profileId })).status).toBe(204)
	expect(events.at(-1)).toEqual({ type: 'profile:removed', id: profileId })
})

test('preferences and camera forms are saved from their revision and keep the version of their shape', async () => {
	const { workspace, routes, profileId } = setup()
	await saveSimulator(routes)

	const saved = await call(routes, '/api/profiles/:id/preferences/:key', 'PUT', { id: profileId, key: 'starProfile' }, { version: 3, value: { minSNR: 5 }, revision: 0 })
	expect(await saved.json()).toEqual({ version: 3, value: { minSNR: 5 }, revision: 1 })

	const stale = await call(routes, '/api/profiles/:id/preferences/:key', 'PUT', { id: profileId, key: 'starProfile' }, { version: 3, value: { minSNR: 9 }, revision: 0 })
	expect(stale.status).toBe(409)
	expect(await stale.json()).toMatchObject({ code: 'conflict', value: { value: { minSNR: 5 }, revision: 1 } })

	const form = await call(routes, '/api/profiles/:id/cameras/:connectionId/:deviceId/:form', 'PUT', { id: profileId, connectionId: 'sim', deviceId: 'camera', form: 'exposure' }, { version: 3, value: { exposureTime: 2 }, revision: 0 })
	expect(form.status).toBe(200)

	const reset = await call(routes, '/api/profiles/:id/preferences/:key', 'PUT', { id: profileId, key: 'starProfile' }, { version: 3, value: null, revision: 1 })
	expect(await reset.json()).toEqual({ version: 3, value: null, revision: 2 })

	expect(workspace.profile(profileId)).toMatchObject({ preferences: { starProfile: { value: null, revision: 2 } }, cameras: { sim: { camera: { exposure: { version: 3, value: { exposureTime: 2 }, revision: 1 } } } } })
})

test('a camera form of a connection that is not saved is refused', async () => {
	const { routes, profileId } = setup()
	const response = await call(routes, '/api/profiles/:id/cameras/:connectionId/:deviceId/:form', 'PUT', { id: profileId, connectionId: 'missing', deviceId: 'camera', form: 'exposure' }, { version: 1, value: {}, revision: 0 })
	expect(response.status).toBe(404)
})

test('deleting a saved connection drops what every profile keeps on it and publishes those profiles', async () => {
	const { workspace, routes, events, profileId } = setup()
	await saveSimulator(routes)
	await call(routes, '/api/profiles/:id', 'PUT', { id: profileId }, { name: 'Default', connectionId: 'sim', sortOrder: 0, revision: 1 })
	await call(routes, '/api/profiles/:id/equipment/:connectionId', 'PUT', { id: profileId, connectionId: 'sim' }, { setup: { MAIN_CAMERA: { id: 'camera', name: 'Camera Simulator' } } })
	await call(routes, '/api/profiles/:id/cameras/:connectionId/:deviceId/:form', 'PUT', { id: profileId, connectionId: 'sim', deviceId: 'camera', form: 'exposure' }, { version: 1, value: {}, revision: 0 })
	await call(routes, '/api/profiles/:id/mount-bindings/:connectionId/:deviceId/:protocol', 'PUT', { id: profileId, connectionId: 'sim', deviceId: 'mount', protocol: 'lx200' }, { host: '0.0.0.0', port: 10002 })
	await call(routes, '/api/profiles/:id/preferences/:key', 'PUT', { id: profileId, key: 'telescope' }, { version: 1, value: { focalLength: 400 }, revision: 0 })
	expect(workspace.profile(profileId)).toMatchObject({ connectionId: 'sim', equipment: { sim: { MAIN_CAMERA: { id: 'camera' } } }, mountBindings: { sim: { mount: { lx200: { port: 10002 } } } } })

	events.length = 0
	expect((await call(routes, '/api/saved-connections/:id', 'DELETE', { id: 'sim' })).status).toBe(204)

	const profile = workspace.profile(profileId)!
	expect(profile.connectionId).toBeUndefined()
	expect(profile).toMatchObject({ equipment: {}, cameras: {}, mountBindings: {}, preferences: { telescope: { value: { focalLength: 400 } } } })
	expect(events).toEqual([
		{ type: 'savedConnection:removed', id: 'sim' },
		{ type: 'profile:updated', profile },
	])
})

test('equipment setups replace the roles of their connection', async () => {
	const { workspace, routes, profileId } = setup()
	await saveSimulator(routes)
	await call(routes, '/api/profiles/:id/equipment/:connectionId', 'PUT', { id: profileId, connectionId: 'sim' }, { setup: { MAIN_CAMERA: { id: 'a', name: 'A' }, MOUNT: { id: 'm', name: 'M' } } })
	await call(routes, '/api/profiles/:id/equipment/:connectionId', 'PUT', { id: profileId, connectionId: 'sim' }, { setup: { MOUNT: { id: 'm', name: 'M' } } })
	expect(workspace.profile(profileId)!.equipment).toEqual({ sim: { MOUNT: { id: 'm', name: 'M' } } })
})

test('framings are saved, renamed, and deleted', async () => {
	const { workspace, routes, profileId } = setup()
	const framing = { name: 'M31', rightAscension: 0.18, declination: 0.72, source: 'sky', createdAt: 1, updatedAt: 1 }
	expect((await call(routes, '/api/profiles/:id/framing-references/:framingId', 'PUT', { id: profileId, framingId: 'f1' }, framing)).status).toBe(204)
	await call(routes, '/api/profiles/:id/framing-references/:framingId', 'PUT', { id: profileId, framingId: 'f1' }, { ...framing, name: 'Andromeda', updatedAt: 2 })
	expect(workspace.profile(profileId)!.framings).toEqual([{ id: 'f1', ...framing, name: 'Andromeda', updatedAt: 2 }] as ProfileRecord['framings'])

	expect((await call(routes, '/api/profiles/:id/framing-references/:framingId', 'DELETE', { id: profileId, framingId: 'f1' })).status).toBe(204)
	expect(workspace.profile(profileId)!.framings).toEqual([])
})

test('deleting a profile deletes everything it keeps', async () => {
	const { database, routes, profileId } = setup()
	await saveSimulator(routes)
	await call(routes, '/api/profiles/:id', 'PUT', { id: 'second' }, { name: 'Second', connectionId: 'sim', sortOrder: 1, revision: 0 })
	await call(routes, '/api/profiles/:id/preferences/:key', 'PUT', { id: 'second', key: 'telescope' }, { version: 1, value: {}, revision: 0 })
	await call(routes, '/api/profiles/:id/cameras/:connectionId/:deviceId/:form', 'PUT', { id: 'second', connectionId: 'sim', deviceId: 'camera', form: 'exposure' }, { version: 1, value: {}, revision: 0 })
	await call(routes, '/api/profiles/:id/framing-references/:framingId', 'PUT', { id: 'second', framingId: 'f' }, { name: 'X', rightAscension: 0, declination: 0, source: 'manual', createdAt: 1, updatedAt: 1 })

	await call(routes, '/api/profiles/:id', 'DELETE', { id: 'second' })

	for (const table of ['profile_preferences', 'profile_camera_settings', 'framing_references']) {
		expect(database.db.query(`SELECT count(*) AS count FROM ${table} WHERE profile_id = 'second'`).get()).toEqual({ count: 0 })
	}

	expect(database.db.query('SELECT id FROM profiles').all()).toEqual([{ id: profileId }])
})

test('events are published only after a write commits', () => {
	const { database, routes, events, profileId } = setup()
	database.db.run('PRAGMA query_only = ON')
	expect(Promise.resolve(call(routes, '/api/profiles/:id', 'PUT', { id: profileId }, { name: 'X', connectionId: null, sortOrder: 0, revision: 1 }))).rejects.toThrow()
	expect(events).toEqual([])
})
