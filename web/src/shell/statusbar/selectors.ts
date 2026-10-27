import type { DeviceSummary, MountState, OperationKind, OperationRecord } from 'api'
import type { ServerLink } from '../../notifications/notifications'
import { OPERATION_LABELS } from '../../operations'

// Pure view-model selectors of the status bar. Every selector is scoped to the active profile's open server
// connection by exact connection and device ids, so the status bar never shows or commands what belongs to
// another connection, and takes plain data (stores or their snapshots) so it can be tested without React.

// Mount operations that move the mount physically, for which the status bar offers an Abort. The mount stop
// of the server cancels every operation holding the mount before stopping its axes, so it ends each of
// these, nudges and remote-control motions included; TPPA and DARV sessions also hold the mount, but are
// left to their own Stop on purpose, since aborting them from the status bar would end a whole session.
export const MOUNT_MOTIONS: ReadonlySet<OperationKind> = new Set<OperationKind>(['mount.slew', 'mount.goto', 'mount.flip', 'mount.park', 'mount.unpark', 'mount.home', 'mount.findHome', 'mount.nudge', 'mount.remoteMove'])

// Motion and capability fields of a mount state the Abort depends on.
export type MountMotionState = Pick<MountState, 'connected' | 'canAbort' | 'slewing' | 'moving' | 'parking' | 'homing'>

// Device identity the status bar matches operations and states against.
export type ScopedDevice = Pick<DeviceSummary, 'id' | 'connectionId' | 'name'>

// Returns the running operations holding at least one device of the server connection, in start order (Unix
// milliseconds, then operation id); empty without a server connection. Operations without devices are never
// included, since nothing scopes them to a connection.
export function scopedRunningOperations(operations: Readonly<Record<string, OperationRecord>>, serverId: string | undefined): OperationRecord[] {
	if (serverId === undefined) return []

	return Object.values(operations)
		.filter((operation) => operation.state === 'running' && operation.devices.some((device) => device.connectionId === serverId))
		.sort((a, b) => a.startedAt - b.startedAt || (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0))
}

// Most running operations named one by one in the status bar; more are summarized by count.
const MAX_NAMED_OPERATIONS = 2

// Returns running operations as one short line, such as "Mount slew · Camera capture · +1".
export function operationsSummary(running: readonly Pick<OperationRecord, 'kind'>[]) {
	const named = running.slice(0, MAX_NAMED_OPERATIONS).map((operation) => OPERATION_LABELS[operation.kind])
	const more = running.length - named.length
	return more > 0 ? `${named.join(' · ')} · +${more}` : named.join(' · ')
}

// Returns whether a mount is moving: a running motion of MOUNT_MOTIONS holds that exact device, or its driver
// reports a goto or flip, a manual axis motion, parking, or homing, which covers motions started outside the
// application, such as from a hand controller.
export function mountMoving(state: MountMotionState | undefined, operations: readonly OperationRecord[], mount: ScopedDevice): boolean {
	if (state && (state.slewing || state.moving || state.parking || state.homing)) return true
	return operations.some((operation) => operation.state === 'running' && MOUNT_MOTIONS.has(operation.kind) && operation.devices.some((device) => device.connectionId === mount.connectionId && device.deviceId === mount.id))
}

// Inputs that decide whether the profile's mount can be aborted.
export interface MountAbortInput {
	// State of the event socket of the tab; absent before it first opened.
	readonly link: ServerLink | undefined
	// Id of the active profile's open server connection.
	readonly serverId: string | undefined
	// Id of the server connection the control store mirrors.
	readonly watched: string | undefined
	// Device assigned to the profile's MOUNT role on the watched connection.
	readonly mount: ScopedDevice | undefined
	// Control state of that mount, read only while the control store mirrors its connection.
	readonly state: MountMotionState | undefined
	// Running operations of the server connection.
	readonly operations: readonly OperationRecord[]
}

// Mount the status bar may abort.
export interface MountAbortTarget {
	// Exact id of the mount on the watched connection.
	readonly deviceId: string
	// Driver-reported name of the mount.
	readonly name: string
}

// Returns the mount the status bar may abort, or undefined unless every condition holds: the event socket is
// online (a closed socket means the state may be stale), the mount belongs to the active server connection and
// the control store mirrors that same connection, the driver reports it connected and able to abort, and it
// is moving.
export function mountAbortTarget({ link, serverId, watched, mount, state, operations }: MountAbortInput): MountAbortTarget | undefined {
	if (link !== 'online' || !mount || serverId === undefined || mount.connectionId !== serverId || watched !== serverId) return undefined
	if (!state?.connected || !state.canAbort || !mountMoving(state, operations, mount)) return undefined
	return { deviceId: mount.id, name: mount.name }
}

// Failure of a device of the active connection, as listed by the status bar.
export interface DeviceError {
	// Exact id of the device.
	readonly deviceId: string
	// Driver-reported name of the device.
	readonly name: string
	// Message of the failure.
	readonly message: string
}

// Inputs of the device errors of the active connection.
export interface DeviceErrorsInput {
	// Id of the active profile's open server connection.
	readonly serverId: string | undefined
	// Id of the server connection the device store tracks, its devices, and their connect failures by device id.
	readonly devices: { readonly watched?: string; readonly devices: readonly ScopedDevice[]; readonly errors: Readonly<Record<string, string>> }
	// Id of the server connection the control store mirrors and its command failures by device id.
	readonly control: { readonly watched?: string; readonly errors: Readonly<Record<string, string>> }
}

// Returns the failures of the devices of the active server connection, in device list order: connect and
// driver failures of the device store, and refused or failed commands of the control store, each only while
// its store tracks that connection. A device with both shows the command failure, the more recent one.
export function scopedDeviceErrors({ serverId, devices, control }: DeviceErrorsInput): DeviceError[] {
	if (serverId === undefined || devices.watched !== serverId) return []

	const commands = control.watched === serverId ? control.errors : {}
	const errors: DeviceError[] = []

	for (const device of devices.devices) {
		if (device.connectionId !== serverId) continue
		const message = commands[device.id] ?? devices.errors[device.id]
		if (message) errors.push({ deviceId: device.id, name: device.name, message })
	}

	return errors
}
