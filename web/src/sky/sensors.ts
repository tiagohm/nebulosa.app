import type { CameraSensor } from 'api'
import { proxy } from 'valtio'
import { type ControlRuntime, watchedDeviceState } from '../equipment-control/control'
import { boundCameraId, type CameraBindingsState, type CatalogCamera, deviceIdCameraId } from '../equipment/catalog'
import { CAMERA_ROLES, type CameraRole } from '../equipment/roles'

// Camera sensor runtime of the tab for the Equipment Setup field of view: the devices the active profile assigns to
// the camera roles on its open server connection, whose sensor geometry is the one their camera state reports in the
// control runtime. Each camera is addressed by its server connection id and exact device id, and switching profile or
// connection changes the cameras followed. What a camera does not report (all of it while it is disconnected) is taken
// from the sensor the Equipment Catalog declares for the camera its device is bound to, the same physical camera
// (roleSensors); the field of view never falls back to another camera's or a manual sensor.

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

// Where the sensor of a camera role comes from: what its device reports, the sensor the Equipment Catalog declares for
// the camera the device is bound to, or the report completed with declared values it lacks.
export type SensorOrigin = 'reported' | 'catalog' | 'completed'

// Sensor of a camera role for the field of view, with where it comes from.
export interface RoleSensor extends CameraSensor {
	// Where its values come from.
	readonly origin: SensorOrigin
	// Name of the camera of the Equipment Catalog whose declared values are used; absent when every value is reported.
	readonly catalogCamera?: string
}

// Returns a value when it is a positive number, else undefined.
function positive(value: number | undefined) {
	return value !== undefined && value > 0 ? value : undefined
}

// Returns the camera of the Equipment Catalog a role's device is bound to: by its connection and id while its server
// connection is open (followed), else by the device id the Equipment Setup keeps, when every binding of a device of that
// id names the same camera; undefined when none does or they disagree.
function roleCameraId(bindings: Pick<CameraBindingsState, 'bindings'>, followed: SensorTarget | undefined, deviceId: string | undefined) {
	if (followed) return boundCameraId(bindings, followed)
	return deviceId === undefined ? undefined : deviceIdCameraId(bindings, deviceId)
}

// Returns the sensor of each camera role for the field of view: what its device reports, each value it does not report
// (every one while it is disconnected or its connection is closed) taken from the sensor the Equipment Catalog declares
// for the camera the device is bound to (roleCameraId, from the device id of each role in `setupDevices`). A role whose
// width or height neither gives has no sensor; a pixel size neither gives is 0, which resolveFraming lists as missing.
export function roleSensors(
	runtime: Readonly<SensorRuntime>,
	control: Pick<ControlRuntime, 'watched' | 'states'>,
	setupDevices: Readonly<Partial<Record<CameraRole, string>>>,
	bindings: Pick<CameraBindingsState, 'bindings'>,
	catalog: { readonly cameras: readonly Pick<CatalogCamera, 'id' | 'name' | 'sensor'>[] },
): Partial<Record<CameraRole, RoleSensor>> {
	const reported = liveSensors(runtime, control)
	const sensors: Partial<Record<CameraRole, RoleSensor>> = {}

	for (const role of CAMERA_ROLES) {
		const live = reported[role]
		const cameraId = roleCameraId(bindings, runtime.cameras[role], setupDevices[role])
		const camera = cameraId === undefined ? undefined : catalog.cameras.find((e) => e.id === cameraId)
		const declared = camera?.sensor
		const width = positive(live?.width) ?? positive(declared?.width)
		const height = positive(live?.height) ?? positive(declared?.height)
		const pixelSize = positive(live?.pixelSize) ?? positive(declared?.pixelSize) ?? 0
		if (!width || !height) continue
		const completed = width !== positive(live?.width) || height !== positive(live?.height) || (pixelSize > 0 && pixelSize !== positive(live?.pixelSize))
		const origin: SensorOrigin = !live ? 'catalog' : completed ? 'completed' : 'reported'
		sensors[role] = { width, height, pixelSize, origin, catalogCamera: origin === 'reported' ? undefined : camera?.name }
	}

	return sensors
}
