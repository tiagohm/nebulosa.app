import { describe, expect, test } from 'bun:test'
import type { CaptureSession, GuidingSessionSummary, OperationKind, OperationRecord } from 'api'
import { newControlRuntime } from '../../equipment-control/control'
import {
	activeCapture,
	activeGuiding,
	barOperations,
	cameraChip,
	capturePercent,
	captureValue,
	fitClocks,
	fitItems,
	fitOperations,
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
	operationInterruption,
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

	test('a camera shows what its capture or any other tool has it doing', () => {
		expect(cameraChip({ temperature: -10, exposing: true }, undefined)).toMatchObject({ text: 'Exposing -10.0°C', tone: 'active' })
		expect(cameraChip({ temperature: -10, exposing: true }, { phase: 'reading' }).text).toBe('Reading -10.0°C')
		expect(cameraChip({ exposing: false }, { phase: 'waiting' }).text).toBe('Waiting')
		expect(cameraChip({ exposing: false }).tone).toBe('ok')
	})

	test('a chip shows only the readings asked for, in their order', () => {
		const state = { temperature: -10, exposing: true, cooler: { power: 41.6 } }
		expect(cameraChip(state, undefined, ['temperature']).text).toBe('-10.0°C')
		expect(cameraChip(state, undefined, ['status', 'temperature', 'cooler']).text).toBe('Exposing -10.0°C 42%')
		expect(cameraChip(state, undefined, []).text).toBe('')
		expect(cameraChip(state, undefined, []).title).toBe('Exposing · Sensor -10.0°C · Cooler 42%')
		expect(focuserChip({ moving: false, position: { value: 10, min: 0, max: 50, step: 1 }, temperature: 5 }, ['position', 'temperature']).text).toBe('10 5.0°C')
		expect(mountChip({ ...mount, tracking: true, rightAscension: 0, declination: 0 }, ['status', 'coordinates']).text).toBe('Tracking 00 00 00 +00 00 00')
		expect(domeChip(dome, ['azimuth']).text).toBe('90.0°')
		expect(flatPanelChip({ enabled: true, intensity: { value: 40, min: 0, max: 255, step: 1 } }, ['status', 'brightness']).text).toBe('On 40')
	})

	const mount = { parking: false, homing: false, slewing: false, moving: false, parked: false, tracking: false }

	const dome = { slewing: false, moving: false, homing: false, parking: false, parked: false, hasShutter: true, shutterState: 'OPEN', azimuth: { value: Math.PI / 2, min: 0, max: 2 * Math.PI, step: 0 } } as const

	test('a moving mount shows its motion by precedence', () => {
		expect(mountChip({ ...mount, slewing: true, tracking: true })).toEqual({ text: 'Slewing', tone: 'active', moving: true, title: 'Slewing' })
		expect(mountChip({ ...mount, moving: true, parked: true }).text).toBe('Moving')
		// A manual motion also sets the broad slewing flag; the chip names the manual motion, as Equipment Control does.
		expect(mountChip({ ...mount, moving: true, slewing: true }).text).toBe('Moving')
		expect(mountChip({ ...mount, homing: true, slewing: true }).text).toBe('Homing')
		expect(mountChip({ ...mount, parking: true, homing: true }).text).toBe('Parking')
	})

	test('a still mount shows parked, then tracking, then idle', () => {
		expect(mountChip(mount).text).toBe('Idle')
		expect(mountChip({ ...mount, tracking: true }).text).toBe('Tracking')
		expect(mountChip({ ...mount, parked: true, tracking: true }).text).toBe('Parked')
		expect(mountChip(undefined).moving).toBe(false)
	})

	test('a focuser shows its position, and that it moves', () => {
		expect(focuserChip({ moving: false, position: { value: 1200, min: 0, max: 5000, step: 1 }, temperature: 12.34 })).toEqual({ text: '1200', tone: 'ok', moving: false, title: 'Position 1200 steps · 12.3°C' })
		expect(focuserChip({ moving: true, position: { value: 1300, min: 0, max: 5000, step: 1 }, temperature: undefined })).toMatchObject({ text: 'Moving 1300', tone: 'active', moving: true })
	})

	test('a wheel shows the filter of its 0-based slot, or the 1-based slot, and only the change while it moves', () => {
		expect(wheelChip({ moving: false, position: 1, names: ['L', 'Ha'] }).text).toBe('Ha')
		expect(wheelChip({ moving: false, position: 2, names: ['L', 'Ha'] }).text).toBe('#3')
		expect(wheelChip({ moving: true, position: 1, names: ['L', 'Ha'] })).toMatchObject({ text: 'Changing', moving: true })
	})

	test('a rotator shows its mechanical angle in degrees', () => {
		expect(rotatorChip({ moving: false, angle: { value: 90.25, min: 0, max: 360, step: 0 } })).toEqual({ text: '90.3°', tone: 'ok', moving: false, title: 'Mechanical angle 90.3°' })
		expect(rotatorChip({ moving: true, angle: { value: 10, min: 0, max: 360, step: 0 } })).toMatchObject({ text: 'Moving 10.0°', moving: true })
	})

	test('a cover shows open, closed, or moving', () => {
		expect(coverChip({ parked: true, parking: false }).text).toBe('Closed')
		expect(coverChip({ parked: false, parking: false }).text).toBe('Open')
		expect(coverChip({ parked: true, parking: true })).toMatchObject({ text: 'Moving', moving: true })
	})

	test('a flat panel shows its light on or off', () => {
		expect(flatPanelChip({ enabled: true, intensity: { value: 40, min: 0, max: 255, step: 1 } })).toEqual({ text: 'On', tone: 'ok', moving: false, title: 'On · brightness 40' })
		expect(flatPanelChip({ enabled: false, intensity: { value: 0, min: 0, max: 255, step: 1 } }).text).toBe('Off')
	})

	test('a dome shows its shutter, and what it is doing while it rotates or the shutter moves', () => {
		expect(domeChip(dome)).toEqual({ text: 'Open', tone: 'ok', moving: false, title: 'Azimuth 90.0° · shutter open' })
		expect(domeChip({ ...dome, shutterState: 'CLOSED', slewing: true })).toMatchObject({ text: 'Moving Closed', moving: true, title: 'Moving · shutter closed' })
		expect(domeChip({ ...dome, shutterState: 'OPENING' })).toMatchObject({ text: 'Opening', tone: 'active', moving: true })
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

	test('shows the frames taken and the percentage, without a total for a loop, or the stop in progress', () => {
		expect(captureValue(session({})).text).toBe('12/50 · 24%')
		expect(captureValue(session({ count: undefined })).text).toBe('12')
		expect(captureValue(session({ stopping: true })).text).toBe('Stopping')
	})

	test('the percentage counts the frame in flight by its exposure', () => {
		const exposure = { elapsedTime: 5e6, remainingTime: 5e6, progress: 50 } as CaptureSession['exposure']
		expect(capturePercent(session({ exposure, captured: 1, count: 4 }))).toBe(37)
		expect(capturePercent(session({ phase: 'reading', exposure, captured: 3, count: 4 }))).toBe(100)
		expect(capturePercent(session({ phase: 'waiting', exposure, captured: 2, count: 4 }))).toBe(50)
	})

	test('the percentage of a loop is that of the current exposure', () => {
		const exposure = { elapsedTime: 5e6, remainingTime: 5e6, progress: 50 } as CaptureSession['exposure']
		expect(capturePercent(session({ exposure, count: undefined }))).toBe(50)
		expect(capturePercent(session({ phase: 'waiting', exposure, count: undefined }))).toBeUndefined()
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

	test('every chip fits a wide bar', () => {
		expect(fitItems(items, 1000, 10, 0)).toEqual({ visible: new Set(items.map((item) => item.id)), hidden: 0 })
	})

	test('the operations left out are counted with the chips', () => {
		expect(fitItems(items, 1000, 10, 2)).toEqual({ visible: new Set(items.map((item) => item.id)), hidden: 2 })
		expect(fitItems(items, 100, 10, 1).hidden).toBe(5)
	})

	test('a narrow bar keeps moving devices, then sessions, then the rest, skipping what does not fit', () => {
		expect(fitItems(items, 100, 10, 1).visible).toEqual(new Set(['MOUNT', 'capture']))
		expect(fitItems(items, 200, 10, 0)).toEqual({ visible: new Set(['MOUNT', 'capture', 'GUIDE_CAMERA', 'COVER']), hidden: 2 })
	})

	test('no room shows no chip', () => {
		expect(fitItems(items, 0, 10, 0).visible.size).toBe(0)
		expect(fitItems([], 0, 10, 0)).toEqual({ visible: new Set(), hidden: 0 })
	})

	describe('the operations', () => {
		const operations = [
			{ id: 'a', width: 100 },
			{ id: 'b', width: 200 },
			{ id: 'c', width: 50 },
		]

		test('all of them show in a wide bar, taking their width and gaps', () => {
			expect(fitOperations(operations, 1000, 10)).toEqual({ visible: new Set(['a', 'b', 'c']), width: 380 })
		})

		test('one that does not fit is skipped for a narrower one', () => {
			expect(fitOperations(operations, 200, 10)).toEqual({ visible: new Set(['a', 'c']), width: 170 })
		})

		test('the first one shows even in a bar without room for it', () => {
			expect(fitOperations(operations, 0, 10).visible).toEqual(new Set(['a']))
			expect(fitOperations([], 0, 10)).toEqual({ visible: new Set(), width: 0 })
		})
	})

	describe('the clock', () => {
		const clocks = [
			{ id: 'last', width: 100 },
			{ id: 'utc', width: 60 },
		]
		// The chips and their gaps take 330 px.
		const CHIPS = 330

		function fit(room: number, hiddenOperations: number = 0) {
			const fitted = fitItems(items, room, 10, hiddenOperations)
			return { fitted, shown: fitClocks(clocks, items, fitted, room, 10) }
		}

		test('takes the room left after every chip, primary first', () => {
			expect(fit(CHIPS + 180).shown).toEqual(new Set(['last', 'utc']))
			expect(fit(CHIPS + 179).shown).toEqual(new Set(['last']))
			expect(fit(CHIPS + 110).shown).toEqual(new Set(['last']))
			expect(fit(CHIPS + 109).shown).toEqual(new Set())
		})

		test('the secondary never shows without the primary, even when it alone would fit', () => {
			expect(fitClocks([{ id: 'last', width: 500 }, clocks[1]], items, fitItems(items, 1000, 10, 0), CHIPS + 100, 10)).toEqual(new Set())
		})

		test('never shows beside a chip that was left out', () => {
			const narrow = fit(200)
			expect(narrow.fitted.hidden).toBe(2)
			expect(narrow.shown).toEqual(new Set())
			expect(fitClocks([{ id: 'last', width: 1 }], items, fitItems(items, 200, 10, 0), 200, 10)).toEqual(new Set())
		})

		test('never shows while an operation was left out', () => {
			expect(fit(1000, 1).shown).toEqual(new Set())
		})

		test('changes nothing fitItems decided, and is never counted', () => {
			for (const [room, others] of [
				[1000, 2],
				[340, 2],
				[200, 0],
				[100, 1],
				[0, 0],
			]) {
				const before = fitItems(items, room, 10, others)
				const { fitted } = fit(room, others)
				expect(fitted).toEqual(before)
			}
		})
	})
})

test('a guide camera shows its session, or the icon alone while it does not guide', () => {
	expect(guideChip(undefined)).toEqual({ text: '--', tone: 'idle', moving: false, title: 'Not guiding' })
	expect(guideChip(undefined, { temperature: 5 }, ['status', 'temperature']).text).toBe('-- 5.0°C')
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

describe('operations of the bar', () => {
	function capture(operationId: string) {
		return { operationId, connectionId: 'A', deviceId: 'c1', phase: 'exposing', stopping: false, captured: 1, count: 4 } as CaptureSession
	}

	test('every running operation shows, those that can be interrupted first', () => {
		const running = [operation('w', 'wheel.move', 'A', 'w1'), operation('s', 'mount.slew', 'A', 'm1'), operation('f', 'focuser.move', 'A', 'f1')]
		const shown = barOperations(running, { captures: {}, guiding: {} }, ({ kind }) => kind !== 'wheel.move')
		expect(shown.map(({ id, label, abortable }) => [id, label, abortable])).toEqual([
			['s', 'Slew', true],
			['f', 'Move', true],
			['w', 'Change', false],
		])
	})

	test('a capture reads through its session, any other through its reported progress', () => {
		const running = [operation('c', 'camera.capture', 'A', 'c1'), { ...operation('a', 'focuser.autofocus', 'A', 'f1'), progress: { step: 2, steps: 5, message: 'Moving to 1100' } }]
		const [first, second] = barOperations(running, { captures: { 'A:c1': capture('c') }, guiding: {} }, () => true)
		expect(first).toMatchObject({ detail: '1/4 · 25%', title: 'Capture · 1/4 · 25%' })
		expect(second).toMatchObject({ detail: '2/5', title: 'Auto Focus · 2/5 · Moving to 1100' })
	})

	test('a guiding session counts once', () => {
		const running = [operation('g1', 'camera.guiding', 'A', 'g'), operation('g2', 'guideOutput.guiding', 'A', 'o')]
		const session = { runOperationId: 'g2' } as GuidingSessionSummary
		expect(barOperations(running, { captures: {}, guiding: { 'A:g': session } }, () => true).map(({ id }) => id)).toEqual(['g1'])
	})
})

describe('interruption of an operation', () => {
	const empty = { sessions: {} }

	function input(states: Partial<Record<'mount' | 'focuser' | 'wheel', Record<string, object>>> = {}) {
		const control = newControlRuntime()
		control.watched = 'A'
		Object.assign(control.states, states)
		return { link: 'online', control, captures: empty, guiding: empty, autoFocus: empty, tppa: empty, ipolar: empty, darv: empty, flatWizard: empty, darkLibraryWizard: empty, targetCentering: empty, mountPointing: empty } as Parameters<typeof operationInterruption>[1]
	}

	test('a motion stops its device, when the driver reports it can', () => {
		expect(operationInterruption(operation('1', 'mount.nudge', 'A', 'm1'), input({ mount: { m1: { connected: true, canAbort: true } } }))).toEqual({ type: 'device', device: 'mount', deviceId: 'm1' })
		expect(operationInterruption(operation('1', 'focuser.move', 'A', 'f1'), input({ focuser: { f1: { connected: true, canAbort: true } } }))).toEqual({ type: 'device', device: 'focuser', deviceId: 'f1' })
		expect(operationInterruption(operation('1', 'focuser.move', 'A', 'f1'), input({ focuser: { f1: { connected: true, canAbort: false } } }))).toBeUndefined()
		expect(operationInterruption(operation('1', 'focuser.move', 'A', 'f1'), input())).toBeUndefined()
	})

	test('a filter wheel and a property write cannot be interrupted', () => {
		expect(operationInterruption(operation('1', 'wheel.move', 'A', 'w1'), input({ wheel: { w1: { connected: true } } }))).toBeUndefined()
		expect(operationInterruption(operation('1', 'indi.propertyWrite', 'A', 'x'), input())).toBeUndefined()
	})

	test('a capture aborts its exposure, or ends after it on a camera that cannot abort', () => {
		const session = { operationId: 'c', connectionId: 'A', deviceId: 'c1' } as CaptureSession
		const running = operation('c', 'camera.capture', 'A', 'c1')
		const camera = { connectionId: 'A', deviceId: 'c1' }
		const abortable = input()
		abortable.control.states.camera.c1 = { id: 'c1', connectionId: 'A', canAbort: true } as (typeof abortable.control.states.camera)[string]
		expect(operationInterruption(running, { ...abortable, captures: { sessions: { 'A:c1': session } } })).toEqual({ type: 'capture', camera, sessionId: session.sessionId, abort: true })
		expect(operationInterruption(running, { ...input(), captures: { sessions: { 'A:c1': session } } })).toEqual({ type: 'capture', camera, sessionId: session.sessionId, abort: false })
	})

	test('a session of a tool is found by its exact operation', () => {
		const session = { sessionId: 's', operationId: 'op', camera: { connectionId: 'A', deviceId: 'c1' }, measurements: [{ operationId: 'measure' }] }
		const sessions = { sessions: { 'A:c1': session } } as never
		expect(operationInterruption(operation('op', 'mount.tppa', 'A', 'c1'), { ...input(), tppa: sessions })).toMatchObject({ type: 'session', tool: 'tppa' })
		expect(operationInterruption(operation('op', 'camera.ipolar', 'A', 'c1'), { ...input(), ipolar: sessions })).toMatchObject({ type: 'session', tool: 'ipolar' })
		expect(operationInterruption(operation('op', 'camera.guiding', 'A', 'c1'), { ...input(), guiding: sessions })).toMatchObject({ type: 'session', tool: 'guiding' })
		expect(operationInterruption(operation('measure', 'mount.darv', 'A', 'c1'), { ...input(), darv: sessions })).toMatchObject({ type: 'session', tool: 'darv' })
		expect(operationInterruption(operation('other', 'mount.tppa', 'A', 'c1'), { ...input(), tppa: sessions })).toBeUndefined()
	})

	test('nothing is offered while the event socket is not online', () => {
		const state = input({ mount: { m1: { connected: true, canAbort: true } } })
		expect(operationInterruption(operation('1', 'mount.slew', 'A', 'm1'), { ...state, link: 'offline' })).toBeUndefined()
	})

	test('a device of another connection is not stopped', () => {
		expect(operationInterruption(operation('1', 'mount.slew', 'B', 'm1'), input({ mount: { m1: { connected: true, canAbort: true } } }))).toBeUndefined()
	})
})
