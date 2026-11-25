import { describe, expect, test } from 'bun:test'
import type { MountState, ServerEvent, TargetCenteringSession, TargetCenteringSessionSummary } from 'api'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { RoleAvailability } from '../equipment/availability'
import type { ImageDocument } from '../images/images'
import { DEFAULT_CAMERA_PLATE_SOLVING, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_TARGET_CENTERING_SETTINGS } from '../profile/schema'
import { cameraKey } from './capture'
import {
	bullseyeRing,
	BULLSEYE_RINGS,
	handleTargetCenteringEvent,
	refreshTargetCentering,
	startTargetCentering,
	stopTargetCentering,
	targetCenteringBlocker,
	targetCenteringFrameCount,
	targetCenteringMountSupport,
	targetCenteringPosition,
	targetCenteringRequest,
	targetCenteringRunning,
	type TargetCenteringRuntime,
	targetCenteringSlews,
	targetCenteringStale,
	targetCenteringStateText,
} from './targetcentering'
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
	const blocker = (mode: Parameters<typeof targetCenteringBlocker>[0], state: MountState | undefined = MOUNT, draft: Parameters<typeof targetCenteringBlocker>[4] = TARGET) => targetCenteringBlocker(mode, READY, READY, state, draft)

	test('a center needs a target and a mount able to move', () => {
		expect(blocker('center')).toBeUndefined()
		expect(blocker('center', MOUNT, {})).toBe('Enter the coordinates of the target.')
		expect(blocker('center', { ...MOUNT, parked: true })).toBe('The mount is parked.')
		expect(blocker('center', { ...MOUNT, site: { latitude: 0, longitude: 0 } } as MountState)).toContain('no site')
		expect(blocker('center', { ...MOUNT, canGoTo: false })).toBe('The mount cannot go to a target.')
		expect(blocker('center', { ...MOUNT, tracking: false, canTracking: false })).toContain('cannot start tracking')
		expect(blocker('center', { ...MOUNT, tracking: false })).toBeUndefined()
	})

	test('a center refuses a target below the horizon, which a measurement does not', () => {
		const below = { altitude: -0.1, distance: 1 }
		expect(targetCenteringBlocker('center', READY, READY, MOUNT, { ...TARGET, label: 'M 42' }, below)).toBe("M 42 is 5.7° below the horizon of the mount's site.")
		expect(targetCenteringBlocker('center', READY, READY, MOUNT, TARGET, { altitude: 0.1, distance: 1 })).toBeUndefined()
		expect(targetCenteringBlocker('verifyOnly', READY, READY, MOUNT, TARGET, below)).toBeUndefined()
	})

	test('verify only asks nothing of a mount it never commands', () => {
		expect(blocker('verifyOnly', { ...MOUNT, parked: true, canGoTo: false, tracking: false, canTracking: false })).toBeUndefined()
		expect(targetCenteringBlocker('verifyOnly', READY, READY, undefined, TARGET)).toBe('The mount state is not known yet.')
	})

	test('the camera and the mount come first', () => {
		const busy = { status: 'busy', message: 'The camera is busy.' } as RoleAvailability
		expect(targetCenteringBlocker('center', busy, READY, MOUNT, TARGET)).toBe('The camera is busy.')
		expect(targetCenteringBlocker('verifyOnly', READY, busy, MOUNT, TARGET)).toBe('The camera is busy.')
	})

	test('a mount that cannot abort is unsupported, and an unknown state says nothing', () => {
		expect(targetCenteringMountSupport({ canGoTo: true, canAbort: false })).toContain('abort')
		expect(targetCenteringMountSupport(undefined)).toBeUndefined()
	})
})

describe('target centering request', () => {
	test('sends radians and the form, copying the target', () => {
		const settings = { ...DEFAULT_TARGET_CENTERING_SETTINGS, tolerance: 3600, maximumCorrection: 180 }
		const request = targetCenteringRequest('center', { ...TARGET, label: 'M 42' }, settings, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, { mount, guideOutput: { connectionId: 'c', deviceId: 'st4' } })

		expect(request).toMatchObject({ mode: 'center', mount, guideOutput: { connectionId: 'c', deviceId: 'st4' }, target: { frame: 'J2000', ...TARGET, label: 'M 42' }, maximumCorrections: 4, noSolutionRetries: 1, maximumFrames: 10, blindRetry: false })
		expect(request.tolerance).toBeCloseTo(Math.PI / 180, 9)
		expect(request.maximumCorrection).toBeCloseTo(Math.PI, 9)
		expect(request.capture.exposureTime).toBe(DEFAULT_TARGET_CENTERING_SETTINGS.exposureTime)
		expect(request.solving).not.toBe(DEFAULT_CAMERA_PLATE_SOLVING)
		// Without a guide output in the setup none is sent.
		expect('guideOutput' in targetCenteringRequest('center', TARGET, settings, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, { mount })).toBeFalse()
	})
})

describe('target centering outcome', () => {
	test('a session runs until it ends, and a blocked one has not ended', () => {
		expect(targetCenteringRunning(undefined)).toBeFalse()
		expect(targetCenteringRunning(summary({ state: 'blocked' }))).toBeTrue()
		expect(targetCenteringRunning(summary({ endedAt: 2 }))).toBeFalse()
	})

	test('the state reads as what runs, then as a verdict with the distance', () => {
		expect(targetCenteringStateText(summary({ step: 'slewing' }))).toBe('Centering · Slewing')
		expect(targetCenteringStateText(summary({ state: 'preparing', request: { ...summary().request, mode: 'verifyOnly' } }))).toBe('Verifying · Preparing')
		const labelled = { ...summary().request, target: { ...summary().request.target, label: 'M 42' } }
		expect(targetCenteringStateText(summary({ state: 'completed', request: labelled, positionVerified: true, readyForImaging: true, finalSeparation: 1e-5 }))).toBe('Centered on M 42 · 2.06″')
		expect(targetCenteringStateText(summary({ state: 'completed', positionVerified: true, readyForImaging: false, finalSeparation: 1e-5 }))).toBe('Centered · 2.06″ · guiding not restored')
		expect(targetCenteringStateText(summary({ state: 'completed', request: { ...summary().request, mode: 'verifyOnly' }, finalSeparation: 1e-2 }))).toBe('Off target · 34.38′')
		expect(targetCenteringStateText(summary({ state: 'cancelled' }))).toBe('Stopped')
	})

	test('an ended session speaks only for the target it measured', () => {
		expect(targetCenteringStale(summary({ endedAt: 2 }), TARGET)).toBeFalse()
		expect(targetCenteringStale(summary({ endedAt: 2 }), { ...TARGET, declination: 0.6 })).toBeTrue()
		expect(targetCenteringStale(summary(), { ...TARGET, declination: 0.6 })).toBeFalse()
		expect(targetCenteringStale(summary({ endedAt: 2 }), {})).toBeFalse()
	})

	test('an ended session counts only the frames whose solve ended', () => {
		const attempts = [{ attempt: 1, outcome: 'solved' as const }, { attempt: 2 }]
		expect(targetCenteringFrameCount(summary({ attempts }))).toBe(2)
		expect(targetCenteringFrameCount(summary({ attempts, endedAt: 2 }))).toBe(1)
	})

	test('the position of a target is its altitude and its distance from the mount', () => {
		// A mount at the north pole pointing at the celestial pole sees every northern target at its declination.
		const state = { rightAscension: 0, declination: Math.PI / 2, site: { latitude: Math.PI / 2, longitude: 0.1 } } as MountState
		const position = targetCenteringPosition(state, { rightAscension: 1, declination: 1.4 }, Date.UTC(2026, 0, 1))!
		expect(position.altitude).toBeCloseTo(1.4, 1)
		expect(position.distance).toBeCloseTo(Math.PI / 2 - 1.4, 1)
		expect(targetCenteringPosition({ ...state, site: { latitude: 0, longitude: 0 } } as MountState, TARGET, 0)).toBeUndefined()
		expect(targetCenteringPosition(state, {}, 0)).toBeUndefined()
	})

	test('a center slews only when the mount stands farther than a correction may go', () => {
		expect(targetCenteringSlews({ altitude: 1, distance: 0.01 }, 0.02)).toBeFalse()
		expect(targetCenteringSlews({ altitude: 1, distance: 0.03 }, 0.02)).toBeTrue()
		expect(targetCenteringSlews(undefined, 0.02)).toBeTrue()
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

		await startTargetCentering(state, 'c', 'cam', targetCenteringRequest('center', TARGET, DEFAULT_TARGET_CENTERING_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, DEFAULT_CAMERA_PLATE_SOLVING, { mount }), request)

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
