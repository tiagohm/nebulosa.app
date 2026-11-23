import { describe, expect, test } from 'bun:test'
import type { DisplaySettings } from 'api'
import { proxy, snapshot } from 'valtio'
import { keepViewEntries } from '../profile/view'
import { ORIGINAL_DISPLAY_SETTINGS } from './display'
import { DEFAULT_IMAGE_TOOL_PREFERENCES, type ImagesIo, type ImagesState, openImage, setImageView } from './images'
import { type KeptImage, keptImage, openImagesEntry, restoreImage } from './openimages'

interface Call {
	readonly url: string
	readonly method: string
	readonly body?: unknown
}

const INFO = { origin: 'file', id: 'held', name: 'm31.fits', path: '/data/m31.fits', format: 'fits', width: 4, height: 2, channels: 1, header: {}, acquisition: {} }
const RESULT = { stretch: [{ midtone: 0.2, shadow: 0.1, highlight: 1 }], channels: 1 }
const BRIGHTER: DisplaySettings = { ...ORIGINAL_DISPLAY_SETTINGS, brightness: 1.5 }

// Fake API: the server holds the image 'held' while held is set, opens any other path as a new image, unless its path
// contains "missing", and renders anything.
function fakeIo(held = true) {
	const calls: Call[] = []
	let opened = 0

	const io: ImagesIo = {
		fetch: (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
			calls.push({ url: input, method, body })

			if (input === '/api/images') {
				const { path } = body as { path: string }
				if (path.includes('missing')) return Promise.resolve(Response.json({ error: 'File not found' }, { status: 404 }))
				return Promise.resolve(Response.json({ ...INFO, id: `opened-${++opened}`, path }, { status: 201 }))
			}

			if (input.endsWith('/claim')) return Promise.resolve(input.startsWith('/api/images/held/') && held ? Response.json(INFO) : Response.json({ error: 'Image not found' }, { status: 404 }))
			if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }))
			return Promise.resolve(new Response(new Blob(['jpeg']), { headers: { 'X-Image-Render': JSON.stringify(RESULT) } }))
		},
		createObjectURL: () => 'blob:1',
		revokeObjectURL: () => undefined,
		loadDisplay: () => undefined,
		loadToolPreferences: () => DEFAULT_IMAGE_TOOL_PREFERENCES,
		saveDisplay: () => undefined,
	}

	return { io, calls }
}

function newState() {
	return proxy<ImagesState>({ documents: [], views: {}, tools: {} })
}

// Keeps what a page had open, as the entry writes it.
async function kept(): Promise<KeptImage> {
	const state = newState()
	const { io } = fakeIo()
	await openImage(state, '/data/m31.fits', io, 'before')
	const { key } = state.documents[0]
	const view = state.views[key]
	setImageView(state, key, { kind: 'manual', scale: 2, center: { x: 1, y: 1 } })
	view.display.applied = BRIGHTER
	view.stars.visible = false
	view.stars.selected = { jobId: 'stars-1', index: 0 }
	view.plateSolving.selected = 'solve-1'
	view.plateSolving.grid = true
	view.astrometry.markers = [{ id: 'm1', point: { x: 1, y: 1 }, visible: true }]
	view.statistics.area = { left: 0, top: 0, width: 2, height: 2 }
	state.tools[key].tool = 'plate-solver'
	return keptImage(state.documents[0], view, state.tools[key])!
}

describe('kept images', () => {
	test('a file document keeps its path, image, tool, and view state, without selections or renderings', async () => {
		const value = await kept()

		expect(value).toMatchObject({ path: '/data/m31.fits', imageId: 'opened-1', tool: 'plate-solver' })
		expect(value.view).toMatchObject({ view: { kind: 'manual', scale: 2, center: { x: 1, y: 1 } }, display: BRIGHTER, stars: { visible: false, acceptedOnly: false }, plateSolving: { selected: 'solve-1', grid: true }, statisticsArea: { left: 0, top: 0, width: 2, height: 2 } })
		expect(value.view.astrometry.markers).toHaveLength(1)
		expect(JSON.stringify(value)).not.toContain('stars-1')
		expect(JSON.stringify(value)).not.toContain('blob:')
	})

	test('only file documents are kept, in tab order, and nothing when none is open', () => {
		const state = newState()
		const entry = openImagesEntry(state, fakeIo().io, 'page', proxy({ loaded: true }))
		expect(entry.value()).toBeUndefined()

		state.documents.push({ key: 'camera', name: 'Camera', source: { kind: 'camera', connectionId: 'c', deviceId: 'd' }, status: 'ready' })
		expect(entry.value()).toBeUndefined()
	})
})

describe('restore', () => {
	test('a document the server still holds is claimed and shown again with its key, tool, view state, and solution', async () => {
		const value = { ...(await kept()), key: 'k1', imageId: 'held' }
		const state = newState()
		const { io, calls } = fakeIo()

		await restoreImage(state, value, io, 'after')

		expect(snapshot(state.documents)).toMatchObject([{ key: 'k1', name: 'm31.fits', status: 'ready', info: { id: 'held' } }])
		expect(state.tools.k1.tool).toBe('plate-solver')
		expect(snapshot(state.views.k1)).toMatchObject({ view: { kind: 'manual', scale: 2 }, display: { applied: BRIGHTER }, stars: { visible: false }, plateSolving: { selected: 'solve-1', grid: true }, statistics: { area: { width: 2 } } })
		expect(state.views.k1.stars.selected).toBeUndefined()
		expect(calls[0]).toMatchObject({ url: '/api/images/held/claim', method: 'POST', body: { client: 'after' } })
		expect(calls.some((call) => call.url === '/api/images')).toBeFalse()
		expect(calls.at(-1)).toMatchObject({ url: '/api/images/held/render', body: { settings: BRIGHTER } })
	})

	test('a document the server no longer holds opens its file again and forgets the solution of the old image', async () => {
		const value = { ...(await kept()), key: 'k1', imageId: 'held' }
		const state = newState()
		const { io, calls } = fakeIo(false)

		await restoreImage(state, value, io, 'after')

		expect(snapshot(state.documents)).toMatchObject([{ key: 'k1', status: 'ready', info: { id: 'opened-1' } }])
		expect(state.views.k1.plateSolving.selected).toBeUndefined()
		expect(state.views.k1.plateSolving.grid).toBeTrue()
		expect(calls.find((call) => call.url === '/api/images')).toMatchObject({ body: { path: '/data/m31.fits', client: 'after' } })

		const header = { ...value, view: { ...value.view, plateSolving: { ...value.view.plateSolving, selected: 'header' } } }
		const again = newState()
		await restoreImage(again, header, fakeIo(false).io, 'after')
		expect(again.views.k1.plateSolving.selected).toBe('header')
	})

	test('a file that cannot be opened again shows why, and a document closed meanwhile releases the image', async () => {
		const value = await kept()
		const state = newState()
		await restoreImage(state, { ...value, imageId: undefined, path: '/data/missing.fits' }, fakeIo().io, 'after')
		expect(snapshot(state.documents[0])).toMatchObject({ status: 'error', error: 'File not found' })

		const closed = newState()
		const { io, calls } = fakeIo()
		const restoring = restoreImage(closed, { ...value, imageId: 'held' }, io, 'after')
		closed.documents.splice(0)
		await restoring
		expect(calls.at(-1)).toMatchObject({ url: '/api/images/held?client=after', method: 'DELETE' })
	})

	test('the files of a page come back after a reload of the tab, in order, without taking the view', async () => {
		const items = new Map<string, string>()
		const session = { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key) }
		const before = newState()
		const { io } = fakeIo(false)
		const stopBefore = keepViewEntries([openImagesEntry(before, io, 'before', proxy({ loaded: true }))], { session })
		await openImage(before, '/data/a.fits', io, 'before')
		await openImage(before, '/data/b.fits', io, 'before')
		await Bun.sleep(0)
		stopBefore()

		// The files wait for the workspace, and stay kept meanwhile.
		const after = newState()
		const sync = proxy({ loaded: false })
		const stopAfter = keepViewEntries([openImagesEntry(after, io, 'after', sync)], { session })
		await Bun.sleep(10)
		expect(after.documents).toEqual([])
		expect(JSON.parse(items.get('nebulosa:openImages')!).value).toHaveLength(2)

		after.documents.push({ key: 'camera', name: 'Camera', source: { kind: 'camera', connectionId: 'c', deviceId: 'd' }, status: 'ready' })
		after.activeKey = 'camera'
		sync.loaded = true
		await Bun.sleep(10)
		stopAfter()

		expect(after.documents.map((document) => document.key)).toEqual(['camera', ...before.documents.map((document) => document.key)])
		expect(after.documents.slice(1).map((document) => document.name)).toEqual(['a.fits', 'b.fits'])
		expect(after.activeKey).toBe('camera')
	})
})
