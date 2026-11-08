import { expect, test } from 'bun:test'
import type { IPolarSession, IPolarSessionSummary, MountState } from 'api'
import { arcsec, deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { DEFAULT_CAMERA_PLATE_SOLVING, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_IPOLAR_SETTINGS } from '../profile/schema'
import { cameraKey } from './capture'
// oxfmt-ignore
import { confirmIPolarRotation, finishIPolar, handleIPolarEvent, ipolarBlocker, ipolarFrameRole, ipolarMountSupport, ipolarRequest, type IPolarRuntime, ipolarSlewRate, refreshIPolar, startIPolar, type IPolarStartContext } from './ipolar'

function newState() {
	return proxy<IPolarRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })
}

const MOUNT = { connectionId: 'c', deviceId: 'mnt' }
const SITE = { id: 'home', name: 'Home', latitude: -22, longitude: -45, elevation: 800, timeZone: 'America/Sao_Paulo' }
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
		tracking: false,
		parked: false,
		parking: false,
		...patch,
	} as MountState
}

function summary(patch: Partial<IPolarSessionSummary> = {}): IPolarSessionSummary {
	return {
		sessionId: 's1',
		operationId: 'o1',
		camera: { connectionId: 'c', deviceId: 'cam' },
		cameraName: 'Camera',
		request: ipolarRequest(DEFAULT_IPOLAR_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, SITE, undefined, undefined, false),
		provider: 'astap',
		state: 'capturing',
		frameCount: 1,
		attemptCount: 0,
		current: false,
		convergence: { streak: 0, converged: false },
		refinementCount: 0,
		warnings: [],
		startedAt: 1000,
		revision: 1,
		...patch,
	}
}

function details(patch: Partial<IPolarSession> = {}): IPolarSession {
	return { ...summary(), poses: [], attempts: [], ...patch }
}

function context(patch: Partial<IPolarStartContext> = {}): IPolarStartContext {
	return { camera: READY, mount: READY, mode: 'manual', mountState: mountState(), slewRate: 'SPEED_4', site: SITE, solverConfigured: true, clearanceConfirmed: false, ...patch }
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

test('the request sends the site, rotation and threshold in radians, and the mount and preset only when used', () => {
	const manual = ipolarRequest({ ...DEFAULT_IPOLAR_SETTINGS, exposureTime: 4, completionThreshold: 45 }, DEFAULT_EXPOSURE_SETTINGS, { provider: 'nova', strategy: 'blind' }, SITE, undefined, 'SPEED_4', true)
	expect(manual).toMatchObject({ mode: 'manual', clearanceConfirmed: false, refraction: true, site: { name: 'Home', elevation: 800 } })
	expect(manual.site.latitude).toBeCloseTo(deg(-22), 12)
	expect(manual.completionThreshold).toBeCloseTo(arcsec(45), 12)
	expect(manual.capture.exposureTime).toBe(4)
	expect('mount' in manual || 'slewRate' in manual).toBeFalse()

	const automatic = ipolarRequest({ ...DEFAULT_IPOLAR_SETTINGS, mode: 'automatic', rotation: 25 }, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, SITE, MOUNT, 'SPEED_4', true)
	expect(automatic).toMatchObject({ mode: 'automatic', mount: MOUNT, slewRate: 'SPEED_4', clearanceConfirmed: true })
	expect(automatic.rotation).toBeCloseTo(deg(25), 12)

	expect(ipolarSlewRate({ slewRate: 'SPEED_4' }, mountState())).toBe('SPEED_4')
	expect(ipolarSlewRate({ slewRate: 'WARP' }, mountState())).toBe('SPEED_1')
	expect(ipolarSlewRate({}, undefined)).toBeUndefined()
})

test('a manual start needs only the camera, a site and a solver; an automatic one the mount and its clearance', () => {
	expect(ipolarBlocker(context())).toBeUndefined()
	expect(ipolarBlocker(context({ mount: { status: 'notSelected', message: 'No mount.' }, mountState: undefined }))).toBeUndefined()
	expect(ipolarBlocker(context({ mount: { status: 'busy', operations: [], message: 'The Mount is busy.' } }))).toBe('The Mount is busy.')
	expect(ipolarBlocker(context({ camera: { status: 'busy', operations: [], message: 'The camera is busy.' } }))).toBe('The camera is busy.')
	expect(ipolarBlocker(context({ site: undefined }))).toContain('observing site')
	expect(ipolarBlocker(context({ solverConfigured: false }))).toContain('not configured')

	const automatic = { mode: 'automatic' as const, clearanceConfirmed: true }
	expect(ipolarBlocker(context(automatic))).toBeUndefined()
	expect(ipolarBlocker(context({ ...automatic, mount: { status: 'unsupported', message: 'No.' } }))).toBe('No.')
	expect(ipolarBlocker(context({ ...automatic, mountState: undefined }))).toContain('not known')
	expect(ipolarBlocker(context({ ...automatic, slewRate: undefined }))).toContain('slew rate')
	expect(ipolarBlocker(context({ ...automatic, mountState: mountState({ parked: true }) }))).toContain('parked')
	expect(ipolarBlocker(context({ ...automatic, clearanceConfirmed: false }))).toContain('without hitting')

	expect(ipolarMountSupport(mountState({ mountType: 'ALTAZ' }))).toContain('not equatorial')
	expect(ipolarMountSupport(mountState({ canAbort: false }))).toContain('abort')
	// Tracking is not required: the Earth-fixed fit does not depend on it.
	expect(ipolarMountSupport(mountState())).toBeUndefined()
	expect(ipolarMountSupport(undefined)).toBeUndefined()
})

test('events are ordered by revision and fetch the record on a new frame, candidate, measurement, or rejection', async () => {
	const state = newState()
	const key = cameraKey('c', 'cam')
	const { request, requests } = fakeFetch(() => Response.json(details({ revision: 3, frameCount: 2, attemptCount: 1 })))

	handleIPolarEvent(state, { type: 'ipolar:updated', session: summary({ revision: 3, frameCount: 2, attemptCount: 1 }) }, request)
	handleIPolarEvent(state, { type: 'ipolar:updated', session: summary({ revision: 2, state: 'waitingForRotation' }) }, request)
	await Bun.sleep(0)

	expect(state.sessions[key]).toMatchObject({ revision: 3, state: 'capturing' })
	expect(requests.map((r) => r.url)).toEqual(['/api/ipolar/s1'])

	// A state change of the same frame needs no record; a rejection of a later frame does.
	handleIPolarEvent(state, { type: 'ipolar:updated', session: summary({ revision: 4, frameCount: 2, attemptCount: 1, state: 'solving' }) }, request)
	expect(requests).toHaveLength(1)
	handleIPolarEvent(state, { type: 'ipolar:updated', session: summary({ revision: 5, frameCount: 2, attemptCount: 1, rejection: { frame: 2, reason: 'unsolved', time: 1 } }) }, request)
	expect(requests).toHaveLength(2)
})

test('the snapshot leaves a session an event ended during its request', async () => {
	const state = newState()
	const snapshot = Promise.withResolvers<Response>()
	const { request } = fakeFetch((url) => (url === '/api/ipolar' ? snapshot.promise : Response.json(details({ state: 'completed', endedAt: 5000, revision: 2 }))))

	const refreshing = refreshIPolar(state, request)
	handleIPolarEvent(state, { type: 'ipolar:updated', session: summary({ state: 'completed', endedAt: 5000, revision: 2 }) }, request)
	snapshot.resolve(Response.json({ sessions: [summary()] }))
	await refreshing

	expect(state.sessions[cameraKey('c', 'cam')].endedAt).toBe(5000)
})

test('a start carries a fresh token and records a refusal; the commands name their session', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url) => (url.endsWith('/ipolar') ? Response.json({ error: 'The plate solver is not configured', code: 'unsupported' }, { status: 422 }) : new Response(null, { status: 204 })))

	await startIPolar(state, 'c', 'cam', summary().request, request)
	expect(requests[0].url).toBe('/api/connections/c/cameras/cam/ipolar')
	expect(JSON.parse(requests[0].init?.body as string).token).toBeString()
	expect(state.errors[cameraKey('c', 'cam')]).toBe('The plate solver is not configured')

	await confirmIPolarRotation(state, summary(), request)
	await finishIPolar(state, summary(), request)
	expect(requests.slice(1).map((r) => r.url)).toEqual(['/api/ipolar/s1/rotation/confirm', '/api/ipolar/s1/finish'])
	expect(state.errors[cameraKey('c', 'cam')]).toBeUndefined()
})

test('an iPolar frame is a pose, a rejected candidate, or a refinement frame of its session', () => {
	const session = details({
		poses: [
			{ pose: 1, frame: 1, rightAscension: 0, declination: 0, time: 1 },
			{ pose: 2, frame: 3, rightAscension: 0, declination: 0, time: 3 },
		],
		attempts: [{ frame: 2, reason: 'insufficientRotation', rotation: deg(4), retry: true }],
		calibration: { frame: 3, rotation: deg(30), preferred: true, residual: arcsec(1), conditioning: 1e-5, axisOffset: deg(0.3), interval: 60, verified: false },
	})

	expect(ipolarFrameRole(session, { sessionId: 's1', generation: 1 })).toEqual({ pose: 1, rejected: false, refinement: false })
	expect(ipolarFrameRole(session, { sessionId: 's1', generation: 2 })).toEqual({ rejected: true, refinement: false })
	expect(ipolarFrameRole(session, { sessionId: 's1', generation: 3 })).toEqual({ pose: 2, rejected: false, refinement: false })
	expect(ipolarFrameRole(session, { sessionId: 's1', generation: 4 })).toEqual({ rejected: false, refinement: true })
	expect(ipolarFrameRole(session, { sessionId: 's2', generation: 1 })).toBeUndefined()
})
