import { expect, test } from 'bun:test'
import type { DeviceSummary, ManagedDeviceType, MountState } from 'api'
import { newControlRuntime } from './control'
import { findGroup, groupActivity, groupDevices, groupTypes, searchGroups } from './groups'

function device(id: string, type: ManagedDeviceType, name: string, hardwareId = name, connectionId = 'c', connected = true): DeviceSummary {
	return { id, type, name, connected, connectionId, hardwareId, interfaces: [type], driver: { executable: '', version: '' } }
}

test('interfaces of one physical device form one group, main function first', () => {
	const devices = [device('fp', 'flatPanel', 'Flip Flat'), device('cv', 'cover', 'Flip Flat'), device('go', 'guideOutput', 'Mount'), device('m', 'mount', 'Mount'), device('cam', 'camera', 'Camera')]
	const groups = groupDevices(devices)

	expect(groups.map((group) => group.name)).toEqual(['Camera', 'Mount', 'Flip Flat'])
	expect(groups[1].devices.map((d) => d.type)).toEqual(['mount', 'guideOutput'])
	expect(groups[2].primary.id).toBe('cv')
	expect(groupTypes(groups[2])).toBe('Cover · Flat Panel')
	expect(findGroup(groups, 'fp')).toBe(groups[2])
	expect(findGroup(groups, 'missing')).toBeUndefined()
})

test('devices of the same name on different physical devices stay apart', () => {
	const groups = groupDevices([device('a', 'camera', 'Camera', 'h1'), device('b', 'camera', 'Camera', 'h2')])
	expect(groups).toHaveLength(2)
})

test('search matches names and interface types', () => {
	const groups = groupDevices([device('cv', 'cover', 'Flip Flat'), device('fp', 'flatPanel', 'Flip Flat'), device('f', 'focuser', 'EAF')])
	expect(searchGroups(groups, '  eaf ').map((g) => g.name)).toEqual(['EAF'])
	expect(searchGroups(groups, 'panel').map((g) => g.name)).toEqual(['Flip Flat'])
	expect(searchGroups(groups, '')).toBe(groups)
})

test('activity reports connection, motion, and operations, never a requested state', () => {
	const runtime = newControlRuntime()
	const [mount] = groupDevices([device('m', 'mount', 'Mount')])
	const [off] = groupDevices([device('x', 'focuser', 'EAF', 'EAF', 'c', false)])

	expect(groupActivity(off, runtime.states, false)).toEqual({ label: 'Disconnected', tone: 'off' })
	expect(groupActivity(off, runtime.states, false, 'connect')).toEqual({ label: 'Connecting', tone: 'active' })
	expect(groupActivity(mount, runtime.states, false, undefined, 'boom').tone).toBe('warning')
	expect(groupActivity(mount, runtime.states, false)).toEqual({ label: 'Connected', tone: 'idle' })
	expect(groupActivity(mount, runtime.states, true)).toEqual({ label: 'Busy', tone: 'active' })

	runtime.states.mount.m = { parked: true, tracking: false, slewing: false, parking: false, homing: false, moving: false } as MountState
	expect(groupActivity(mount, runtime.states, false)).toEqual({ label: 'Parked', tone: 'idle' })
	expect(groupActivity(mount, runtime.states, true)).toEqual({ label: 'Busy', tone: 'active' })
	runtime.states.mount.m = { ...runtime.states.mount.m, parked: false, slewing: true }
	expect(groupActivity(mount, runtime.states, true)).toEqual({ label: 'Slewing', tone: 'active' })
})
