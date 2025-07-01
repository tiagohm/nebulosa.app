import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import { join } from 'path'
import type { ConnectionProvider } from './connection'
import { DeviceHandler, type IndiDeviceEventHandler, type IndiDeviceHandler } from './indi'
import type { WebSocketMessageHandler } from './message'
import { type Camera, type CameraAdded, type CameraCaptureStart, type CameraCaptureTaskEvent, type CameraRemoved, type CameraUpdated, DEFAULT_CAMERA_CAPTURE_TASK_EVENT, type DeviceType, type FrameType } from './types'
import { exposureTimeInMicroseconds, exposureTimeInSeconds } from './util'

const MINIMUM_WAITING_TIME = 100000 // 100ms in microseconds

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

	connect(client: IndiClient, camera: Camera) {
		this.indi.deviceConnect(client, camera)
	}

	disconnect(client: IndiClient, camera: Camera) {
		this.indi.deviceDisconnect(client, camera)
	}

	enableBlob(client: IndiClient, camera: Camera) {
		this.indi.enableBlob(client, camera)
	}

	disableBlob(client: IndiClient, camera: Camera) {
		this.indi.disableBlob(client, camera)
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

	handleCameraCaptureTaskEvent(event: CameraCaptureTaskEvent) {
		this.webSocketMessageHandler.send(event)
	}
}

// Task that capture one or more frames from camera
export class CameraCaptureTask implements IndiDeviceEventHandler<Camera> {
	readonly event = structuredClone(DEFAULT_CAMERA_CAPTURE_TASK_EVENT)

	private readonly waitingTime: number
	private readonly totalExposureProgress = [0, 0] // remaining, elapsed
	private waitingTimeout?: NodeJS.Timeout

	constructor(
		private readonly camera: Camera,
		private readonly request: CameraCaptureStart,
		private readonly handler: CameraHandler,
		private readonly client: IndiClient,
		private readonly handleCameraCaptureTaskEvent: (event: CameraCaptureTaskEvent) => void = handler.handleCameraCaptureTaskEvent.bind(handler),
	) {
		this.event.device = camera.name
		this.event.count = this.request.exposureMode === 'SINGLE' ? 1 : this.request.exposureMode === 'FIXED' ? this.request.count : Number.MAX_SAFE_INTEGER
		this.event.remainingCount = this.event.count

		this.event.frameExposureTime = exposureTimeInMicroseconds(this.request.exposureTime, this.request.exposureTimeUnit)
		this.event.totalExposureTime = this.event.frameExposureTime * this.event.count + exposureTimeInMicroseconds(this.request.delay, 'SECOND') * (this.event.count - 1)
		this.waitingTime = exposureTimeInMicroseconds(this.request.delay, 'SECOND')

		this.totalExposureProgress[0] = this.request.exposureMode === 'LOOP' ? Number.MAX_SAFE_INTEGER : this.event.totalExposureTime

		this.event.totalProgress.remainingTime = this.totalExposureProgress[0]
	}

	deviceAdded(device: Camera, type: DeviceType) {
		// nothing
	}

	deviceUpdated(device: Camera, property: keyof Camera, state?: PropertyState) {
		if (this.camera.name === device.name) {
			if (property === 'exposure') {
				const { exposure } = device

				const remainingTime = exposureTimeInMicroseconds(exposure.time, 'SECOND')
				const elapsedTime = this.event.frameExposureTime - remainingTime

				if (state === 'Busy') {
					this.event.state = 'EXPOSING'
					this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
					this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
					this.event.totalProgress.progress = (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100
					this.event.frameProgress.remainingTime = remainingTime
					this.event.frameProgress.elapsedTime = elapsedTime
					this.event.frameProgress.progress = (1 - remainingTime / this.event.frameExposureTime) * 100
					this.handleCameraCaptureTaskEvent(this.event)
				} else if (state === 'Ok') {
					this.event.state = 'EXPOSURE_FINISHED'
					this.event.frameProgress.remainingTime = 0
					this.event.frameProgress.elapsedTime = this.event.frameExposureTime
					this.event.frameProgress.progress = 100
					this.handleCameraCaptureTaskEvent(this.event)

					this.totalExposureProgress[0] -= this.event.frameExposureTime
					this.totalExposureProgress[1] += this.event.frameExposureTime

					if (this.event.remainingCount > 0) {
						// If there are more frames to capture, start the next exposure
						if (this.waitingTime >= MINIMUM_WAITING_TIME) {
							this.event.state = 'WAITING'

							this.waitingTimeout = waitFor(this.waitingTime, (remainingTime) => {
								const elapsedTime = this.waitingTime - remainingTime

								this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
								this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
								this.event.totalProgress.progress = (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100
								this.event.frameProgress.remainingTime = remainingTime
								this.event.frameProgress.elapsedTime = this.waitingTime - remainingTime
								this.event.frameProgress.progress = (1 - remainingTime / this.waitingTime) * 100
								this.handleCameraCaptureTaskEvent(this.event)

								if (remainingTime === 0) {
									this.totalExposureProgress[0] -= this.waitingTime
									this.totalExposureProgress[1] += this.waitingTime

									this.start()
								}
							})
						} else {
							this.start()
						}
					} else {
						// If no more frames, finish the task
						this.event.state = 'IDLE'
						this.event.totalProgress.remainingTime = 0
						this.event.totalProgress.elapsedTime = this.totalExposureProgress[1]
						this.event.totalProgress.progress = 100
						this.handleCameraCaptureTaskEvent(this.event)

						// this.handler.disableBlob(this.client, this.camera)
						this.handler.stop(this.client, this.camera)
					}
				} else if (state === 'Alert') {
					this.event.state = 'IDLE'
					this.event.totalProgress.remainingTime = 0
					this.event.totalProgress.elapsedTime = 0
					this.event.totalProgress.progress = 0
					this.event.frameProgress.remainingTime = 0
					this.event.frameProgress.elapsedTime = 0
					this.event.frameProgress.progress = 0
					this.handleCameraCaptureTaskEvent(this.event)

					// Stop the camera if an error occurs
					this.handler.stop(this.client, this.camera)
				}
			}
		}
	}

	deviceRemoved(device: Camera, type: DeviceType) {
		// nothing
	}

	async blobReceived(device: Camera, data: string) {
		if (this.camera.name === device.name) {
			const path = join(Bun.env.capturesDir, device.name, 'capture.fits')
			await Bun.write(path, Buffer.from(data, 'base64'))

			this.event.savedPath = path
			this.handleCameraCaptureTaskEvent(this.event)
			this.event.savedPath = undefined
		}
	}

	start() {
		if (this.event.remainingCount > 0) {
			this.event.state = 'EXPOSURE_STARTED'
			this.event.elapsedCount++
			this.event.remainingCount--
			this.event.frameProgress.remainingTime = this.event.frameExposureTime
			this.event.frameProgress.elapsedTime = 0
			this.event.frameProgress.progress = 0
			this.handleCameraCaptureTaskEvent(this.event)

			this.handler.enableBlob(this.client, this.camera)
			this.handler.frame(this.client, this.camera, this.request.x, this.request.y, this.request.width, this.request.height)
			this.handler.frameType(this.client, this.camera, this.request.frameType)
			if (this.request.frameFormat) this.handler.frameFormat(this.client, this.camera, this.request.frameFormat)
			this.handler.bin(this.client, this.camera, this.request.binX, this.request.binY)
			this.handler.gain(this.client, this.camera, this.request.gain)
			this.handler.offset(this.client, this.camera, this.request.offset)
			this.handler.start(this.client, this.camera, exposureTimeInSeconds(this.request.exposureTime, this.request.exposureTimeUnit))
		}
	}

	stop() {
		clearTimeout(this.waitingTimeout)
		this.waitingTimeout = undefined

		this.handler.stop(this.client, this.camera)
	}
}

// Creates an instance of Elysia with camera endpoints
export function cameras(handler: CameraHandler, indi: IndiDeviceHandler, connection: ConnectionProvider) {
	const app = new Elysia({ prefix: '/cameras' })
	const tasks = new Map<string, CameraCaptureTask>()

	app.get('', () => {
		return indi.cameras()
	})

	app.get('/:id', ({ params }) => {
		return indi.camera(decodeURIComponent(params.id))
	})

	app.post('/:id/start', ({ params, body }) => {
		const camera = indi.camera(decodeURIComponent(params.id))

		// Stop any existing task for this camera and remove its handler
		if (tasks.has(camera.name)) {
			const task = tasks.get(camera.name)!
			task.stop()
			indi.removeDeviceHandler('CAMERA', task)
		}

		// Start a new task for the camera
		const task = new CameraCaptureTask(camera, body as never, handler, connection.client())
		tasks.set(camera.name, task)
		indi.addDeviceHandler('CAMERA', task)
		task.start()
	})

	return app
}

// Waits for a specified time and call a callback with the remaining time
function waitFor(us: number, callback: (remaining: number) => void) {
	let remaining = us

	if (remaining >= MINIMUM_WAITING_TIME) {
		const interval = setInterval(() => {
			if (remaining <= 0) {
				clearInterval(interval)
				return callback(0)
			} else {
				callback(remaining)
			}

			// Decrease remaining time by 100ms (100000 microseconds)
			remaining -= 100000
		}, 100)

		return interval
	}
}
