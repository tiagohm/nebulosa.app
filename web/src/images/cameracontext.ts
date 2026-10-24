import type { CaptureSnoop, OperationDevice } from 'api'
import { useSnapshot } from 'valtio'
import { captureSnoop } from '../camera/capture'
import { type DeviceView, roleDevice, roleStatus } from '../equipment/equipment'
import { CAMERA_ROLES, type CameraRole, type EquipmentRole, type EquipmentSetup } from '../equipment/roles'
import { type RoleDevice, useWatchedDevices } from '../equipment/useEquipment'
import { activeProfile, activeSetup, profileCamera, profileState } from '../profile/profile'
import type { CameraIdentity, Profile } from '../profile/schema'
import type { ImageDocument } from './images'

// Equipment a camera tab's operations command: the physical camera of the tab, and the focuser, mount, filter wheel,
// flat panel, and cover of the active profile's equipment setup associated with it. The setup assigns flat roles per
// connection, with no optical train, so the association is a fixed rule: the focuser belongs to the Main Camera, and
// only that camera's Auto Focus moves it; the mount is shared by every camera of the connection, since a nudge holds
// only the mount; the wheel, the panel, and the cover belong to any camera with a role, and never to one without,
// which takes its flats with manual filters and light and leaves the cover as it is. A camera without a role has no
// focuser and snoops nothing into its headers. The forms of the camera are those of the physical camera in the active
// profile. An operation keeps the devices it started with; changing tab or profile never redirects it.

// Equipment of the operations of a camera tab.
export interface CameraOperationContext {
	// Camera of the tab, by its exact connection and device ids.
	readonly camera: OperationDevice
	// Camera of the tab as the watched connection lists it, and its state.
	readonly device: RoleDevice
	// Camera whose forms the operations edit in the active profile; absent when the camera is not on the profile's
	// connection.
	readonly settings?: CameraIdentity
	// Role the camera is assigned in the active equipment setup; absent when it has none.
	readonly role?: CameraRole
	// Focuser Auto Focus moves: the FOCUSER of the setup when the camera is its Main Camera; absent otherwise,
	// meaning the camera has no focuser associated with it.
	readonly focuser?: RoleDevice
	// Mount Mount Nudge moves: the MOUNT of the setup of the camera's connection.
	readonly mount: RoleDevice
	// Filter wheel Flat Wizard moves: the FILTER_WHEEL of the setup when the camera has a role; absent otherwise,
	// meaning every filter change is manual.
	readonly wheel?: RoleDevice
	// Flat panel Flat Wizard lights the frames with: the FLAT_PANEL of the setup when the camera has a role; absent
	// otherwise, meaning the light is manual.
	readonly flatPanel?: RoleDevice
	// Dust cover Flat Wizard closes before its frames: the COVER of the setup when the camera has a role; absent otherwise,
	// meaning the cover is left as it is.
	readonly cover?: RoleDevice
	// Devices snooped into the headers of the camera's frames: those of the setup when the camera has a role, none
	// otherwise.
	readonly snoop: CaptureSnoop
}

// Resolves the equipment of the camera tab of a document from the active profile and the devices of the watched
// connection, which is the profile's, or undefined for a document that is not a camera tab. A camera of another
// connection than the watched one has no role, no forms, and its devices are unavailable.
export function cameraOperationContext(document: Pick<ImageDocument, 'source'> | undefined, profile: Pick<Profile, 'connectionId' | 'equipment'>, runtime: Pick<DeviceView, 'watched' | 'devices' | 'pending' | 'errors'>): CameraOperationContext | undefined {
	if (document?.source.kind !== 'camera') return undefined

	const { connectionId, deviceId } = document.source
	const camera = { connectionId, deviceId }
	const watched = runtime.watched === connectionId
	const setup = activeSetup(profile)
	const resolve = (role: EquipmentRole, assignments: Readonly<EquipmentSetup> = setup): RoleDevice => (watched ? { device: roleDevice(assignments, role, runtime), serverId: runtime.watched, status: roleStatus(assignments, role, runtime) } : { status: 'unavailable' })
	// The camera itself resolves as if assigned to a role, so it reports the same states as an assigned device.
	const device = resolve('MAIN_CAMERA', { MAIN_CAMERA: { id: deviceId, name: '' } })
	const role = watched ? CAMERA_ROLES.find((role) => setup[role]?.id === deviceId) : undefined
	const settings = watched ? profileCamera(profile, deviceId) : undefined
	const context: CameraOperationContext = { camera, device, ...(settings && { settings }), mount: resolve('MOUNT'), snoop: role ? captureSnoop(setup) : {} }

	if (!role) return context
	const flats = { wheel: resolve('FILTER_WHEEL'), flatPanel: resolve('FLAT_PANEL'), cover: resolve('COVER') }
	return role === 'MAIN_CAMERA' ? { ...context, role, focuser: resolve('FOCUSER'), ...flats } : { ...context, role, ...flats }
}

// Resolves the equipment of the camera tab of a document for the active profile, following its setup and the watched
// devices.
export function useCameraOperationContext(document: Pick<ImageDocument, 'source'> | undefined): CameraOperationContext | undefined {
	const profiles = useSnapshot(profileState)
	const runtime = useWatchedDevices()
	return cameraOperationContext(document, activeProfile(profiles), runtime)
}
