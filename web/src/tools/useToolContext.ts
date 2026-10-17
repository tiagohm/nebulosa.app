import { useSnapshot } from 'valtio'
import { resolveCameraView } from '../capture/views'
import { type RoleStatus, roleStatus } from '../equipment/equipment'
import { type EquipmentRole, ROLES } from '../equipment/roles'
import { useWatchedDevices } from '../equipment/useEquipment'
import { activeDocument, imagesState } from '../images/images'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import type { ToolContext } from './availability'

// React binding of the context tool requirements are evaluated against: the real state of every role of
// the active profile on its connection, the camera of the Capture camera view selected last, and whether
// an image is open. It follows profile, connection, and device changes, so availability is never
// computed from a previous profile's equipment.

// Returns the current tool context.
export function useToolContext(): ToolContext {
	const profiles = useSnapshot(profileState)
	const runtime = useWatchedDevices()
	const images = useSnapshot(imagesState)
	const profile = activeProfile(profiles)
	const setup = activeSetup(profile)
	const roles = Object.fromEntries(ROLES.map(({ role }) => [role, roleStatus(setup, role, runtime)])) as Record<EquipmentRole, RoleStatus>
	const camera = resolveCameraView(setup, undefined, profile.settings.capture.activeCamera)
	return { roles, camera: camera && { role: camera, status: roles[camera] }, hasImage: activeDocument(images)?.status === 'ready' }
}
