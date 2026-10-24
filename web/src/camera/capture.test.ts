import { expect, test } from 'bun:test'
import type { CameraCapabilities, CaptureFrame, CaptureRequest, CaptureSession } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_ACQUISITION_SETTINGS, DEFAULT_EXPOSURE_SETTINGS } from '../profile/profile'
import { cameraKey, captureCount, captureElapsed, captureRequest, fitExposure, type CaptureRuntime, captureRunning, captureSnoop, captureStatus, fileState, handleCaptureEvent, refreshCaptures, startCapture, stopCapture } from './capture'
import { convertExposure, exposureUnitOf, fromSeconds, toSeconds } from './ExposureTimeInput'

function newState() {
	return proxy<CaptureRuntime>({ sessions: {}, frames: {}, pending: {}, errors: {} })
}

// The request of the default forms.
const DEFAULT_REQUEST: CaptureRequest = { ...DEFAULT_EXPOSURE_SETTINGS, ...DEFAULT_ACQUISITION_SETTINGS }

function session(patch: Partial<CaptureSession> = {}): CaptureSession {
	return { sessionId: 's1', operationId: 'o1', connectionId: 'c', deviceId: 'cam', cameraName: 'Camera', request: { ...DEFAULT_REQUEST, exposureTime: 5 }, phase: 'exposing', stopping: false, captured: 0, saved: 0, count: 1, startedAt: 1000, ...patch }
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
	canSetTemperature: false,
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

test('mirrors sessions and frames by exact camera, ignoring late frames', () => {
	const state = newState()
	const key = cameraKey('c', 'cam')

	handleCaptureEvent(state, { type: 'capture:updated', session: session() })
	handleCaptureEvent(state, { type: 'capture:frame', frame: frame({ imageId: 'i2', time: 20 }) })
	handleCaptureEvent(state, { type: 'capture:frame', frame: frame({ imageId: 'i1', time: 10 }) })
	handleCaptureEvent(state, { type: 'capture:frame', frame: frame({ imageId: 'i2', time: 20, file: 'saved' }) })

	expect(state.sessions[key]?.phase).toBe('exposing')
	expect(state.frames[key]).toMatchObject({ imageId: 'i2', file: 'saved' })
	expect(state.sessions[cameraKey('other', 'cam')]).toBeUndefined()

	handleCaptureEvent(state, { type: 'connection:close', id: 'c' })
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

	const first = startCapture(state, 'c', 'cam', DEFAULT_REQUEST, refused.request)
	const duplicate = startCapture(state, 'c', 'cam', DEFAULT_REQUEST, refused.request)
	await Promise.all([first, duplicate])

	expect(refused.requests).toHaveLength(1)
	expect(refused.requests[0].url).toBe('/api/connections/c/cameras/cam/capture')
	expect(JSON.parse(refused.requests[0].init!.body as string)).toEqual(DEFAULT_REQUEST)
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

test('composes the exposure settings and the acquisition form of a camera, fitted to its capabilities', () => {
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 0.0001, gain: 500, binX: 8, binY: 8, subframe: true, x: 900, y: 0, width: 400, height: 200, frameFormat: 'RGB' }
	const acquisition = { ...DEFAULT_ACQUISITION_SETTINGS, exposureMode: 'loop', delay: 3, frameType: 'FLAT', output: { mode: 'preview-save', format: 'XISF' } } as const

	expect(captureRequest(exposure, acquisition, CAPABILITIES)).toEqual({ ...exposure, ...acquisition, exposureTime: 0.0001, gain: 300, binX: 4, binY: 4, x: 600, frameFormat: '', output: { mode: 'preview-save', format: 'FITS' } })
	expect(captureRequest({ ...exposure, exposureTime: 0.000001 }, acquisition, CAPABILITIES).exposureTime).toBe(0.00001)
	expect(captureRequest(exposure, acquisition, { ...CAPABILITIES, subframe: undefined, bin: undefined, gain: undefined, transferFormats: ['FITS', 'XISF'] })).toMatchObject({ subframe: false, width: 0, height: 0, binX: 1, binY: 1, gain: 500, output: { format: 'XISF' } })
	expect(captureRequest(exposure, acquisition)).toEqual({ ...exposure, ...acquisition })
	// The exposure alone is fitted the same way, without any acquisition field.
	expect(fitExposure(exposure, CAPABILITIES)).toEqual({ ...exposure, gain: 300, binX: 4, binY: 4, x: 600, frameFormat: '' })
})

test('snoops the mount, focuser, filter wheel, and rotator of the equipment setup', () => {
	const setup = { MAIN_CAMERA: { id: 'cam', name: 'Camera' }, MOUNT: { id: 'mount', name: 'Mount' }, FOCUSER: { id: 'focuser', name: 'Focuser' }, ROTATOR: { id: 'rotator', name: 'Rotator' }, DOME: { id: 'dome', name: 'Dome' } }
	expect(captureSnoop(setup)).toEqual({ mount: 'mount', focuser: 'focuser', wheel: undefined, rotator: 'rotator' })
	expect(captureSnoop({})).toEqual({})
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

test('converts exposure times between units without float noise', () => {
	expect(fromSeconds(0.000032, 'μs')).toBe(32)
	expect(fromSeconds(0.0015, 'ms')).toBe(1.5)
	expect(toSeconds(32, 'μs')).toBe(0.000032)
	expect(toSeconds(3, 'm')).toBe(180)

	expect(exposureUnitOf(120)).toBe('m')
	expect(exposureUnitOf(90)).toBe('s')
	expect(exposureUnitOf(0.5)).toBe('ms')
	expect(exposureUnitOf(0.000032)).toBe('μs')
	expect(exposureUnitOf(1e-7)).toBe('μs')

	expect(convertExposure(1.5, 'ms')).toBe(1.5)
	expect(convertExposure(1.5, 's')).toBe(2)
	expect(convertExposure(0.001, 'm')).toBe(60)
})

test('reports the file state of previewed and saved frames', () => {
	expect(fileState(frame())).toBe('not-saved')
	expect(fileState(frame({ path: '/f.fit', file: 'saving' }))).toBe('saving')
	expect(fileState(frame({ path: '/f.fit', file: 'saved' }))).toBe('saved')
	expect(fileState(frame({ path: '/f.fit', file: 'failed' }))).toBe('failed')
})
