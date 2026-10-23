import type { CaptureSnoop, OperationDevice } from 'api'
import { useSnapshot } from 'valtio'
import { captureSnoop } from '../capture/capture'
import { type DeviceView, roleDevice, roleStatus } from '../equipment/equipment'
import { CAMERA_ROLES, type CameraRole, type EquipmentRole, type EquipmentSetup } from '../equipment/roles'
import { type RoleDevice, useWatchedDevices } from '../equipment/useEquipment'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import type { ImageDocument } from './images'

// Equipment a camera tab's operations command: the physical camera of the tab, and the focuser and mount of the
// active profile's equipment setup associated with it. The setup assigns flat roles per connection, with no optical
// train, so the association is a fixed rule: the focuser belongs to the Main Camera, and only that camera's Auto
// Focus moves it; the mount is shared by every camera of the connection, since a nudge holds only the mount. A
// camera without a role has no focuser and snoops nothing into its headers. An operation keeps the devices it
// started with; changing tab or profile never redirects it.

// Equipment of the operations of a camera tab.
export interface CameraOperationContext {
	// Camera of the tab, by its exact connection and device ids.
	readonly camera: OperationDevice
	// Role the camera is assigned in the active equipment setup; absent when it has none.
	readonly role?: CameraRole
	// Focuser Auto Focus moves: the FOCUSER of the setup when the camera is its Main Camera; absent otherwise,
	// meaning the camera has no focuser associated with it.
	readonly focuser?: RoleDevice
	// Mount Mount Nudge moves: the MOUNT of the setup of the camera's connection.
	readonly mount: RoleDevice
	// Devices snooped into the headers of the camera's frames: those of the setup when the camera has a role, none
	// otherwise.
	readonly snoop: CaptureSnoop
}

// Resolves the equipment of the camera tab of a document from the active equipment setup and the devices of the
// watched connection, or undefined for a document that is not a camera tab. A camera of another connection than the
// watched one has no role, and its mount is unavailable.
export function cameraOperationContext(document: Pick<ImageDocument, 'source'> | undefined, setup: Readonly<EquipmentSetup>, runtime: Pick<DeviceView, 'watched' | 'devices' | 'pending' | 'errors'>): CameraOperationContext | undefined {
	if (document?.source.kind !== 'camera') return undefined

	const { connectionId, deviceId } = document.source
	const camera = { connectionId, deviceId }
	const watched = runtime.watched === connectionId
	const resolve = (role: EquipmentRole): RoleDevice => (watched ? { device: roleDevice(setup, role, runtime), serverId: runtime.watched, status: roleStatus(setup, role, runtime) } : { status: 'unavailable' })
	const role = watched ? CAMERA_ROLES.find((role) => setup[role]?.id === deviceId) : undefined
	const context: CameraOperationContext = { camera, mount: resolve('MOUNT'), snoop: role ? captureSnoop(setup) : {} }

	if (!role) return context
	return role === 'MAIN_CAMERA' ? { ...context, role, focuser: resolve('FOCUSER') } : { ...context, role }
}

// Resolves the equipment of the camera tab of a document for the active profile, following its setup and the watched
// devices.
export function useCameraOperationContext(document: Pick<ImageDocument, 'source'> | undefined): CameraOperationContext | undefined {
	const profiles = useSnapshot(profileState)
	const runtime = useWatchedDevices()
	return cameraOperationContext(document, activeSetup(activeProfile(profiles)), runtime)
}
