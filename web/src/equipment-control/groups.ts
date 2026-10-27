import type { DeviceSummary, IndiDeviceSummary, ManagedDeviceType } from 'api'
import { type ControlStates, deviceStateOf } from './control'

// Physical devices of the Equipment Control page. The server lists one entry per interface of a device
// (a flip-flat is a cover and a flat panel, a mount is also a guide output), all sharing its hardware id,
// so the page groups them back into one entry per physical device, shown once with a section per interface.
// The INDI directory adds each device's INDI identity, and the devices of an INDI server that no interface
// manages (relay boxes, auxiliary drivers) as groups of their own, which only have INDI properties. The
// activity of a device summarizes what its interfaces report, never what was requested.

// Display name of each device type.
export const DEVICE_TYPE_LABELS: Readonly<Record<ManagedDeviceType, string>> = {
	camera: 'Camera',
	mount: 'Mount',
	focuser: 'Focuser',
	wheel: 'Filter Wheel',
	rotator: 'Rotator',
	guideOutput: 'Guide Output',
	dome: 'Dome',
	cover: 'Cover',
	flatPanel: 'Flat Panel',
	dewHeater: 'Dew Heater',
}

// Order of the interfaces of a group: the main function of a device first, sub-interfaces last.
const INTERFACE_ORDER: readonly ManagedDeviceType[] = ['camera', 'mount', 'dome', 'focuser', 'wheel', 'rotator', 'cover', 'flatPanel', 'dewHeater', 'guideOutput']

// One physical device, its interfaces, and its INDI identity.
export interface DeviceGroup {
	// Id naming the group in the URL: the id of its main interface, or its hardware id when it has none.
	readonly id: string
	// Physical identity shared by the interfaces.
	readonly hardwareId: string
	// Driver-reported name of the device.
	readonly name: string
	// Interfaces of the device, main function first; empty for a device no interface manages.
	readonly devices: readonly DeviceSummary[]
	// Main interface; absent for a device no interface manages.
	readonly primary?: DeviceSummary
	// The device in the INDI directory of its connection, once listed.
	readonly indi?: IndiDeviceSummary
}

// Tone of an activity: off when the device is not connected, active while something is happening,
// warning when it needs attention, idle otherwise.
export type ActivityTone = 'off' | 'idle' | 'active' | 'warning'

// Activity of a physical device as shown in the device list.
export interface DeviceActivity {
	// Short description, such as "Slewing" or "Parked".
	readonly label: string
	// Tone of the description.
	readonly tone: ActivityTone
}

// Description of a device no interface manages, in place of its interface types.
export const INDI_DEVICE_LABEL = 'INDI device'

// Returns the rank of a device type in INTERFACE_ORDER; a device without interfaces ranks last.
function rank(type: ManagedDeviceType | undefined) {
	return type === undefined ? INTERFACE_ORDER.length : INTERFACE_ORDER.indexOf(type)
}

// Groups the devices of one connection by physical device, with the devices of its INDI directory: a managed
// device gets its INDI identity, and a device no interface manages becomes a group of its own. Groups are
// ordered by the type of their main interface, devices without one last, then by name.
export function groupDevices(devices: readonly DeviceSummary[], indiDevices: readonly IndiDeviceSummary[] = []): DeviceGroup[] {
	const groups = new Map<string, DeviceSummary[]>()

	for (const device of devices) {
		const group = groups.get(device.hardwareId)
		if (group) group.push(device)
		else groups.set(device.hardwareId, [device])
	}

	const indi = new Map(indiDevices.map((device) => [device.hardwareId, device]))

	const managed = Array.from(groups.entries(), ([hardwareId, members]): DeviceGroup => {
		const sorted = members.toSorted((a, b) => rank(a.type) - rank(b.type))
		return { id: sorted[0].id, hardwareId, name: sorted[0].name, devices: sorted, primary: sorted[0], indi: indi.get(hardwareId) }
	})

	const unmanaged = indiDevices.filter((device) => !groups.has(device.hardwareId)).map((device): DeviceGroup => ({ id: device.hardwareId, hardwareId: device.hardwareId, name: device.name, devices: [], indi: device }))

	return [...managed, ...unmanaged].sort((a, b) => rank(a.primary?.type) - rank(b.primary?.type) || a.name.localeCompare(b.name))
}

// Returns the group named by an id: the id of one of its interfaces, or its hardware id.
export function findGroup(groups: readonly DeviceGroup[], id: string | undefined): DeviceGroup | undefined {
	return id === undefined ? undefined : groups.find((group) => group.hardwareId === id || group.devices.some((device) => device.id === id))
}

// Returns the groups whose name or one of whose interface types contains the query, ignoring case.
export function searchGroups(groups: readonly DeviceGroup[], query: string): readonly DeviceGroup[] {
	const text = query.trim().toLowerCase()
	if (!text) return groups
	return groups.filter((group) => group.name.toLowerCase().includes(text) || groupTypes(group).toLowerCase().includes(text))
}

// Returns the interface types of a group as text, such as "Cover · Flat Panel", or INDI_DEVICE_LABEL for a
// device no interface manages.
export function groupTypes(group: DeviceGroup) {
	return group.primary ? group.devices.map((device) => DEVICE_TYPE_LABELS[device.type]).join(' · ') : INDI_DEVICE_LABEL
}

// Returns whether a group is connected to its hardware: what its main interface reports, or for a device no
// interface manages, what its INDI CONNECTION vector reports (undefined without one).
export function groupConnected(group: DeviceGroup): boolean | undefined {
	return group.primary ? group.primary.connected : group.indi?.connected
}

// Returns what one interface reports doing, or undefined when it reports nothing in particular.
function interfaceActivity(states: Readonly<ControlStates>, device: DeviceSummary): DeviceActivity | undefined {
	switch (device.type) {
		case 'mount': {
			const mount = deviceStateOf(states, 'mount', device.id)
			if (!mount) return undefined
			if (mount.homing) return { label: 'Homing', tone: 'active' }
			if (mount.parking) return { label: 'Parking', tone: 'active' }
			if (mount.moving) return { label: 'Moving', tone: 'active' }
			if (mount.slewing) return { label: 'Slewing', tone: 'active' }
			if (mount.parked) return { label: 'Parked', tone: 'idle' }
			return mount.tracking ? { label: 'Tracking', tone: 'idle' } : undefined
		}
		case 'focuser':
			return deviceStateOf(states, 'focuser', device.id)?.moving ? { label: 'Moving', tone: 'active' } : undefined
		case 'wheel':
			return deviceStateOf(states, 'wheel', device.id)?.moving ? { label: 'Moving', tone: 'active' } : undefined
		case 'rotator':
			return deviceStateOf(states, 'rotator', device.id)?.moving ? { label: 'Moving', tone: 'active' } : undefined
		case 'dome': {
			const dome = deviceStateOf(states, 'dome', device.id)
			if (!dome) return undefined
			if (dome.homing) return { label: 'Homing', tone: 'active' }
			if (dome.parking) return { label: 'Parking', tone: 'active' }
			if (dome.slewing || dome.moving) return { label: 'Moving', tone: 'active' }
			if (dome.shutterState === 'OPENING' || dome.shutterState === 'CLOSING') return { label: 'Shutter moving', tone: 'active' }
			if (dome.shutterState === 'ERROR') return { label: 'Shutter error', tone: 'warning' }
			return dome.parked ? { label: 'Parked', tone: 'idle' } : undefined
		}
		case 'cover': {
			const cover = deviceStateOf(states, 'cover', device.id)
			if (!cover?.canPark) return undefined
			if (cover.parking) return { label: 'Moving', tone: 'active' }
			return { label: cover.parked ? 'Closed' : 'Open', tone: 'idle' }
		}
		case 'flatPanel':
			return deviceStateOf(states, 'flatPanel', device.id)?.enabled ? { label: 'Light on', tone: 'idle' } : undefined
		case 'guideOutput':
			return deviceStateOf(states, 'guideOutput', device.id)?.pulsing ? { label: 'Pulsing', tone: 'active' } : undefined
		default:
			return undefined
	}
}

// Returns the activity of a physical device: its connection state when it is not connected or a connect
// request is pending, the first motion or condition one of its interfaces reports, Busy while an
// operation holds it, and Connected otherwise; Available for a device no interface manages that defines no
// CONNECTION vector, so its connection is unknown.
export function groupActivity(group: DeviceGroup, states: Readonly<ControlStates>, busy: boolean, pending?: 'connect' | 'disconnect', error?: string): DeviceActivity {
	if (pending) return { label: pending === 'connect' ? 'Connecting' : 'Disconnecting', tone: 'active' }
	if (error) return { label: 'Error', tone: 'warning' }
	const connected = groupConnected(group)
	if (connected === false) return { label: 'Disconnected', tone: 'off' }

	for (const device of group.devices) {
		const activity = interfaceActivity(states, device)
		if (activity && activity.tone !== 'idle') return activity
	}

	if (busy) return { label: 'Busy', tone: 'active' }

	for (const device of group.devices) {
		const activity = interfaceActivity(states, device)
		if (activity) return activity
	}

	return connected ? { label: 'Connected', tone: 'idle' } : { label: 'Available', tone: 'idle' }
}
