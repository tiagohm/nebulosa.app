import { describe, expect, test } from 'bun:test'
import type { OperationKind, OperationRecord } from 'api'
import { type MountMotionState, mountAbortTarget, mountMoving, operationsSummary, scopedDeviceErrors, scopedRunningOperations, type ScopedDevice } from './selectors'

function operation(operationId: string, kind: OperationKind, connectionId: string, deviceId: string, startedAt = 0, state: OperationRecord['state'] = 'running'): OperationRecord {
	return { operationId, kind, devices: [{ connectionId, deviceId }], state, startedAt }
}

const MOUNT: ScopedDevice = { id: 'm1', connectionId: 'A', name: 'Mount A' }

const IDLE: MountMotionState = { connected: true, canAbort: true, slewing: false, moving: false, parking: false, homing: false }

describe('scoped running operations', () => {
	const operations = {
		a2: operation('a2', 'mount.slew', 'A', 'm1', 20),
		b1: operation('b1', 'camera.capture', 'B', 'c1', 5),
		a1: operation('a1', 'camera.capture', 'A', 'c1', 10),
		a0: operation('a0', 'focuser.move', 'A', 'f1', 1, 'succeeded'),
		a3: operation('a3', 'dome.slew', 'A', 'd1', 20),
	}

	test('keeps only running operations of the active connection in start order', () => {
		expect(scopedRunningOperations(operations, 'A').map((o) => o.operationId)).toEqual(['a1', 'a2', 'a3'])
		expect(scopedRunningOperations(operations, 'B').map((o) => o.operationId)).toEqual(['b1'])
	})

	test('is empty without a server connection', () => {
		expect(scopedRunningOperations(operations, undefined)).toEqual([])
	})
})

test('the summary names at most two running operations', () => {
	expect(operationsSummary([{ kind: 'mount.slew' }])).toBe('Mount slew')
	expect(operationsSummary([{ kind: 'mount.slew' }, { kind: 'camera.capture' }, { kind: 'dome.slew' }])).toBe('Mount slew · Camera capture · +1')
})

describe('mount motion', () => {
	test('a motion operation of that exact mount moves it', () => {
		expect(mountMoving(IDLE, [operation('1', 'mount.goto', 'A', 'm1')], MOUNT)).toBe(true)
		expect(mountMoving(IDLE, [operation('1', 'mount.remoteMove', 'A', 'm1')], MOUNT)).toBe(true)
		expect(mountMoving(IDLE, [operation('1', 'mount.nudge', 'A', 'm1')], MOUNT)).toBe(true)
	})

	test('a motion of another connection or device does not', () => {
		expect(mountMoving(IDLE, [operation('1', 'mount.goto', 'B', 'm1')], MOUNT)).toBe(false)
		expect(mountMoving(IDLE, [operation('1', 'mount.goto', 'A', 'm2')], MOUNT)).toBe(false)
	})

	test('TPPA and DARV sessions are not motions of the status bar', () => {
		expect(mountMoving(IDLE, [operation('1', 'mount.tppa', 'A', 'm1'), operation('2', 'mount.darv', 'A', 'm1')], MOUNT)).toBe(false)
	})

	test('the driver reporting motion moves it without an operation', () => {
		for (const flag of ['slewing', 'moving', 'parking', 'homing'] as const) {
			expect(mountMoving({ ...IDLE, [flag]: true }, [], MOUNT)).toBe(true)
		}

		expect(mountMoving(IDLE, [], MOUNT)).toBe(false)
	})
})

describe('mount abort target', () => {
	const moving = { link: 'online', serverId: 'A', watched: 'A', mount: MOUNT, state: { ...IDLE, slewing: true }, operations: [] } as const

	test('targets exactly the profile mount while it moves', () => {
		expect(mountAbortTarget(moving)).toEqual({ deviceId: 'm1', name: 'Mount A' })
	})

	test('is unavailable while the event socket is not online', () => {
		expect(mountAbortTarget({ ...moving, link: 'offline' })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, link: undefined })).toBeUndefined()
	})

	test('is unavailable when the control store mirrors another connection', () => {
		expect(mountAbortTarget({ ...moving, watched: 'B' })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, watched: undefined })).toBeUndefined()
	})

	test('is unavailable for a mount of another connection or without one', () => {
		expect(mountAbortTarget({ ...moving, serverId: 'B', watched: 'B' })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, serverId: undefined })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, mount: undefined })).toBeUndefined()
	})

	test('is unavailable for a disconnected, non-abortable, unreported, or idle mount', () => {
		expect(mountAbortTarget({ ...moving, state: { ...moving.state, connected: false } })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, state: { ...moving.state, canAbort: false } })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, state: undefined })).toBeUndefined()
		expect(mountAbortTarget({ ...moving, state: IDLE })).toBeUndefined()
	})
})

describe('scoped device errors', () => {
	const devices: ScopedDevice[] = [MOUNT, { id: 'c1', connectionId: 'A', name: 'Camera A' }]

	test('lists connect and command failures of the active connection, the command one first', () => {
		const errors = scopedDeviceErrors({ serverId: 'A', devices: { watched: 'A', devices, errors: { m1: 'Timed out', c1: 'Driver alert' } }, control: { watched: 'A', errors: { m1: 'The mount did not stop' } } })
		expect(errors).toEqual([
			{ deviceId: 'm1', name: 'Mount A', message: 'The mount did not stop' },
			{ deviceId: 'c1', name: 'Camera A', message: 'Driver alert' },
		])
	})

	test('ignores the stores while they track another connection', () => {
		expect(scopedDeviceErrors({ serverId: 'A', devices: { watched: 'B', devices, errors: { m1: 'Timed out' } }, control: { watched: 'A', errors: {} } })).toEqual([])
		expect(scopedDeviceErrors({ serverId: 'A', devices: { watched: 'A', devices, errors: {} }, control: { watched: 'B', errors: { m1: 'Refused' } } })).toEqual([])
		expect(scopedDeviceErrors({ serverId: undefined, devices: { watched: undefined, devices: [], errors: {} }, control: { watched: undefined, errors: {} } })).toEqual([])
	})

	test('ignores errors of devices that are not listed on the connection', () => {
		expect(scopedDeviceErrors({ serverId: 'A', devices: { watched: 'A', devices, errors: { x9: 'Gone' } }, control: { watched: 'A', errors: {} } })).toEqual([])
	})
})
