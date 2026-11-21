import type { CoverState, DomeState, GuideOutputState, MountState, WheelState } from 'api'
import { mountMotion } from './mountActivity'

// State words of the devices: the one vocabulary the device list, the header of a device, and its controls use, so a
// device reads the same wherever Equipment Control shows it, and an idle mount reads Idle as in the status bar. Every
// word describes what the device reports, never a commanded value.

// Display name of each dome shutter state.
export const SHUTTER_LABELS: Readonly<Record<DomeState['shutterState'], string>> = { UNKNOWN: 'Unknown', OPEN: 'Open', CLOSED: 'Closed', OPENING: 'Opening', CLOSING: 'Closing', ERROR: 'Error' }

// Returns the state of a mount: its motion (mountMotion), otherwise Parked, Tracking, or Idle.
export function mountStateWord(mount: Pick<MountState, 'parking' | 'homing' | 'moving' | 'slewing' | 'parked' | 'tracking'>): string {
	return mountMotion(mount) ?? (mount.parked ? 'Parked' : mount.tracking ? 'Tracking' : 'Idle')
}

// Returns whether a dome reports a motion of its rotation or of its shutter.
export function domeMoving(dome: Pick<DomeState, 'slewing' | 'moving' | 'homing' | 'parking' | 'shutterState'>): boolean {
	return dome.slewing || dome.moving || dome.homing || dome.parking || dome.shutterState === 'OPENING' || dome.shutterState === 'CLOSING'
}

// Returns the state of a dome: its motion by precedence (homing, parking, a manual rotation and its direction, the
// shutter moving, then a slew), otherwise Parked, At home, or Idle. The shutter comes before the slew because drivers
// following ASCOM report slewing while any part of the dome moves, the shutter included.
export function domeStateWord(dome: Pick<DomeState, 'homing' | 'parking' | 'moving' | 'direction' | 'slewing' | 'shutterState' | 'parked' | 'atHome'>): string {
	if (dome.homing) return 'Homing'
	if (dome.parking) return 'Parking'
	if (dome.moving) return dome.direction === 'COUNTER_CLOCKWISE' ? 'Rotating counterclockwise' : 'Rotating clockwise'
	if (dome.shutterState === 'OPENING') return 'Shutter opening'
	if (dome.shutterState === 'CLOSING') return 'Shutter closing'
	if (dome.slewing) return 'Slewing'
	if (dome.parked) return 'Parked'
	return dome.atHome ? 'At home' : 'Idle'
}

// Returns the state of a device whose only motion is a move, such as a focuser, a filter wheel, or a rotator.
export function motionWord(moving: boolean): string {
	return moving ? 'Moving' : 'Idle'
}

// Returns the state of a dust cover: Moving while it opens or closes, otherwise Closed or Open.
export function coverStateWord(cover: Pick<CoverState, 'parking' | 'parked'>): string {
	return cover.parking ? 'Moving' : cover.parked ? 'Closed' : 'Open'
}

// Returns the state of a guide output: Pulsing with the axes that pulse, or Idle.
export function guideOutputStateWord(output: Pick<GuideOutputState, 'pulsing' | 'pulsingNS' | 'pulsingWE'>): string {
	return output.pulsing ? `Pulsing${output.pulsingNS ? ' N/S' : ''}${output.pulsingWE ? ' W/E' : ''}` : 'Idle'
}

// Returns the display name of a 0-based filter wheel slot: its number from 1 and its filter name, if any; a slot
// without a name is "Slot n", never an invented filter.
export function slotLabel(wheel: Pick<WheelState, 'names'>, slot: number): string {
	const name = wheel.names[slot]?.trim()
	return name ? `${slot + 1} · ${name}` : `Slot ${slot + 1}`
}
