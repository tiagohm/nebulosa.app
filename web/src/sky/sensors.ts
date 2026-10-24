import type { CameraSensor } from 'api'
import { proxy } from 'valtio'
import { type ControlRuntime, watchedDeviceState } from '../equipment-control/control'
import { CAMERA_ROLES, type CameraRole } from '../equipment/roles'

// Camera sensor runtime of the tab for the Equipment Setup field of view: the devices the active profile assigns to
// the camera roles on its open server connection, whose sensor geometry is the one their camera state reports in the
// control runtime. Each camera is addressed by its server connection id and exact device id, and switching profile or
// connection changes the cameras followed. A camera that reports nothing has no sensor here: the field of view never
// falls back to another camera's or a manual sensor.

// Camera device a role is assigned to.
export interface SensorTarget {
	// Id of the open server connection that provides the camera.
	readonly connectionId: string
	// Exact device id of the camera.
	readonly id: string
}

// Camera sensor runtime state.
export interface SensorRuntime {
	// Followed camera of each camera role; absent for a role without a device on the open connection.
	cameras: Partial<Record<CameraRole, SensorTarget>>
}

// Camera sensor runtime of the tab.
export const sensorRuntime = proxy<SensorRuntime>({ cameras: {} })

// Whether two cameras are the same device of the same connection.
function sameCamera(a: SensorTarget | undefined, b: SensorTarget | undefined) {
	return a?.connectionId === b?.connectionId && a?.id === b?.id
}

// Follows the cameras of the camera roles; a role without a camera is forgotten.
export function watchSensors(runtime: SensorRuntime, targets: Readonly<Partial<Record<CameraRole, SensorTarget>>>) {
	for (const role of CAMERA_ROLES) {
		const target = targets[role]
		if (sameCamera(runtime.cameras[role], target)) continue
		if (target) runtime.cameras[role] = { connectionId: target.connectionId, id: target.id }
		else delete runtime.cameras[role]
	}
}

// Returns the reported sensor of each camera role, for equipmentOptics: the sensor of the camera state the control
// runtime mirrors for the role's camera.
export function liveSensors(runtime: Readonly<SensorRuntime>, control: Pick<ControlRuntime, 'watched' | 'states'>): Partial<Record<CameraRole, CameraSensor>> {
	const sensors: Partial<Record<CameraRole, CameraSensor>> = {}

	for (const role of CAMERA_ROLES) {
		const sensor = watchedDeviceState(control, 'camera', runtime.cameras[role])?.sensor
		if (sensor) sensors[role] = sensor
	}

	return sensors
}
