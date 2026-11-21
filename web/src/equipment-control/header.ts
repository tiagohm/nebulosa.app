import type { DeviceSummary, ManagedDeviceType } from 'api'
import { formatDegrees, formatFixed, formatPercent, formatTemperature } from '../format'
import { formatDeclination, formatRightAscension } from '../sky/format'
import { type ControlStates, deviceStateOf } from './control'
import { DEVICE_TYPE_LABELS, type DeviceGroup } from './groups'
import { coverStateWord, domeMoving, domeStateWord, guideOutputStateWord, motionWord, mountStateWord, SHUTTER_LABELS, slotLabel } from './lexicon'

// What the header of a device in Equipment Control shows besides its name: the one live reading of its main
// interface, large enough to read at arm's length, the stops of the motions its interfaces report, so stopping a
// device is always in the same place and never shifts the controls below, and why disconnecting it deserves a
// confirmation. Everything is computed from the states the server reports.

// Live reading of a device.
export interface Readout {
	// Reading shown large, with its unit, such as "50000 steps" or "Tracking".
	readonly value: string
	// Line that qualifies the reading, such as the coordinate of a mount or the state of a focuser.
	readonly caption?: string
}

// Stop of the motion of one interface of a device.
export interface DeviceStop {
	// Type of the interface stopped, which selects its route.
	readonly type: ManagedDeviceType
	// Exact id of the interface.
	readonly deviceId: string
	// Display name of the interface type, which tells the stops of one device apart.
	readonly label: string
}

// Returns the live reading of an interface, or undefined while its state is not reported or when it has nothing
// worth reading from afar (a camera without a thermometer). focuserOffset is the offset in steps between the reported
// and the logical position of a focuser under an ABSOLUTE backlash compensation; 0 otherwise.
export function readoutOf(device: Pick<DeviceSummary, 'type' | 'id'>, states: Readonly<ControlStates>, focuserOffset: number = 0): Readout | undefined {
	switch (device.type) {
		case 'mount': {
			const mount = deviceStateOf(states, 'mount', device.id)
			return mount && { value: mountStateWord(mount), caption: `RA ${formatRightAscension(mount.rightAscension)} · Dec ${formatDeclination(mount.declination)}` }
		}
		case 'camera': {
			const camera = deviceStateOf(states, 'camera', device.id)
			if (camera?.temperature === undefined) return undefined
			const cooler = camera.cooler
			return { value: formatTemperature(camera.temperature), caption: cooler ? `Sensor · cooler ${cooler.enabled === false ? 'off' : 'on'} at ${formatPercent(cooler.power / 100)}` : 'Sensor' }
		}
		case 'focuser': {
			const focuser = deviceStateOf(states, 'focuser', device.id)
			return focuser && { value: `${focuser.position.value - focuserOffset} steps`, caption: motionWord(focuser.moving) }
		}
		case 'wheel': {
			const wheel = deviceStateOf(states, 'wheel', device.id)
			return wheel && { value: wheel.count > 0 ? slotLabel(wheel, wheel.position) : 'Unknown filter', caption: motionWord(wheel.moving) }
		}
		case 'rotator': {
			const rotator = deviceStateOf(states, 'rotator', device.id)
			return rotator && { value: `${formatFixed(rotator.angle.value, 2)}°`, caption: `Mechanical angle · ${motionWord(rotator.moving)}` }
		}
		case 'dome': {
			const dome = deviceStateOf(states, 'dome', device.id)
			if (!dome) return undefined
			const state = domeStateWord(dome)
			// A shutter in motion is already the state word, so it is not said twice.
			const shutter = dome.hasShutter && !state.startsWith('Shutter') ? ` · shutter ${SHUTTER_LABELS[dome.shutterState].toLowerCase()}` : ''
			return { value: formatDegrees(dome.azimuth.value, 1), caption: `Azimuth · ${state}${shutter}` }
		}
		case 'cover': {
			const cover = deviceStateOf(states, 'cover', device.id)
			return cover && { value: coverStateWord(cover) }
		}
		case 'flatPanel': {
			const panel = deviceStateOf(states, 'flatPanel', device.id)
			return panel && { value: panel.enabled ? 'Light on' : 'Light off', caption: `Brightness ${panel.intensity.value} of ${panel.intensity.min}–${panel.intensity.max}` }
		}
		case 'dewHeater': {
			const heater = deviceStateOf(states, 'dewHeater', device.id)
			return heater?.hasDewHeater ? { value: `${heater.dutyCycle.value}`, caption: `Duty cycle of ${heater.dutyCycle.min}–${heater.dutyCycle.max}` } : undefined
		}
		case 'guideOutput': {
			const output = deviceStateOf(states, 'guideOutput', device.id)
			return output && { value: guideOutputStateWord(output) }
		}
	}
}

// Returns whether an interface reports a motion its driver can stop. A filter wheel has no stop, and a guide pulse
// can always be stopped.
function stoppable(device: Pick<DeviceSummary, 'type' | 'id'>, states: Readonly<ControlStates>): boolean {
	switch (device.type) {
		case 'mount': {
			const mount = deviceStateOf(states, 'mount', device.id)
			return !!mount?.canAbort && (mount.slewing || mount.parking || mount.homing || mount.moving)
		}
		case 'dome': {
			const dome = deviceStateOf(states, 'dome', device.id)
			return !!dome?.canAbort && domeMoving(dome)
		}
		case 'focuser': {
			const focuser = deviceStateOf(states, 'focuser', device.id)
			return !!focuser?.canAbort && focuser.moving
		}
		case 'rotator': {
			const rotator = deviceStateOf(states, 'rotator', device.id)
			return !!rotator?.canAbort && rotator.moving
		}
		case 'cover': {
			const cover = deviceStateOf(states, 'cover', device.id)
			return !!cover?.canAbort && cover.parking
		}
		case 'guideOutput':
			return !!deviceStateOf(states, 'guideOutput', device.id)?.pulsing
		default:
			return false
	}
}

// Returns the stops of a device: one per interface that reports a motion its driver can stop, in interface order.
export function stopsOf(group: Pick<DeviceGroup, 'devices'>, states: Readonly<ControlStates>): readonly DeviceStop[] {
	return group.devices.filter((device) => stoppable(device, states)).map((device) => ({ type: device.type, deviceId: device.id, label: DEVICE_TYPE_LABELS[device.type] }))
}

// Returns what an interface is doing that a disconnection would leave out of reach, as a predicate of its device
// ("is tracking"), or undefined when nothing.
function activityAtRisk(device: Pick<DeviceSummary, 'type' | 'id'>, states: Readonly<ControlStates>): string | undefined {
	switch (device.type) {
		case 'mount': {
			const mount = deviceStateOf(states, 'mount', device.id)
			if (!mount) return undefined
			if (mount.slewing || mount.parking || mount.homing || mount.moving) return `is ${mountStateWord(mount).toLowerCase()}`
			return mount.tracking ? 'is tracking' : undefined
		}
		case 'camera':
			return deviceStateOf(states, 'camera', device.id)?.cooler?.enabled ? 'has its cooler on' : undefined
		case 'dome': {
			const dome = deviceStateOf(states, 'dome', device.id)
			return dome && domeMoving(dome) ? 'is moving' : undefined
		}
		case 'focuser':
			return deviceStateOf(states, 'focuser', device.id)?.moving ? 'is moving' : undefined
		case 'wheel':
			return deviceStateOf(states, 'wheel', device.id)?.moving ? 'is changing filter' : undefined
		case 'rotator':
			return deviceStateOf(states, 'rotator', device.id)?.moving ? 'is moving' : undefined
		case 'cover':
			return deviceStateOf(states, 'cover', device.id)?.parking ? 'is moving' : undefined
		case 'guideOutput':
			return deviceStateOf(states, 'guideOutput', device.id)?.pulsing ? 'is pulsing' : undefined
		default:
			return undefined
	}
}

// Returns why disconnecting a device deserves a confirmation, naming what it would interrupt or leave out of reach:
// the running operation that holds it (operation, its display name), else the first activity one of its interfaces
// reports; undefined when nothing is at stake.
export function disconnectWarningOf(group: Pick<DeviceGroup, 'name' | 'devices'>, states: Readonly<ControlStates>, operation?: string): string | undefined {
	if (operation) return `${operation} is running on ${group.name} and fails once it disconnects. Afterwards, Nebulosa no longer reads or controls it until it is connected again.`
	const activity = group.devices.map((device) => activityAtRisk(device, states)).find(Boolean)
	return activity && `${group.name} ${activity}. Once disconnected, Nebulosa no longer reads or controls it until it is connected again.`
}
