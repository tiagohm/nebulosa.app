import type { DeviceSummary } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { connectionState, serverOf } from '../connection/connection'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import { deviceState, type DeviceView, type RoleStatus, roleDevice, roleStatus, watchServer } from './equipment'
import type { EquipmentRole } from './roles'

// React bindings of the equipment runtime: keeping the watched server connection in step with the active
// profile, and resolving the device a role is assigned to for the panels that use it.

// Returns the id of the open server connection of the active profile's selected connection.
export function useActiveServerId(): string | undefined {
	const { connections, servers } = useSnapshot(connectionState)
	const profiles = useSnapshot(profileState)
	const connectionId = activeProfile(profiles).connectionId
	return serverOf(
		servers,
		connections.find((c) => c.id === connectionId),
	)?.id
}

// Watches the active profile's server connection while mounted, switching whenever the profile, its
// selected connection, or the server state changes. Leaving a connection never disconnects it.
export function useWatchActiveServer() {
	const serverId = useActiveServerId()

	useEffect(() => {
		watchServer(deviceState, serverId)
	}, [serverId])
}

// Device assigned to a role of the active profile and its state.
export interface RoleDevice {
	// Assigned device, when present on the watched connection.
	readonly device?: DeviceSummary
	// Id of the server connection that commands to the device must target.
	readonly serverId?: string
	// Operational state of the role.
	readonly status: RoleStatus
}

// Resolves the device assigned to a role on the active profile's connection, e.g. MAIN_CAMERA for
// capture or MOUNT for slewing. Commands must target serverId, never another connection.
export function useRoleDevice(role: EquipmentRole): RoleDevice {
	const profiles = useSnapshot(profileState)
	const runtime = useWatchedDevices()
	const setup = activeSetup(activeProfile(profiles))
	return { device: roleDevice(setup, role, runtime), serverId: runtime.watched, status: roleStatus(setup, role, runtime) }
}

// Runtime with no devices, used while the watched connection lags behind the active profile.
const NO_DEVICES: Omit<DeviceView, 'watched' | 'loading'> = { devices: [], pending: {}, errors: {} }

// Returns the device runtime when it tracks the active profile's server connection; otherwise, for the
// render between a profile or connection switch and the watch effect, a runtime with no devices, so a
// previous connection's devices are never shown or commanded as the new one's.
export function useWatchedDevices(): DeviceView {
	const serverId = useActiveServerId()
	const runtime = useSnapshot(deviceState)
	return runtime.watched === serverId ? runtime : { ...NO_DEVICES, watched: serverId, loading: serverId !== undefined }
}
