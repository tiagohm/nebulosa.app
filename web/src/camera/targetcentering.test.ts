import { describe, expect, test } from 'bun:test'
import type { MountState, ServerEvent, TargetCenteringSession, TargetCenteringSessionSummary } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { RoleAvailability } from '../equipment/availability'
import type { ImageDocument } from '../images/images'
import { DEFAULT_CAMERA_PLATE_SOLVING, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_TARGET_CENTERING_SETTINGS } from '../profile/schema'
import { cameraKey } from './capture'
import { bullseyeRing, BULLSEYE_RINGS, handleTargetCenteringEvent, refreshTargetCentering, startTargetCentering, stopTargetCentering, targetCenteringBlocker, targetCenteringMountSupport, targetCenteringRequest, targetCenteringRunning, type TargetCenteringRuntime, targetCenteringVerdict } from './targetcentering'
import { targetCenteringOverlay } from './targetcentering.overlay'

const camera = { connectionId: 'c', deviceId: 'cam' }
const mount = { connectionId: 'c', deviceId: 'mnt' }
const key = cameraKey('c', 'cam')
const READY: RoleAvailability = { status: 'ready', message: '' } as RoleAvailability
const MOUNT = { canGoTo: true, canAbort: true, tracking: true, canTracking: true, parked: false, parking: false, site: { latitude: 1, longitude: 1 } } as MountState
const TARGET = { rightAscension: 1, declination: 0.5 }

function runtime(): TargetCenteringRuntime {
	return { sessions: {}, details: {}, drafts: {}, pending: {}, errors: {} }
}

function summary(patch: Partial<TargetCenteringSessionSummary> = {}): TargetCenteringSessionSummary {
	return {
		sessionId: 's1',
		operationId: 'o1',
		camera,
		cameraName: 'CCD',
		mount,
		mountName: 'Mount',
		state: 'running',
		attempts: [],
		positionVerified: false,
		readyForImaging: false,
		guidingRestoration: 'notNeeded',
		warnings: [],
		startedAt: 1,
		revision: 1,
		provider: 'astap',
		request: { mount, mode: 'center', target: { frame: 'J2000', ...TARGET }, tolerance: 1e-4 } as TargetCenteringSessionSummary['request'],
		...patch,
	}
}

function event(session: TargetCenteringSessionSummary): ServerEvent {
	return { type: 'targetCentering:updated', session }
}

// Waits for a condition of an asynchronous store update.
async function until(condition: () => boolean) {
	while (!condition()) await Bun.sleep(1)
}

// Fetch answering from a table of URLs, recording what it was asked.
function fakeFetch(answers: Record<string, () => Response>) {
	const calls: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		calls.push({ url, init })
		const answer = answers[url]
		return answer ? Promise.resolve(answer()) : Promise.reject(new Error(`unexpected ${url}`))
	}) as typeof fetch
	return { request, calls }
}

describe('target centering blockers', () => {
	const blocker = (mode: Parameters<typeof targetCenteringBlocker>[0], state: MountState | undefined = MOUNT, draft: Parameters<typeof targetCenteringBlocker>[4] = TARGET, framingId?: string, configured = true) => targetCenteringBlocker(mode, READY, READY, state, draft, framingId, configured)

	test('a center needs a target, a solver, and a mount able to move', () => {
		expect(blocker('center')).toBeUndefined()
		expect(blocker('center', MOUNT, {})).toBe('Enter the coordinates of the target.')
		expect(blocker('center', MOUNT, TARGET, undefined, false)).toBe('The plate solver is not configured.')
		expect(blocker('center', { ...MOUNT, parked: true })).toBe('The mount is parked.')
		expect(blocker('center', { ...MOUNT, site: { latitude: 0, longitude: 0 } } as MountState)).toContain('no site')
		expect(blocker('center', { ...MOUNT, canGoTo: false })).toBe('The mount cannot go to a target.')
		expect(blocker('center', { ...MOUNT, tracking: false, canTracking: false })).toContain('cannot start tracking')
		expect(blocker('center', { ...MOUNT, tracking: false })).toBeUndefined()
	})

	test('recenter is disabled with its reason until a framing is selected', () => {
		expect(blocker('recenter')).toBe('Recenter needs a saved framing: load or save one first.')
		expect(blocker('recenter', MOUNT, TARGET, 'framing')).toBeUndefined()
	})

	test('verify only asks nothing of a mount it never commands', () => {
		expect(blocker('verifyOnly', { ...MOUNT, parked: true, canGoTo: false, tracking: false, canTracking: false })).toBeUndefined()
		expect(targetCenteringBlocker('verifyOnly', READY, READY, undefined, TARGET, undefined, true)).toBe('The mount state is not known yet.')
	})

	test('the camera and the mount come first', () => {
		const busy = { status: 'busy', message: 'The camera is busy.' } as RoleAvailability
		expect(targetCenteringBlocker('center', busy, READY, MOUNT, TARGET, undefined, true)).toBe('The camera is busy.')
		expect(targetCenteringBlocker('verifyOnly', READY, busy, MOUNT, TARGET, undefined, true)).toBe('The camera is busy.')
	})

	test('a mount that cannot abort is unsupported, and an unknown state says nothing', () => {
		expect(targetCenteringMountSupport({ canGoTo: true, canAbort: false })).toContain('abort')
		expect(targetCenteringMountSupport(undefined)).toBeUndefined()
	})
})

describe('target centering request', () => {
	test('sends radians and the form, copying the target and the framing it came from', () => {
		const settings = { ...DEFAULT_TARGET_CENTERING_SETTINGS, tolerance: 3600, maximumCorrection: 180, framingId: 'f1' }
		const request = targetCenteringRequest('recenter', { ...TARGET, label: 'M 42' }, settings, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, mount)

		expect(request).toMatchObject({ mode: 'recenter', mount, target: { frame: 'J2000', ...TARGET, label: 'M 42', framingId: 'f1' }, maximumCorrections: 4, noSolutionRetries: 1, maximumFrames: 10, blindRetry: false })
		expect(request.tolerance).toBeCloseTo(Math.PI / 180, 9)
		expect(request.maximumCorrection).toBeCloseTo(Math.PI, 9)
		expect(request.capture.exposureTime).toBe(DEFAULT_TARGET_CENTERING_SETTINGS.exposureTime)
		expect(request.solving).not.toBe(DEFAULT_CAMERA_PLATE_SOLVING)
	})
})

describe('target centering outcome', () => {
	test('a session runs until it ends, and a blocked one has not ended', () => {
		expect(targetCenteringRunning(undefined)).toBeFalse()
		expect(targetCenteringRunning(summary({ state: 'blocked' }))).toBeTrue()
		expect(targetCenteringRunning(summary({ endedAt: 2 }))).toBeFalse()
	})

	test('the verdict compares the latest solution with the tolerance', () => {
		expect(targetCenteringVerdict(summary())).toBeUndefined()
		expect(targetCenteringVerdict(summary({ finalSeparation: 1e-5 }))).toBe('within')
		expect(targetCenteringVerdict(summary({ finalSeparation: 1e-3 }))).toBe('outside')
	})

	test('the rings of the bullseye hold the distance on a scale it states', () => {
		expect(bullseyeRing(30)).toBe(10)
		expect(bullseyeRing(31)).toBe(15)
		expect(bullseyeRing(3)).toBe(1)
		expect(bullseyeRing(1e9)).toBe(36000)
		expect(bullseyeRing(200) * BULLSEYE_RINGS).toBeGreaterThanOrEqual(200)
	})
})

describe('target centering store', () => {
	const details = (session: TargetCenteringSessionSummary) => () => Response.json({ ...session, solutions: {} } satisfies TargetCenteringSession)

	test('events are ordered by revision and fetch the record on a new solution', async () => {
		const state = runtime()
		const first = summary({ attempts: [{ attempt: 1, outcome: 'solved' }], revision: 5 })
		const { request, calls } = fakeFetch({ '/api/target-centering/s1': details(first) })

		handleTargetCenteringEvent(state, event(first), request)
		await until(() => state.details.s1 !== undefined)
		expect(state.details.s1.revision).toBe(5)
		expect(state.sessions[key].revision).toBe(5)
		expect(calls).toHaveLength(1)

		handleTargetCenteringEvent(state, event(summary({ revision: 3 })), request)
		expect(state.sessions[key].revision).toBe(5)

		handleTargetCenteringEvent(state, event({ ...first, revision: 6, warnings: ['a'] }), request)
		await Bun.sleep(5)
		expect(state.sessions[key].revision).toBe(6)
		expect(calls).toHaveLength(1)

		handleTargetCenteringEvent(state, { type: 'other' } as never, request)
		expect(state.sessions[key].revision).toBe(6)
	})

	test('an older session never replaces a newer one, and a new one forgets the old record', async () => {
		const state = runtime()
		const { request } = fakeFetch({ '/api/target-centering/s2': details(summary({ sessionId: 's2', startedAt: 10 })), '/api/target-centering/s3': details(summary({ sessionId: 's3', startedAt: 20 })) })

		handleTargetCenteringEvent(state, event(summary({ sessionId: 's2', startedAt: 10 })), request)
		await until(() => state.details.s2 !== undefined)
		handleTargetCenteringEvent(state, event(summary({ sessionId: 's1', startedAt: 1, revision: 9 })), request)
		expect(state.sessions[key].sessionId).toBe('s2')

		handleTargetCenteringEvent(state, event(summary({ sessionId: 's3', startedAt: 20 })), request)
		await until(() => state.details.s3 !== undefined)
		expect(Object.keys(state.details)).toEqual(['s3'])
	})

	test('a snapshot replaces the sessions but leaves what an event changed during its fetch', async () => {
		const state = runtime()
		state.sessions.gone = summary({ sessionId: 'gone', camera: { connectionId: 'c', deviceId: 'gone' } })
		const { promise, resolve } = Promise.withResolvers<Response>()
		const request = ((url: string) => (url === '/api/target-centering' ? promise : Promise.resolve(details(summary({ revision: 9 }))()))) as unknown as typeof fetch

		const refreshing = refreshTargetCentering(state, request)
		handleTargetCenteringEvent(state, event(summary({ revision: 9 })), request)
		resolve(Response.json({ sessions: [summary({ revision: 2 })] }))
		await refreshing

		expect(state.sessions[key].revision).toBe(9)
		expect(state.sessions.gone).toBeUndefined()
	})

	test('a start carries a token, and a refusal is recorded for the camera', async () => {
		const state = runtime()
		const url = '/api/connections/c/cameras/cam/target-centering'
		const { request, calls } = fakeFetch({ [url]: () => Response.json({ error: 'Guiding is correcting the mount', code: 'guidingActive' }, { status: 409 }) })

		await startTargetCentering(state, 'c', 'cam', targetCenteringRequest('center', TARGET, DEFAULT_TARGET_CENTERING_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, mount), request)

		expect((JSON.parse(calls[0].init!.body as string) as { token: string }).token).toBeString()
		expect(state.errors[key]).toBe('Guiding is correcting the mount')
		expect(state.pending[key]).toBeUndefined()
	})

	test('an unreachable server refreshes the snapshot, since the command may have been applied', async () => {
		const state = runtime()
		const { request, calls } = fakeFetch({ '/api/target-centering': () => Response.json({ sessions: [] }) })

		await stopTargetCentering(state, summary(), request)
		expect(state.errors[key]).toBe('Unable to reach the server.')
		expect(calls.map(({ url }) => url)).toEqual(['/api/target-centering/s1/stop', '/api/target-centering'])
	})
})

describe('target centering overlay', () => {
	const solution = { rightAscension: 1 } as PlateSolution
	const document = { source: { kind: 'camera', ...camera }, info: { id: 'image' } } as unknown as Pick<ImageDocument, 'source' | 'info'>

	function state(attempts: TargetCenteringSessionSummary['attempts']) {
		const session = summary({ attempts })
		return { sessions: { [key]: session }, details: { s1: { ...session, solutions: { 2: solution } } } }
	}

	test('draws what the attempt that measured the image shown solved', () => {
		const overlay = targetCenteringOverlay(state([{ attempt: 2, imageId: 'image' }]), document)
		expect(overlay).toEqual({ target: { source: 'manual', ...TARGET }, solution })
	})

	test('draws nothing on another image, or on an attempt that did not solve', () => {
		expect(targetCenteringOverlay(state([{ attempt: 2, imageId: 'other' }]), document)).toBeUndefined()
		expect(targetCenteringOverlay(state([{ attempt: 1, imageId: 'image' }]), document)).toBeUndefined()
		expect(targetCenteringOverlay(state([]), undefined)).toBeUndefined()
	})
})
