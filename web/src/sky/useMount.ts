import { useEffect } from 'react'
import { useRoleDevice } from '../equipment/useEquipment'
import { mountRuntime, watchMount } from './mount'

// React binding of the mount runtime: keeps it following the device the active profile assigns to the
// MOUNT role on its open server connection, for every workspace.

// Follows the active profile's mount while mounted; a profile, connection, or assignment change switches
// the mount followed, and no mount is followed while the role has no device on the watched connection.
export function useWatchMount() {
	const { device, serverId } = useRoleDevice('MOUNT')
	const id = device?.id
	const name = device?.name

	useEffect(() => {
		watchMount(mountRuntime, serverId && id ? { connectionId: serverId, id, name: name ?? '' } : undefined)
	}, [serverId, id, name])
}
