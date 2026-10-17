import { proxy } from 'valtio'
import { CAMERA_ROLES, type CameraRole, type EquipmentSetup } from '../equipment/roles'
import type { RoleDevice } from '../equipment/useEquipment'
import type { CaptureSettings } from '../profile/profile'
import type { CaptureCamera, CaptureMode, CaptureRoute } from '../shell/route'
import type { ViewerView } from '../viewer/transform'
import { CAPTURE_MODE_DEFINITIONS } from './modes'

// Camera views of the Capture workspace. A camera view is the presentation context of one camera role
// of the active profile's equipment setup: its tab, operational mode, and viewer preferences. It is not
// an operation and not a device connection: the device it shows is resolved from the setup every time,
// so commands target the device actually assigned, and operations never belong to a view. The zoom and
// pan of each view's viewer are kept here in memory only.

// Camera view of each camera role, also its URL path segment.
const CAMERA_VIEWS: Readonly<Record<CameraRole, CaptureCamera>> = { MAIN_CAMERA: 'main', GUIDE_CAMERA: 'guide' }

// Camera of a camera view: its role and the device assigned to it on the active profile's connection,
// whose server connection id and device id identify the physical camera that commands must target.
export interface CameraTarget extends RoleDevice {
	// Camera role the view stands for.
	readonly role: CameraRole
}

// Returns the URL path segment of a camera role's view.
export function cameraView(role: CameraRole): CaptureCamera {
	return CAMERA_VIEWS[role]
}

// Returns the camera role of a view's URL path segment.
export function cameraRole(camera: CaptureCamera): CameraRole {
	return CAMERA_ROLES.find((role) => CAMERA_VIEWS[role] === camera)!
}

// Returns the camera roles with a device assigned in a setup, in tab order. A role whose device is
// unavailable or disconnected keeps its tab; only removing the assignment removes it.
export function cameraTabs(setup: Readonly<EquipmentSetup>): CameraRole[] {
	return CAMERA_ROLES.filter((role) => setup[role] !== undefined)
}

// Returns the camera role whose view is shown: the requested role when assigned, else the role selected
// last when assigned, else the first tab. Undefined when the setup has no camera. Falling back only
// changes what is shown; it never changes the setup or commands a device.
export function resolveCameraView(setup: Readonly<EquipmentSetup>, requested?: CameraRole, active?: CameraRole): CameraRole | undefined {
	const tabs = cameraTabs(setup)
	if (requested && tabs.includes(requested)) return requested
	if (active && tabs.includes(active)) return active
	return tabs[0]
}

// Returns the operational mode selected last in a camera role's view; the camera mode before any.
export function viewMode(capture: CaptureSettings, role: CameraRole): CaptureMode {
	return capture.views[role]?.mode ?? 'camera'
}

// Returns whether the reticle is shown in a camera role's view in a mode: the view's choice, or the
// mode's default overlays.
export function viewReticle(capture: CaptureSettings, role: CameraRole, mode: CaptureMode): boolean {
	return capture.views[role]?.reticle ?? CAPTURE_MODE_DEFINITIONS[mode].overlays.includes('reticle')
}

// Returns the Capture route of a profile: the camera view selected last (or the fallback one) in the
// given mode, else in the mode selected last in that view. Without a camera it opens the main camera
// view, which shows that none is configured.
export function captureRoute(capture: CaptureSettings, setup: Readonly<EquipmentSetup>, mode?: CaptureMode): CaptureRoute {
	const role = resolveCameraView(setup, undefined, capture.activeCamera) ?? 'MAIN_CAMERA'
	return { workspace: 'capture', camera: cameraView(role), mode: mode ?? viewMode(capture, role) }
}

// Zoom and pan of each camera view's viewer, by viewer key, kept in memory while the tab lives so they
// survive switching camera views and workspaces; a view never seen yet is fitted.
export const captureViewerState = proxy<Record<string, ViewerView>>({})

// Returns the key of a camera view's viewer: its camera role and the id of the device assigned to it in
// the setup, so a replaced device starts fitted and shows nothing of the previous one.
export function viewerKey(role: CameraRole, setup: Readonly<EquipmentSetup>): string {
	return `${role}:${setup[role]?.id}`
}
