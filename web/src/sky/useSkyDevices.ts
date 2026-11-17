import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { controlRuntime } from '../equipment-control/control'
import { cameraBindingsState, catalogState } from '../equipment/catalog'
import { useRoleDevice } from '../equipment/useEquipment'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import { mountRuntime, watchMount } from './mount'
import { roleSensors, sensorRuntime, watchSensors } from './sensors'

// React bindings of the Sky device runtimes: keep the mount runtime following the device the active
// profile assigns to the MOUNT role, and the sensor runtime following the cameras of its camera roles,
// on its open server connection, for every workspace; and the sensor of each camera role for the field of view.

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

// Follows the sensors of the active profile's main and guide cameras while mounted, the same way.
export function useWatchCameraSensors() {
	const main = useRoleDevice('MAIN_CAMERA')
	const guide = useRoleDevice('GUIDE_CAMERA')
	const mainId = main.serverId && main.device?.id
	const guideId = guide.serverId && guide.device?.id
	const serverId = main.serverId

	useEffect(() => {
		watchSensors(sensorRuntime, { MAIN_CAMERA: serverId && mainId ? { connectionId: serverId, id: mainId } : undefined, GUIDE_CAMERA: serverId && guideId ? { connectionId: serverId, id: guideId } : undefined })
	}, [serverId, mainId, guideId])
}

// Returns the sensor of each camera role of the active profile for the field of view (roleSensors): what its camera
// reports, completed by what the Equipment Catalog declares for it, following the cameras, the profile's Equipment
// Setup, the bindings, and the catalog.
export function useRoleSensors() {
	const setup = activeSetup(activeProfile(useSnapshot(profileState)))
	const devices = { MAIN_CAMERA: setup.MAIN_CAMERA?.id, GUIDE_CAMERA: setup.GUIDE_CAMERA?.id }
	return roleSensors(useSnapshot(sensorRuntime), useSnapshot(controlRuntime), devices, useSnapshot(cameraBindingsState), useSnapshot(catalogState))
}
