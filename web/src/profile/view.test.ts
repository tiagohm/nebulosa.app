import { afterEach, describe, expect, test } from 'bun:test'
import type { ProfileRecord, WorkspaceSnapshot } from 'api'
import { proxy, snapshot } from 'valtio'
import type { TargetCenteringRuntime } from '../camera/targetcentering'
import type { ConnectionState } from '../connection/connection'
import type { ImagesState } from '../images/images'
import type { CollapsibleSections } from '../shell/collapsible'
import { deleteProfile, type ProfileState, selectProfile, setCameraFramesShown, setImageProcessingPipeline, setLastImageDirectory, setPanelOpen, setSkyTimeBarVisible } from './profile'
import { PROFILE_SETTINGS_VERSION } from './schema'
import { WorkspaceSync, type WorkspaceSyncState } from './sync'
import { activeCameraTabEntry, cameraToolsEntry, centeringTargetsEntry, keepViewEntries, sectionsEntry, ViewPersistence, type ViewStorages } from './view'

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
		setCameraFramesShown(before.profiles, false)
		await settle(before.sync)
		expect(before.sent).toEqual([])

		// A reload of the same tab keeps its session.
		const reloaded = await tab(first)
		expect(reloaded.profiles.activeId).toBe('p2')
		expect(snapshot(reloaded.profiles).profiles[1].settings).toMatchObject({ panels: { images: false }, lastImageDirectory: '/data/frames', framesHidden: true, imageProcessing: [{ enabled: true, operation: { type: 'invert' } }], sky: { timeBar: true } })
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

describe('view entries', () => {
	// Camera tab of an Images state, showing tool.
	function cameraTab(images: ImagesState, key: string, tool = 'inspector') {
		images.documents.push({ key, camera: { selection: { kind: 'latest' } } } as never)
		images.tools[key] = { tool } as never
	}

	test('expanded sections come back in every tab of the browser, and a section toggled before keeps its state', async () => {
		const local = new MemoryStorage()
		const sections = proxy<CollapsibleSections>({})
		stops.push(keepViewEntries([sectionsEntry(sections)], { local, session: new MemoryStorage() }))
		sections['sky.position'] = false
		sections['images.inspector.storage'] = true
		await Bun.sleep(0)

		const other = proxy<CollapsibleSections>({ 'sky.position': true })
		stops.push(keepViewEntries([sectionsEntry(other)], { local, session: new MemoryStorage() }))
		expect(snapshot(other)).toEqual({ 'sky.position': true, 'images.inspector.storage': true })
	})

	test('a camera tab gets back the tool it showed in this tab, and only once', async () => {
		const session = new MemoryStorage()
		const before = proxy<ImagesState>({ documents: [], views: {}, tools: {} })
		stops.push(keepViewEntries([cameraToolsEntry(before)], { local: new MemoryStorage(), session }))
		cameraTab(before, 'camera:c1:main')
		await Bun.sleep(0)
		before.tools['camera:c1:main'].tool = 'camera-acquisition'
		cameraTab(before, 'camera:c1:guide', 'guiding')
		await Bun.sleep(0)

		// The guide camera is not connected after the reload; its tool is kept for its return.
		const after = proxy<ImagesState>({ documents: [], views: {}, tools: {} })
		stops.push(keepViewEntries([cameraToolsEntry(after)], { local: new MemoryStorage(), session }))
		cameraTab(after, 'camera:c1:main')
		await Bun.sleep(0)
		expect(after.tools['camera:c1:main'].tool).toBe('camera-acquisition')
		expect(JSON.parse(session.getItem('nebulosa:cameraTools')!).value).toEqual({ 'camera:c1:main': 'camera-acquisition', 'camera:c1:guide': 'guiding' })

		after.tools['camera:c1:main'].tool = 'auto-focus'
		await Bun.sleep(0)
		expect(after.tools['camera:c1:main'].tool).toBe('auto-focus')

		cameraTab(after, 'camera:c1:guide')
		await Bun.sleep(0)
		expect(after.tools['camera:c1:guide'].tool).toBe('guiding')
	})

	test('the camera tab selected last is selected again once its camera has a tab, not the first one shown', async () => {
		const session = new MemoryStorage()
		const before = proxy<ImagesState>({ documents: [], views: {}, tools: {} })
		stops.push(keepViewEntries([activeCameraTabEntry(before)], { local: new MemoryStorage(), session }))
		cameraTab(before, 'camera:c1:guide')
		cameraTab(before, 'camera:c1:main')
		before.activeKey = 'camera:c1:main'
		await Bun.sleep(0)
		before.documents.push({ key: 'file' } as never)
		before.activeKey = 'file'
		await Bun.sleep(0)
		expect(JSON.parse(session.getItem('nebulosa:activeCameraTab')!).value).toBe('camera:c1:main')

		// After the reload the guide camera has its tab first, and the workspace shows it.
		const after = proxy<ImagesState>({ documents: [], views: {}, tools: {} })
		stops.push(keepViewEntries([activeCameraTabEntry(after)], { local: new MemoryStorage(), session }))
		cameraTab(after, 'camera:c1:guide')
		after.activeKey = 'camera:c1:guide'
		await Bun.sleep(0)
		expect(JSON.parse(session.getItem('nebulosa:activeCameraTab')!).value).toBe('camera:c1:main')
		cameraTab(after, 'camera:c1:main')
		await Bun.sleep(0)
		expect(after.activeKey).toBe('camera:c1:main')

		after.activeKey = 'camera:c1:guide'
		await Bun.sleep(0)
		expect(after.activeKey).toBe('camera:c1:guide')
		expect(JSON.parse(session.getItem('nebulosa:activeCameraTab')!).value).toBe('camera:c1:guide')
	})

	test('a camera tab the operator selects before the remembered one appears replaces it', async () => {
		const session = new MemoryStorage()
		session.setItem('nebulosa:activeCameraTab', JSON.stringify({ version: 1, value: 'camera:c1:main' }))
		const images = proxy<ImagesState>({ documents: [], views: {}, tools: {} })
		stops.push(keepViewEntries([activeCameraTabEntry(images)], { local: new MemoryStorage(), session }))
		cameraTab(images, 'camera:c1:guide')
		cameraTab(images, 'camera:c1:other')
		images.activeKey = 'camera:c1:guide'
		await Bun.sleep(0)
		images.activeKey = 'camera:c1:other'
		await Bun.sleep(0)
		cameraTab(images, 'camera:c1:main')
		await Bun.sleep(0)
		expect(images.activeKey).toBe('camera:c1:other')
		expect(JSON.parse(session.getItem('nebulosa:activeCameraTab')!).value).toBe('camera:c1:other')
	})

	test('the target typed for a camera comes back in the same tab only, and another version is ignored', async () => {
		const session = new MemoryStorage()
		const runtime = () => proxy<TargetCenteringRuntime>({ sessions: {}, details: {}, drafts: {}, pending: {}, errors: {} })
		const before = runtime()
		stops.push(keepViewEntries([centeringTargetsEntry(before)], { local: new MemoryStorage(), session }))
		before.drafts['c1:main'] = { rightAscension: 1.5, declination: -0.2, label: 'M 42' }
		await Bun.sleep(0)

		const reloaded = runtime()
		stops.push(keepViewEntries([centeringTargetsEntry(reloaded)], { local: new MemoryStorage(), session }))
		expect(snapshot(reloaded).drafts).toEqual({ 'c1:main': { rightAscension: 1.5, declination: -0.2, label: 'M 42' } })

		const newTab = runtime()
		stops.push(keepViewEntries([centeringTargetsEntry(newTab)], { local: new MemoryStorage(), session: new MemoryStorage() }))
		expect(snapshot(newTab).drafts).toEqual({})

		const old = new MemoryStorage()
		old.setItem('nebulosa:centeringTargets', JSON.stringify({ version: 99, value: { 'c1:main': {} } }))
		const ignored = runtime()
		stops.push(keepViewEntries([centeringTargetsEntry(ignored)], { local: new MemoryStorage(), session: old }))
		expect(snapshot(ignored).drafts).toEqual({})
		expect(old.getItem('nebulosa:centeringTargets')).toBeNull()
	})
})
