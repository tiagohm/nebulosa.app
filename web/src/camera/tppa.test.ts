import { expect, test } from 'bun:test'
import type { MountState, TppaSession, TppaSessionSummary } from 'api'
import { deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { DEFAULT_EXPOSURE_SETTINGS, DEFAULT_TPPA_SETTINGS } from '../profile/schema'
import { cameraKey } from './capture'
import { handleTppaEvent, refreshTppa, startTppa, stopTppaRefinement, tppaBlocker, tppaFrameRole, tppaMountSupport, tppaRequest, type TppaRuntime, tppaSlewRate } from './tppa'

function newState() {
	return proxy<TppaRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })
}

const MOUNT = { connectionId: 'c', deviceId: 'mnt' }

const READY = { status: 'ready' } as const

function mountState(patch: Partial<MountState> = {}): MountState {
	return {
		connectionId: 'c',
		id: 'mnt',
		connected: true,
		mountType: 'EQ_GEM',
		canMove: true,
		canMoveWE: true,
		canAbort: true,
		slewRates: [
			{ name: 'SPEED_1', label: '1x' },
			{ name: 'SPEED_4', label: '16x' },
		],
		slewRate: 'SPEED_1',
		tracking: true,
		parked: false,
		parking: false,
		site: { latitude: deg(-22), longitude: deg(-45), elevation: 800 },
		...patch,
	} as MountState
}

function summary(patch: Partial<TppaSessionSummary> = {}): TppaSessionSummary {
	return {
		sessionId: 's1',
		operationId: 'o1',
		camera: { connectionId: 'c', deviceId: 'cam' },
		cameraName: 'Camera',
		mount: MOUNT,
		mountName: 'Mount',
		request: tppaRequest(DEFAULT_TPPA_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, MOUNT, 'SPEED_4'),
		provider: 'astap',
		state: 'capturing',
		frameCount: 1,
		pointCount: 0,
		refinementCount: 0,
		warnings: [],
		startedAt: 1000,
		revision: 1,
		...patch,
	}
}

function details(patch: Partial<TppaSession> = {}): TppaSession {
	return { ...summary(), points: [], attempts: [], ...patch }
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

test('the request sends the rotation in radians and the camera exposure, and the slew rate only when announced', () => {
	const request = tppaRequest({ ...DEFAULT_TPPA_SETTINGS, rotation: 10, solver: { provider: 'nova', strategy: 'blind', downsample: 2 } }, DEFAULT_EXPOSURE_SETTINGS, MOUNT, 'SPEED_4')
	expect(request.rotation).toBeCloseTo(deg(10), 12)
	expect(request.solving).toEqual({ provider: 'nova', strategy: 'blind', downsample: 2 })
	expect(request.capture.exposureTime).toBe(DEFAULT_EXPOSURE_SETTINGS.exposureTime)

	expect(tppaSlewRate({ slewRate: 'SPEED_4' }, mountState())).toBe('SPEED_4')
	expect(tppaSlewRate({ slewRate: 'WARP' }, mountState())).toBe('SPEED_1')
	expect(tppaSlewRate({}, mountState({ slewRate: undefined }))).toBeUndefined()
	expect(tppaSlewRate({ slewRate: 'SPEED_4' }, undefined)).toBeUndefined()
})

test('a mount that can never align is unsupported, and a start needs a ready, tracking, located mount and a solver', () => {
	expect(tppaMountSupport(mountState({ mountType: 'ALTAZ' }))).toContain('not equatorial')
	expect(tppaMountSupport(mountState({ canMoveWE: false }))).toContain('west-east')
	expect(tppaMountSupport(mountState({ canAbort: false }))).toContain('abort')
	expect(tppaMountSupport(mountState({ slewRates: [] }))).toContain('slew rate')
	expect(tppaMountSupport(mountState())).toBeUndefined()
	expect(tppaMountSupport(undefined)).toBeUndefined()

	const state = mountState()
	expect(tppaBlocker(READY, READY, state, 'SPEED_4', true)).toBeUndefined()
	expect(tppaBlocker({ status: 'busy', operations: [], message: 'The camera is busy.' }, READY, state, 'SPEED_4', true)).toBe('The camera is busy.')
	expect(tppaBlocker(READY, { status: 'unsupported', message: 'No.' }, state, 'SPEED_4', true)).toBe('No.')
	expect(tppaBlocker(READY, READY, undefined, 'SPEED_4', true)).toContain('not known')
	expect(tppaBlocker(READY, READY, state, undefined, true)).toContain('slew rate')
	expect(tppaBlocker(READY, READY, mountState({ site: { latitude: 0, longitude: 0, elevation: 0 } }), 'SPEED_4', true)).toContain('site')
	expect(tppaBlocker(READY, READY, mountState({ tracking: false }), 'SPEED_4', true)).toContain('tracking')
	expect(tppaBlocker(READY, READY, state, 'SPEED_4', false)).toContain('not configured')
})

test('events are ordered by revision and fetch the record on a new frame, pose, or estimate', async () => {
	const state = newState()
	const key = cameraKey('c', 'cam')
	const { request, requests } = fakeFetch(() => Response.json(details({ revision: 3, frameCount: 2, pointCount: 1 })))

	handleTppaEvent(state, { type: 'tppa:updated', session: summary({ revision: 3, frameCount: 2, pointCount: 1 }) }, request)
	handleTppaEvent(state, { type: 'tppa:updated', session: summary({ revision: 2, state: 'moving' }) }, request)
	await Bun.sleep(0)

	expect(state.sessions[key]).toMatchObject({ revision: 3, state: 'capturing' })
	expect(requests.map((r) => r.url)).toEqual(['/api/tppa/s1'])
	expect(state.details.s1?.pointCount).toBe(1)

	// A state change of the same frame needs no record.
	handleTppaEvent(state, { type: 'tppa:updated', session: summary({ revision: 4, frameCount: 2, pointCount: 1, state: 'solving' }) }, request)
	expect(requests).toHaveLength(1)
})

test('a newer session forgets the record of the previous one, and the snapshot replaces the sessions', async () => {
	const state = newState()
	state.details.s1 = details()
	const { request } = fakeFetch((url) => (url === '/api/tppa' ? Response.json({ sessions: [summary({ sessionId: 's2', startedAt: 2000 })] }) : Response.json(details({ sessionId: 's2', startedAt: 2000 }))))

	handleTppaEvent(state, { type: 'tppa:updated', session: summary({ sessionId: 's2', startedAt: 2000 }) }, request)
	expect(state.details.s1).toBeUndefined()

	await refreshTppa(state, request)
	await Bun.sleep(0)
	expect(Object.values(state.sessions).map((s) => s.sessionId)).toEqual(['s2'])
	expect(state.details.s2?.sessionId).toBe('s2')
})

test('a start carries a fresh token and records a refusal; a pause names its session', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url) => (url.endsWith('/tppa') ? Response.json({ error: 'The mount is not tracking', code: 'unsupported' }, { status: 422 }) : new Response(null, { status: 204 })))

	await startTppa(state, 'c', 'cam', summary().request, request)
	expect(requests[0].url).toBe('/api/connections/c/cameras/cam/tppa')
	expect(JSON.parse(requests[0].init?.body as string).token).toBeString()
	expect(state.errors[cameraKey('c', 'cam')]).toBe('The mount is not tracking')

	await stopTppaRefinement(state, summary(), request)
	expect(requests[1].url).toBe('/api/tppa/s1/refinement/stop')
	expect(state.errors[cameraKey('c', 'cam')]).toBeUndefined()
})

test('a TPPA frame is a pose, a rejected candidate, or a refinement frame of its session', () => {
	const session = details({
		points: [{ point: 1, frame: 1, rightAscension: 0, declination: 0, time: 1 }],
		attempts: [{ point: 2, frame: 2, rotation: deg(3), totalRotation: deg(3), separation: deg(3), accepted: false, reason: 'insufficientRotation' }],
		initialAlignment: { stage: 'acquisition', frame: 4, azimuthError: 0, altitudeError: 0, totalError: 0, azimuthAdjustment: 0, altitudeAdjustment: 0, time: 1 },
	})

	expect(tppaFrameRole(session, { sessionId: 's1', generation: 1 })).toEqual({ point: 1, rejected: false, refinement: false })
	expect(tppaFrameRole(session, { sessionId: 's1', generation: 2 })).toEqual({ rejected: true, refinement: false })
	expect(tppaFrameRole(session, { sessionId: 's1', generation: 5 })).toEqual({ rejected: false, refinement: true })
	expect(tppaFrameRole(session, { sessionId: 's2', generation: 1 })).toBeUndefined()
})
