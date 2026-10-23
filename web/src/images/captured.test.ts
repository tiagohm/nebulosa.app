import { describe, expect, test } from 'bun:test'
import type { CaptureFrameSummary, CaptureSourceSummary, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { type CaptureFramesState, frameLabel, frameUnavailableReason, handleCaptureFramesEvent } from './captureframes'
import { closeImage, handleCapturedFrame, type ImagesIo, type ImagesState, openCaptureFrame, openLive, pauseLive, pinLive, reconcileCapturedFrames, resumeLive, setImageView } from './images'

interface Call {
	readonly url: string
	readonly method: string
	readonly body?: unknown
}

const SOURCE: CaptureSourceSummary = { connectionId: 'conn', deviceId: 'cam', cameraName: 'Camera', connected: true, latestRestored: false, count: 1, revision: 1 }

// Returns a frame of the camera, with fields replaced.
function frame(generation: number, patch: Partial<CaptureFrameSummary> = {}): CaptureFrameSummary {
	return { frameId: `s:${generation}`, sequence: generation, revision: generation, connectionId: 'conn', deviceId: 'cam', cameraName: 'Camera', sessionId: 's', generation, time: 0, frameType: 'LIGHT', width: 4, height: 2, channels: 1, availability: 'memory', imageId: `img-${generation}`, ...patch }
}

// Returns the registry event of a new frame, which is the latest of its camera.
function event(summary: CaptureFrameSummary): ServerEvent {
	return { type: 'captureFrame:updated', frame: summary, source: { ...SOURCE, latestFrameId: summary.frameId, latestAvailableFrameId: summary.frameId, revision: summary.revision } }
}

// Fake API: opens any frame "s:<n>" as the document img-<n> under the lease lease-<n>-<count>, refuses frames named
// in refused, holds the opens of gated frames until released, and renders anything.
function fakeIo() {
	const calls: Call[] = []
	const refused = new Set<string>()
	const gated = new Map<string, () => void>()
	const control = { lost: [] as string[] }
	let count = 0

	const io: ImagesIo = {
		fetch: async (input: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET'
			const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
			calls.push({ url: input, method, body })
			const open = /\/api\/capture-frames\/frames\/([^/]+)\/open$/.exec(input)

			if (open) {
				const frameId = decodeURIComponent(open[1])
				if (refused.has(frameId)) return Response.json({ error: 'The frame is no longer in memory and was not saved', code: 'expired' }, { status: 410 })
				if (gated.has(frameId))
					await new Promise<void>((resolve) => {
						gated.set(frameId, resolve)
					})
				const generation = Number(frameId.split(':')[1])
				const summary = frame(generation)
				return Response.json({ lease: `lease-${generation}-${++count}`, info: { origin: 'capture', format: 'fits', id: summary.imageId, name: 'frame', width: 4, height: 2, channels: 1, header: {}, acquisition: {}, connectionId: 'conn', deviceId: 'cam', frameId, time: 0 }, frame: summary })
			}

			if (method === 'PUT') return Response.json({ lost: control.lost })
			if (method === 'DELETE') return new Response(null, { status: 204 })
			return new Response(new Blob(['jpeg']), { headers: { 'X-Image-Render': JSON.stringify({ stretch: [], channels: 1 }) } })
		},
		createObjectURL: () => `blob:${++count}`,
		revokeObjectURL: () => undefined,
	}

	// Lets a gated open answer.
	function release(frameId: string) {
		gated.get(frameId)?.()
	}

	return { io, calls, refused, gated, control, release }
}

function newState() {
	return proxy<ImagesState>({ documents: [], views: {}, tools: {} })
}

function opens(calls: readonly Call[]) {
	return calls.filter((c) => c.url.endsWith('/open'))
}

function deletes(calls: readonly Call[]) {
	return calls.filter((c) => c.method === 'DELETE').map((c) => c.url)
}

describe('captured frames', () => {
	test('opens a frame by its id under a lease of the page, once', async () => {
		const state = newState()
		const { io, calls } = fakeIo()

		await openCaptureFrame(state, 's:3', io, 'page')
		await openCaptureFrame(state, 's:3', io, 'page')

		expect(state.documents).toHaveLength(1)
		const [document] = state.documents
		expect(document).toMatchObject({ status: 'ready', name: 'Camera · Frame 0003', source: { kind: 'capture', frameId: 's:3' }, info: { id: 'img-3' }, capture: { lease: 'lease-3-1' } })
		expect(opens(calls)).toEqual([{ url: '/api/capture-frames/frames/s%3A3/open', method: 'POST', body: { client: 'page' } }])
		expect(calls.some((c) => c.url === '/api/images/img-3/render')).toBeTrue()
	})

	test('a refused frame is an error, never another frame', async () => {
		const state = newState()
		const { io, refused } = fakeIo()
		refused.add('s:1')

		await openCaptureFrame(state, 's:1', io, 'page')

		expect(state.documents[0]).toMatchObject({ status: 'error', error: 'The frame is no longer in memory and was not saved' })
		expect(state.documents[0].info).toBeUndefined()
	})

	test('closing releases the lease, never the document of the camera', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openCaptureFrame(state, 's:1', io, 'page')

		closeImage(state, state.documents[0].key, io)

		expect(deletes(calls)).toEqual(['/api/capture-frames/leases/lease-1-1'])
	})

	test('a tab closed before the server answers releases its lease', async () => {
		const state = newState()
		const { io, calls, gated, release } = fakeIo()
		gated.set('s:1', () => undefined)
		const opening = openCaptureFrame(state, 's:1', io, 'page')
		await Bun.sleep(0)

		closeImage(state, state.documents[0].key, io)
		release('s:1')
		await opening

		expect(deletes(calls)).toEqual(['/api/capture-frames/leases/lease-1-1'])
	})

	test('a lost lease marks the frame unavailable', async () => {
		const state = newState()
		const { io, control, calls } = fakeIo()
		await openCaptureFrame(state, 's:1', io, 'page')
		control.lost = ['lease-1-1']

		await reconcileCapturedFrames(state, io, 'page')

		expect(calls.at(-1)).toEqual({ url: '/api/capture-frames/clients/page/leases', method: 'PUT', body: { leases: ['lease-1-1'] } })
		expect(state.documents[0]).toMatchObject({ status: 'error', capture: { lease: undefined } })
	})
})

describe('live', () => {
	test('follows the newer frames of its camera, keeping the view, and releases the previous lease', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')
		const key = state.documents[0].key
		setImageView(state, key, { kind: 'manual', scale: 2, center: { x: 10, y: 5 } })

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(state.documents).toHaveLength(1)
		expect(state.documents[0]).toMatchObject({ name: 'Live · Camera', info: { id: 'img-2' }, capture: { live: 'following', frame: { frameId: 's:2' }, lease: 'lease-2-3' } })
		expect(state.views[key].view).toEqual({ kind: 'manual', scale: 2, center: { x: 10, y: 5 } })
		expect(deletes(calls)).toEqual(['/api/capture-frames/leases/lease-1-1'])
	})

	test('ignores older frames, frames of other cameras, and frames not in memory', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:5', io, 'page')

		handleCapturedFrame(state, event(frame(4)), io, 'page')
		handleCapturedFrame(state, event(frame(6, { deviceId: 'other' })), io, 'page')
		handleCapturedFrame(state, event(frame(7, { availability: 'file', imageId: undefined })), io, 'page')
		await Bun.sleep(10)

		expect(opens(calls)).toHaveLength(1)
		expect(state.documents[0].capture?.frame?.frameId).toBe('s:5')
	})

	test('only the newest of the frames arriving while one opens is shown', async () => {
		const state = newState()
		const { io, calls, gated, release } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, undefined, io, 'page')
		gated.set('s:1', () => undefined)

		handleCapturedFrame(state, event(frame(1)), io, 'page')
		await Bun.sleep(0)
		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)
		release('s:1')
		await Bun.sleep(10)

		expect(state.documents[0].capture?.frame?.frameId).toBe('s:2')
		// The lease of the superseded frame is released.
		expect(deletes(calls).filter((url) => url.startsWith('/api/capture-frames/leases/lease-1-'))).toHaveLength(1)
	})

	test('waits for the first frame without one', async () => {
		const state = newState()
		const { io, calls } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, undefined, io, 'page')

		expect(state.documents[0]).toMatchObject({ status: 'ready', capture: { live: 'following' } })
		expect(state.documents[0].info).toBeUndefined()
		expect(calls).toEqual([])
	})

	test('one live tab per camera', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')

		expect(state.documents).toHaveLength(1)
	})

	test('pausing keeps the frame shown; resuming shows the latest one', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')
		const key = state.documents[0].key

		pauseLive(state, key)
		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)
		expect(state.documents[0].capture).toMatchObject({ live: 'paused', frame: { frameId: 's:1' } })

		await resumeLive(state, key, 's:3', io, 'page')
		expect(state.documents[0].capture).toMatchObject({ live: 'following', frame: { frameId: 's:3' } })
	})

	test('a manual analysis pauses the tab for it', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')

		pauseLive(state, state.documents[0].key, 'pausedForAnalysis')

		expect(state.documents[0].capture?.live).toBe('pausedForAnalysis')
	})

	test('pinning opens the frame shown as a tab of its own; the live tab goes on', async () => {
		const state = newState()
		const { io } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')

		await pinLive(state, state.documents[0].key, io, 'page')
		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(state.documents.map((d) => [d.source.kind, d.capture?.frame?.frameId])).toEqual([
			['live', 's:2'],
			['capture', 's:1'],
		])
	})

	test('a frame that cannot be opened keeps the frame shown', async () => {
		const state = newState()
		const { io, refused } = fakeIo()
		await openLive(state, { connectionId: 'conn', deviceId: 'cam', name: 'Camera' }, 's:1', io, 'page')
		refused.add('s:2')

		handleCapturedFrame(state, event(frame(2)), io, 'page')
		await Bun.sleep(10)

		expect(state.documents[0]).toMatchObject({ info: { id: 'img-1' }, capture: { frame: { frameId: 's:1' }, error: 'The frame is no longer in memory and was not saved' } })
	})
})

describe('frame registry mirror', () => {
	function newFrames() {
		return proxy<CaptureFramesState>({ limit: 3, sources: {}, frames: { 'conn:cam': [] }, loading: {}, errors: {}, loaded: true })
	}

	test('keeps the newest frames first, within the limit', () => {
		const state = newFrames()
		for (const generation of [1, 3, 2, 4]) handleCaptureFramesEvent(state, event(frame(generation)))

		expect(state.frames['conn:cam'].map((f) => f.frameId)).toEqual(['s:4', 's:3', 's:2'])
		expect(state.sources['conn:cam'].latestFrameId).toBe('s:4')
	})

	test('a late event never replaces newer news', () => {
		const state = newFrames()
		handleCaptureFramesEvent(state, event(frame(1, { revision: 5, file: 'saved' })))
		handleCaptureFramesEvent(state, event(frame(1, { revision: 4, file: 'saving' })))

		expect(state.frames['conn:cam'][0].file).toBe('saved')
		expect(state.sources['conn:cam'].revision).toBe(5)
	})

	test('labels and reasons', () => {
		expect(frameLabel(frame(12))).toBe('Camera · Frame 0012')
		expect(frameLabel(frame(12, { fileName: 'm42_0012.fit' }))).toBe('m42_0012.fit')
		expect(frameUnavailableReason(frame(1))).toBeUndefined()
		expect(frameUnavailableReason(frame(1, { availability: 'unavailable', reason: 'fileMissing' }))).toBe('Saved file missing')
	})
})
