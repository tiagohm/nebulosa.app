import { describe, expect, test } from 'bun:test'
import type { DisplaySettings } from 'api'
import { proxy, snapshot } from 'valtio'
import { ORIGINAL_DISPLAY_SETTINGS } from './display'
import {
	activeDocument,
	activeTool,
	activeView,
	applyDisplay,
	closeImage,
	documentPath,
	hasUnsavedImages,
	saveFileName,
	saveImage,
	defaultDisplaySettings,
	type ImageSource,
	type ImagesIo,
	type ImagesState,
	imageUnavailableReason,
	openDerivedImage,
	openImage,
	selectImage,
	selectImageTool,
	selectPlateSolution,
	selectStar,
	selectStreak,
	setImageView,
	setPlateSolveOverlay,
	setPlateSolveRequest,
	setStarMarkers,
	setStreakView,
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
const UNTRUSTED_CFA_INFO = { ...INFO, bayer: 'XYZW' }
const RESULT = { stretch: [{ midtone: 0.2, shadow: 0.1, highlight: 1 }], channels: 1 }
const DERIVED_INFO = { origin: 'derived', id: 'srv-2', name: 'm31 — Processed', width: 4, height: 2, channels: 3, header: {}, provenance: { kind: 'processing', source: 'srv-1', sourceName: 'm31.fits', steps: [], createdAt: '2026-10-17T00:00:00.000Z' } }

// Fake API: opens any path as INFO (CFA_INFO for paths containing "cfa", UNTRUSTED_CFA_INFO for "mosaic", or fails
// for paths containing "bad"), and renders after release() is called for that rendering when gated. Renders fail
// while failing is set. The profile gives saved for every source and records what is saved.
function fakeIo(gated = false) {
	const calls: Call[] = []
	const created: string[] = []
	const revoked: string[] = []
	const gates: (() => void)[] = []
	const loads: ImageSource[] = []
	const saves: { readonly source: ImageSource; readonly settings: DisplaySettings }[] = []
	const control: { failing: boolean; saved?: DisplaySettings } = { failing: false }
	let count = 0

	const io: ImagesIo = {
		fetch: async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
			calls.push({ url: input, method, body, signal: init?.signal ?? undefined })

			if (input === '/api/images') {
				const { path } = body as { path: string }
				return path.includes('bad') ? Response.json({ error: 'Not a FITS or XISF image' }, { status: 415 }) : Response.json(path.includes('cfa') ? CFA_INFO : path.includes('mosaic') ? UNTRUSTED_CFA_INFO : INFO, { status: 201 })
			}

			if (method === 'DELETE') return new Response(null, { status: 204 })

			if (input.endsWith('/save')) {
				const { path, overwrite } = body as { path: string; overwrite: boolean }
				if (path.includes('existing') && !overwrite) return Response.json({ error: 'The file already exists', code: 'exists' }, { status: 409 })
				if (path.includes('readonly')) return Response.json({ error: 'Unable to write the file: EACCES' }, { status: 500 })
				return Response.json({ path })
			}

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
		loadDisplay: (source) => {
			loads.push(source)
			return control.saved
		},
		saveDisplay: (source, settings) => void saves.push({ source, settings }),
	}

	return { io, calls, created, revoked, gates, control, loads, saves }
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
		expect(activeView(state)?.display).toEqual({ applied: ORIGINAL_DISPLAY_SETTINGS, showOriginal: false })
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

	test('a file starts with the global settings saved in the profile, without saving them again', async () => {
		const state = newState()
		const { io, calls, control, loads, saves } = fakeIo()
		control.saved = BRIGHTER
		await openImage(state, '/data/m31.fits', io)

		expect(loads).toEqual([{ kind: 'file', path: '/data/m31.fits' }])
		expect(renders(calls)[0].body).toEqual({ settings: BRIGHTER })
		expect(activeView(state)?.display.applied).toEqual(BRIGHTER)
		expect(saves).toEqual([])
	})

	test('saved debayering is dropped where it does not apply or cannot be resolved', async () => {
		const state = newState()
		const { io, calls, control } = fakeIo()
		control.saved = { ...BRIGHTER, debayer: { enabled: true, pattern: 'auto' } }

		await openImage(state, '/data/m31.fits', io)
		await openImage(state, '/data/mosaic.fits', io)
		await openImage(state, '/data/cfa.fits', io)
		control.saved = { ...BRIGHTER, debayer: { enabled: true, pattern: 'GRBG' } }
		await openImage(state, '/data/mosaic.fits', io)

		expect(renders(calls).map((c) => (c.body as { settings: DisplaySettings }).settings.debayer)).toEqual([{ enabled: false }, { enabled: false }, { enabled: true, pattern: 'auto' }, { enabled: true, pattern: 'GRBG' }])
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
	test('a patch renders once, is applied on success, and is saved for the source', async () => {
		const state = newState()
		const { io, calls, revoked, saves } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		await applyDisplay(state, key, { brightness: 1.5 }, io)

		expect(renders(calls).map((c) => c.body)).toEqual([{ settings: ORIGINAL_DISPLAY_SETTINGS }, { settings: BRIGHTER }])
		expect(state.views[key]).toMatchObject({ rendering: { url: 'blob:2' }, display: { applied: BRIGHTER } })
		expect(revoked).toEqual(['blob:1'])
		expect(saves).toEqual([{ source: { kind: 'file', path: '/a.fits' }, settings: BRIGHTER }])
	})

	test('a patch applied while rendering builds on the settings being applied, whose rendering it aborts', async () => {
		const state = newState()
		const { io, calls, gates, saves } = fakeIo(true)
		const opening = openImage(state, '/a.fits', io)
		await Bun.sleep(0)
		gates[0]()
		await opening
		const key = state.documents[0].key

		const first = applyDisplay(state, key, { brightness: 1.5 }, io)
		const second = applyDisplay(state, key, { invert: true }, io)
		expect(renders(calls)[1].signal?.aborted).toBe(true)
		await Bun.sleep(0)
		gates[2]()
		await Promise.all([first, second])

		expect(renders(calls)[2].body).toEqual({ settings: { ...BRIGHTER, invert: true } })
		expect(state.views[key]?.display.applied).toEqual({ ...BRIGHTER, invert: true })
		expect(state.views[key]?.renderPending).toBe(false)
		expect(saves.map((s) => s.settings)).toEqual([{ ...BRIGHTER, invert: true }])
	})

	test('a failure keeps the previous rendering and applied settings and saves nothing', async () => {
		const state = newState()
		const { io, control, saves } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		control.failing = true
		await applyDisplay(state, key, { brightness: 1.5 }, io)

		expect(state.views[key]).toMatchObject({ rendering: { url: 'blob:1' }, display: { applied: ORIGINAL_DISPLAY_SETTINGS }, error: 'Rendering failed' })
		expect(saves).toEqual([])
	})

	test('each document keeps its own settings', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)

		await applyDisplay(state, b, { brightness: 1.5 }, io)

		expect(state.views[a]?.display.applied).toEqual(ORIGINAL_DISPLAY_SETTINGS)
		expect(state.views[b]?.display.applied).toEqual(BRIGHTER)
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
		const applied = state.views[key].display.applied

		await toggleOriginal(state, key, io)
		expect(renders(calls).at(-1)?.body).toEqual({ settings: ORIGINAL_DISPLAY_SETTINGS })
		expect(shownRendering(state.views[key])?.url).toBe('blob:2')

		await toggleOriginal(state, key, io)
		expect(shownRendering(state.views[key])?.url).toBe('blob:1')
		await toggleOriginal(state, key, io)

		expect(renders(calls)).toHaveLength(2)
		expect(state.views[key]?.display).toMatchObject({ applied, showOriginal: true })
	})

	test('apply leaves the original view', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/a.fits', io)
		const key = state.documents[0].key

		await toggleOriginal(state, key, io)
		await applyDisplay(state, key, { invert: true }, io)

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

describe('derived images', () => {
	test('opening one adds a new active unsaved document rendered with the global settings', async () => {
		const state = newState()
		const { io, control, loads } = fakeIo()
		await openImage(state, '/data/m31.fits', io)
		control.saved = BRIGHTER

		await openDerivedImage(state, DERIVED_INFO as never, 'm31.fits', true, io)
		const derived = activeDocument(state)!

		expect(state.documents).toHaveLength(2)
		expect(derived).toMatchObject({ name: 'm31 — Processed', source: { kind: 'derived', sourceName: 'm31.fits' }, status: 'ready', unsaved: true })
		expect(loads.at(-1)).toEqual({ kind: 'derived', sourceName: 'm31.fits' })
		expect(state.views[derived.key]?.display.applied).toEqual(BRIGHTER)
		expect(hasUnsavedImages(state)).toBeTrue()
		expect(documentPath(derived)).toBeUndefined()
	})

	test('saving its pixels marks the document saved, keeping its name, only once the server confirms', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/data/m31.fits', io)
		await openDerivedImage(state, DERIVED_INFO as never, 'm31.fits', true, io)
		const key = state.activeKey!

		expect(await saveImage(state, key, '/out/existing.xisf', 'xisf', false, io)).toEqual({ status: 'exists' })
		expect(activeDocument(state)?.unsaved).toBeTrue()

		expect(await saveImage(state, key, '/readonly/m31.fits', 'fits', false, io)).toEqual({ status: 'failed', error: 'Unable to write the file: EACCES' })
		expect(activeDocument(state)?.unsaved).toBeTrue()

		expect(await saveImage(state, key, '/out/existing.xisf', 'xisf', true, io)).toEqual({ status: 'saved' })
		expect(activeDocument(state)).toMatchObject({ unsaved: false, savedPath: '/out/existing.xisf', name: 'm31 — Processed' })
		expect(calls.at(-1)).toMatchObject({ url: '/api/images/srv-2/save', body: { path: '/out/existing.xisf', format: 'xisf', overwrite: true } })
		expect(hasUnsavedImages(state)).toBeFalse()
		expect(documentPath(activeDocument(state)!)).toBe('/out/existing.xisf')
	})

	test('saving it as JPEG sends the shown settings and leaves it unsaved', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/data/m31.fits', io)
		await openDerivedImage(state, DERIVED_INFO as never, 'm31.fits', true, io)
		const key = state.activeKey!
		const applied = activeView(state)?.display.applied

		expect(await saveImage(state, key, '/out/m31.jpg', 'jpeg', false, io)).toEqual({ status: 'saved' })
		expect(calls.at(-1)).toMatchObject({ url: '/api/images/srv-2/save', body: { path: '/out/m31.jpg', format: 'jpeg', overwrite: false, settings: applied } })
		expect(activeDocument(state)).toMatchObject({ unsaved: true, name: 'm31 — Processed' })
		expect(activeDocument(state)?.savedPath).toBeUndefined()
	})

	test('saving a file document writes a copy and leaves the document as it is', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openImage(state, '/data/m31.fits', io)
		const before = snapshot(activeDocument(state)!)

		expect(await saveImage(state, before.key, '/out/copy.xisf', 'xisf', false, io)).toEqual({ status: 'saved' })
		expect(snapshot(activeDocument(state)!)).toEqual(before)
		expect(documentPath(activeDocument(state)!)).toBe('/data/m31.fits')
	})

	test('closing one releases it on the server and revokes its rendering', async () => {
		const state = newState()
		const { io, calls, revoked } = fakeIo()
		await openImage(state, '/data/m31.fits', io)
		await openDerivedImage(state, DERIVED_INFO as never, 'm31.fits', true, io)

		closeImage(state, state.activeKey!, io)

		expect(state.documents).toHaveLength(1)
		expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/api/images/srv-2' })
		expect(revoked).toEqual(['blob:2'])
		expect(hasUnsavedImages(state)).toBeFalse()
	})

	test('a save file name gets the extension of its format unless it already has one of it', () => {
		expect(['a.fits', 'b.fit', 'c.FTS', 'd.xisf', 'e', 'f.jpg', 'Camera #3'].map((name) => saveFileName(name, 'fits'))).toEqual(['a.fits', 'b.fit', 'c.FTS', 'd.fits', 'e.fits', 'f.fits', 'Camera #3.fits'])
		expect(['m31.fits', 'm31.JPEG', 'm31 — Processed', 'v1.2'].map((name) => saveFileName(name, 'jpeg'))).toEqual(['m31.jpg', 'm31.JPEG', 'm31 — Processed.jpg', 'v1.2.jpg'])
		expect(saveFileName('/out/m31.fit', 'xisf')).toBe('/out/m31.xisf')
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

describe('star detection', () => {
	test('a new document starts with shown markers and nothing selected', async () => {
		const state = newState()
		await openImage(state, '/a.fits', fakeIo().io)
		const key = state.documents[0].key

		expect(state.views[key]?.stars).toEqual({ visible: true, acceptedOnly: false })
	})

	test('edits the markers of one document only', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)
		const requests = calls.length

		setStarMarkers(state, a, { acceptedOnly: true })
		selectStar(state, a, { jobId: 'job-1', index: 3 })
		expect(state.views[a]?.stars).toMatchObject({ visible: true, acceptedOnly: true, selected: { jobId: 'job-1', index: 3 } })
		expect(state.views[b]?.stars).toEqual({ visible: true, acceptedOnly: false })

		// Editing and showing never reach the server.
		expect(calls.length).toBe(requests)
	})
})

describe('streak detection', () => {
	test('a new document starts with shown lines and labels, every context source, and nothing selected', async () => {
		const state = newState()
		await openImage(state, '/a.fits', fakeIo().io)
		const key = state.documents[0].key

		expect(state.views[key]?.streaks).toEqual({ visible: true, labels: true, useSolution: true, useStars: true })
	})

	test('edits the lines and the context of one document only, never reaching the server', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)
		const requests = calls.length

		setStreakView(state, a, { labels: false, useStars: false })
		selectStreak(state, a, { jobId: 'job-1', index: 2 })
		expect(state.views[a]?.streaks).toEqual({ visible: true, labels: false, useSolution: true, useStars: false, selected: { jobId: 'job-1', index: 2 } })
		expect(state.views[b]?.streaks).toEqual({ visible: true, labels: true, useSolution: true, useStars: true })
		expect(calls.length).toBe(requests)
	})
})

describe('plate solving', () => {
	test('a new document starts with ASTAP around the header, its overlay shown, and the latest solution', async () => {
		const state = newState()
		await openImage(state, '/a.fits', fakeIo().io)
		const key = state.documents[0].key

		expect(state.views[key]?.plateSolving).toEqual({ request: { provider: 'astap', strategy: 'assisted' }, overlay: true, grid: false })
	})

	test('edits the request, the solution shown, and the overlay of one document only, without the server', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openImage(state, '/a.fits', io)
		await openImage(state, '/b.fits', io)
		const [a, b] = state.documents.map((d) => d.key)
		const requests = calls.length

		setPlateSolveRequest(state, a, { provider: 'nova', strategy: 'blind', downsample: 4 })
		selectPlateSolution(state, a, 'header')
		setPlateSolveOverlay(state, a, { grid: true })

		expect(state.views[a]?.plateSolving).toEqual({ request: { provider: 'nova', strategy: 'blind', downsample: 4 }, selected: 'header', overlay: true, grid: true })
		expect(state.views[b]?.plateSolving).toEqual({ request: { provider: 'astap', strategy: 'assisted' }, overlay: true, grid: false })
		expect(calls.length).toBe(requests)
	})
})

test('a document without an image says why, so its tools keep their settings editable meanwhile', () => {
	expect(imageUnavailableReason({ status: 'loading' })).toBe('Opening the image…')
	expect(imageUnavailableReason({ status: 'ready', camera: {} as never })).toBe('Waiting for the first frame of the camera.')
	expect(imageUnavailableReason({ status: 'error' })).toBe('The image is unavailable.')
	expect(imageUnavailableReason({ status: 'ready', info: {} as never })).toBeUndefined()
})
