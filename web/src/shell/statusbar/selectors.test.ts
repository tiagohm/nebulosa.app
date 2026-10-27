import { describe, expect, test } from 'bun:test'
import type { CaptureSession, GuidingSessionSummary, OperationKind, OperationRecord } from 'api'
import { newControlRuntime } from '../../equipment-control/control'
import {
	activeCapture,
	activeGuiding,
	cameraChip,
	captureValue,
	fitItems,
	connectionLabel,
	coverChip,
	domeChip,
	flatPanelChip,
	focuserChip,
	formatElapsed,
	guideChip,
	guidingValue,
	type MountMotionState,
	mountAbortTarget,
	mountChip,
	mountMoving,
	operationsSummary,
	otherOperations,
	progressText,
	roleChip,
	roleDetailValue,
	rotatorChip,
	scopedDeviceErrors,
	scopedRunningOperations,
	type ScopedDevice,
	serverLinkLabel,
	sessionOperationIds,
	wheelChip,
} from './selectors'

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
	expect(operationsSummary([{ kind: 'mount.slew' }])).toBe('Slew')
	expect(operationsSummary([{ kind: 'mount.slew' }, { kind: 'camera.capture' }, { kind: 'dome.slew' }])).toBe('Slew · Capture · +1')
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

describe('device chips', () => {
	test('a camera shows its finite temperature, or the icon alone', () => {
		expect(cameraChip({ temperature: -10.24 }).text).toBe('-10.2°C')
		expect(cameraChip({ temperature: -0.04 }).text).toBe('0.0°C')
		expect(cameraChip({ temperature: undefined }).text).toBe('')
		expect(cameraChip({ temperature: Number.NaN }).text).toBe('')
		expect(cameraChip(undefined).text).toBe('')
	})

	const mount = { parking: false, homing: false, slewing: false, moving: false, parked: false, tracking: false }

	test('a moving mount shows only the motion dots, with the motion by precedence in the title', () => {
		expect(mountChip({ ...mount, slewing: true, tracking: true })).toEqual({ text: '', tone: 'active', moving: true, title: 'Slewing' })
		expect(mountChip({ ...mount, moving: true, parked: true }).title).toBe('Moving')
		expect(mountChip({ ...mount, homing: true, slewing: true }).title).toBe('Homing')
		expect(mountChip({ ...mount, parking: true, homing: true }).title).toBe('Parking')
	})

	test('a still mount shows parked, then tracking, then idle', () => {
		expect(mountChip(mount).text).toBe('Idle')
		expect(mountChip({ ...mount, tracking: true }).text).toBe('Tracking')
		expect(mountChip({ ...mount, parked: true, tracking: true }).text).toBe('Parked')
		expect(mountChip(undefined).moving).toBe(false)
	})

	test('a focuser shows its position, with the dots while it moves', () => {
		expect(focuserChip({ moving: false, position: { value: 1200, min: 0, max: 5000, step: 1 }, temperature: 12.34 })).toEqual({ text: '1200', tone: 'ok', moving: false, title: 'Position 1200 steps · 12.3°C' })
		expect(focuserChip({ moving: true, position: { value: 1300, min: 0, max: 5000, step: 1 }, temperature: undefined })).toMatchObject({ text: '1300', moving: true })
	})

	test('a wheel shows the filter of its 0-based slot, or the 1-based slot, and only the dots while it moves', () => {
		expect(wheelChip({ moving: false, position: 1, names: ['L', 'Ha'] }).text).toBe('Ha')
		expect(wheelChip({ moving: false, position: 2, names: ['L', 'Ha'] }).text).toBe('#3')
		expect(wheelChip({ moving: true, position: 1, names: ['L', 'Ha'] })).toMatchObject({ text: '', moving: true })
	})

	test('a rotator shows its mechanical angle in degrees', () => {
		expect(rotatorChip({ moving: false, angle: { value: 90.25, min: 0, max: 360, step: 0 } })).toEqual({ text: '90.3°', tone: 'ok', moving: false, title: 'Mechanical angle 90.3°' })
		expect(rotatorChip({ moving: true, angle: { value: 10, min: 0, max: 360, step: 0 } }).moving).toBe(true)
	})

	test('a cover shows open or closed, and only the dots while it moves', () => {
		expect(coverChip({ parked: true, parking: false }).text).toBe('Closed')
		expect(coverChip({ parked: false, parking: false }).text).toBe('Open')
		expect(coverChip({ parked: true, parking: true })).toMatchObject({ text: '', moving: true })
	})

	test('a flat panel shows its light on or off', () => {
		expect(flatPanelChip({ enabled: true, intensity: { value: 40, min: 0, max: 255, step: 1 } })).toEqual({ text: 'On', tone: 'ok', moving: false, title: 'On · brightness 40' })
		expect(flatPanelChip({ enabled: false, intensity: { value: 0, min: 0, max: 255, step: 1 } }).text).toBe('Off')
	})

	const dome = { slewing: false, moving: false, homing: false, parking: false, parked: false, hasShutter: true, shutterState: 'OPEN', azimuth: { value: Math.PI / 2, min: 0, max: 2 * Math.PI, step: 0 } } as const

	test('a dome shows its shutter, with the dots while it rotates or the shutter moves', () => {
		expect(domeChip(dome)).toEqual({ text: 'Open', tone: 'ok', moving: false, title: 'Azimuth 90.0° · shutter open' })
		expect(domeChip({ ...dome, shutterState: 'CLOSED', slewing: true })).toMatchObject({ text: 'Closed', moving: true, title: 'Moving · shutter closed' })
		expect(domeChip({ ...dome, shutterState: 'OPENING' })).toMatchObject({ text: '', moving: true })
		expect(domeChip({ ...dome, shutterState: 'ERROR' }).tone).toBe('error')
		expect(domeChip({ ...dome, hasShutter: false })).toMatchObject({ text: '', moving: false, title: 'Azimuth 90.0°' })
	})

	function control(type: 'mount' | 'wheel', state: object, watched = 'A') {
		const runtime = newControlRuntime()
		runtime.watched = watched
		;(runtime.states[type] as Record<string, unknown>).d = { id: 'd', connectionId: 'A', connected: true, moving: false, ...state }
		return runtime
	}

	const device = { id: 'd', connectionId: 'A', connected: true }

	test('a device that is not connected, absent, or unassigned has no chip', () => {
		expect(roleChip('FILTER_WHEEL', { ...device, connected: false }, control('wheel', { position: 0, names: ['L'] }))).toBeUndefined()
		expect(roleChip('FILTER_WHEEL', undefined, control('wheel', { position: 0, names: ['L'] }))).toBeUndefined()
		expect(roleChip('FILTER_WHEEL', device, control('wheel', { position: 0, names: ['L'] }))?.text).toBe('L')
	})

	test('a chip never reads the state of another connection', () => {
		expect(roleChip('FILTER_WHEEL', device, control('wheel', { position: 0, names: ['L'] }, 'B'))?.title).toBe('State not reported')
	})

	test('the details show the full reading while connected, and the role status otherwise', () => {
		expect(roleDetailValue('FILTER_WHEEL', 'connected', device, control('wheel', { position: 1, names: ['L', 'Ha'] })).text).toBe('#2 · Ha')
		expect(roleDetailValue('MOUNT', 'connected', device, control('mount', { ...mount, slewing: true }))).toEqual({ text: 'Slewing', tone: 'active' })
		expect(roleDetailValue('FILTER_WHEEL', 'disconnected', device, control('wheel', { position: 1, names: ['L'] })).text).toBe('Disconnected')
		expect(roleDetailValue('GUIDE_OUTPUT', 'connected', device, control('wheel', {})).text).toBe('Connected')
	})

	test('the links read as text', () => {
		expect(serverLinkLabel('online')).toBe('Server online')
		expect(serverLinkLabel('offline')).toBe('Reconnecting')
		expect(serverLinkLabel(undefined)).toBe('Connecting')
		expect(connectionLabel(undefined, 'disconnected')).toBe('No connection')
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

describe('fitting chips', () => {
	const items = [
		{ id: 'MAIN_CAMERA', moving: false, active: false, width: 60 },
		{ id: 'capture', moving: false, active: true, width: 40 },
		{ id: 'FOCUSER', moving: false, active: false, width: 50 },
		{ id: 'MOUNT', moving: true, active: false, width: 30 },
		{ id: 'GUIDE_CAMERA', moving: false, active: true, width: 70 },
		{ id: 'COVER', moving: false, active: false, width: 20 },
	]

	test('every chip fits a wide bar, and the other operations are named in the room left', () => {
		expect(fitItems(items, 1000, 10, 2)).toEqual({ visible: new Set(items.map((item) => item.id)), nameOthers: true, hidden: 0 })
	})

	test('the other operations are counted when there is no room to name them', () => {
		expect(fitItems(items, 340, 10, 2)).toEqual({ visible: new Set(items.map((item) => item.id)), nameOthers: false, hidden: 2 })
	})

	test('a narrow bar keeps moving devices, then sessions, then the rest, skipping what does not fit', () => {
		expect(fitItems(items, 100, 10, 1)).toEqual({ visible: new Set(['MOUNT', 'capture']), nameOthers: false, hidden: 5 })
		expect(fitItems(items, 200, 10, 0)).toEqual({ visible: new Set(['MOUNT', 'capture', 'GUIDE_CAMERA', 'COVER']), nameOthers: false, hidden: 2 })
	})

	test('no room shows no chip', () => {
		expect(fitItems(items, 0, 10, 0).visible.size).toBe(0)
		expect(fitItems([], 0, 10, 0)).toEqual({ visible: new Set(), nameOthers: false, hidden: 0 })
	})
})

test('a guide camera shows its session, or the icon alone while it does not guide', () => {
	expect(guideChip(undefined)).toEqual({ text: '--', tone: 'idle', moving: false, title: 'Not guiding' })
	const session = { state: 'guiding', settling: false, dithering: false, rms: { ra: 0.3, dec: 0.4, total: 0.5, samples: 20 }, pixelScale: 1.5 } as GuidingSessionSummary
	expect(guideChip(session)).toEqual({ text: 'RMS 0.75″', tone: 'ok', moving: false, title: 'Guiding · RMS 0.75″' })
	expect(guideChip({ ...session, state: 'calibrating' }).title).toBe('Calibrating')
})

test('elapsed time and progress are shown only as reported', () => {
	expect(formatElapsed(0, 65_000)).toBe('1:05')
	expect(formatElapsed(0, 3_725_000)).toBe('1:02:05')
	expect(formatElapsed(10_000, 0)).toBe('0:00')
	expect(progressText(undefined)).toBeUndefined()
	expect(progressText({ step: 2, steps: 5, message: 'Moving to 1100' })).toBe('2/5 · Moving to 1100')
	expect(progressText({ step: 1, steps: 3, message: '' })).toBe('1/3')
})
