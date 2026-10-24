import { CameraCommander } from 'nebulosa/src/devices/commanders/camera'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { type ClientResolver, connectedDevice, settle, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { OperationRegistry } from './operations'

// Thermal commands of the cameras of every open connection, over the toolkit's CameraCommander: switching
// the cooler and setting its target temperature. Neither waits for the sensor to reach the target, which
// takes minutes and is reported as camera:capabilities events; the target is never shown as reached. Both
// acquire the camera, so they are refused while an exposure runs: changing the thermal state of a sensor
// that is integrating would leave a frame that looks plausible but cannot be calibrated. Acquisition stays
// in the capture service; nothing here starts or changes an exposure.

// Body of POST /api/connections/:id/cameras/:deviceId/cooler.
export interface CameraCoolerRequest {
	// Whether the cooler is to be on.
	readonly enabled: boolean
}

// Body of POST /api/connections/:id/cameras/:deviceId/temperature.
export interface CameraTemperatureRequest {
	// Target sensor temperature in degrees Celsius.
	readonly value: number
}

// Thermal commands over the cameras of every open connection.
export class CameraCommands {
	// Commander driving the cooling of the cameras.
	readonly #commander: CameraCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations arbitrates every command against the captures.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new CameraCommander(devices.cameras)
	}

	// Switches the cooler. Responds 204 once sent (the new state arrives as a camera:capabilities event);
	// 404, 409 disconnected or capturing, 422 when the cooler cannot be switched.
	async setCooler(connectionId: string, deviceId: string, { enabled }: CameraCoolerRequest): Promise<Response> {
		const camera = this.#available(connectionId, deviceId)
		if (camera instanceof Response) return camera
		if (!camera.hasCoolerControl) return unsupported('The camera cannot switch its cooler')
		return await settle(this.#commander.cooler(this.operations.coordinator, camera, enabled), 'Switching the cooler')
	}

	// Sets the cooling target. Responds 204 once sent; 404, 409 disconnected or capturing, 422 when the
	// camera has no settable target.
	async setTemperature(connectionId: string, deviceId: string, { value }: CameraTemperatureRequest): Promise<Response> {
		const camera = this.#available(connectionId, deviceId)
		if (camera instanceof Response) return camera
		if (!camera.canSetTemperature) return unsupported('The camera cannot set a target temperature')
		return await settle(this.#commander.temperature(this.operations.coordinator, camera, value), 'Setting the target temperature')
	}

	// Returns the connected camera with this id on an open connection, or the response refusing it: 404,
	// 409 disconnected, and 409 with an explanation while a capture or any other operation holds it.
	#available(connectionId: string, deviceId: string): Camera | Response {
		const camera = connectedDevice(this.devices, this.client, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		if (!this.operations.available(camera)) return errorResponse('The camera is busy; cooling changes wait until the exposure ends, so the frame stays calibratable', 409, 'busy')
		return camera
	}
}
