import { expect, test } from 'bun:test'
import type { MountState, OperationRecord } from 'api'
import { proxy } from 'valtio'
import { localSiderealTime } from './celestial/time'
import { handleMountEvent, horizontalOf, type MountRuntime, mountPoint, selectionPoint, slewBlocker, slewMount, watchMount } from './mount'
import { mountMarkerOf, refKey, refOfCelestialObject } from './objects'

const TARGET = { connectionId: 'a', id: 'm1', name: 'Mount Simulator' }

function state(overrides: Partial<MountState> = {}): MountState {
	return { connectionId: 'a', id: 'm1', connected: true, rightAscension: 1, declination: 0.5, slewing: false, tracking: true, parked: false, parking: false, canGoTo: true, canAbort: true, canMove: true, canMoveNS: true, canMoveWE: true, moving: false, slewRates: [], ...overrides }
}

// Fake fetch answering every request with a fixed response, recording the requests.
function fakeFetch(respond: () => Response) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(respond())
	}) as typeof fetch
	return { requests, request }
}

function runtime(): MountRuntime {
	const value = proxy<MountRuntime>({ sending: false, following: false })
	watchMount(value, TARGET, fakeFetch(() => Response.json(state())).request)
	return value
}

test('applies only the events of the followed mount on its connection', () => {
	const value = runtime()

	handleMountEvent(value, { type: 'mount:updated', state: state({ connectionId: 'b', rightAscension: 2 }) })
	handleMountEvent(value, { type: 'mount:updated', state: state({ id: 'm2', rightAscension: 2 }) })
	expect(value.state?.rightAscension ?? 1).toBe(1)

	handleMountEvent(value, { type: 'mount:updated', state: state({ rightAscension: 3 }) })
	expect(value.state?.rightAscension).toBe(3)

	handleMountEvent(value, { type: 'connection:close', id: 'b' })
	expect(value.state).toBeDefined()
	handleMountEvent(value, { type: 'connection:close', id: 'a' })
	expect(value.state).toBeUndefined()
})

test('switching the mount drops what was known and stops following', () => {
	const value = runtime()
	handleMountEvent(value, { type: 'mount:updated', state: state() })
	value.following = true

	watchMount(value, { ...TARGET, connectionId: 'b' }, fakeFetch(() => new Response(null, { status: 404 })).request)
	expect(value.state).toBeUndefined()
	expect(value.following).toBeFalse()
})

test('has a position only while connected and in real time', () => {
	expect(mountPoint({ state: state() }, true)).toEqual({ rightAscension: 1, declination: 0.5 })
	expect(mountPoint({ state: state() }, false)).toBeUndefined()
	expect(mountPoint({ state: state({ connected: false }) }, true)).toBeUndefined()
	expect(mountPoint({ state: undefined }, true)).toBeUndefined()

	const mountSelection = { ref: { kind: 'mount', connectionId: 'a', id: 'm1' } as const }
	expect(selectionPoint(mountSelection, { target: TARGET, state: state() }, true)).toEqual({ rightAscension: 1, declination: 0.5 })
	expect(selectionPoint({ ref: { kind: 'mount', connectionId: 'b', id: 'm1' } }, { target: TARGET, state: state() }, true)).toBeUndefined()
})

test('explains why the mount cannot slew', () => {
	const base = { target: TARGET, sending: false }
	const none = { operations: {} }
	expect(slewBlocker({ ...base, target: undefined }, none)).toBeDefined()
	expect(slewBlocker({ ...base, state: state({ connected: false }) }, none)).toBe('The mount is disconnected')
	expect(slewBlocker({ ...base, state: state({ parked: true }) }, none)).toBe('The mount is parked')
	expect(slewBlocker({ ...base, state: state({ canGoTo: false }) }, none)).toBe('The mount cannot go to a target')
	expect(slewBlocker({ ...base, state: state({ slewing: true }) }, none)).toBe('The mount is slewing')
	expect(slewBlocker({ ...base, state: state() }, none)).toBeUndefined()
})

test('a slew is blocked while any operation holds the exact mount', () => {
	const base = { target: TARGET, sending: false, state: state() }
	const operation = (connectionId: string, state: OperationRecord['state']): OperationRecord => ({ operationId: 'x', kind: 'mount.slew', devices: [{ connectionId, deviceId: 'm1' }], state, startedAt: 1 })

	expect(slewBlocker(base, { operations: { x: operation('b', 'running') } })).toBeUndefined()
	expect(slewBlocker(base, { operations: { x: operation('a', 'failed') } })).toBeUndefined()
	expect(slewBlocker(base, { operations: { x: operation('a', 'running') } })).toBe('The mount is busy')
	expect(slewBlocker({ ...base, slew: { operationId: 'x', targetName: 'M31', response: { operationId: 'x', time: 1, rightAscension: 0, declination: 0, azimuth: 0, altitude: 1 } } }, { operations: { x: operation('a', 'running') } })).toBe('The mount is slewing')
})

test('records an accepted slew and keeps the reason of a refused one', async () => {
	const value = runtime()
	const observer = { latitude: -23, longitude: -46, elevation: 0 }
	const accepted = fakeFetch(() => Response.json({ operationId: 'op', time: 1, rightAscension: 1, declination: 0, azimuth: 0, altitude: 1 }, { status: 202 }))

	await slewMount(value, { kind: 'body', code: '499' }, 'Mars', observer, accepted.request)
	expect(accepted.requests[0].url).toBe('/api/connections/a/mounts/m1/slew')
	expect(JSON.parse(accepted.requests[0].init?.body as string)).toEqual({ target: { kind: 'body', code: '499' }, observer })
	expect(value.slew?.operationId).toBe('op')
	expect(value.sending).toBeFalse()

	const refused = fakeFetch(() => Response.json({ error: 'The target is below the horizon' }, { status: 422 }))
	await slewMount(value, { kind: 'body', code: '499' }, 'Mars', observer, refused.request)
	expect(value.error).toBe('The target is below the horizon')
})

test('a point at the local sidereal time and the latitude is at the zenith', () => {
	const time = Date.UTC(2026, 9, 18, 3)
	const observer = { latitude: -23.5, longitude: -46.6 }
	const { altitude } = horizontalOf({ rightAscension: localSiderealTime(time, (observer.longitude * Math.PI) / 180), declination: (observer.latitude * Math.PI) / 180 }, time, observer)
	expect(altitude).toBeCloseTo(Math.PI / 2, 5)
})

test('the mount marker is selected as the mount', () => {
	const ref = { kind: 'mount', connectionId: 'a', id: 'm1' } as const
	const object = { type: 'shape', id: 'mount-marker', shape: { id: 'mount-marker', type: 'mount', coordinate: { rightAscension: 0, declination: 0 }, data: { ref, name: 'Mount' }, render: () => {} } } as const
	const names = { typeNames: [], starDesignations: [], constellationCodes: new Map() }
	expect(mountMarkerOf(object)?.name).toBe('Mount')
	expect(refOfCelestialObject(object, names)).toEqual(ref)
	expect(refKey(ref)).toBe('mount:a:m1')
})
