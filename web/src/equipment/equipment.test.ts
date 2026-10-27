import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import type { DeviceSummary } from 'api'
import { proxy } from 'valtio'
import { type DeviceState, handleDeviceEvent, refreshDevices, roleStatus, switchDevice, switchSetup, watchServer } from './equipment'

const fetchSpy = spyOn(globalThis, 'fetch')

afterEach(() => fetchSpy.mockReset())

function device(id: string, connected = false, connectionId = 's1'): DeviceSummary {
	return { id, type: 'camera', name: id, connected, connectionId, hardwareId: id, interfaces: ['camera'], driver: { executable: '', version: '' } }
}

function newState(devices: DeviceSummary[] = [], watched = 's1'): DeviceState {
	return proxy<DeviceState>({ watched, devices, loading: false, pending: {}, errors: {}, open: false })
}

describe('role status', () => {
	test('maps assignment, presence, requests, and state', () => {
		const state = { devices: [device('a'), device('b', true)], pending: { c: 'connect' as const }, errors: { d: 'boom' } }
		state.devices.push(device('c'), device('d'))

		expect(roleStatus({}, 'MAIN_CAMERA', state)).toBe('notSelected')
		expect(roleStatus({ MAIN_CAMERA: { id: 'gone', name: 'gone' } }, 'MAIN_CAMERA', state)).toBe('unavailable')
		expect(roleStatus({ MAIN_CAMERA: { id: 'a', name: 'a' } }, 'MAIN_CAMERA', state)).toBe('disconnected')
		expect(roleStatus({ MAIN_CAMERA: { id: 'b', name: 'b' } }, 'MAIN_CAMERA', state)).toBe('connected')
		expect(roleStatus({ MAIN_CAMERA: { id: 'c', name: 'c' } }, 'MAIN_CAMERA', state)).toBe('connecting')
		expect(roleStatus({ MAIN_CAMERA: { id: 'd', name: 'd' } }, 'MAIN_CAMERA', state)).toBe('error')
		expect(roleStatus({ MAIN_CAMERA: { id: 'b', name: 'b' } }, 'MAIN_CAMERA', { ...state, pending: { b: 'disconnect' } })).toBe('disconnecting')
	})

	test('a closed connection keeps the assignment as unavailable', () => {
		const state = newState([device('a', true)])
		handleDeviceEvent(state, { type: 'connection:close', id: 's1', cause: 'requested' })

		expect(roleStatus({ MAIN_CAMERA: { id: 'a', name: 'a' } }, 'MAIN_CAMERA', state)).toBe('unavailable')
	})
})

describe('watching', () => {
	test('a stale device list response is dropped', async () => {
		const first = Promise.withResolvers<Response>()
		const second = Promise.withResolvers<Response>()
		fetchSpy.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
		const state = newState([], 's0')

		watchServer(state, 's1')
		watchServer(state, 's2')
		second.resolve(Response.json([device('b', false, 's2')]))
		first.resolve(Response.json([device('a')]))
		await Bun.sleep(0)

		expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(['/api/connections/s1/devices', '/api/connections/s2/devices'])
		expect(state.devices.map((d) => d.id)).toEqual(['b'])
		expect(state.loading).toBeFalse()
	})

	test('switching connection drops devices, requests, and errors without disconnecting', () => {
		fetchSpy.mockResolvedValue(Response.json([]))
		const state = newState([device('a')])
		state.pending.a = 'connect'
		state.errors.a = 'x'

		watchServer(state, undefined)

		expect(state.watched).toBeUndefined()
		expect(state.devices).toBeEmpty()
		expect(state.pending).toEqual({})
		expect(state.errors).toEqual({})
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('events of another connection are ignored', () => {
		const state = newState([device('a')])

		handleDeviceEvent(state, { type: 'device:added', device: device('x', false, 's2') })
		handleDeviceEvent(state, { type: 'device:updated', connectionId: 's2', id: 'a', connected: true })
		handleDeviceEvent(state, { type: 'device:removed', connectionId: 's2', id: 'a' })
		handleDeviceEvent(state, { type: 'connection:close', id: 's2', cause: 'requested' })

		expect(state.devices).toEqual([device('a')])
	})

	test('events of the watched connection update its devices', () => {
		const state = newState([device('a')])

		handleDeviceEvent(state, { type: 'device:added', device: device('b') })
		handleDeviceEvent(state, { type: 'device:updated', connectionId: 's1', id: 'a', connected: true, state: 'Ok' })
		handleDeviceEvent(state, { type: 'device:removed', connectionId: 's1', id: 'b' })

		expect(state.devices).toEqual([device('a', true)])
	})
})

describe('switching a device', () => {
	test('connect stays pending until the server reports the new state', async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 202 }))
		const state = newState([device('a')])

		await switchDevice(state, 'a', true)
		expect(fetchSpy).toHaveBeenCalledWith('/api/connections/s1/devices/a/connect', { method: 'POST' })
		expect(state.pending.a).toBe('connect')

		await switchDevice(state, 'a', true)
		expect(fetchSpy).toHaveBeenCalledTimes(1)

		handleDeviceEvent(state, { type: 'device:updated', connectionId: 's1', id: 'a', connected: true, state: 'Ok' })
		expect(state.pending.a).toBeUndefined()
		expect(roleStatus({ MAIN_CAMERA: { id: 'a', name: 'a' } }, 'MAIN_CAMERA', state)).toBe('connected')
	})

	test('a rejected request or a driver alert is an error', async () => {
		fetchSpy.mockResolvedValue(Response.json({ error: 'Device not found' }, { status: 404 }))
		const state = newState([device('a'), device('b')])

		await switchDevice(state, 'a', true)
		expect(state.pending.a).toBeUndefined()
		expect(state.errors.a).toBe('Device not found')

		fetchSpy.mockResolvedValue(new Response(null, { status: 202 }))
		await switchDevice(state, 'b', true)
		handleDeviceEvent(state, { type: 'device:updated', connectionId: 's1', id: 'b', connected: false, state: 'Alert' })
		expect(roleStatus({ GUIDE_CAMERA: { id: 'b', name: 'b' } }, 'GUIDE_CAMERA', state)).toBe('error')
	})

	test('a device not in the watched connection is never commanded', async () => {
		const state = newState([device('a')])

		await switchDevice(state, 'other', true)
		await switchDevice(state, 'a', false)

		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('a refresh without a watched connection does nothing', async () => {
		const state = newState([], '')
		state.watched = undefined

		await refreshDevices(state)

		expect(fetchSpy).not.toHaveBeenCalled()
	})
})

describe('switching a setup', () => {
	test('connects each assigned device once and skips the rest', async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 202 }))
		const state = newState([device('a'), device('b', true), device('c'), device('d')])
		state.pending.d = 'connect'
		const setup = { MAIN_CAMERA: { id: 'a', name: 'a' }, GUIDE_CAMERA: { id: 'b', name: 'b' }, MOUNT: { id: 'd', name: 'd' }, FOCUSER: { id: 'gone', name: 'gone' }, GUIDE_OUTPUT: { id: 'a', name: 'a' } }

		await switchSetup(state, setup, true)

		expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(['/api/connections/s1/devices/a/connect'])
		expect(state.pending.a).toBe('connect')
	})

	test('disconnects only the connected assigned devices', async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 202 }))
		const state = newState([device('a', true), device('b'), device('c', true)])

		await switchSetup(state, { MAIN_CAMERA: { id: 'a', name: 'a' }, GUIDE_CAMERA: { id: 'b', name: 'b' } }, false)

		expect(fetchSpy.mock.calls.map((c) => c[0])).toEqual(['/api/connections/s1/devices/a/disconnect'])
	})
})

describe('events during a fetch', () => {
	test('are replayed onto the fetched list', async () => {
		const response = Promise.withResolvers<Response>()
		fetchSpy.mockReturnValueOnce(response.promise)
		const state = newState([], 's0')

		watchServer(state, 's1')
		handleDeviceEvent(state, { type: 'device:updated', connectionId: 's1', id: 'a', connected: true, state: 'Ok' })
		handleDeviceEvent(state, { type: 'device:added', device: device('b') })
		// The list was computed before both events.
		response.resolve(Response.json([device('a'), device('c')]))
		await Bun.sleep(0)

		expect(state.devices).toEqual([device('a', true), device('c'), device('b')])
	})

	test('a close drops pending requests but keeps errors', async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 202 }))
		const state = newState([device('a'), device('b')])
		state.errors.b = 'boom'
		await switchDevice(state, 'a', true)

		handleDeviceEvent(state, { type: 'connection:close', id: 's1', cause: 'requested' })

		expect(state.devices).toBeEmpty()
		expect(state.pending).toEqual({})
		expect(state.errors).toEqual({ b: 'boom' })
	})
})
