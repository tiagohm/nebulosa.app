import { describe, expect, test } from 'bun:test'
import type { DisplaySettings } from 'api'
import { proxy, snapshot } from 'valtio'
import {
	activeDocument,
	activeTool,
	activeView,
	applyDisplay,
	closeImage,
	defaultDisplaySettings,
	displayStatus,
	editDisplay,
	type ImagesIo,
	type ImagesState,
	openImage,
	ORIGINAL_DISPLAY_SETTINGS,
	resetDisplay,
	revertDisplay,
	selectImage,
	selectImageTool,
	setImageView,
	shownRendering,
	summaryStretch,
	toggleOriginal,
} from './images'

interface Call {
	readonly url: string
	readonly method: string
	readonly body?: unknown
	readonly signal?: AbortSignal
}

const INFO = { id: 'srv-1', name: 'm31.fits', path: '/data/m31.fits', format: 'fits', width: 4, height: 2, channels: 1, header: {} }
const CFA_INFO = { ...INFO, bayer: 'RGGB', cfa: 'RGGB' }
const RESULT = { stretch: [{ midtone: 0.2, shadow: 0.1, highlight: 1 }], channels: 1 }

// Fake API: opens any path as INFO (CFA_INFO for paths containing "cfa", or fails for paths containing
// "bad"), and renders after release() is called for that rendering when gated. Renders fail while
// failing is set.
function fakeIo(gated = false) {
	const calls: Call[] = []
	const created: string[] = []
	const revoked: string[] = []
	const gates: (() => void)[] = []
	const control = { failing: false }
	let count = 0

	const io: ImagesIo = {
		fetch: async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
			calls.push({ url: input, method, body, signal: init?.signal ?? undefined })

			if (input === '/api/images') {
				const { path } = body as { path: string }
				return path.includes('bad') ? Response.json({ error: 'Not a FITS or XISF image' }, { status: 415 }) : Response.json(path.includes('cfa') ? CFA_INFO : INFO, { status: 201 })
			}

			if (method === 'DELETE') return new Response(null, { status: 204 })

			if (gated) {
				await new Promise<void>((resolve, reject) => {
					gates.push(resolve)
					init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
				})
			}

			if (control.failing) return Response.json({ error: 'Rendering failed' }, { status: 500 })
			return new Response(new Blob(['jpeg']), { headers: { 'X-Image-Render': JSON.stringify(RESULT) } })
		},
		createObjectURL: () => {
			const url = `blob:${++count}`
			created.push(url)
			return url
		},
		revokeObjectURL: (url) => void revoked.push(url),
	}

	return { io, calls, created, revoked, gates, control }
}

function newState() {
	return proxy<ImagesState>({ documents: [], views: {}, tools: {} })
}

function renders(calls: readonly Call[]) {
	return calls.filter((c) => c.url.endsWith('/render'))
}

const BRIGHTER: DisplaySettings = { ...ORIGINAL_DISPLAY_SETTINGS, brightness: 1.5 }

describe('open', () => {
	test('opens, activates, and renders once with the default settings', async () => {
		const state = newState()
		const { io, calls } = fakeIo()

		await openImage(state, '/data/m31.fits', io)
		const document = activeDocument(state)!

		expect(document).toMatchObject({ name: 'm31.fits', source: { kind: 'file', path: '/data/m31.fits' }, status: 'ready' })
		expect(activeView(snapshot(state))).toMatchObject({ view: { kind: 'fit' }, renderPending: false, rendering: { url: 'blob:1', result: RESULT } })
		expect(activeView(state)?.display).toEqual({ pending: ORIGINAL_DISPLAY_SETTINGS, applied: ORIGINAL_DISPLAY_SETTINGS, showOriginal: false })
		expect(displayStatus(activeView(state)!)).toBe('applied')
		expect(document.info?.id).toBe('srv-1')
		expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
			['POST', '/api/images', { path: '/data/m31.fits' }],
			['POST', '/api/images/srv-1/render', { settings: ORIGINAL_DISPLAY_SETTINGS }],
		])
	})

	test('a CFA mosaic with a known pattern is debayered by default', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/data/cfa.fits', io)

		expect(defaultDisplaySettings(INFO as never)).toEqual(ORIGINAL_DISPLAY_SETTINGS)
		expect(renders(calls)[0].body).toEqual({ settings: { ...ORIGINAL_DISPLAY_SETTINGS, debayer: { enabled: true, pattern: 'auto' } } })
	})

	test('a rejected file becomes an error document', async () => {
		const state = newState()
		await openImage(state, 'C:\\data\\bad.txt', fakeIo().io)
		expect(activeDocument(state)).toMatchObject({ name: 'bad.txt', status: 'error', error: 'Not a FITS or XISF image' })
	})

	test('a document closed while opening is released on the server', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		const opening = openImage(state, '/data/m31.fits', io)
		closeImage(state, state.documents[0].key, io)
		await opening

		expect(state.documents).toEqual([])
		expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/images/srv-1' })
	})
})

describe('display settings', () => {
	test('editing never renders and marks the settings not applied', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		editDisplay(state, key, BRIGHTER)

		expect(renders(calls)).toHaveLength(1)
		expect(displayStatus(state.views[key])).toBe('not-applied')
		expect(state.views[key]?.display.applied).toEqual(ORIGINAL_DISPLAY_SETTINGS)
	})

	test('apply renders the pending settings once and applies them on success', async () => {
		const state = newState()
		const { io, calls, revoked } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		editDisplay(state, key, BRIGHTER)
		await applyDisplay(state, key, io)

		expect(renders(calls).map((c) => c.body)).toEqual([{ settings: ORIGINAL_DISPLAY_SETTINGS }, { settings: BRIGHTER }])
		expect(state.views[key]).toMatchObject({ rendering: { url: 'blob:2' }, display: { applied: BRIGHTER } })
		expect(displayStatus(state.views[key])).toBe('applied')
		expect(revoked).toEqual(['blob:1'])
	})

	test('edits made while processing stay pending and the snapshot is applied', async () => {
		const state = newState()
		const { io, gates } = fakeIo(true)
		const opening = openImage(state, '/a.fits', io)
		await Bun.sleep(0)
		gates[0]()
		await opening
		const key = state.documents[0].key

		editDisplay(state, key, BRIGHTER)
		const applying = applyDisplay(state, key, io)
		expect(displayStatus(state.views[key])).toBe('processing')

		editDisplay(state, key, { ...BRIGHTER, invert: true })
		await Bun.sleep(0)
		gates[1]()
		await applying

		expect(state.views[key]?.display.applied).toEqual(BRIGHTER)
		expect(displayStatus(state.views[key])).toBe('not-applied')
	})

	test('a failure keeps the previous rendering and applied settings', async () => {
		const state = newState()
		const { io, control } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		editDisplay(state, key, BRIGHTER)
		control.failing = true
		await applyDisplay(state, key, io)

		expect(state.views[key]).toMatchObject({ rendering: { url: 'blob:1' }, display: { applied: ORIGINAL_DISPLAY_SETTINGS, pending: BRIGHTER }, error: 'Rendering failed' })
		expect(displayStatus(state.views[key])).toBe('error')
	})

	test('a newer apply aborts the previous one and only the latest is applied', async () => {
		const state = newState()
		const { io, calls, gates } = fakeIo(true)
		const opening = openImage(state, '/a.fits', io)
		await Bun.sleep(0)
		gates[0]()
		await opening
		const key = state.documents[0].key

		editDisplay(state, key, BRIGHTER)
		const first = applyDisplay(state, key, io)
		editDisplay(state, key, ORIGINAL_DISPLAY_SETTINGS)
		const second = applyDisplay(state, key, io)
		expect(renders(calls)[1].signal?.aborted).toBe(true)
		await Bun.sleep(0)
		gates[2]()
		await Promise.all([first, second])

		expect(state.views[key]?.display.applied).toEqual(ORIGINAL_DISPLAY_SETTINGS)
		expect(state.views[key]?.renderPending).toBe(false)
	})

	test('revert restores the applied settings and reset the defaults, without rendering', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/data/cfa.fits', io)
		const key = state.documents[0].key
		const defaults = defaultDisplaySettings(CFA_INFO as never)

		editDisplay(state, key, BRIGHTER)
		revertDisplay(state, key)
		expect(state.views[key]?.display.pending).toEqual(defaults)

		editDisplay(state, key, BRIGHTER)
		await applyDisplay(state, key, io)
		resetDisplay(state, key)

		expect(state.views[key]?.display).toMatchObject({ pending: defaults, applied: BRIGHTER })
		expect(renders(calls)).toHaveLength(2)
	})

	test('each document keeps its own settings', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)

		editDisplay(state, b, BRIGHTER)
		await applyDisplay(state, b, io)

		expect(state.views[a]?.display).toMatchObject({ pending: ORIGINAL_DISPLAY_SETTINGS, applied: ORIGINAL_DISPLAY_SETTINGS })
		expect(state.views[b]?.display).toMatchObject({ pending: BRIGHTER, applied: BRIGHTER })
	})

	test('a manual stretch starts from the mean of the applied stretches', () => {
		const stretch = summaryStretch({
			stretch: [
				{ midtone: 0.1, shadow: 0, highlight: 1 },
				{ midtone: 0.2, shadow: 0.3, highlight: 1 },
				{ midtone: 0.3, shadow: 0, highlight: 0.7 },
			],
			channels: 3,
		})

		expect(stretch.midtone).toBeCloseTo(0.2)
		expect(stretch.shadow).toBeCloseTo(0.1)
		expect(stretch.highlight).toBeCloseTo(0.9)
	})
})

describe('show original', () => {
	test('renders the original once and switches without touching the settings', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/data/cfa.fits', io)
		const key = state.documents[0].key
		editDisplay(state, key, BRIGHTER)
		const display = { pending: state.views[key].display.pending, applied: state.views[key].display.applied }

		await toggleOriginal(state, key, io)
		expect(renders(calls).at(-1)?.body).toEqual({ settings: ORIGINAL_DISPLAY_SETTINGS })
		expect(shownRendering(state.views[key])?.url).toBe('blob:2')

		await toggleOriginal(state, key, io)
		expect(shownRendering(state.views[key])?.url).toBe('blob:1')
		await toggleOriginal(state, key, io)

		expect(renders(calls)).toHaveLength(2)
		expect(state.views[key]?.display).toMatchObject({ ...display, showOriginal: true })
	})

	test('apply leaves the original view', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		await toggleOriginal(state, key, io)
		await applyDisplay(state, key, io)

		expect(state.views[key]?.display.showOriginal).toBe(false)
		expect(shownRendering(state.views[key])?.url).toBe('blob:3')
	})

	test('closing revokes both renderings', async () => {
		const state = newState()
		const { io, revoked } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key
		await toggleOriginal(state, key, io)
		closeImage(state, key, io)

		expect(revoked).toEqual(['blob:1', 'blob:2'])
	})
})

describe('tabs', () => {
	test('closing revokes, releases, and activates a neighbor', async () => {
		const state = newState()
		const { io, calls, revoked } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		await openImage(state, '/c.fits', io)
		const [a, b, c] = state.documents.map((d) => d.key)

		selectImage(state, b)
		closeImage(state, b, io)
		expect(state.activeKey).toBe(c)

		closeImage(state, c, io)
		expect(state.activeKey).toBe(a)
		expect(revoked).toEqual(['blob:2', 'blob:3'])
		expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(2)

		closeImage(state, a, io)
		expect(state.activeKey).toBeUndefined()
	})
})

describe('view state', () => {
	test('each document keeps its own view', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)
		const zoomed = { kind: 'manual', scale: 2, center: { x: 1, y: 1 } } as const

		setImageView(state, a, zoomed)
		selectImage(state, a)

		expect(activeView(state)).toMatchObject({ view: zoomed })
		expect(state.views[b]).toMatchObject({ view: { kind: 'fit' } })
	})

	test('closing drops the view state', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		closeImage(state, state.documents[0].key, io)
		expect(state.views).toEqual({})
	})
})

describe('tool context', () => {
	test('a new document shows the inspector and each document keeps its own tool', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)

		selectImageTool(state, b, 'plate-solver')

		expect(state.tools[a]?.tool).toBe('inspector')
		expect(activeTool(state)?.tool).toBe('plate-solver')

		closeImage(state, b, io)
		expect(state.tools).toEqual({ [a]: { tool: 'inspector' } })
	})
})
