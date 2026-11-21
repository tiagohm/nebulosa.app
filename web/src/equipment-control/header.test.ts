import { expect, test } from 'bun:test'
import type { DeviceStateMap, DeviceSummary, ManagedDeviceType } from 'api'
import { type ControlStates, newControlRuntime } from './control'
import { disconnectWarningOf, readoutOf, stopsOf } from './header'

function device(id: string, type: ManagedDeviceType): DeviceSummary {
	return { id, type, name: 'Rig', connected: true, connectionId: 'c', hardwareId: 'h', interfaces: [type], driver: { executable: '', version: '' } }
}

function states(patch: { readonly [T in ManagedDeviceType]?: Record<string, Partial<DeviceStateMap[T]>> }): ControlStates {
	const result = newControlRuntime().states
	for (const [type, byId] of Object.entries(patch)) Object.assign(result[type as ManagedDeviceType], byId)
	return result
}

test('reads a focuser at its logical position', () => {
	const s = states({ focuser: { f: { position: { value: 50000, min: 0, max: 100000, step: 1 }, moving: false } } })
	expect(readoutOf(device('f', 'focuser'), s)).toEqual({ value: '50000 steps', caption: 'Idle' })
	expect(readoutOf(device('f', 'focuser'), s, 20)).toEqual({ value: '49980 steps', caption: 'Idle' })
})

test('reads the state of a mount, idle when it neither moves nor tracks', () => {
	const mount = { rightAscension: 0, declination: 0, parked: false, parking: false, homing: false, moving: false, slewing: false, tracking: false }
	expect(readoutOf(device('m', 'mount'), states({ mount: { m: mount } }))?.value).toBe('Idle')
	expect(readoutOf(device('m', 'mount'), states({ mount: { m: { ...mount, tracking: true } } }))?.value).toBe('Tracking')
	expect(readoutOf(device('m', 'mount'), states({ mount: { m: { ...mount, slewing: true, tracking: true } } }))?.value).toBe('Slewing')
})

test('has no readout for a camera without a thermometer or a device not reported yet', () => {
	expect(readoutOf(device('c', 'camera'), states({ camera: { c: { temperature: undefined } } }))).toBeUndefined()
	expect(readoutOf(device('x', 'focuser'), states({}))).toBeUndefined()
})

test('stops only the motions a driver can stop', () => {
	const group = { devices: [device('m', 'mount'), device('g', 'guideOutput'), device('w', 'wheel')] }
	const idle = states({ mount: { m: { canAbort: true, slewing: false, parking: false, homing: false, moving: false } }, guideOutput: { g: { pulsing: false } }, wheel: { w: { moving: true } } })
	expect(stopsOf(group, idle)).toEqual([])

	const moving = states({ mount: { m: { canAbort: true, slewing: true, parking: false, homing: false, moving: false } }, guideOutput: { g: { pulsing: true } }, wheel: { w: { moving: true } } })
	expect(stopsOf(group, moving)).toEqual([
		{ type: 'mount', deviceId: 'm', label: 'Mount' },
		{ type: 'guideOutput', deviceId: 'g', label: 'Guide Output' },
	])

	const noAbort = states({ mount: { m: { canAbort: false, slewing: true, parking: false, homing: false, moving: false } } })
	expect(stopsOf({ devices: [device('m', 'mount')] }, noAbort)).toEqual([])
})

test('warns before disconnecting a device in use', () => {
	const group = { name: 'Rig', devices: [device('m', 'mount'), device('c', 'camera')] }
	const mount = { slewing: false, parking: false, homing: false, moving: false, parked: false, tracking: false }
	expect(disconnectWarningOf(group, states({ mount: { m: mount }, camera: { c: {} } }))).toBeUndefined()
	expect(disconnectWarningOf(group, states({ mount: { m: { ...mount, tracking: true } }, camera: { c: {} } }))).toStartWith('Rig is tracking.')
	expect(disconnectWarningOf(group, states({ mount: { m: mount }, camera: { c: { cooler: { enabled: true, power: 40 } } } }))).toStartWith('Rig has its cooler on.')
	expect(disconnectWarningOf(group, states({ mount: { m: mount }, camera: { c: {} } }), 'Goto')).toStartWith('Goto is running on Rig')
})
