import { afterEach, describe, expect, test } from 'bun:test'
import type { ProfileRecord, WorkspaceSnapshot } from 'api'
import { proxy, snapshot } from 'valtio'
import type { ConnectionState } from '../connection/connection'
import { deleteProfile, type ProfileState, selectProfile, setImageProcessingPipeline, setLastImageDirectory, setPanelOpen, setSkyTimeBarVisible } from './profile'
import { PROFILE_SETTINGS_VERSION } from './schema'
import { WorkspaceSync, type WorkspaceSyncState } from './sync'
import { ViewPersistence, type ViewStorages } from './view'

// Storage area of a browser, in memory.
class MemoryStorage {
	readonly items = new Map<string, string>()

	getItem(key: string) {
		return this.items.get(key) ?? null
	}

	setItem(key: string, value: string) {
		this.items.set(key, value)
	}

	removeItem(key: string) {
		this.items.delete(key)
	}
}

// Storage that refuses every access, as a private window or blocked site data does.
const BLOCKED = {
	getItem: () => {
		throw new Error('SecurityError')
	},
	setItem: () => {
		throw new Error('QuotaExceededError')
	},
	removeItem: () => {
		throw new Error('SecurityError')
	},
}

function record(id: string, patch: Partial<ProfileRecord> = {}): ProfileRecord {
	return { id, name: id, sortOrder: 0, revision: 1, createdAt: 0, equipment: {}, preferences: {}, cameras: {}, mountBindings: {}, framings: [], notifications: { readIds: [], dismissedIds: [] }, ...patch }
}

const WORKSPACE: WorkspaceSnapshot = { connections: [], profiles: [record('p1'), record('p2', { sortOrder: 1 })] }

const stops: (() => void)[] = []

afterEach(() => {
	for (const stop of stops.splice(0)) stop()
})

// Opens a tab over storages and a fake server holding workspace, returning its stores and what it wrote to the server.
async function tab(storages: ViewStorages, workspace = WORKSPACE) {
	const connections = proxy<ConnectionState>({ open: false, connections: [], servers: [], errors: {} })
	const profiles = proxy<ProfileState>({ profiles: [], activeId: '', open: false })
	const status = proxy<WorkspaceSyncState>({ loaded: false })
	const sent: string[] = []
	const request = ((path: string, init?: RequestInit) => {
		if (path === '/api/workspace') return Promise.resolve(Response.json(workspace))
		sent.push(`${init?.method} ${path}`)
		return Promise.resolve(new Response(undefined, { status: 204 }))
	}) as typeof fetch
	const sync = new WorkspaceSync(connections, profiles, status, request, 0)
	stops.push(sync.start(), new ViewPersistence(profiles, status, storages).start())
	await sync.refresh()
	return { profiles, sync, sent }
}

// Lets the stores notify their subscribers, then writes what the synchronization found.
async function settle(sync: WorkspaceSync) {
	await Bun.sleep(0)
	await sync.flush()
}

describe('view state', () => {
	test('each field comes back from the storage it is kept in, and none reaches the server', async () => {
		const local = new MemoryStorage()
		const first = { local, session: new MemoryStorage() }
		const before = await tab(first)

		selectProfile(before.profiles, 'p2')
		setPanelOpen(before.profiles, 'images', false)
		setLastImageDirectory(before.profiles, '/data/frames')
		setImageProcessingPipeline(before.profiles, [{ enabled: true, operation: { type: 'invert' } } as never])
		setSkyTimeBarVisible(before.profiles, true)
		await settle(before.sync)
		expect(before.sent).toEqual([])

		// A reload of the same tab keeps its session.
		const reloaded = await tab(first)
		expect(reloaded.profiles.activeId).toBe('p2')
		expect(snapshot(reloaded.profiles).profiles[1].settings).toMatchObject({ panels: { images: false }, lastImageDirectory: '/data/frames', imageProcessing: [{ enabled: true, operation: { type: 'invert' } }], sky: { timeBar: true } })
		expect(reloaded.profiles.profiles[0].settings.panels).toEqual({})

		// A new tab of the same browser keeps what is local, and starts on the profile used last.
		const other = await tab({ local, session: new MemoryStorage() })
		expect(other.profiles.activeId).toBe('p2')
		expect(snapshot(other.profiles).profiles[1].settings).toMatchObject({ panels: { images: false }, lastImageDirectory: '/data/frames' })
		expect(other.profiles.profiles[1].settings.sky.timeBar).toBeUndefined()

		await settle(other.sync)
		expect(other.sent).toEqual([])
	})

	test('a profile that is gone takes its documents, and an unknown active profile opens the first one', async () => {
		const storages = { local: new MemoryStorage(), session: new MemoryStorage() }
		const before = await tab(storages)
		selectProfile(before.profiles, 'p2')
		setPanelOpen(before.profiles, 'sky', false)
		await Bun.sleep(0)
		expect(storages.local.items.has('nebulosa:view:p2')).toBeTrue()

		deleteProfile(before.profiles, 'p2')
		await Bun.sleep(0)
		expect(storages.local.items.has('nebulosa:view:p2')).toBeFalse()

		const after = await tab(storages, { connections: [], profiles: [record('p1')] })
		expect(after.profiles.activeId).toBe('p1')
	})

	test('a document of another version, or unreadable, is ignored and replaced', async () => {
		const local = new MemoryStorage()
		local.setItem('nebulosa:view:p1', JSON.stringify({ version: 99, fields: { lastImageDirectory: '/old' } }))
		local.setItem('nebulosa:view:p2', '{broken')
		const { profiles, sync } = await tab({ local, session: new MemoryStorage() })
		expect(profiles.profiles.map(({ settings }) => settings.lastImageDirectory)).toEqual([undefined, undefined])

		setLastImageDirectory(profiles, '/new')
		await settle(sync)
		expect(JSON.parse(local.getItem('nebulosa:view:p1')!)).toEqual({ version: 1, fields: { lastImageDirectory: '/new' } })
	})

	test('the drawn framing applies to the presets the server kept, never creating a framing', async () => {
		const framing = {
			version: PROFILE_SETTINGS_VERSION,
			value: {
				presets: [
					{ id: 'a', name: 'A' },
					{ id: 'b', name: 'B' },
				],
			},
			revision: 1,
		}
		const local = new MemoryStorage()
		local.setItem('nebulosa:view:p1', JSON.stringify({ version: 1, fields: { skyFraming: { activePresetId: 'b', visible: true, source: 'custom' } } }))
		local.setItem('nebulosa:view:p2', JSON.stringify({ version: 1, fields: { skyFraming: { activePresetId: 'gone', visible: true } } }))
		const { profiles, sync, sent } = await tab({ local, session: new MemoryStorage() }, { connections: [], profiles: [record('p1', { preferences: { skyFraming: framing } }), record('p2', { sortOrder: 1 })] })

		expect(snapshot(profiles).profiles[0].settings.sky.framing).toMatchObject({ activePresetId: 'b', visible: true, source: 'custom' })
		expect(profiles.profiles[1].settings.sky.framing).toBeUndefined()
		await settle(sync)
		expect(sent).toEqual([])
	})

	test('storage that cannot be used leaves the view in memory', async () => {
		const { profiles, sync } = await tab({ local: BLOCKED, session: BLOCKED })
		expect(profiles.activeId).toBe('p1')
		setPanelOpen(profiles, 'images', false)
		await settle(sync)
		expect(profiles.profiles[0].settings.panels).toEqual({ images: false })
	})
})
