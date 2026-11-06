import { afterEach, describe, expect, test } from 'bun:test'
import type { ProfileRecord, WorkspaceSnapshot } from 'api'
import { proxy, snapshot } from 'valtio'
import { type ConnectionState, removeConnection, saveConnection } from '../connection/connection'
import { forgetSite, removeSite, saveSite, selectSite, type SiteState } from '../location/site'
import { assignDevice, createProfile, deleteFramingReference, dismissNotifications, markNotificationsRead, deleteProfile, forgetConnection, type ProfileState, saveFramingReference, selectConnection, setExposureSettings, setFramingVisible, setMountRemoteBinding, setPanelOpen, setTelescopeOptics } from './profile'
import { PROFILE_SETTINGS_VERSION } from './schema'
import { WorkspaceSync, type WorkspaceSyncState } from './sync'

// A request the tab sent.
interface Sent {
	readonly method: string
	readonly path: string
	readonly body?: Record<string, unknown>
}

// Profile record of the server with nothing kept.
function record(id: string, patch: Partial<ProfileRecord> = {}): ProfileRecord {
	return { id, name: id, sortOrder: 0, revision: 1, createdAt: 0, equipment: {}, preferences: {}, cameras: {}, mountBindings: {}, framings: [], notifications: { readIds: [], dismissedIds: [] }, ...patch }
}

const stops: (() => void)[] = []

afterEach(() => {
	for (const stop of stops.splice(0)) stop()
})

// Workspace of a new database: its Default profile.
const NEW_WORKSPACE: WorkspaceSnapshot = { connections: [], sites: [], profiles: [record('p1', { name: 'Default' })] }

// Creates the stores of a tab and its synchronization over a fake server holding workspace, recording what the tab
// sent. answer replaces the answer of the server to a write.
function setup(workspace = NEW_WORKSPACE, answer?: (sent: Sent) => Response | undefined) {
	const connections = proxy<ConnectionState>({ open: false, connections: [], servers: [], errors: {} })
	const profiles = proxy<ProfileState>({ profiles: [], activeId: '', open: false })
	const sites = proxy<SiteState>({ sites: [] })
	const status = proxy<WorkspaceSyncState>({ loaded: false })
	const sent: Sent[] = []

	const request = ((input: string, init?: RequestInit) => {
		const path = input
		if (path === '/api/workspace') return Promise.resolve(Response.json(workspace))
		const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined
		const write: Sent = { method: init?.method ?? 'GET', path, ...(body && { body }) }
		sent.push(write)
		const answered = answer?.(write)
		if (answered) return Promise.resolve(answered)
		if (write.method === 'PUT' && body && 'revision' in body) return Promise.resolve(Response.json({ revision: (body.revision as number) + 1 }))
		return Promise.resolve(new Response(undefined, { status: 204 }))
	}) as typeof fetch

	const sync = new WorkspaceSync(connections, profiles, sites, status, request, 0)
	stops.push(sync.start())
	return { connections, profiles, sites, status, sync, sent }
}

// Fields of a site in São Paulo.
const HOME = { name: 'Home', latitude: -23.5475, longitude: -46.63611, elevation: 760, timeZone: 'America/Sao_Paulo' }

// Lets the stores notify the synchronization, then writes what it found.
async function settle(sync: WorkspaceSync) {
	await Bun.sleep(0)
	await sync.flush()
}

describe('loading', () => {
	test('the workspace of the server becomes the tab, on the first profile', async () => {
		const workspace: WorkspaceSnapshot = {
			connections: [{ id: 'c1', name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624, revision: 2 }],
			sites: [],
			profiles: [
				record('p1', {
					connectionId: 'c1',
					equipment: { c1: { MAIN_CAMERA: { id: 'cam', name: 'Camera' } } },
					preferences: { telescope: { version: PROFILE_SETTINGS_VERSION, value: { focalLength: 800, focalMultiplier: 1, aperture: 200 }, revision: 3 } },
					cameras: { c1: { cam: { exposure: { version: PROFILE_SETTINGS_VERSION, value: { exposureTime: 2 }, revision: 1 } } } },
					mountBindings: { c1: { mount: { lx200: { host: '0.0.0.0', port: 4030 } } } },
					framings: [{ id: 'f1', name: 'M 42', rightAscension: 1.46, declination: -0.09, source: 'manual', createdAt: 1, updatedAt: 1 }],
				}),
				record('p2', { sortOrder: 1 }),
			],
		}
		const { connections, profiles, status, sync, sent } = setup(workspace)

		expect(await sync.refresh()).toBeTrue()
		expect(status.loaded).toBeTrue()
		expect(connections.connections).toEqual([{ id: 'c1', name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624 }])
		expect(connections.selected).toBe('c1')
		expect(profiles.activeId).toBe('p1')
		expect(profiles.profiles.map(({ id }) => id)).toEqual(['p1', 'p2'])
		expect(snapshot(profiles).profiles[0]).toMatchObject({
			connectionId: 'c1',
			equipment: { c1: { MAIN_CAMERA: { id: 'cam', name: 'Camera' } } },
			settings: { telescope: { focalLength: 800 }, cameras: { c1: { cam: { exposure: { exposureTime: 2 } } } }, mountRemoteControl: { c1: { mount: { lx200: { port: 4030 } } } }, framingReferences: [{ id: 'f1', name: 'M 42' }] },
		})

		await settle(sync)
		expect(sent).toEqual([])
	})

	test('a value of another version of its shape is read as absent', async () => {
		const { profiles, sync } = setup({ connections: [], sites: [], profiles: [record('p1', { preferences: { telescope: { version: PROFILE_SETTINGS_VERSION + 1, value: { focalLength: 1 }, revision: 4 } } })] })
		await sync.refresh()
		expect(profiles.profiles[0].settings.telescope).toBeUndefined()
	})
})

describe('writes', () => {
	test('a preference is written once, from its revision, after the latest change', async () => {
		const { profiles, sync, sent } = setup()
		await sync.refresh()

		setTelescopeOptics(profiles, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		setTelescopeOptics(profiles, { focalLength: 500, focalMultiplier: 1, aperture: 80 })
		await settle(sync)

		expect(sent).toEqual([{ method: 'PUT', path: '/api/profiles/p1/preferences/telescope', body: { version: PROFILE_SETTINGS_VERSION, value: { focalLength: 500, focalMultiplier: 1, aperture: 80 }, revision: 0 } }])

		setTelescopeOptics(profiles, { focalLength: 600, focalMultiplier: 1, aperture: 80 })
		await settle(sync)
		expect(sent.at(-1)?.body).toMatchObject({ value: { focalLength: 600 }, revision: 1 })
	})

	test('tab memory is never written', async () => {
		const { profiles, sync, sent } = setup()
		await sync.refresh()

		setPanelOpen(profiles, 'sky', false)
		setFramingVisible(profiles, true)
		await settle(sync)

		expect(sent.map(({ path }) => path)).toEqual(['/api/profiles/p1/preferences/skyFraming'])
		expect(sent[0].body).toMatchObject({ value: { presets: [] } })

		setFramingVisible(profiles, false)
		await settle(sync)
		expect(sent).toHaveLength(1)
	})

	test('camera forms and bindings are written on every edit, whether the server or the tab created them', async () => {
		const workspace: WorkspaceSnapshot = {
			connections: [{ id: 'c1', name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624, revision: 1 }],
			sites: [],
			profiles: [
				record('p1', {
					connectionId: 'c1',
					cameras: { c1: { cam: { exposure: { version: PROFILE_SETTINGS_VERSION, value: { exposureTime: 5 }, revision: 2 } } } },
					mountBindings: { c1: { mount: { lx200: { host: '0.0.0.0', port: 4030 } } } },
				}),
			],
		}
		const { profiles, sync, sent } = setup(workspace)
		await sync.refresh()
		const written = () => sent.map(({ path, body }) => `${path} ${JSON.stringify(body)}`)

		for (const exposureTime of [7, 8]) {
			setExposureSettings(profiles, { connectionId: 'c1', deviceId: 'cam' }, { exposureTime })
			await settle(sync)
		}

		for (const exposureTime of [1, 2]) {
			setExposureSettings(profiles, { connectionId: 'c1', deviceId: 'other' }, { exposureTime })
			await settle(sync)
		}

		for (const port of [5000, 5001]) {
			setMountRemoteBinding(profiles, { connectionId: 'c1', deviceId: 'mount' }, 'lx200', { host: '0.0.0.0', port })
			await settle(sync)
		}

		expect(written()).toEqual([
			`/api/profiles/p1/cameras/c1/cam/exposure {"version":${PROFILE_SETTINGS_VERSION},"value":{"exposureTime":7},"revision":2}`,
			`/api/profiles/p1/cameras/c1/cam/exposure {"version":${PROFILE_SETTINGS_VERSION},"value":{"exposureTime":8},"revision":3}`,
			`/api/profiles/p1/cameras/c1/other/exposure {"version":${PROFILE_SETTINGS_VERSION},"value":{"exposureTime":1,"gain":0,"offset":0,"binX":1,"binY":1,"subframe":false,"x":0,"y":0,"width":0,"height":0,"frameFormat":""},"revision":0}`,
			`/api/profiles/p1/cameras/c1/other/exposure {"version":${PROFILE_SETTINGS_VERSION},"value":{"exposureTime":2,"gain":0,"offset":0,"binX":1,"binY":1,"subframe":false,"x":0,"y":0,"width":0,"height":0,"frameFormat":""},"revision":1}`,
			'/api/profiles/p1/mount-bindings/c1/mount/lx200 {"host":"0.0.0.0","port":5000}',
			'/api/profiles/p1/mount-bindings/c1/mount/lx200 {"host":"0.0.0.0","port":5001}',
		])
	})

	test('a new connection is saved before the profile that works with it and its equipment', async () => {
		const { connections, profiles, sync, sent } = setup()
		await sync.refresh()

		const saved = saveConnection(connections, { name: 'Simulator', host: '', port: 7624, type: 'SIMULATOR' })!
		selectConnection(profiles, saved.id)
		assignDevice(profiles, 'MAIN_CAMERA', { id: 'cam', name: 'Camera' })
		setExposureSettings(profiles, { connectionId: saved.id, deviceId: 'cam' }, { exposureTime: 3 })
		await settle(sync)

		expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual([`PUT /api/saved-connections/${saved.id}`, 'PUT /api/profiles/p1', `PUT /api/profiles/p1/equipment/${saved.id}`, `PUT /api/profiles/p1/cameras/${saved.id}/cam/exposure`])
		expect(sent[0].body).toEqual({ name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624, revision: 0 })
		expect(sent[1].body).toEqual({ name: 'Default', connectionId: saved.id, activeSiteId: null, sortOrder: 0, revision: 1 })
	})

	test('deletions and resets reach the server, and what went with a connection is not written', async () => {
		const workspace: WorkspaceSnapshot = {
			connections: [{ id: 'c1', name: 'Simulator', type: 'SIMULATOR', host: '', port: 7624, revision: 1 }],
			sites: [],
			profiles: [
				record('p1', {
					connectionId: 'c1',
					preferences: { dateTime: { version: PROFILE_SETTINGS_VERSION, value: { displayTimeZone: 'utc' }, revision: 2 } },
					cameras: { c1: { cam: { exposure: { version: PROFILE_SETTINGS_VERSION, value: { exposureTime: 2 }, revision: 1 } } } },
					framings: [{ id: 'f1', name: 'M 42', rightAscension: 1, declination: 0, source: 'manual', createdAt: 1, updatedAt: 1 }],
				}),
				record('p2', { sortOrder: 1 }),
			],
		}
		const { connections, profiles, sync, sent } = setup(workspace)
		await sync.refresh()

		delete profiles.profiles[0].settings.dateTime
		deleteFramingReference(profiles, 'f1')
		deleteProfile(profiles, 'p2')
		removeConnection(connections, 'c1')
		forgetConnection(profiles, 'c1')
		await settle(sync)

		expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(['PUT /api/profiles/p1', 'PUT /api/profiles/p1/preferences/dateTime', 'DELETE /api/profiles/p1/framing-references/f1', 'DELETE /api/profiles/p2', 'DELETE /api/saved-connections/c1'])
		expect(sent[1].body).toEqual({ version: PROFILE_SETTINGS_VERSION, value: null, revision: 2 })
	})

	test('a profile created in the tab is created on the server with its framings', async () => {
		const { profiles, sync, sent } = setup()
		await sync.refresh()

		const created = createProfile(profiles, 'Planetary')!
		profiles.activeId = created.id
		const framing = saveFramingReference(profiles, { name: 'Jupiter', rightAscension: 1, declination: 0.1, source: 'sky' }, 5)!
		await settle(sync)

		expect(sent).toEqual([
			{ method: 'PUT', path: `/api/profiles/${created.id}`, body: { name: 'Planetary', connectionId: null, activeSiteId: null, sortOrder: 1, revision: 0 } },
			{ method: 'PUT', path: `/api/profiles/${created.id}/framing-references/${framing.id}`, body: { name: 'Jupiter', rightAscension: 1, declination: 0.1, source: 'sky', createdAt: 5, updatedAt: 5 } },
		])
	})

	test('the notifications a profile read or dismissed are written as they grow, and come back with the profile', async () => {
		const { profiles, sync, sent } = setup()
		await sync.refresh()

		markNotificationsRead(profiles, ['n1'])
		dismissNotifications(profiles, ['n2'])
		await settle(sync)
		expect(sent).toEqual([{ method: 'PUT', path: '/api/profiles/p1/notifications', body: { readIds: ['n1', 'n2'], dismissedIds: ['n2'] } }])

		sync.handle({ type: 'profile:updated', profile: record('p1', { name: 'Default', notifications: { readIds: ['n1', 'n2', 'n3'], dismissedIds: ['n2'] } }) })
		expect(snapshot(profiles).profiles[0].settings.notifications).toEqual({ readIds: ['n1', 'n2', 'n3'], dismissedIds: ['n2'] })
	})

	test('a change the server could not receive is written again', async () => {
		let failures = 1
		const { profiles, sync, sent } = setup(undefined, () => {
			if (failures-- > 0) throw new Error('offline')
			return undefined
		})
		await sync.refresh()

		setTelescopeOptics(profiles, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		await settle(sync)
		expect(sent).toHaveLength(1)

		await sync.flush()
		expect(sent).toHaveLength(2)
		expect(sent[1].body).toMatchObject({ value: { focalLength: 400 }, revision: 0 })
	})
})

describe('other tabs', () => {
	test('a conflict shows what the server kept and says so', async () => {
		const { profiles, status, sync } = setup(undefined, ({ path }) =>
			path.endsWith('/preferences/telescope') ? Response.json({ error: 'It was changed by another tab', code: 'conflict', value: { version: PROFILE_SETTINGS_VERSION, value: { focalLength: 900, focalMultiplier: 1, aperture: 100 }, revision: 5 } }, { status: 409 }) : undefined,
		)
		await sync.refresh()

		setTelescopeOptics(profiles, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		await settle(sync)

		expect(profiles.profiles[0].settings.telescope).toEqual({ focalLength: 900, focalMultiplier: 1, aperture: 100 })
		expect(status.message).toContain('Another tab changed this first')
	})

	test('events apply to what the tab is not changing, never older than what it knows', async () => {
		const { profiles, sync, sent } = setup()
		await sync.refresh()

		const updated = record('p1', { name: 'Renamed', revision: 3, preferences: { telescope: { version: PROFILE_SETTINGS_VERSION, value: { focalLength: 300, focalMultiplier: 1, aperture: 60 }, revision: 2 } } })
		sync.handle({ type: 'profile:updated', profile: updated })
		expect(snapshot(profiles).profiles[0]).toMatchObject({ name: 'Renamed', settings: { telescope: { focalLength: 300 } } })

		sync.handle({ type: 'profile:updated', profile: record('p1', { name: 'Older', revision: 2 }) })
		expect(profiles.profiles[0].name).toBe('Renamed')

		sync.handle({ type: 'profile:updated', profile: record('p2', { sortOrder: 1 }) })
		expect(profiles.profiles.map(({ id }) => id)).toEqual(['p1', 'p2'])

		await settle(sync)
		expect(sent).toEqual([])
	})

	test('a profile another tab deleted goes, and the tab works with the first one', async () => {
		const { profiles, sync } = setup({ connections: [], sites: [], profiles: [record('p1'), record('p2', { sortOrder: 1 })] })
		await sync.refresh()
		profiles.activeId = 'p2'

		sync.handle({ type: 'profile:removed', id: 'p2' })
		expect(profiles.profiles.map(({ id }) => id)).toEqual(['p1'])
		expect(profiles.activeId).toBe('p1')
	})

	test('an event does not overwrite a change the tab has not written yet', async () => {
		const { profiles, sync, sent } = setup()
		await sync.refresh()

		setTelescopeOptics(profiles, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		await Bun.sleep(0)
		sync.handle({ type: 'profile:updated', profile: record('p1', { name: 'Default', preferences: { telescope: { version: PROFILE_SETTINGS_VERSION, value: { focalLength: 300, focalMultiplier: 1, aperture: 60 }, revision: 1 } } }) })
		expect(profiles.profiles[0].settings.telescope?.focalLength).toBe(400)

		await sync.flush()
		expect(sent[0].body).toMatchObject({ value: { focalLength: 400 }, revision: 0 })
	})
})

describe('observing sites', () => {
	test('a new site is saved before the profile that observes from it', async () => {
		const { profiles, sites, sync, sent } = setup()
		await sync.refresh()

		const site = saveSite(sites, HOME)!
		selectSite(profiles, sites, site.id)
		await settle(sync)

		expect(sent).toEqual([
			{ method: 'PUT', path: `/api/observing-sites/${site.id}`, body: { ...HOME, revision: 0 } },
			{ method: 'PUT', path: '/api/profiles/p1', body: { name: 'Default', connectionId: null, activeSiteId: site.id, sortOrder: 0, revision: 1 } },
		])
	})

	test('a deleted site is deleted after the profiles that observed from it are cleared', async () => {
		const { profiles, sites, sync, sent } = setup({ connections: [], sites: [{ id: 's1', ...HOME, revision: 1 }], profiles: [record('p1', { activeSiteId: 's1' })] })
		await sync.refresh()
		expect(profiles.profiles[0].activeSiteId).toBe('s1')

		removeSite(sites, 's1')
		forgetSite(profiles, 's1')
		await settle(sync)

		expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(['PUT /api/profiles/p1', 'DELETE /api/observing-sites/s1'])
		expect(sent[0].body).toMatchObject({ activeSiteId: null })
	})

	test('a conflict on a site shows what the server kept', async () => {
		const { sites, status, sync } = setup({ connections: [], sites: [{ id: 's1', ...HOME, revision: 1 }], profiles: [record('p1')] }, ({ path }) =>
			path === '/api/observing-sites/s1' ? Response.json({ error: 'It was changed by another tab', code: 'conflict', site: { id: 's1', ...HOME, name: 'Observatory', revision: 4 } }, { status: 409 }) : undefined,
		)
		await sync.refresh()

		saveSite(sites, { ...HOME, name: 'Backyard' }, 's1')
		await settle(sync)

		expect(sites.sites).toEqual([{ id: 's1', ...HOME, name: 'Observatory' }])
		expect(status.message).toContain('Another tab changed this first')
	})

	test('site events apply, never older than what the tab knows, and a removed one goes', async () => {
		const { sites, sync, sent } = setup()
		await sync.refresh()

		sync.handle({ type: 'observingSite:updated', site: { id: 's1', ...HOME, revision: 2 } })
		sync.handle({ type: 'observingSite:updated', site: { id: 's1', ...HOME, name: 'Older', revision: 1 } })
		expect(sites.sites).toEqual([{ id: 's1', ...HOME }])

		sync.handle({ type: 'observingSite:removed', id: 's1' })
		expect(sites.sites).toEqual([])

		await settle(sync)
		expect(sent).toEqual([])
	})

	test('the active site of a profile follows the server', async () => {
		const { profiles, sync } = setup({ connections: [], sites: [{ id: 's1', ...HOME, revision: 1 }], profiles: [record('p1')] })
		await sync.refresh()

		sync.handle({ type: 'profile:updated', profile: record('p1', { activeSiteId: 's1', revision: 2 }) })
		expect(profiles.profiles[0].activeSiteId).toBe('s1')

		sync.handle({ type: 'profile:updated', profile: record('p1', { revision: 3 }) })
		expect(profiles.profiles[0].activeSiteId).toBeUndefined()
	})
})

describe('events of the tab own writes', () => {
	test('an event published before the answer of a write never writes it again', async () => {
		const tab: { sync?: WorkspaceSync } = {}
		const { profiles, sites, sync, sent } = setup(undefined, ({ method, path, body }) => {
			if (method !== 'PUT' || !body) return undefined
			const revision = (body.revision as number) + 1
			// The server publishes a committed change before it answers the request that made it.
			if (path === '/api/profiles/p1/preferences/telescope') tab.sync!.handle({ type: 'profile:updated', profile: record('p1', { name: 'Default', preferences: { telescope: { version: PROFILE_SETTINGS_VERSION, value: body.value, revision } } }) })
			if (path.startsWith('/api/observing-sites/')) tab.sync!.handle({ type: 'observingSite:updated', site: { id: path.split('/').at(-1)!, ...(body as typeof HOME), revision } })
			return Response.json({ revision })
		})
		tab.sync = sync
		await sync.refresh()

		setTelescopeOptics(profiles, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		const site = saveSite(sites, HOME)!
		await settle(sync)
		await sync.flush()

		expect(sent.map(({ path }) => path)).toEqual([`/api/observing-sites/${site.id}`, '/api/profiles/p1/preferences/telescope'])
	})

	test('an event published before the answer of a deletion never deletes it again', async () => {
		const tab: { sync?: WorkspaceSync } = {}
		const { sites, sync, sent } = setup({ connections: [], sites: [{ id: 's1', ...HOME, revision: 1 }], profiles: [record('p1')] }, ({ method, path }) => {
			if (method === 'DELETE') tab.sync!.handle({ type: 'observingSite:removed', id: path.split('/').at(-1)! })
			return undefined
		})
		tab.sync = sync
		await sync.refresh()

		removeSite(sites, 's1')
		await settle(sync)
		await sync.flush()

		expect(sent.map(({ method, path }) => `${method} ${path}`)).toEqual(['DELETE /api/observing-sites/s1'])
	})

	test('a change made while its unit is being written is written after it', async () => {
		const tab: { sync?: WorkspaceSync } = {}
		let changed = false
		const { profiles, sync, sent } = setup(undefined, ({ method, body }) => {
			if (method !== 'PUT' || !body || changed) return undefined
			changed = true
			setTelescopeOptics(tab.sync!.profiles, { focalLength: 500, focalMultiplier: 1, aperture: 80 })
			return Response.json({ revision: (body.revision as number) + 1 })
		})
		tab.sync = sync
		await sync.refresh()

		setTelescopeOptics(profiles, { focalLength: 400, focalMultiplier: 1, aperture: 80 })
		await settle(sync)
		await settle(sync)

		expect(sent.map(({ body }) => (body!.value as { focalLength: number }).focalLength)).toEqual([400, 500])
	})
})
