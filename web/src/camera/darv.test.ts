import { expect, test } from 'bun:test'
import type { DarvMeasurement, DarvSession, DarvSessionSummary, MountState } from 'api'
import { deg } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { DEFAULT_DARV_SETTINGS, DEFAULT_EXPOSURE_SETTINGS } from '../profile/schema'
import { cameraKey } from './capture'
import { darvBlocker, darvComparable, darvProgress, darvFrameMeasurement, darvMeasurementRequest, darvMountSupport, type DarvRuntime, darvSlewRate, handleDarvEvent, refreshDarv, repeatDarv, startDarv } from './darv'

function newState() {
	return proxy<DarvRuntime>({ sessions: {}, details: {}, pending: {}, errors: {} })
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

function measurement(patch: Partial<DarvMeasurement> = {}): DarvMeasurement {
	return { generation: 1, operationId: 'o1', request: darvMeasurementRequest(DEFAULT_DARV_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, 'SPEED_1'), state: 'exposing', exposure: 129, startedAt: 1000, ...patch }
}

function summary(patch: Partial<DarvSessionSummary> = {}): DarvSessionSummary {
	return { sessionId: 's1', camera: { connectionId: 'c', deviceId: 'cam' }, cameraName: 'Camera', mount: MOUNT, mountName: 'Mount', state: 'measuring', measurements: [measurement()], startedAt: 1000, revision: 1, ...patch }
}

function details(patch: Partial<DarvSession> = {}): DarvSession {
	return { ...summary(), trails: [], ...patch }
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

const RESULT = { status: 'measured', driftMagnitude: 0.4, trailCount: 2, usableCount: 2, confidence: 0.9, diagnostics: [] } as const

test('the request takes the camera settings but never the Camera Acquisition exposure', () => {
	const request = darvMeasurementRequest({ ...DEFAULT_DARV_SETTINGS, axis: 'altitude', direction: 'WEST', legDuration: 30 }, { ...DEFAULT_EXPOSURE_SETTINGS, exposureTime: 5, gain: 100 }, 'SPEED_4')
	expect(request).toEqual({ capture: { gain: 100, offset: DEFAULT_EXPOSURE_SETTINGS.offset, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: DEFAULT_EXPOSURE_SETTINGS.frameFormat }, axis: 'altitude', direction: 'WEST', slewRate: 'SPEED_4', legDuration: 30 })
	expect('exposureTime' in request.capture).toBeFalse()
})

test('the mount must be equatorial, move west-east, abort, track, and announce the slew rate', () => {
	expect(darvMountSupport(mountState())).toBeUndefined()
	expect(darvMountSupport(mountState({ mountType: 'ALTAZ' }))).toContain('not equatorial')
	expect(darvMountSupport(mountState({ canAbort: false }))).toContain('abort')
	expect(darvBlocker(READY, READY, mountState(), 'SPEED_1')).toBeUndefined()
	expect(darvBlocker(READY, READY, mountState(), 'WARP')).toBe('Choose a slew rate.')
	expect(darvBlocker(READY, READY, mountState({ tracking: false, canTracking: false }), 'SPEED_1')).toContain('not tracking')
	// The server starts the tracking of a mount that can switch it.
	expect(darvBlocker(READY, READY, mountState({ tracking: false, canTracking: true }), 'SPEED_1')).toBeUndefined()
	expect(darvBlocker(READY, READY, mountState({ parked: true }), 'SPEED_1')).toBe('The mount is parked.')
	// No site is needed: DARV never converts the drift into a polar error.
	expect(darvBlocker(READY, READY, mountState({ site: { latitude: 0, longitude: 0, elevation: 0 } }), 'SPEED_1')).toBeUndefined()
	expect(darvSlewRate({ slewRate: 'SPEED_4' }, mountState())).toBe('SPEED_4')
	expect(darvSlewRate({ slewRate: 'GONE' }, mountState())).toBe('SPEED_1')
})

test('the progress follows the phase and the exposure elapsed, and stops at the analysis', () => {
	expect(darvProgress(measurement({ state: 'preparing' }), 5000)).toEqual({ step: 1 })
	expect(darvProgress(measurement({ state: 'outbound', exposure: 20, exposureStartedAt: 1000 }), 6000)).toEqual({ step: 3, elapsed: 5, fraction: 0.25 })
	expect(darvProgress(measurement({ state: 'finishing', exposure: 20, exposureStartedAt: 1000 }), 60000)).toEqual({ step: 6, elapsed: 20, fraction: 1 })
	expect(darvProgress(measurement({ state: 'analyzing', exposure: 20, exposureStartedAt: 1000 }), 60000)).toEqual({ step: 7 })
	expect(darvProgress(measurement({ state: 'ready', exposureStartedAt: 1000 }), 60000)).toEqual({ step: undefined })
})

test('drifts are compared only between measurements of equal settings', () => {
	const first = measurement({ generation: 1, state: 'ready', result: RESULT })
	const second = measurement({ generation: 2, state: 'ready', result: { ...RESULT, driftMagnitude: 0.1 } })
	expect(darvComparable([first, second])).toBe(first)
	expect(darvComparable([first, { ...second, request: { ...second.request, legDuration: 30 } }])).toBeUndefined()
	expect(darvComparable([first, measurement({ generation: 2, state: 'ready', result: { status: 'limited', trailCount: 1, usableCount: 0, confidence: 0, diagnostics: ['trailClipped'] } })])).toBeUndefined()
	expect(darvFrameMeasurement(summary({ measurements: [first, second] }), { sessionId: 's1', generation: 2 })).toBe(second)
	expect(darvFrameMeasurement(summary(), { sessionId: 'other', generation: 1 })).toBeUndefined()
})

test('events are ordered by revision and fetch the record when a measurement was analyzed', async () => {
	const state = newState()
	const { request, requests } = fakeFetch(() => Response.json(details({ revision: 3 })))
	const key = cameraKey('c', 'cam')

	handleDarvEvent(state, { type: 'darv:updated', session: summary({ revision: 2 }) }, request)
	expect(state.sessions[key].revision).toBe(2)
	expect(requests).toHaveLength(1)
	await Bun.sleep(0)

	handleDarvEvent(state, { type: 'darv:updated', session: summary({ revision: 1, state: 'idle' }) }, request)
	expect(state.sessions[key].state).toBe('measuring')

	// A later phase of the same measurement needs no new record.
	handleDarvEvent(state, { type: 'darv:updated', session: summary({ revision: 4, measurements: [measurement({ state: 'outbound' })] }) }, request)
	expect(requests).toHaveLength(1)

	handleDarvEvent(state, { type: 'darv:updated', session: summary({ revision: 5, state: 'idle', measurements: [measurement({ state: 'ready', result: RESULT })] }) }, request)
	expect(requests).toHaveLength(2)
})

test('the snapshot replaces the sessions and drops the records of sessions gone', async () => {
	const state = newState()
	state.details.old = details({ sessionId: 'old' })
	const { request } = fakeFetch((url) => (url === '/api/darv' ? Response.json({ sessions: [summary({ state: 'idle' })] }) : Response.json(details({ state: 'idle', revision: 2 }))))

	await refreshDarv(state, request)
	await Bun.sleep(0)
	expect(Object.keys(state.sessions)).toEqual([cameraKey('c', 'cam')])
	expect(state.details.old).toBeUndefined()
	expect(state.details.s1?.revision).toBe(2)
})

test('a start and a repetition carry a fresh token, and a refusal is kept as the camera error', async () => {
	const state = newState()
	const { request, requests } = fakeFetch((url) => (url.endsWith('/measurements') ? Response.json({ error: 'A DARV measurement is running in this session', code: 'busy' }, { status: 409 }) : Response.json({ sessionId: 's1', operationId: 'o1', generation: 1 }, { status: 202 })))
	const body = darvMeasurementRequest(DEFAULT_DARV_SETTINGS, DEFAULT_EXPOSURE_SETTINGS, 'SPEED_1')

	await startDarv(state, 'c', 'cam', MOUNT, body, request)
	await repeatDarv(state, summary(), body, request)

	expect(requests[0].url).toBe('/api/connections/c/cameras/cam/darv')
	const first = JSON.parse(requests[0].init!.body as string)
	const second = JSON.parse(requests[1].init!.body as string)
	expect(first).toMatchObject({ mount: MOUNT, legDuration: 60, direction: 'EAST' })
	expect(second.mount).toBeUndefined()
	expect(first.token).not.toBe(second.token)
	expect(requests[1].url).toBe('/api/darv/s1/measurements')
	expect(state.errors[cameraKey('c', 'cam')]).toBe('A DARV measurement is running in this session')
	expect(state.pending).toEqual({})
})
