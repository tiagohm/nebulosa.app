import { expect, test } from 'bun:test'
import type { AutoFocusRequest, AutoFocusSession, AutoFocusSessionSummary, CameraCapabilities } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_EXPOSURE_SETTINGS, DEFAULT_AUTO_FOCUS_SETTINGS } from '../profile/schema'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import { autoFocusBlocker, autoFocusFrameFocus, autoFocusRequest, autoFocusRunning, type AutoFocusRuntime, defaultStepSize, handleAutoFocusEvent, refreshAutoFocus, NO_FOCUSER, startAutoFocus, stopAutoFocus } from './autofocus'
import { cameraKey } from './capture'
import { curveBounds, ticks } from './FocusCurve'

function newState() {
	return proxy<AutoFocusRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })
}

const FOCUSER = { connectionId: 'c', deviceId: 'foc' }

function summary(patch: Partial<AutoFocusSessionSummary> = {}): AutoFocusSessionSummary {
	return {
		sessionId: 's1',
		operationId: 'o1',
		camera: { connectionId: 'c', deviceId: 'cam' },
		cameraName: 'Camera',
		focuser: FOCUSER,
		focuserName: 'Focuser',
		request: autoFocusRequest(DEFAULT_AUTO_FOCUS_SETTINGS, DEFAULT_STAR_REQUEST, DEFAULT_EXPOSURE_SETTINGS, FOCUSER, 100, {}),
		provider: 'builtin',
		state: 'exposing',
		measurementCount: 0,
		verification: 'pending',
		startedAt: 1000,
		...patch,
	}
}

function details(patch: Partial<AutoFocusSession> = {}): AutoFocusSession {
	return { ...summary(), measurements: [], ...patch }
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

test('mirrors the latest session of each camera and fetches its record when a measurement arrives', async () => {
	const state = newState()
	const key = cameraKey('c', 'cam')
	const { request, requests } = fakeFetch(() => Response.json(details({ measurementCount: 1, measurements: [{ capture: 1, requestedPosition: 100, observedPosition: 100, hfd: 3, detectedCount: 9, acceptedCount: 8, elapsed: 5, warnings: [], time: 2 }] })))

	handleAutoFocusEvent(state, { type: 'autofocus:updated', session: summary() }, request)
	handleAutoFocusEvent(state, { type: 'autofocus:updated', session: summary({ measurementCount: 1 }) }, request)
	await Bun.sleep(0)

	expect(state.sessions[key]?.measurementCount).toBe(1)
	expect(requests.map((r) => r.url)).toContain('/api/autofocus/s1')
	expect(state.details.s1?.measurements).toHaveLength(1)

	// An older session of the same camera never replaces the newer one.
	handleAutoFocusEvent(state, { type: 'autofocus:updated', session: summary({ sessionId: 's0', startedAt: 500 }) }, request)
	expect(state.sessions[key]?.sessionId).toBe('s1')
	expect(autoFocusRunning(state.sessions[key])).toBeTrue()
	expect(autoFocusRunning(summary({ endedAt: 3000 }))).toBeFalse()
})

test('a newer session forgets the record of the previous one', () => {
	const state = newState()
	const { request } = fakeFetch(() => new Response(null, { status: 404 }))
	state.details.s1 = details()

	handleAutoFocusEvent(state, { type: 'autofocus:updated', session: summary() }, request)
	handleAutoFocusEvent(state, { type: 'autofocus:updated', session: summary({ sessionId: 's2', startedAt: 2000 }) }, request)

	expect(state.details.s1).toBeUndefined()
})

test('the snapshot replaces the sessions after a reconnection', async () => {
	const state = newState()
	state.sessions.old = summary({ sessionId: 'gone' })
	const { request } = fakeFetch((url) => (url === '/api/autofocus' ? Response.json({ sessions: [summary({ state: 'completed', endedAt: 5000 })] }) : Response.json(details({ state: 'completed', endedAt: 5000 }))))

	await refreshAutoFocus(state, request)
	await Bun.sleep(0)

	expect(Object.keys(state.sessions)).toEqual([cameraKey('c', 'cam')])
	expect(state.details.s1?.state).toBe('completed')
})

test('a start carries a fresh token and records a refusal; a stop names its session', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url) => (url.endsWith('/autofocus') ? Response.json({ error: 'The device is busy', code: 'busy' }, { status: 409 }) : new Response(null, { status: 204 })))

	await startAutoFocus(state, 'c', 'cam', autoFocusRequest(DEFAULT_AUTO_FOCUS_SETTINGS, DEFAULT_STAR_REQUEST, DEFAULT_EXPOSURE_SETTINGS, FOCUSER, 100, {}), request)
	expect(requests[0].url).toBe('/api/connections/c/cameras/cam/autofocus')
	const body = JSON.parse(requests[0].init!.body as string) as AutoFocusRequest
	expect(body.token).toBeString()
	expect(body.focuser).toEqual(FOCUSER)
	expect(state.errors[cameraKey('c', 'cam')]).toBe('The device is busy')

	await stopAutoFocus(state, summary(), request)
	expect(requests[1].url).toBe('/api/autofocus/s1/stop')
	expect(state.errors[cameraKey('c', 'cam')]).toBeUndefined()
})

test('the request takes its exposure time and the camera settings fitted to the camera, snoops the setup devices, and always grows the aperture of the built-in detector', () => {
	const capabilities = { exposure: { min: 0.001, max: 60 }, gain: { min: 0, max: 100 }, offset: { min: 0, max: 50 }, bin: { x: 2, y: 2 }, subframe: { width: 1000, height: 800 }, frameFormats: [{ name: 'RAW16', label: 'Raw 16' }], transferFormats: ['FITS'] } as unknown as CameraCapabilities
	const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 5, gain: 300, offset: 20, binX: 4, binY: 4, subframe: true, x: 100, y: 50, width: 400, height: 300, frameFormat: 'RAW16' } as const
	const detection = { ...DEFAULT_STAR_REQUEST, detector: { provider: 'builtin', maxStars: 100, minSNR: 0, searchRegion: 0 } } as const
	const request = autoFocusRequest({ ...DEFAULT_AUTO_FOCUS_SETTINGS, exposureTime: 120 }, detection, exposure, FOCUSER, 250, { mount: 'm', focuser: 'f', wheel: 'w', rotator: 'r' }, capabilities)

	expect(request.capture).toEqual({ exposureTime: 60, gain: 100, offset: 20, binX: 2, binY: 2, subframe: true, x: 100, y: 50, width: 400, height: 300, frameFormat: 'RAW16' })
	expect(request.snoop).toEqual({ mount: 'm', wheel: 'w', rotator: 'r' })
	expect(request.detection.detector).toEqual({ provider: 'builtin', maxStars: 100, minSNR: 0, searchRegion: 0, maximumRadius: 32 })
	expect(request.stepSize).toBe(250)
	expect(defaultStepSize(0, 100000)).toBe(500)
	expect(defaultStepSize(0, 50)).toBe(1)
})

test('the chart spans the measurements, the fitted curves, and the outcome, padded by the step size', () => {
	const session = details({
		measurements: [
			{ capture: 1, requestedPosition: 1000, observedPosition: 1000, hfd: 4, detectedCount: 1, acceptedCount: 1, elapsed: 1, warnings: [], time: 1 },
			{ capture: 2, requestedPosition: 1400, observedPosition: 1400, detectedCount: 0, acceptedCount: 0, elapsed: 1, warnings: [], time: 2 },
		],
		curve: { fittingMode: 'HYPERBOLIC', series: [{ kind: 'hyperbolic', points: [{ x: 900, y: 5 }] }] },
		finalPosition: 1500,
	})
	const bounds = curveBounds(session)!
	expect(bounds.y).toEqual([3.5, 5.5])
	expect(bounds.x).toEqual([850, 1550])
	// A single sample still spans a step of the session.
	expect(curveBounds(details({ measurements: [session.measurements[0]] }))!.x).toEqual([950, 1050])
	expect(curveBounds(details())).toBeUndefined()
	expect(ticks(0, 10, 4)).toEqual([0, 5, 10])
	expect(ticks(980, 1520, 5)).toEqual([1000, 1200, 1400])
})

test('a session starts only on a ready camera with an associated, ready focuser that moves to absolute positions', () => {
	const ready = { status: 'ready' } as const
	const busy = { status: 'busy', operations: [], message: 'The camera is busy.' } as const
	const focuser = { canAbsoluteMove: true }

	expect(autoFocusBlocker(ready, ready, focuser, false)).toBeUndefined()
	expect(autoFocusBlocker(busy, ready, focuser, false)).toBe('The camera is busy.')
	expect(autoFocusBlocker(ready, undefined, focuser, false)).toBe(NO_FOCUSER)
	expect(autoFocusBlocker(ready, { status: 'notSelected', message: 'No Focuser selected in Equipment Setup.' }, focuser, false)).toBe('No Focuser selected in Equipment Setup.')
	expect(autoFocusBlocker(ready, ready, undefined, false)).toBe('The focuser state is not known yet.')
	expect(autoFocusBlocker(ready, ready, { canAbsoluteMove: false }, false)).toBe('The focuser cannot move to absolute positions, which the Auto Focus needs.')
	expect(autoFocusBlocker(ready, ready, focuser, true)).toBe('ASTAP is not configured.')
})

test('an Auto Focus frame takes the focuser position its session recorded, and nothing is guessed', () => {
	const measurement = { requestedPosition: 1000, detectedCount: 1, acceptedCount: 1, elapsed: 1, warnings: [], time: 1 }
	const session = details({
		measurements: [
			{ ...measurement, capture: 1, observedPosition: 1002 },
			{ ...measurement, capture: 2, observedPosition: 1398 },
		],
		verificationImageId: 'img-v',
		finalPosition: 1200,
	})

	expect(autoFocusFrameFocus(session, { sessionId: 's1', generation: 2, imageId: 'img-2' })).toEqual({ position: 1398, verification: false })
	expect(autoFocusFrameFocus(session, { sessionId: 's1', generation: 3, imageId: 'img-v' })).toEqual({ position: 1200, verification: true })
	// A frame published before its measurement is recorded has no position yet.
	expect(autoFocusFrameFocus(session, { sessionId: 's1', generation: 3, imageId: 'img-3' })).toBeUndefined()
	expect(autoFocusFrameFocus(session, { sessionId: 'other', generation: 1 })).toBeUndefined()
	expect(autoFocusFrameFocus(undefined, { sessionId: 's1', generation: 1 })).toBeUndefined()
})
