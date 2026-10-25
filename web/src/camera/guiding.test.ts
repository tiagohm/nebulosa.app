import { describe, expect, test } from 'bun:test'
import type { GuidingEventRecord, GuidingSessionSummary, GuidingTelemetrySample } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_EXPOSURE_SETTINGS, DEFAULT_GUIDING_SETTINGS, GUIDING_MAXIMUM_PULSE as GUIDING_MAXIMUM_PULSE_CLAMP } from '../profile/schema'
import { DEFAULT_BUILTIN_SETTINGS } from '../stars/stars'
import { cameraKey } from './capture'
import {
	guideFocalLength,
	GUIDING_TELEMETRY_KEPT,
	guidingBlocker,
	guidingCalibrationBlocker,
	guidingCalibrationPulse,
	guidingDitherRequest,
	guidingRequest,
	guidingRunning,
	type GuidingRuntime,
	guidingStartRequest,
	handleGuidingEvent,
	refreshGuiding,
	setGuidingExposure,
	startGuiding,
	startGuidingSession,
	stopGuidingSession,
} from './guiding'

function newState() {
	return proxy<GuidingRuntime>({ sessions: {}, events: {}, telemetry: {}, frames: {}, pending: {}, errors: {} })
}

const READY = { status: 'ready' } as const

const KEY = cameraKey('c', 'guide')

const OUTPUT = { connectionId: 'c', deviceId: 'st4' }

function summary(patch: Partial<GuidingSessionSummary> = {}): GuidingSessionSummary {
	return {
		sessionId: 's1',
		operationId: 'o1',
		camera: { connectionId: 'c', deviceId: 'guide' },
		cameraName: 'Guide',
		guideOutput: OUTPUT,
		guideOutputName: 'ST4',
		revision: 1,
		active: true,
		lost: false,
		state: 'looping',
		guideOutputHeld: false,
		pulsesAdmitted: false,
		settling: false,
		dithering: false,
		calibrated: false,
		exposure: 2000,
		eventSequence: 0,
		telemetryCursor: 0,
		startedAt: 1000,
		...patch,
	}
}

function record(sequence: number): GuidingEventRecord {
	return { sequence, event: { type: 'stateChanged' } as unknown as GuidingEventRecord['event'] }
}

function sample(cursor: number): GuidingTelemetrySample {
	const axis = { duration: 0, limited: false }
	return { cursor, frameId: cursor, timestamp: cursor, lost: false, dx: 0, dy: 0, raDistance: 0, decDistance: 0, ra: axis, dec: axis, snr: 10, mass: 100, hfd: 2 }
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

// A fetch that fails every request it is not expected to send.
const NO_FETCH = fakeFetch(() => new Response(null, { status: 500 })).request

describe('requests', () => {
	test('the start takes the camera settings without their exposure, the guide exposure in ms, and the controller of the form', () => {
		const exposure = { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 30, gain: 120, binX: 2, binY: 2 }
		const request = guidingRequest({ ...DEFAULT_GUIDING_SETTINGS, exposureTime: 1.5, trackingMode: 'multiStar', aggressivenessRA: 0.4 }, exposure, OUTPUT, {}, DEFAULT_BUILTIN_SETTINGS, undefined)
		expect('exposureTime' in request.camera).toBeFalse()
		expect(request).toMatchObject({ guideOutput: OUTPUT, exposure: 1500, trackingMode: 'multiStar', camera: { gain: 120, binX: 2, binY: 2 }, calibration: { raPulse: 650, decPulse: 650 }, guider: { aggressivenessRA: 0.4, aggressivenessDEC: 0.65, maxPulseMsRA: 2000, maxPulseMsDEC: 2500 } })
		expect('optics' in request).toBeFalse()
		expect(request.client).toEqual({ ditherMode: 'random', searchRegion: 64, stickyLockPosition: false, fastRecenter: true, reverseDecOutputAfterMeridianFlip: false })
		expect(guidingRequest(DEFAULT_GUIDING_SETTINGS, exposure, OUTPUT, {}, DEFAULT_BUILTIN_SETTINGS, 240).optics).toEqual({ focalLength: 240 })
	})

	test('the start sends the star detector of the profile, without its acceptance', () => {
		const astap = { provider: 'astap', maxStars: 50, minSNR: 10 } as const
		expect(guidingRequest(DEFAULT_GUIDING_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, OUTPUT, {}, astap, undefined).detection).toEqual(astap)
		expect(guidingRequest(DEFAULT_GUIDING_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, OUTPUT, {}, DEFAULT_BUILTIN_SETTINGS, undefined).detection).toEqual(DEFAULT_BUILTIN_SETTINGS)
		expect(guidingBlocker(READY, READY, DEFAULT_GUIDING_SETTINGS, true)).toBe('ASTAP is not configured.')
	})

	test('the start snoops the devices it is given', () => {
		expect(guidingRequest(DEFAULT_GUIDING_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, OUTPUT, { mount: 'm' }, DEFAULT_BUILTIN_SETTINGS, undefined).snoop).toEqual({ mount: 'm' })
	})

	test('the guide focal length is the focal length of the guide telescope times its reducer or Barlow, unknown while not set', () => {
		expect(guideFocalLength({ focalLength: 240, focalMultiplier: 0.8, aperture: 60 })).toBeCloseTo(192, 9)
		expect(guideFocalLength({ focalLength: 0, focalMultiplier: 1, aperture: 0 })).toBeUndefined()
		expect(guideFocalLength(undefined)).toBeUndefined()
	})

	test('says which inputs the calibration step calculator lacks, and when the RA motion vanishes', () => {
		const known = { focalLength: 200, pixelSize: 3.75, guideRate: 0.5, declination: 0 }
		expect(guidingCalibrationBlocker(known, 1)).toBeUndefined()
		expect(guidingCalibrationBlocker({ ...known, focalLength: undefined }, 1)).toBe('Calculate needs the focal length of the Guide Telescope, entered in Equipment Setup.')
		expect(guidingCalibrationBlocker({ focalLength: 200, guideRate: 0.5 }, 1)).toBe('Calculate needs the pixel size of the guide camera, which it reports once connected and the declination of the Mount of the Equipment Setup, once connected.')
		expect(guidingCalibrationBlocker({}, 1)).toStartWith('Calculate needs the focal length of the Guide Telescope, entered in Equipment Setup, the pixel size')
		expect(guidingCalibrationBlocker({ ...known, declination: Math.PI / 2 }, 1)).toStartWith('The RA motion of a pulse vanishes')
		expect(guidingCalibrationBlocker({ ...known, guideRate: 0 }, 1)).toStartWith('The RA motion of a pulse vanishes')
	})

	test('the calibration pulse moves the star 25 px in 12 RA steps, as the PHD2 calculator', () => {
		// 200 mm, 3.75 µm: 3.8675"/px; 0.5× sidereal at the equator: 7.5205"/s; 25 px / 12 steps.
		expect(guidingCalibrationPulse(200, 3.75, 1, 0.5, 0)).toBe(1071)
		// 40 mm, 5.2 µm: 26.814"/px; at Dec 20° the RA motion is cos 20° slower.
		expect(guidingCalibrationPulse(40, 5.2, 1, 0.5, (20 * Math.PI) / 180)).toBe(7905)
		expect(guidingCalibrationPulse(200, 3.75, 2, 0.5, 0)).toBe(2143)
		expect(guidingCalibrationPulse(10, 5.2, 1, 0.5, 0)).toBe(GUIDING_MAXIMUM_PULSE_CLAMP)
		expect(guidingCalibrationPulse(200, 3.75, 1, 0.5, Math.PI / 2)).toBeUndefined()
		expect(guidingCalibrationPulse(0, 3.75, 1, 0.5, 0)).toBeUndefined()
		expect(guidingCalibrationPulse(200, 3.75, 1, 0, 0)).toBeUndefined()
	})

	test('Start Guiding and dither carry the settle of the form, and the dither its size in guide pixels', () => {
		const settings = { ...DEFAULT_GUIDING_SETTINGS, recalibrate: false, ditherPixels: 3, ditherRaOnly: true }
		expect(guidingStartRequest(settings)).toEqual({ recalibrate: false, settle: DEFAULT_GUIDING_SETTINGS.settle })
		expect(guidingDitherRequest(settings)).toEqual({ amount: { unit: 'guidePixel', value: 3 }, raOnly: true, settle: DEFAULT_GUIDING_SETTINGS.settle })
	})

	test('only the Guide Camera with a connected guide output can start, even while the output is busy', () => {
		const busy = { status: 'busy', operations: [], message: 'The mount is slewing.' } as const
		expect(guidingBlocker(READY, READY, DEFAULT_GUIDING_SETTINGS, false)).toBeUndefined()
		expect(guidingBlocker(READY, busy, DEFAULT_GUIDING_SETTINGS, false)).toBeUndefined()
		expect(guidingBlocker(READY, undefined, DEFAULT_GUIDING_SETTINGS, false)).toContain('Guide Camera')
		expect(guidingBlocker(READY, { status: 'disconnected', message: 'The guide output is disconnected.' }, DEFAULT_GUIDING_SETTINGS, false)).toBe('The guide output is disconnected.')
		expect(guidingBlocker({ ...busy, message: 'The camera is capturing.' }, READY, DEFAULT_GUIDING_SETTINGS, false)).toBe('The camera is capturing.')
	})
})

describe('events', () => {
	test('summaries are ordered by revision and an older session never replaces a newer one', () => {
		const state = newState()
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary({ revision: 2, state: 'guiding' }) }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary({ revision: 1 }) }, NO_FETCH)
		expect(state.sessions[KEY].state).toBe('guiding')
		expect(guidingRunning(state.sessions[KEY])).toBeTrue()

		handleGuidingEvent(state, { type: 'guiding:updated', session: summary({ sessionId: 's0', startedAt: 500, revision: 9 }) }, NO_FETCH)
		expect(state.sessions[KEY].sessionId).toBe('s1')
		expect(guidingRunning(summary({ active: false }))).toBeFalse()
	})

	test('events and telemetry are appended in order, duplicates and unknown sessions are ignored, and a gap is fetched', async () => {
		const state = newState()
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary() }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(1) }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(1) }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 'other', record: record(1) }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:telemetry', sessionId: 's1', sample: sample(1) }, NO_FETCH)
		expect(state.events.s1.map((item) => item.sequence)).toEqual([1])
		expect(state.events.other).toBeUndefined()
		expect(state.telemetry.s1.map((item) => item.cursor)).toEqual([1])

		const { request, requests } = fakeFetch(() => Response.json({ items: [record(2), record(3), record(4)], truncated: false }))
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(4) }, request)
		await Bun.sleep(0)
		expect(requests.map(({ url }) => url)).toEqual(['/api/guiding/s1/events?after=1'])
		expect(state.events.s1.map((item) => item.sequence)).toEqual([1, 2, 3, 4])
	})

	test('the telemetry keeps the newest samples within its bound', () => {
		const state = newState()
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary() }, NO_FETCH)
		for (let cursor = 1; cursor <= GUIDING_TELEMETRY_KEPT + 5; cursor++) handleGuidingEvent(state, { type: 'guiding:telemetry', sessionId: 's1', sample: sample(cursor) }, NO_FETCH)
		expect(state.telemetry.s1).toHaveLength(GUIDING_TELEMETRY_KEPT)
		expect(state.telemetry.s1[0].cursor).toBe(6)
	})

	test('a newer session of the camera forgets the history of the previous one and fetches its own', async () => {
		const state = newState()
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary() }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(1) }, NO_FETCH)
		const overlay = { frameId: 3, state: 'looping', searchRegion: 15, stars: [] } as const
		handleGuidingEvent(state, { type: 'guiding:frame', sessionId: 's1', frameId: 3, imageId: 'i3', overlay }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:frame', sessionId: 's1', frameId: 2, imageId: 'i2', overlay: { ...overlay, frameId: 2 } }, NO_FETCH)
		expect(state.frames.s1.imageId).toBe('i3')
		// The newer frame keeps the overlay of the one before it, which the tab still shows until it switches.
		handleGuidingEvent(state, { type: 'guiding:frame', sessionId: 's1', frameId: 4, imageId: 'i4', overlay: { ...overlay, frameId: 4 } }, NO_FETCH)
		expect(state.frames.s1).toMatchObject({ imageId: 'i4', previous: { imageId: 'i3', overlay: { frameId: 3 } } })

		const { request, requests } = fakeFetch((url) => Response.json({ items: url.includes('events') ? [record(1), record(2)] : [sample(1)], truncated: false }))
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary({ sessionId: 's2', startedAt: 2000, eventSequence: 2, telemetryCursor: 1 }) }, request)
		await Bun.sleep(0)
		expect(state.events.s1).toBeUndefined()
		expect(state.frames.s1).toBeUndefined()
		expect(requests.map(({ url }) => url).toSorted()).toEqual(['/api/guiding/s2/events?after=0', '/api/guiding/s2/telemetry?after=0'])
		expect(state.events.s2.map((item) => item.sequence)).toEqual([1, 2])
		expect(state.telemetry.s2.map((item) => item.cursor)).toEqual([1])
	})
})

describe('refresh', () => {
	test('replaces the sessions, forgets those no longer listed, and fetches what was missed, replacing a truncated history', async () => {
		const state = newState()
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary() }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(1) }, NO_FETCH)
		state.events.gone = [record(1)]

		const { request, requests } = fakeFetch((url) => {
			if (url === '/api/guiding') return Response.json({ sessions: [summary({ revision: 5, eventSequence: 900 })] })
			if (url.includes('events')) return Response.json({ items: [record(400), record(401)], truncated: true })
			return Response.json({ items: [], truncated: false })
		})
		await refreshGuiding(state, request)
		expect(requests.map(({ url }) => url)).toEqual(['/api/guiding', '/api/guiding/s1/events?after=1', '/api/guiding/s1/telemetry?after=0'])
		expect(state.sessions[KEY].revision).toBe(5)
		expect(state.events.gone).toBeUndefined()
		expect(state.events.s1.map((item) => item.sequence)).toEqual([400, 401])
	})

	test('a session the server no longer keeps is forgotten', async () => {
		const state = newState()
		handleGuidingEvent(state, { type: 'guiding:updated', session: summary() }, NO_FETCH)
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(1) }, NO_FETCH)
		const { request } = fakeFetch(() => new Response(null, { status: 404 }))
		handleGuidingEvent(state, { type: 'guiding:event', sessionId: 's1', record: record(3) }, request)
		await Bun.sleep(0)
		expect(state.events.s1).toBeUndefined()
	})
})

describe('commands', () => {
	test('a start posts a tokened request to the camera route; a failure is recorded per camera', async () => {
		const state = newState()
		const body = guidingRequest(DEFAULT_GUIDING_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, OUTPUT, {}, DEFAULT_BUILTIN_SETTINGS, undefined)
		const accepted = fakeFetch(() => Response.json({ sessionId: 's1', operationId: 'o1' }, { status: 202 }))
		expect(await startGuidingSession(state, 'c', 'guide', body, accepted.request)).toEqual({ sessionId: 's1', operationId: 'o1' })
		expect(accepted.requests[0].url).toBe('/api/connections/c/cameras/guide/guiding')
		const sent = JSON.parse(accepted.requests[0].init!.body as string)
		expect(typeof sent.token).toBe('string')
		expect(sent.exposure).toBe(2000)

		const refused = fakeFetch(() => Response.json({ error: 'The camera is busy.', code: 'busy' }, { status: 409 }))
		expect(await startGuidingSession(state, 'c', 'guide', body, refused.request)).toBeUndefined()
		expect(state.errors[KEY]).toBe('The camera is busy.')
		expect(state.pending[KEY]).toBeUndefined()
	})

	test('session commands address the session routes, durable ones with a token and the exposure in ms', async () => {
		const state = newState()
		const { request, requests } = fakeFetch((url) => (url.endsWith('/start') ? Response.json({ commandId: 'k1' }, { status: 202 }) : new Response(null, { status: 204 })))
		const session = summary()
		expect(await startGuiding(state, session, guidingStartRequest(DEFAULT_GUIDING_SETTINGS), request)).toEqual({ commandId: 'k1' })
		await setGuidingExposure(state, session, 0.5, request)
		await stopGuidingSession(state, session, request)
		expect(requests.map(({ url }) => url)).toEqual(['/api/guiding/s1/start', '/api/guiding/s1/exposure', '/api/guiding/s1/stop'])
		expect(JSON.parse(requests[0].init!.body as string)).toMatchObject({ recalibrate: true, token: expect.any(String) })
		expect(JSON.parse(requests[1].init!.body as string)).toEqual({ exposure: 500 })
	})
})
