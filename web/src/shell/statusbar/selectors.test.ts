import { describe, expect, test } from 'bun:test'
import type { CaptureSession, GuidingSessionSummary, OperationKind, OperationRecord } from 'api'
import { activeCapture, activeGuiding, cameraValue, captureValue, connectionLabel, guidingValue, type MountMotionState, mountAbortTarget, mountMoving, mountValue, operationsSummary, otherOperations, scopedDeviceErrors, scopedRunningOperations, type ScopedDevice, serverLinkLabel, sessionOperationIds } from './selectors'

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

describe('equipment values', () => {
	test('a connected camera shows its finite temperature and nothing invented otherwise', () => {
		expect(cameraValue('connected', { temperature: -10.24 })).toEqual({ text: '-10.2°C', tone: 'ok' })
		expect(cameraValue('connected', { temperature: -0.04 })).toEqual({ text: '0.0°C', tone: 'ok' })
		expect(cameraValue('connected', { temperature: undefined })).toEqual({ text: 'Connected', tone: 'ok' })
		expect(cameraValue('connected', { temperature: Number.NaN })).toEqual({ text: 'Connected', tone: 'ok' })
		expect(cameraValue('connected', undefined)).toEqual({ text: 'Connected', tone: 'ok' })
		expect(cameraValue('disconnected', { temperature: 5 })).toEqual({ text: 'Disconnected', tone: 'idle' })
		expect(cameraValue('unavailable', undefined)).toEqual({ text: 'Unavailable', tone: 'muted' })
	})

	const mount = { connected: true, parking: false, homing: false, slewing: false, moving: false, parked: false, tracking: false }

	test('a mount shows one state by precedence', () => {
		expect(mountValue('connected', mount).text).toBe('Idle')
		expect(mountValue('connected', { ...mount, tracking: true }).text).toBe('Tracking')
		expect(mountValue('connected', { ...mount, parked: true, tracking: true }).text).toBe('Parked')
		expect(mountValue('connected', { ...mount, slewing: true, tracking: true }).text).toBe('Slewing')
		expect(mountValue('connected', { ...mount, moving: true, parked: true }).text).toBe('Moving')
		expect(mountValue('connected', { ...mount, homing: true, slewing: true }).text).toBe('Homing')
		expect(mountValue('connected', { ...mount, parking: true, homing: true }).text).toBe('Parking')
	})

	test('a mount that is not connected or not reported never shows a motion', () => {
		expect(mountValue('connected', { ...mount, connected: false, slewing: true }).text).toBe('Disconnected')
		expect(mountValue('connected', undefined).text).toBe('Unknown')
		expect(mountValue('error', { ...mount, slewing: true }).text).toBe('Error')
		expect(mountValue('notSelected', undefined).text).toBe('Not Selected')
	})

	test('the links read as text', () => {
		expect(serverLinkLabel('online')).toBe('Server online')
		expect(serverLinkLabel('offline')).toBe('Reconnecting')
		expect(serverLinkLabel(undefined)).toBe('Connecting')
		expect(connectionLabel(undefined, 'disconnected')).toBe('No connection')
		expect(connectionLabel('Observatory', 'connecting')).toBe('Observatory · Connecting')
		expect(connectionLabel('Observatory', 'connected')).toBe('Observatory · Connected')
	})
})

describe('capture', () => {
	const camera: ScopedDevice = { id: 'c1', connectionId: 'A', name: 'Camera A' }

	function session(patch: Partial<CaptureSession>) {
		return { operationId: 'op', connectionId: 'A', deviceId: 'c1', phase: 'exposing', stopping: false, captured: 12, count: 50, ...patch } as CaptureSession
	}

	test('only the running session of that exact camera is active', () => {
		expect(activeCapture({ 'A:c1': session({}) }, camera)).toBeDefined()
		expect(activeCapture({ 'A:c1': session({ phase: 'completed' }) }, camera)).toBeUndefined()
		expect(activeCapture({ 'B:c1': session({ connectionId: 'B' }) }, camera)).toBeUndefined()
		expect(activeCapture({ 'A:c1': session({}) }, undefined)).toBeUndefined()
	})

	test('shows the frames taken, without a total for a loop, or the stop in progress', () => {
		expect(captureValue(session({})).text).toBe('12/50')
		expect(captureValue(session({ count: undefined })).text).toBe('12')
		expect(captureValue(session({ stopping: true })).text).toBe('Stopping')
	})
})

describe('guiding', () => {
	function session(patch: Partial<GuidingSessionSummary>) {
		return { operationId: 'g1', state: 'guiding', active: true, settling: false, dithering: false, rms: { ra: 0.3, dec: 0.4, total: 0.5, samples: 20 }, pixelScale: 1.5, ...patch } as GuidingSessionSummary
	}

	test('shows the RMS in arcseconds only with a valid pixel scale', () => {
		expect(guidingValue(session({})).text).toBe('RMS 0.75″')
		expect(guidingValue(session({ pixelScale: undefined })).text).toBe('RMS 0.50 px')
		expect(guidingValue(session({ pixelScale: 0 })).text).toBe('RMS 0.50 px')
	})

	test('shows no RMS before a measured step', () => {
		expect(guidingValue(session({ rms: { ra: 0, dec: 0, total: 0, samples: 0 } })).text).toBe('Guiding')
		expect(guidingValue(session({ rms: undefined })).text).toBe('Guiding')
	})

	test('a dither, a settle, or another state takes precedence over the RMS', () => {
		expect(guidingValue(session({ dithering: true })).text).toBe('Dithering')
		expect(guidingValue(session({ settling: true })).text).toBe('Settling')
		expect(guidingValue(session({ state: 'lostLock' }))).toEqual({ text: 'Star lost', tone: 'error' })
		expect(guidingValue(session({ state: 'paused' })).text).toBe('Paused')
		expect(guidingValue(session({ state: 'calibrating' })).text).toBe('Calibrating')
	})

	test('only a running session is active', () => {
		const camera: ScopedDevice = { id: 'g', connectionId: 'A', name: 'Guide' }
		expect(activeGuiding({ 'A:g': session({}) }, camera)).toBeDefined()
		expect(activeGuiding({ 'A:g': session({ active: false }) }, camera)).toBeUndefined()
	})

	test('a guiding session counts once and keeps unrelated operations', () => {
		const running = [operation('g1', 'camera.guiding', 'A', 'g'), operation('g2', 'guideOutput.guiding', 'A', 'm1'), operation('x', 'guideOutput.guiding', 'A', 'o2'), operation('c', 'camera.capture', 'A', 'c1')]
		const ids = sessionOperationIds({ operationId: 'c' }, { operationId: 'g1', runOperationId: 'g2' })
		expect(otherOperations(running, ids).map((o) => o.operationId)).toEqual(['x'])
		expect(otherOperations(running, sessionOperationIds(undefined, undefined))).toHaveLength(4)
	})
})
