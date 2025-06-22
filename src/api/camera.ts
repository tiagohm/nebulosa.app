import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { ConnectionProvider } from './connection'
import { DeviceHandler, type IndiDeviceManager } from './indi'
import type { WebSocketMessageHandler } from './message'
import type { Camera, CameraAdded, CameraRemoved, CameraUpdated } from './types'

// Handler for managing camera devices and their properties
export class CameraHandler extends DeviceHandler<Camera> {
	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {
		super()
	}

	deviceAdded(device: Camera) {
		this.webSocketMessageHandler.send<CameraAdded>({ type: 'camera.add', device })
	}

	deviceUpdated(device: Camera, property: keyof Camera, state?: PropertyState) {
		this.webSocketMessageHandler.send<CameraUpdated>({ type: 'camera.update', device: device.name, property, value: device[property], state })
	}

	deviceRemoved(device: Camera) {
		this.webSocketMessageHandler.send<CameraRemoved>({ type: 'camera.remove', device })
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
			client.sendSwitch({ device: camera.name, name: 'CCD_CAPTURE_FORMAT', elements: { value: true } })
		}
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

	gain(client: IndiClient, camera: Camera, value: number, deviceManager: IndiDeviceManager) {
		const properties = deviceManager.deviceProperties(camera.name)

		if (properties?.CCD_CONTROLS?.elements.Gain) {
			client.sendNumber({ device: camera.name, name: 'CCD_CONTROLS', elements: { Gain: value } })
		} else if (properties?.CCD_GAIN?.elements?.GAIN) {
			client.sendNumber({ device: camera.name, name: 'CCD_GAIN', elements: { GAIN: value } })
		}
	}

	offset(client: IndiClient, camera: Camera, value: number, deviceManager: IndiDeviceManager) {
		const properties = deviceManager.deviceProperties(camera.name)

		if (properties?.CCD_CONTROLS?.elements.Offset) {
			client.sendNumber({ device: camera.name, name: 'CCD_CONTROLS', elements: { Offset: value } })
		} else if (properties?.CCD_OFFSET?.elements?.OFFSET) {
			client.sendNumber({ device: camera.name, name: 'CCD_OFFSET', elements: { OFFSET: value } })
		}
	}
}

// Manager for camera operations
export class CameraManager {
	constructor(
		private readonly handler: CameraHandler,
		private readonly indi: IndiDeviceManager,
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
		this.handler.gain(this.connection.client(), this.get(id), value, this.indi)
	}

	offset(id: string, value: number) {
		this.handler.offset(this.connection.client(), this.get(id), value, this.indi)
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

	return app
}
