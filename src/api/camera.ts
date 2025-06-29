import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { ConnectionProvider } from './connection'
import { DeviceHandler, type IndiDeviceEventHandler, type IndiDeviceHandler } from './indi'
import type { WebSocketMessageHandler } from './message'
import type { Camera, CameraAdded, CameraCaptureStart, CameraRemoved, CameraUpdated, DeviceType, FrameType } from './types'

// Handler for managing camera devices and their properties
export class CameraHandler extends DeviceHandler<Camera> {
	constructor(
		private readonly webSocketMessageHandler: WebSocketMessageHandler,
		private readonly indi: IndiDeviceHandler,
	) {
		super()
	}

	deviceAdded(device: Camera) {
		this.webSocketMessageHandler.send<CameraAdded>({ type: 'CAMERA_ADD', device })
	}

	deviceUpdated(device: Camera, property: keyof Camera, state?: PropertyState) {
		this.webSocketMessageHandler.send<CameraUpdated>({ type: 'CAMERA_UPDATE', device: { name: device.name, [property]: device[property] }, property, state })
	}

	deviceRemoved(device: Camera) {
		this.webSocketMessageHandler.send<CameraRemoved>({ type: 'CAMERA_REMOVE', device })
	}

	cooler(client: IndiClient, camera: Camera, value: boolean) {
		if (camera.hasCoolerControl && camera.cooler !== value) {
			client.sendSwitch({ device: camera.name, name: 'CCD_COOLER', elements: { [value ? 'COOLER_ON' : 'COOLER_OFF']: true } })
		}
	}

	temperature(client: IndiClient, camera: Camera, value: number) {
		if (camera.canSetTemperature) {
			client.sendNumber({ device: camera.name, name: 'CCD_TEMPERATURE', elements: { CCD_TEMPERATURE_VALUE: value } })
		}
	}

	frameFormat(client: IndiClient, camera: Camera, value: string) {
		if (value && camera.frameFormats.includes(value)) {
			client.sendSwitch({ device: camera.name, name: 'CCD_CAPTURE_FORMAT', elements: { [value]: true } })
		}
	}

	frameType(client: IndiClient, camera: Camera, value: FrameType) {
		client.sendSwitch({ device: camera.name, name: 'CCD_FRAME_TYPE', elements: { [`FRAME_${value}`]: true } })
	}

	frame(client: IndiClient, camera: Camera, X: number, Y: number, WIDTH: number, HEIGHT: number) {
		if (camera.canSubFrame) {
			client.sendNumber({ device: camera.name, name: 'CCD_FRAME', elements: { X, Y, WIDTH, HEIGHT } })
		}
	}

	bin(client: IndiClient, camera: Camera, x: number, y: number) {
		if (camera.canBin) {
			client.sendNumber({ device: camera.name, name: 'CCD_BINNING', elements: { HOR_BIN: x, VER_BIN: y } })
		}
	}

	gain(client: IndiClient, camera: Camera, value: number) {
		const properties = this.indi.deviceProperties(camera.name)

		if (properties?.CCD_CONTROLS?.elements.Gain) {
			client.sendNumber({ device: camera.name, name: 'CCD_CONTROLS', elements: { Gain: value } })
		} else if (properties?.CCD_GAIN?.elements?.GAIN) {
			client.sendNumber({ device: camera.name, name: 'CCD_GAIN', elements: { GAIN: value } })
		}
	}

	offset(client: IndiClient, camera: Camera, value: number) {
		const properties = this.indi.deviceProperties(camera.name)

		if (properties?.CCD_CONTROLS?.elements.Offset) {
			client.sendNumber({ device: camera.name, name: 'CCD_CONTROLS', elements: { Offset: value } })
		} else if (properties?.CCD_OFFSET?.elements?.OFFSET) {
			client.sendNumber({ device: camera.name, name: 'CCD_OFFSET', elements: { OFFSET: value } })
		}
	}

	start(client: IndiClient, camera: Camera, exposureTimeInSeconds: number) {
		client.sendSwitch({ device: camera.name, name: 'CCD_TRANSFER_FORMAT', elements: { FORMAT_FITS: true } })
		client.sendNumber({ device: camera.name, name: 'CCD_EXPOSURE', elements: { CCD_EXPOSURE_VALUE: exposureTimeInSeconds } })
	}

	stop(client: IndiClient, camera: Camera) {
		client.sendSwitch({ device: camera.name, name: 'CCD_ABORT_EXPOSURE', elements: { ABORT: true } })
	}
}

// Manager for camera operations
export class CameraManager {
	private readonly tasks = new Map<string, CameraCaptureTask>()

	constructor(
		private readonly webSocketMessageHandler: WebSocketMessageHandler,
		private readonly handler: CameraHandler,
		private readonly indi: IndiDeviceHandler,
		private readonly connection: ConnectionProvider,
	) {}

	list() {
		return this.indi.cameras()
	}

	get(id: string) {
		return this.indi.camera(id)
	}

	cooler(id: string, value: boolean) {
		this.handler.cooler(this.connection.client(), this.get(id), value)
	}

	temperature(id: string, value: number) {
		this.handler.temperature(this.connection.client(), this.get(id), value)
	}

	frameFormat(id: string, value: string) {
		this.handler.frameFormat(this.connection.client(), this.get(id), value)
	}

	frame(id: string, x: number, y: number, width: number, height: number) {
		this.handler.frame(this.connection.client(), this.get(id), x, y, width, height)
	}

	bin(id: string, x: number, y: number) {
		this.handler.bin(this.connection.client(), this.get(id), x, y)
	}

	gain(id: string, value: number) {
		this.handler.gain(this.connection.client(), this.get(id), value)
	}

	offset(id: string, value: number) {
		this.handler.offset(this.connection.client(), this.get(id), value)
	}

	start(id: string, req: CameraCaptureStart) {
		if (this.tasks.has(id)) return console.warn(`camera capture task for ${id} already exists.`)

		const task = new CameraCaptureTask(this.get(id), req, this.connection.client(), this.handler)
		this.indi.addDeviceHandler('CAMERA', task)
		this.tasks.set(id, task)
		task.start()
	}
}

// Task that capture one or more frames from camera
export class CameraCaptureTask implements IndiDeviceEventHandler<Camera> {
	constructor(
		private readonly camera: Camera,
		private readonly request: CameraCaptureStart,
		private readonly client: IndiClient,
		private readonly handler: CameraHandler,
	) {}

	start() {
		this.handler.frame(this.client, this.camera, this.request.x, this.request.y, this.request.width, this.request.height)
		this.handler.frameType(this.client, this.camera, this.request.frameType)
		this.handler.frameFormat(this.client, this.camera, this.request.frameFormat)
		this.handler.bin(this.client, this.camera, this.request.binX, this.request.binY)
		this.handler.gain(this.client, this.camera, this.request.gain)
		this.handler.offset(this.client, this.camera, this.request.offset)
		this.handler.start(this.client, this.camera, 0)
	}

	deviceAdded(device: Camera, type: DeviceType) {
		// nothing
	}

	deviceUpdated(device: Camera, property: keyof Camera, state?: PropertyState) {
		if (this.camera.id === device.id) {
			//
		}
	}

	deviceRemoved(device: Camera, type: DeviceType) {
		// nothing
	}

	stop() {
		this.handler.stop(this.client, this.camera)
	}
}

// Creates an instance of Elysia with camera endpoints
export function cameras(camera: CameraManager) {
	const app = new Elysia({ prefix: '/cameras' })

	app.get('', () => {
		return camera.list()
	})

	app.get('/:id', ({ params }) => {
		return camera.get(decodeURIComponent(params.id))
	})

	app.post('/:id/start', ({ params, body }) => {
		camera.start(params.id, body as never)
	})

	return app
}
