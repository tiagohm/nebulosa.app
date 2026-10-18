import type { CameraSensor, CameraSensorState, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { CAMERA_ROLES, type CameraRole } from '../equipment/roles'

// Camera sensor runtime of the tab for the Equipment Setup field of view: the sensor geometry reported by
// the devices the active profile assigns to the camera roles on its open server connection. Each camera
// is addressed by its server connection id and exact device id; events of other connections or devices
// are ignored, and switching profile or connection drops what was known. A camera that reports nothing
// has no sensor here: the field of view never falls back to another camera's or a manual sensor.

// Camera device a role is assigned to.
export interface SensorTarget {
	// Id of the open server connection that provides the camera.
	readonly connectionId: string
	// Exact device id of the camera.
	readonly id: string
}

// Followed camera of a role with its latest reported sensor.
export interface RoleSensor extends SensorTarget {
	// Latest sensor geometry; absent while unknown or not reported.
	sensor?: CameraSensor
}

// Camera sensor runtime state.
export interface SensorRuntime {
	// Followed camera of each camera role; absent for a role without a device on the open connection.
	cameras: Partial<Record<CameraRole, RoleSensor>>
}

// Camera sensor runtime of the tab.
export const sensorRuntime = proxy<SensorRuntime>({ cameras: {} })

// Counter of fetches per role; a response is applied only if no later fetch for the role started.
const generations: Record<CameraRole, number> = { MAIN_CAMERA: 0, GUIDE_CAMERA: 0 }

// Whether two cameras are the same device of the same connection.
function sameCamera(a: SensorTarget | undefined, b: SensorTarget | undefined) {
	return a?.connectionId === b?.connectionId && a?.id === b?.id
}

// Fetches the sensor of a role's camera; dropped when the role's camera changed or another fetch started.
async function refreshRole(runtime: SensorRuntime, role: CameraRole, request: typeof fetch) {
	const target = runtime.cameras[role]
	const current = ++generations[role]
	if (!target) return

	try {
		const response = await request(`/api/connections/${encodeURIComponent(target.connectionId)}/cameras/${encodeURIComponent(target.id)}/sensor`)
		const state = response.ok ? ((await response.json()) as CameraSensorState) : undefined
		const camera = runtime.cameras[role]
		if (current === generations[role] && camera && sameCamera(camera, target)) camera.sensor = state?.sensor
	} catch {
		// The server is unreachable; the next socket open refreshes the sensors.
	}
}

// Follows the cameras of the camera roles; a role whose camera changed drops its sensor and fetches the
// new one, and a role without a camera is forgotten.
export function watchSensors(runtime: SensorRuntime, targets: Readonly<Partial<Record<CameraRole, SensorTarget>>>, request: typeof fetch = fetch) {
	for (const role of CAMERA_ROLES) {
		const target = targets[role]
		if (sameCamera(runtime.cameras[role], target)) continue

		if (target) {
			runtime.cameras[role] = { connectionId: target.connectionId, id: target.id }
			void refreshRole(runtime, role, request)
		} else {
			delete runtime.cameras[role]
			generations[role]++
		}
	}
}

// Fetches the sensors of every followed camera, which may have changed while the event socket was closed.
export function refreshSensors(runtime: SensorRuntime, request: typeof fetch = fetch) {
	for (const role of CAMERA_ROLES) void refreshRole(runtime, role, request)
}

// Applies a server event concerning a followed camera: its sensor, its removal, and the closing of its
// connection.
export function handleSensorEvent(runtime: SensorRuntime, event: ServerEvent) {
	for (const role of CAMERA_ROLES) {
		const camera = runtime.cameras[role]
		if (!camera) continue

		if (event.type === 'camera:sensor' && sameCamera(event.state, camera)) camera.sensor = event.state.sensor
		else if (event.type === 'device:removed' && sameCamera(event, camera)) camera.sensor = undefined
		else if (event.type === 'connection:close' && event.id === camera.connectionId) camera.sensor = undefined
	}
}

// Returns the reported sensor of each camera role, for equipmentOptics.
export function liveSensors(runtime: SensorRuntime): Partial<Record<CameraRole, CameraSensor>> {
	const sensors: Partial<Record<CameraRole, CameraSensor>> = {}

	for (const role of CAMERA_ROLES) {
		const sensor = runtime.cameras[role]?.sensor
		if (sensor) sensors[role] = sensor
	}

	return sensors
}
