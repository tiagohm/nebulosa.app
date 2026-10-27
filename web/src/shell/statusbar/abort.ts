import type { ConnectionState } from '../../connection/connection'
import { type ControlRuntime, stopCommand, watchedDeviceState } from '../../equipment-control/control'
import { type DeviceState, roleDevice } from '../../equipment/equipment'
import { activeServerIdOf } from '../../equipment/useEquipment'
import type { NotificationsState } from '../../notifications/notifications'
import type { OperationsState } from '../../operations'
import { activeProfile, activeSetup, type ProfileState } from '../../profile/profile'
import { mountAbortTarget, scopedRunningOperations } from './selectors'

// Abort of the active profile's mount from the status bar. The button is rendered from snapshots, which may be
// a render behind a profile, connection, or role switch, so the click decides again from the live stores and
// sends the stop only to the mount the profile has at that moment. It never stops any other device, and it
// never shows the mount as stopped: its state and operation events remain the evidence.

// Live stores the Abort decides from.
export interface MountAbortStores {
	// Saved connections and the connections the server holds open.
	readonly connections: Pick<ConnectionState, 'connections' | 'servers'>
	// Profiles and the active one.
	readonly profiles: Pick<ProfileState, 'profiles' | 'activeId'>
	// Devices of the watched connection.
	readonly devices: Pick<DeviceState, 'watched' | 'devices'>
	// Control states of the watched connection, which also records a failed stop.
	readonly control: ControlRuntime
	// Operations of the server.
	readonly operations: Pick<OperationsState, 'operations'>
	// State of the event socket.
	readonly notifications: Pick<NotificationsState, 'server'>
}

// Stops the motion of the active profile's mount when it can still be aborted. Does nothing, and resolves false,
// when the profile has no mount, it belongs to another connection than the one mirrored, it is not moving, cannot
// abort, or the event socket is not online. Resolves true when the server confirmed the stop; a refused stop is
// recorded in the control store's errors of the mount.
export async function abortProfileMount(stores: MountAbortStores, request: typeof fetch = fetch): Promise<boolean> {
	const { connections, profiles, devices, control, operations, notifications } = stores
	if (profiles.profiles.length === 0) return false

	const serverId = activeServerIdOf(connections, profiles)
	const mount = serverId !== undefined && devices.watched === serverId ? roleDevice(activeSetup(activeProfile(profiles)), 'MOUNT', devices) : undefined
	const state = watchedDeviceState(control, 'mount', mount)
	const target = mountAbortTarget({ link: notifications.server, serverId, watched: control.watched, mount, state, operations: scopedRunningOperations(operations.operations, serverId) })

	return target ? await stopCommand(control, { type: 'mount', deviceId: target.deviceId, action: 'stop' }, request) : false
}
