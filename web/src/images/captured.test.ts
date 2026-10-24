import { describe, expect, test } from 'bun:test'
import type { CaptureFrameSummary, CaptureSourceSummary, DisplaySettings, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { cameraTabKey, connectionCameraTab, handleCapturedFrame, holdCameraFrame, reconcileCameraTabs, reconcileCapturedFrames, selectCameraFrame } from './cameratabs'
import { type CaptureFramesState, frameLabel, frameUnavailableReason, handleCaptureFramesEvent, loadRecentFrames, refreshCaptureFrames } from './captureframes'
import { applyDisplay, closeImage, editDisplay, type ImagesIo, type ImagesState, isClosable, ORIGINAL_DISPLAY_SETTINGS, setImageView } from './images'

interface Call {
	readonly url: string
	readonly method: string
	readonly body?: unknown
}

const SOURCE: CaptureSourceSummary = { connectionId: 'conn', deviceId: 'cam', cameraName: 'Camera', connected: true, latestRestored: false, count: 1, revision: 1 }

const CAMERA = { connectionId: 'conn', id: 'cam', name: 'Camera' }

const KEY = cameraTabKey('conn', 'cam')

// Returns a frame of the camera, with fields replaced.
function frame(generation: number, patch: Partial<CaptureFrameSummary> = {}): CaptureFrameSummary {
	return { frameId: `s:${generation}`, origin: 'capture', sequence: generation, revision: generation, connectionId: 'conn', deviceId: 'cam', cameraName: 'Camera', sessionId: 's', generation, time: 0, frameType: 'LIGHT', width: 4, height: 2, channels: 1, availability: 'memory', imageId: `img-${generation}`, ...patch }
}

// Returns the registry event of a new frame, which is the latest of its camera.
function event(summary: CaptureFrameSummary): ServerEvent {
	return { type: 'captureFrame:updated', frame: summary, source: { ...SOURCE, latestFrameId: summary.frameId, latestAvailableFrameId: summary.frameId, revision: summary.revision } }
}

// Returns the mirror of the registry with the camera whose latest available frame is latest.
function framesOf(latest?: string): Pick<CaptureFramesState, 'sources'> {
	return { sources: { 'conn:cam': { ...SOURCE, latestFrameId: latest, latestAvailableFrameId: latest } } }
}

// Fake API: opens any frame "s:<n>" as the document img-<n> (sized by sizes, 4 × 2 px otherwise) under the lease
// lease-<n>-<count>, refuses frames named in refused, holds the opens and renderings of gated frames until released,
// fails the renderings of failing images, and renders anything else.
function fakeIo() {
	const calls: Call[] = []
	const refused = new Set<string>()
	const gated = new Map<string, () => void>()
	const failing = new Set<string>()
	const sizes = new Map<string, readonly [number, number]>()
	const control = { lost: [] as string[] }
	const revoked: string[] = []
	let count = 0

	async function gate(id: string) {
		if (gated.has(id))
			await new Promise<void>((resolve) => {
				gated.set(id, resolve)
			})
	}

	const io: ImagesIo = {
		fetch: async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
			calls.push({ url: input, method, body })
			const open = /\/api\/capture-frames\/frames\/([^/]+)\/open$/.exec(input)

			if (open) {
				const frameId = decodeURIComponent(open[1])
				if (refused.has(frameId)) return Response.json({ error: 'The frame is no longer in memory and was not saved', code: 'expired' }, { status: 410 })
				await gate(frameId)
				const generation = Number(frameId.split(':')[1])
				const [width, height] = sizes.get(frameId) ?? [4, 2]
				const summary = frame(generation, { width, height })
				return Response.json({ lease: `lease-${generation}-${++count}`, info: { origin: 'capture', format: 'fits', id: summary.imageId, name: 'frame', width, height, channels: 1, header: {}, acquisition: {}, connectionId: 'conn', deviceId: 'cam', frameId, time: 0 }, frame: summary })
			}

			if (method === 'PUT') return Response.json({ lost: control.lost })
			if (method === 'DELETE') return new Response(null, { status: 204 })
			const render = /\/api\/images\/([^/]+)\/render$/.exec(input)
			const id = decodeURIComponent(render?.[1] ?? '')
			await gate(id)
			if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
			if (failing.has(id)) return Response.json({ error: 'The image has no known CFA pattern' }, { status: 400 })
			return new Response(new Blob(['jpeg']), { headers: { 'X-Image-Render': JSON.stringify({ stretch: [], channels: 1 }) } })
		},
		createObjectURL: () => `blob:${++count}`,
		revokeObjectURL: (url) => revoked.push(url),
	}

	// Lets a gated open or rendering answer.
	function release(id: string) {
		gated.get(id)?.()
	}

	return { io, calls, refused, gated, failing, sizes, control, revoked, release }
}

function newState() {
	return proxy<ImagesState>({ documents: [], views: {}, tools: {} })
}

function opens(calls: readonly Call[]) {
	return calls.filter((c) => c.url.endsWith('/open'))
}

function renders(calls: readonly Call[]) {
	return calls.filter((c) => c.url.endsWith('/render'))
}

function deletes(calls: readonly Call[]) {
	return calls.filter((c) => c.method === 'DELETE').map((c) => c.url)
}

// Opens the camera tab of the camera, showing latest, and waits for it.
async function cameraTab(io: ImagesIo, latest?: string) {
	const state = newState()
	reconcileCameraTabs(state, [CAMERA], framesOf(latest), io, 'page')
	await Bun.sleep(10)
	return state
}

function tab(state: ImagesState) {
	return state.documents.find((d) => d.key === KEY)!
}

describe('camera tabs', () => {
	test('one permanent tab per connected camera, before the other documents, ordered by name', () => {
		const state = newState()
		const { io } = fakeIo()
		state.documents.push({ key: 'file', name: 'm42.fits', source: { kind: 'file', path: '/m42.fits' }, status: 'ready', unsaved: false })

		reconcileCameraTabs(
			state,
			[
				{ connectionId: 'conn', id: 'b', name: 'Main' },
				{ connectionId: 'conn', id: 'a', name: 'Guide' },
				{ connectionId: 'conn', id: 'c', name: 'Guide' },
			],
			framesOf(),
			io,
			'page',
		)
		reconcileCameraTabs(
			state,
			[
				{ connectionId: 'conn', id: 'b', name: 'Main' },
				{ connectionId: 'conn', id: 'a', name: 'Guide' },
				{ connectionId: 'conn', id: 'c', name: 'Guide' },
			],
			framesOf(),
			io,
			'page',
		)

		expect(state.documents.map((d) => d.name)).toEqual(['Guide · a', 'Guide · c', 'Main', 'm42.fits'])
		expect(state.documents.map((d) => isClosable(d))).toEqual([false, false, false, true])
	})

	test('a camera tab is never closed by the operator', async () => {
		const { io } = fakeIo()
		const state = await cameraTab(io)

		closeImage(state, KEY, io)

		expect(state.documents).toHaveLength(1)
	})

	test('waits for the first frame of a camera without one, then follows it', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io)

		expect(tab(state)).toMatchObject({ status: 'ready', camera: { selection: { kind: 'latest' } } })
		expect(tab(state).info).toBeUndefined()
		expect(calls).toEqual([])

		handleCapturedFrame(state, event(frame(1)), io, 'page')
		await Bun.sleep(10)
		expect(tab(state)).toMatchObject({ info: { id: 'img-1' }, camera: { shown: { frame: { frameId: 's:1' }, lease: 'lease-1-1' } } })
	})

	test('shows the latest frame of a camera when its tab opens', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:3')

		expect(opens(calls)).toEqual([{ url: '/api/capture-frames/frames/s%3A3/open', method: 'POST', body: { client: 'page' } }])
		expect(tab(state)).toMatchObject({ info: { id: 'img-3' }, camera: { shown: { frame: { frameId: 's:3' } } } })
		expect(state.views[KEY].rendering).toBeDefined()
	})

	test('a disconnected camera loses its tab and lease; it comes back with its view state', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')
		setImageView(state, KEY, { kind: 'manual', scale: 2, center: { x: 1, y: 1 } })

		reconcileCameraTabs(state, [], framesOf('s:1'), io, 'page')
		expect(state.documents).toEqual([])
		expect(deletes(calls)).toEqual(['/api/capture-frames/leases/lease-1-1'])

		reconcileCameraTabs(state, [CAMERA], framesOf('s:1'), io, 'page')
		await Bun.sleep(10)
		expect(state.views[KEY].view).toEqual({ kind: 'manual', scale: 2, center: { x: 1, y: 1 } })
		expect(tab(state).camera?.shown?.frame.frameId).toBe('s:1')
	})
})

describe('following the latest frame', () => {
	test('follows the newer frames of its camera, keeping the view, and releases the previous lease', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')
		setImageView(state, KEY, { kind: 'manual', scale: 2, center: { x: 1, y: 1 } })

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(tab(state)).toMatchObject({ info: { id: 'img-2' }, camera: { selection: { kind: 'latest' }, shown: { frame: { frameId: 's:2' }, lease: 'lease-2-3' } } })
		expect(state.views[KEY].view).toEqual({ kind: 'manual', scale: 2, center: { x: 1, y: 1 } })
		expect(deletes(calls)).toEqual(['/api/capture-frames/leases/lease-1-1'])
	})

	test('ignores older frames, frames of other cameras, and frames not in memory', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:5')

		handleCapturedFrame(state, event(frame(4)), io, 'page')
		handleCapturedFrame(state, event(frame(6, { deviceId: 'other' })), io, 'page')
		handleCapturedFrame(state, event(frame(7, { availability: 'file', imageId: undefined })), io, 'page')
		await Bun.sleep(10)

		expect(opens(calls)).toHaveLength(1)
		expect(tab(state).camera?.shown?.frame.frameId).toBe('s:5')
	})

	test('only the newest of the frames arriving while one opens is shown; the superseded lease is released', async () => {
		const { io, calls, gated, release } = fakeIo()
		const state = await cameraTab(io)
		gated.set('s:1', () => undefined)

		handleCapturedFrame(state, event(frame(1)), io, 'page')
		await Bun.sleep(0)
		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)
		release('s:1')
		await Bun.sleep(10)

		expect(tab(state).camera?.shown?.frame.frameId).toBe('s:2')
		expect(deletes(calls).filter((url) => url.startsWith('/api/capture-frames/leases/lease-1-'))).toHaveLength(1)
	})

	test('a frame being opened never changes the document, rendering, or results shown', async () => {
		const { io, gated, release } = fakeIo()
		const state = await cameraTab(io, 's:1')
		const rendering = state.views[KEY].rendering
		state.views[KEY].stars.selected = { jobId: 'job', index: 0 }
		gated.set('img-2', () => undefined)

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)
		expect(tab(state)).toMatchObject({ info: { id: 'img-1' }, camera: { requested: 's:2', shown: { frame: { frameId: 's:1' } } } })
		expect(state.views[KEY].rendering).toEqual(rendering)
		expect(state.views[KEY].stars.selected).toEqual({ jobId: 'job', index: 0 })

		release('img-2')
		await Bun.sleep(10)
		expect(tab(state)).toMatchObject({ info: { id: 'img-2' }, camera: { requested: undefined, shown: { frame: { frameId: 's:2' } } } })
		expect(state.views[KEY].stars.selected).toBeUndefined()
	})

	test('a frame that cannot be opened or rendered keeps the frame shown', async () => {
		const { io, refused, failing, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')
		refused.add('s:2')
		failing.add('img-3')

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)
		expect(tab(state)).toMatchObject({ info: { id: 'img-1' }, camera: { shown: { frame: { frameId: 's:1' } }, error: 'The frame is no longer in memory and was not saved' } })

		handleCapturedFrame(state, event(frame(3)), io, 'page')
		await Bun.sleep(10)
		expect(tab(state)).toMatchObject({ info: { id: 'img-1' }, camera: { shown: { frame: { frameId: 's:1' } }, error: 'The image has no known CFA pattern' } })
		expect(deletes(calls)).toEqual([expect.stringMatching(/^\/api\/capture-frames\/leases\/lease-3-/)])
	})
})

describe('selection', () => {
	test('a saved frame stays shown while new frames arrive; Return to Latest shows the latest one', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:5')

		await selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:2' }, framesOf('s:5'), io, 'page')
		handleCapturedFrame(state, event(frame(6)), io, 'page')
		await Bun.sleep(10)
		expect(tab(state).camera).toMatchObject({ selection: { kind: 'saved', frameId: 's:2' }, shown: { frame: { frameId: 's:2' } } })

		await selectCameraFrame(state, KEY, { kind: 'latest' }, framesOf('s:6'), io, 'page')
		expect(tab(state).camera).toMatchObject({ selection: { kind: 'latest' }, shown: { frame: { frameId: 's:6' } } })
		expect(opens(calls).map((c) => c.url)).toEqual(['/api/capture-frames/frames/s%3A5/open', '/api/capture-frames/frames/s%3A2/open', '/api/capture-frames/frames/s%3A6/open'])
	})

	test('selecting the frame shown opens nothing', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')

		await selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:1' }, framesOf('s:1'), io, 'page')

		expect(opens(calls)).toHaveLength(1)
		expect(renders(calls)).toHaveLength(1)
	})

	test('only the latest selection is shown when an earlier one ends later', async () => {
		const { io, gated, release, calls } = fakeIo()
		const state = await cameraTab(io, 's:9')
		gated.set('s:5', () => undefined)

		const first = selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:5' }, framesOf('s:9'), io, 'page')
		await Bun.sleep(0)
		await selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:4' }, framesOf('s:9'), io, 'page')
		release('s:5')
		await first

		expect(tab(state).camera).toMatchObject({ selection: { kind: 'saved', frameId: 's:4' }, shown: { frame: { frameId: 's:4' } } })
		expect(deletes(calls)).toContainEqual(expect.stringMatching(/^\/api\/capture-frames\/leases\/lease-5-/))
	})

	test('a manual analysis holds the frame shown and drops the frame being opened', async () => {
		const { io, gated, release } = fakeIo()
		const state = await cameraTab(io, 's:1')
		gated.set('s:2', () => undefined)

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(0)
		holdCameraFrame(state, KEY)
		release('s:2')
		await Bun.sleep(10)
		handleCapturedFrame(state, event(frame(3)), io, 'page')
		await Bun.sleep(10)

		expect(tab(state).camera).toMatchObject({ selection: { kind: 'inspect', frameId: 's:1' }, shown: { frame: { frameId: 's:1' } } })
	})
})

describe('shared view state', () => {
	test('every frame renders with the applied settings, never the pending ones', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')
		const applied: DisplaySettings = { ...ORIGINAL_DISPLAY_SETTINGS, gamma: 2 }
		editDisplay(state, KEY, applied)
		await applyDisplay(state, KEY, io)
		editDisplay(state, KEY, { ...ORIGINAL_DISPLAY_SETTINGS, gamma: 3 })

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(renders(calls).at(-1)).toMatchObject({ url: '/api/images/img-2/render', body: { settings: { gamma: 2 } } })
		expect(state.views[KEY].display).toMatchObject({ applied: { gamma: 2 }, pending: { gamma: 3 } })
	})

	test('settings being applied when a new frame arrives become the applied ones', async () => {
		const { io, calls, gated, release } = fakeIo()
		const state = await cameraTab(io, 's:1')
		editDisplay(state, KEY, { ...ORIGINAL_DISPLAY_SETTINGS, gamma: 2 })
		gated.set('img-1', () => undefined)
		const applying = applyDisplay(state, KEY, io)
		await Bun.sleep(0)

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)
		release('img-1')
		await applying

		expect(renders(calls).at(-1)).toMatchObject({ url: '/api/images/img-2/render', body: { settings: { gamma: 2 } } })
		expect(state.views[KEY].display.applied).toMatchObject({ gamma: 2 })
	})

	test('Show Original renders the original of the next frame too', async () => {
		const { io, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')
		state.views[KEY].display.showOriginal = true

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(
			renders(calls)
				.filter((c) => c.url === '/api/images/img-2/render')
				.map((c) => c.body),
		).toEqual([{ settings: state.views[KEY].display.applied }, { settings: ORIGINAL_DISPLAY_SETTINGS }])
		expect(state.views[KEY].display.original).toBeDefined()
	})

	test('zoom and pan are adapted when the size of the frame changes', async () => {
		const { io, sizes } = fakeIo()
		const state = await cameraTab(io, 's:1')
		setImageView(state, KEY, { kind: 'manual', scale: 1, center: { x: 2, y: 1 } })
		sizes.set('s:2', [2, 1])

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(state.views[KEY].view).toEqual({ kind: 'manual', scale: 2, center: { x: 1, y: 0.5 } })
	})

	test('a superseded rendering revokes its object URL', async () => {
		const { io, gated, release, revoked } = fakeIo()
		const state = await cameraTab(io, 's:1')
		gated.set('s:3', () => undefined)

		const late = selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:3' }, framesOf('s:1'), io, 'page')
		await Bun.sleep(0)
		await selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:2' }, framesOf('s:1'), io, 'page')
		const shown = state.views[KEY].rendering!.url
		release('s:3')
		await late

		expect(state.views[KEY].rendering!.url).toBe(shown)
		expect(revoked).toHaveLength(1)
	})
})

describe('leases', () => {
	test('a lost lease shows the latest frame again, never another saved frame', async () => {
		const { io, control, calls } = fakeIo()
		const state = await cameraTab(io, 's:1')
		control.lost = ['lease-1-1']

		await reconcileCapturedFrames(state, framesOf('s:4'), io, 'page')
		await Bun.sleep(10)

		expect(calls.find((c) => c.method === 'PUT')).toEqual({ url: '/api/capture-frames/clients/page/leases', method: 'PUT', body: { leases: ['lease-1-1'] } })
		expect(tab(state).camera?.shown?.frame.frameId).toBe('s:4')

		await selectCameraFrame(state, KEY, { kind: 'saved', frameId: 's:2' }, framesOf('s:4'), io, 'page')
		control.lost = [tab(state).camera!.shown!.lease!]
		await reconcileCapturedFrames(state, framesOf('s:4'), io, 'page')
		await Bun.sleep(10)
		expect(tab(state).camera).toMatchObject({ selection: { kind: 'saved', frameId: 's:2' }, shown: { frame: { frameId: 's:2' } } })
		expect(opens(calls).at(-1)?.url).toBe('/api/capture-frames/frames/s%3A2/open')
	})

	test('a lost lease without a frame to show again is an error', async () => {
		const { io, control } = fakeIo()
		const state = await cameraTab(io, 's:1')
		control.lost = ['lease-1-1']

		await reconcileCapturedFrames(state, framesOf(), io, 'page')

		expect(tab(state).camera).toMatchObject({ shown: { frame: { frameId: 's:1' }, lease: undefined }, error: 'The frame shown is no longer available on the server' })
	})
})

describe('frame registry mirror', () => {
	function newFrames() {
		return proxy<CaptureFramesState>({ limit: 3, sources: {}, latest: {}, frames: { 'conn:cam': [] }, loading: {}, errors: {}, loaded: true })
	}

	test('keeps the newest saved frames first, within the limit; previewed-only frames are only the latest', () => {
		const state = newFrames()
		for (const generation of [1, 3, 2, 4]) handleCaptureFramesEvent(state, event(frame(generation, { file: 'saved' })))
		handleCaptureFramesEvent(state, event(frame(5)))

		expect(state.frames['conn:cam'].map((f) => f.frameId)).toEqual(['s:4', 's:3', 's:2'])
		expect(state.latest['conn:cam'].frameId).toBe('s:5')
		expect(state.sources['conn:cam'].latestFrameId).toBe('s:5')
	})

	test('a frame joins the saved frames once written, and leaves them when its write failed', () => {
		const state = newFrames()
		handleCaptureFramesEvent(state, event(frame(1, { revision: 1, file: 'saving' })))
		expect(state.frames['conn:cam']).toEqual([])

		handleCaptureFramesEvent(state, event(frame(1, { revision: 2, file: 'saved' })))
		expect(state.frames['conn:cam'].map((f) => f.frameId)).toEqual(['s:1'])

		handleCaptureFramesEvent(state, event(frame(1, { revision: 3, file: 'failed' })))
		expect(state.frames['conn:cam']).toEqual([])
	})

	test('a late event never replaces newer news', () => {
		const state = newFrames()
		handleCaptureFramesEvent(state, event(frame(1, { revision: 5, file: 'saved' })))
		handleCaptureFramesEvent(state, event(frame(1, { revision: 4, file: 'saving' })))

		expect(state.frames['conn:cam'][0].file).toBe('saved')
		expect(state.sources['conn:cam'].revision).toBe(5)
	})

	test('a snapshot or page fetched before newer events keeps them', async () => {
		const state = newFrames()
		state.epoch = 'run'
		let answer: (response: Response) => void = () => undefined
		const pending = (() =>
			new Promise<Response>((resolve) => {
				answer = resolve
			})) as unknown as typeof fetch

		const refreshing = refreshCaptureFrames(state, pending)
		handleCaptureFramesEvent(state, event(frame(7, { file: 'saved', revision: 7 })))
		answer(Response.json({ epoch: 'run', limit: 3, sources: [{ ...SOURCE, revision: 3, latestFrameId: 's:3' }] }))
		await refreshing
		expect(state.sources['conn:cam']).toMatchObject({ revision: 7, latestFrameId: 's:7' })

		const loading = loadRecentFrames(state, 'conn', 'cam', pending)
		answer(Response.json({ latest: frame(3, { file: 'saved' }), frames: [frame(3, { file: 'saved' })] }))
		await loading
		expect(state.frames['conn:cam'].map((f) => f.frameId)).toEqual(['s:7', 's:3'])
		expect(state.latest['conn:cam'].frameId).toBe('s:7')
	})

	test('labels and reasons', () => {
		expect(frameLabel(frame(12))).toBe('Camera · Frame 0012')
		expect(frameLabel(frame(12, { fileName: 'm42_0012.fit' }))).toBe('m42_0012.fit')
		expect(frameUnavailableReason(frame(1))).toBeUndefined()
		expect(frameUnavailableReason(frame(1, { availability: 'unavailable', reason: 'fileMissing' }))).toBe('Saved file missing')
	})
})

describe('mount nudge tab', () => {
	test('opens on the preferred camera of the connection, then on its first camera tab, never on another connection', () => {
		const tab = (connectionId: string, deviceId: string) => ({ key: cameraTabKey(connectionId, deviceId), source: { kind: 'camera', connectionId, deviceId } as const })
		const state = { documents: [{ key: 'file', source: { kind: 'file', path: '/m42.fits' } as const }, tab('other', 'cam'), tab('conn', 'guide'), tab('conn', 'main')] }

		expect(connectionCameraTab(state, 'conn', 'main')).toBe(cameraTabKey('conn', 'main'))
		expect(connectionCameraTab(state, 'conn', 'gone')).toBe(cameraTabKey('conn', 'guide'))
		expect(connectionCameraTab(state, 'conn')).toBe(cameraTabKey('conn', 'guide'))
		expect(connectionCameraTab(state, 'none', 'main')).toBeUndefined()
	})
})
