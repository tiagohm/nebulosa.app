import { expect, test } from 'bun:test'
import type { CameraCapabilities, CaptureFrame, CaptureRequest, CaptureSession } from 'api'
import { proxy } from 'valtio'
import type { ImagesIo } from '../images/images'
import { DEFAULT_ACQUISITION_SETTINGS } from '../profile/profile'
import { cameraKey, captureCount, captureElapsed, captureRequest, type CaptureRuntime, captureRunning, captureStatus, fileState, frameState, handleCaptureEvent, refreshCaptures, renderFrame, startCapture, stopCapture } from './capture'
import { parseDecimal } from './DecimalInput'

function newState() {
	return proxy<CaptureRuntime>({ sessions: {}, frames: {}, capabilities: {}, pending: {}, errors: {}, renderings: {}, renderErrors: {} })
}

function session(patch: Partial<CaptureSession> = {}): CaptureSession {
	return { sessionId: 's1', operationId: 'o1', connectionId: 'c', deviceId: 'cam', cameraName: 'Camera', request: { ...DEFAULT_ACQUISITION_SETTINGS, exposureTime: 5 }, phase: 'exposing', stopping: false, captured: 0, saved: 0, count: 1, startedAt: 1000, ...patch }
}

function frame(patch: Partial<CaptureFrame> = {}): CaptureFrame {
	return { imageId: 'i1', sessionId: 's1', connectionId: 'c', deviceId: 'cam', generation: 1, time: 10, frameType: 'LIGHT', width: 64, height: 32, channels: 1, acquisition: {}, ...patch }
}

const CAPABILITIES: CameraCapabilities = {
	connectionId: 'c',
	id: 'cam',
	name: 'Camera',
	connected: true,
	exposure: { min: 0.00001, max: 3600 },
	gain: { min: 0, max: 300 },
	bin: { x: 4, y: 4 },
	subframe: { width: 1000, height: 800 },
	canAbort: true,
	frameFormats: [{ name: 'MONO', label: 'Mono' }],
	frameFormat: 'MONO',
	transferFormats: ['FITS'],
}

// Fetch fake answering each URL with the response its handler builds, recording the requests.
function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(handler(url, init))
	}) as typeof fetch
	return { request, requests }
}

test('mirrors sessions, frames, and capabilities by exact camera, ignoring late frames', () => {
	const state = newState()
	const key = cameraKey('c', 'cam')

	handleCaptureEvent(state, { type: 'capture:updated', session: session() })
	handleCaptureEvent(state, { type: 'capture:frame', frame: frame({ imageId: 'i2', time: 20 }) })
	handleCaptureEvent(state, { type: 'capture:frame', frame: frame({ imageId: 'i1', time: 10 }) })
	handleCaptureEvent(state, { type: 'capture:frame', frame: frame({ imageId: 'i2', time: 20, file: 'saved' }) })
	handleCaptureEvent(state, { type: 'camera:capabilities', capabilities: CAPABILITIES })

	expect(state.sessions[key]?.phase).toBe('exposing')
	expect(state.frames[key]).toMatchObject({ imageId: 'i2', file: 'saved' })
	expect(state.capabilities[key]?.name).toBe('Camera')
	expect(state.sessions[cameraKey('other', 'cam')]).toBeUndefined()

	handleCaptureEvent(state, { type: 'connection:close', id: 'c' })
	expect(state.capabilities[key]).toBeUndefined()
	// A session belongs to the server and stays known until the server replaces it.
	expect(state.sessions[key]).toBeDefined()
})

test('a refresh replaces the sessions and frames with the server snapshot', async () => {
	const state = newState()
	handleCaptureEvent(state, { type: 'capture:updated', session: session({ deviceId: 'gone' }) })
	const { request } = fakeFetch(() => Response.json({ sessions: [session({ phase: 'waiting' })], frames: [frame()] }))

	await refreshCaptures(state, request)

	expect(Object.keys(state.sessions)).toEqual([cameraKey('c', 'cam')])
	expect(state.sessions[cameraKey('c', 'cam')]?.phase).toBe('waiting')
	expect(state.frames[cameraKey('c', 'cam')]?.imageId).toBe('i1')
})

test('starts a capture once, reports a refusal, and refreshes after a lost response', async () => {
	const state = newState()
	const key = cameraKey('c', 'cam')
	const refused = fakeFetch(() => Response.json({ error: 'The camera is busy' }, { status: 409 }))

	const first = startCapture(state, 'c', 'cam', DEFAULT_ACQUISITION_SETTINGS, refused.request)
	const duplicate = startCapture(state, 'c', 'cam', DEFAULT_ACQUISITION_SETTINGS, refused.request)
	await Promise.all([first, duplicate])

	expect(refused.requests).toHaveLength(1)
	expect(refused.requests[0].url).toBe('/api/connections/c/cameras/cam/capture')
	expect(JSON.parse(refused.requests[0].init!.body as string)).toEqual(DEFAULT_ACQUISITION_SETTINGS)
	expect(state.errors[key]).toBe('The camera is busy')
	expect(state.pending[key]).toBeUndefined()

	const lost = fakeFetch((url) => {
		if (url === '/api/captures') return Response.json({ sessions: [session()], frames: [] })
		throw new Error('network')
	})

	await stopCapture(state, 'c', 'cam', lost.request)
	expect(lost.requests.map((r) => r.url)).toEqual(['/api/connections/c/cameras/cam/capture/stop', '/api/captures'])
	expect(state.errors[key]).toBe('Unable to reach the server.')
	expect(state.sessions[key]?.phase).toBe('exposing')
})

test('fits a form to the camera capabilities', () => {
	const settings: CaptureRequest = { ...DEFAULT_ACQUISITION_SETTINGS, exposureTime: 0.0001, gain: 500, binX: 8, binY: 8, subframe: true, x: 900, y: 0, width: 400, height: 200, frameFormat: 'RGB', output: { mode: 'preview-save', format: 'XISF' } }

	expect(captureRequest(settings, CAPABILITIES)).toEqual({ ...settings, exposureTime: 0.0001, gain: 300, binX: 4, binY: 4, x: 600, frameFormat: '', output: { mode: 'preview-save', format: 'FITS' } })
	expect(captureRequest({ ...settings, exposureTime: 0.000001 }, CAPABILITIES).exposureTime).toBe(0.00001)
	expect(captureRequest(settings, { ...CAPABILITIES, subframe: undefined, bin: undefined, gain: undefined, transferFormats: ['FITS', 'XISF'] })).toMatchObject({ subframe: false, width: 0, height: 0, binX: 1, binY: 1, gain: 500, output: { format: 'XISF' } })
	expect(captureRequest(settings)).toEqual(settings)
})

test('describes the state of a capture', () => {
	expect(captureStatus(session({ exposure: { elapsedTime: 3200000, remainingTime: 1800000, progress: 64 } }))).toBe('Exposing — 3.2 / 5 s')
	expect(captureStatus(session())).toBe('Exposing')
	expect(captureStatus(session({ phase: 'reading' }))).toBe('Reading Frame')
	expect(captureStatus(session({ phase: 'saving' }))).toBe('Saving Frame')
	expect(captureStatus(session({ phase: 'waiting', delay: { elapsedTime: 200000, remainingTime: 800000, progress: 20 } }))).toBe('Waiting — 0.8 s')
	expect(captureStatus(session({ phase: 'failed', reason: 'commandFailed', error: 'disk full' }))).toBe('Failed: disk full')
	expect(captureCount(session({ captured: 12, count: 30 }))).toBe('Captured 12 / 30')
	expect(captureCount(session({ captured: 152, count: undefined }))).toBe('Captured 152')
	expect(captureElapsed(session({ startedAt: 1000, endedAt: 4500 }), 9999)).toBe(3.5)
	expect(captureRunning(session({ phase: 'waiting' }))).toBeTrue()
	expect(captureRunning(session({ phase: 'stopped' }))).toBeFalse()
	expect(captureRunning(undefined)).toBeFalse()
})

test('keeps the previous rendering until the next frame is rendered, and when it was closed meanwhile', async () => {
	const state = newState()
	const key = cameraKey('c', 'cam')
	const revoked: string[] = []
	let status = 200
	let created = 0
	const io: ImagesIo = {
		fetch: () => Promise.resolve(status === 200 ? new Response(new Blob(['jpeg'])) : Response.json({ error: 'Image not found' }, { status })),
		createObjectURL: () => `blob:${++created}`,
		revokeObjectURL: (url) => revoked.push(url),
	}

	await renderFrame(state, key, frame({ imageId: 'i1' }), io)
	expect(state.renderings[key]).toEqual({ imageId: 'i1', url: 'blob:1', width: 64, height: 32 })

	await renderFrame(state, key, frame({ imageId: 'i1', file: 'saved' }), io)
	expect(created).toBe(1)

	status = 404
	await renderFrame(state, key, frame({ imageId: 'i2' }), io)
	expect(state.renderings[key]?.imageId).toBe('i1')
	expect(state.renderErrors[key]).toBeUndefined()

	status = 500
	await renderFrame(state, key, frame({ imageId: 'i3' }), io)
	expect(state.renderings[key]?.imageId).toBe('i1')
	expect(state.renderErrors[key]).toBe('Image not found')

	status = 200
	await renderFrame(state, key, frame({ imageId: 'i4', width: 10, height: 10 }), io)
	expect(state.renderings[key]).toEqual({ imageId: 'i4', url: 'blob:2', width: 10, height: 10 })
	expect(revoked).toEqual(['blob:1'])
	expect(state.renderErrors[key]).toBeUndefined()
})

test('parses decimal times without rounding them', () => {
	expect(parseDecimal('0.0001', 0, true)).toBe(0.0001)
	expect(parseDecimal(' 1.5 ', 0)).toBe(1.5)
	expect(parseDecimal('0', 0)).toBe(0)
	expect(parseDecimal('0', 0, true)).toBeUndefined()
	expect(parseDecimal('-1', 0)).toBeUndefined()
	expect(parseDecimal('abc', 0)).toBeUndefined()
	expect(parseDecimal('', 0)).toBeUndefined()
	expect(parseDecimal('Infinity', 0)).toBeUndefined()
})

test('keeps the frame state apart from the capture outcome', () => {
	expect(frameState(frame({ imageId: 'i2' }))).toBe('received')
	expect(frameState(frame({ imageId: 'i2' }), { imageId: 'i1' })).toBe('received')
	expect(frameState(frame({ imageId: 'i2' }), { imageId: 'i2' }, 'Image not found')).toBe('ready')
	expect(frameState(frame({ imageId: 'i2' }), { imageId: 'i1' }, 'Image not found')).toBe('error')
	expect(frameState(frame({ imageId: 'i2' }), undefined, undefined, 'Unable to decode the frame')).toBe('error')
})

test('reports the file state of previewed and saved frames', () => {
	expect(fileState(frame())).toBe('not-saved')
	expect(fileState(frame({ path: '/f.fit', file: 'saving' }))).toBe('saving')
	expect(fileState(frame({ path: '/f.fit', file: 'saved' }))).toBe('saved')
	expect(fileState(frame({ path: '/f.fit', file: 'failed' }))).toBe('failed')
})
