import Elysia from 'elysia'
import fs, { mkdir } from 'fs/promises'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Camera } from 'nebulosa/src/indi.device'
import type { CameraManager, DeviceHandler, FocuserManager, GuideOutputManager, MountManager, ThermometerManager, WheelManager } from 'nebulosa/src/indi.manager'
import { formatTemporal, temporalGet, temporalSubtract } from 'nebulosa/src/temporal'
import { join } from 'path'
import { type CameraAdded, type CameraCaptureEvent, type CameraCaptureStart, type CameraRemoved, type CameraUpdated, DEFAULT_CAMERA_CAPTURE_EVENT } from '../shared/types'
import { exposureTimeInMicroseconds, exposureTimeInSeconds } from '../shared/util'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

const MINIMUM_WAITING_TIME = 1000000 // 1s in microseconds

export class CameraHandler implements DeviceHandler<Camera> {
	private readonly tasks = new Map<string, CameraCaptureTask>()

	readonly cache = new Map<string, Buffer>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly camera: CameraManager,
		readonly guideOutput: GuideOutputManager,
		readonly thermometer: ThermometerManager,
		readonly mount: MountManager,
		readonly wheel: WheelManager,
		readonly focuser: FocuserManager,
	) {}

	added(client: IndiClient, device: Camera) {
		this.wsm.send<CameraAdded>('camera:add', { device })
		console.info('camera added:', device.name)
	}

	updated(client: IndiClient, device: Camera, property: keyof Camera, state?: PropertyState) {
		this.wsm.send<CameraUpdated>('camera:update', { device: { name: device.name, [property]: device[property] }, property, state })
		this.tasks.forEach((task) => task.camera === device && task.cameraUpdated(client, device, property, state))
	}

	removed(client: IndiClient, device: Camera) {
		this.wsm.send<CameraRemoved>('camera:remove', { device })
		console.info('camera removed:', device.name)
	}

	blobReceived(client: IndiClient, device: Camera, data: string) {
		this.tasks.forEach((task) => task.blobReceived(client, device, data, this.cache))
	}

	handleCameraCaptureEvent(client: IndiClient, camera: Camera, event: CameraCaptureEvent) {
		this.wsm.send('camera:capture', event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.tasks.delete(camera.name)
			this.camera.disableBlob(client, camera)
		}
	}

	private startExposure(client: IndiClient, camera: Camera, request: CameraCaptureStart) {
		this.camera.enableBlob(client, camera)
		request.width && request.height && this.camera.frame(client, camera, request.x, request.y, request.width, request.height)
		this.camera.frameType(client, camera, request.frameType)
		if (request.frameFormat) this.camera.frameFormat(client, camera, request.frameFormat)
		this.camera.bin(client, camera, request.binX, request.binY)
		this.camera.gain(client, camera, request.gain)
		this.camera.offset(client, camera, request.offset)
		this.camera.startExposure(client, camera, exposureTimeInSeconds(request.exposureTime, request.exposureTimeUnit))
	}

	private stopExposure(client: IndiClient, camera: Camera) {
		this.camera.stopExposure(client, camera)
	}

	startCameraCapture(client: IndiClient, camera: Camera, req: CameraCaptureStart) {
		// Stop any existing task for this camera and remove its handler
		if (this.tasks.has(camera.name)) {
			const task = this.tasks.get(camera.name)!
			task.stop(client)
		}

		// Start a new task for the camera
		const task = new CameraCaptureTask(camera, req, this.startExposure.bind(this), this.stopExposure.bind(this), this.handleCameraCaptureEvent.bind(this))

		this.tasks.set(camera.name, task)
		const mount = req.mount ? this.mount.get(req.mount) : undefined
		const wheel = req.wheel ? this.wheel.get(req.wheel) : undefined
		const focuser = req.focuser ? this.focuser.get(req.focuser) : undefined
		this.camera.snoop(client, camera, ...[mount, wheel, focuser].filter((e) => !!e))
		task.start(client)
	}

	stopCameraCapture(client: IndiClient, device: Camera) {
		this.tasks.get(device.name)?.stop(client)
	}
}

export function camera(camera: CameraManager, capturer: CameraHandler, connection: ConnectionHandler) {
	function cameraFromParams(params: { id: string }) {
		return camera.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/cameras' })
		// Endpoints!
		.get('', () => camera.list())
		.get('/:id', ({ params }) => cameraFromParams(params))
		.post('/:id/cooler', ({ params, body }) => camera.cooler(connection.get(), cameraFromParams(params), body as never))
		.post('/:id/temperature', ({ params, body }) => camera.temperature(connection.get(), cameraFromParams(params), body as never))
		.post('/:id/start', ({ params, body }) => capturer.startCameraCapture(connection.get(), cameraFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => capturer.stopCameraCapture(connection.get(), cameraFromParams(params)))

	return app
}

export class CameraCaptureTask {
	readonly event = structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT)

	private readonly waitingTime: number
	private readonly totalExposureProgress = [0, 0] // remaining, elapsed
	private stopped = false

	constructor(
		readonly camera: Camera,
		private readonly request: CameraCaptureStart,
		private readonly startExposure: (client: IndiClient, camera: Camera, request: CameraCaptureStart) => void,
		private readonly stopExposure: (client: IndiClient, camera: Camera) => void,
		private readonly handleCameraCaptureEvent: (client: IndiClient, camera: Camera, event: CameraCaptureEvent) => void,
	) {
		this.event.loop = request.exposureMode === 'LOOP'
		this.event.device = camera.name
		this.event.count = request.exposureMode === 'SINGLE' ? 1 : request.exposureMode === 'FIXED' ? request.count : Number.MAX_SAFE_INTEGER
		this.event.remainingCount = this.event.count

		this.event.frameExposureTime = exposureTimeInMicroseconds(request.exposureTime, request.exposureTimeUnit)
		this.event.totalExposureTime = this.event.frameExposureTime * this.event.count + exposureTimeInMicroseconds(request.delay, 'SECOND') * (this.event.count - 1)
		this.waitingTime = exposureTimeInMicroseconds(request.delay, 'SECOND')

		this.totalExposureProgress[0] = this.event.loop ? 0 : this.event.totalExposureTime

		this.event.totalProgress.remainingTime = this.totalExposureProgress[0]
	}

	cameraUpdated(client: IndiClient, camera: Camera, property: keyof Camera, state?: PropertyState) {
		if (property === 'exposure') {
			const { exposure } = camera

			const remainingTime = exposureTimeInMicroseconds(exposure.value, 'SECOND')
			const elapsedTime = this.event.frameExposureTime - remainingTime

			if (state === 'Busy') {
				this.event.state = 'EXPOSING'

				if (!this.event.loop) {
					this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
					this.event.totalProgress.progress = Math.max(0, (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100)
				}

				this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
				this.event.frameProgress.remainingTime = remainingTime
				this.event.frameProgress.elapsedTime = elapsedTime
				this.event.frameProgress.progress = Math.max(0, (1 - remainingTime / this.event.frameExposureTime) * 100)
				return this.handleCameraCaptureEvent(client, camera, this.event)
			} else if (state === 'Ok') {
				this.event.state = 'EXPOSURE_FINISHED'
				this.event.frameProgress.remainingTime = 0
				this.event.frameProgress.elapsedTime = this.event.frameExposureTime
				this.event.frameProgress.progress = 100
				this.handleCameraCaptureEvent(client, camera, this.event)

				this.totalExposureProgress[0] -= this.event.frameExposureTime
				this.totalExposureProgress[1] += this.event.frameExposureTime

				// If there are more frames to capture, start the next exposure
				if (!this.stopped && this.event.remainingCount > 0) {
					// Check if we need to wait before the next exposure
					if (this.waitingTime >= MINIMUM_WAITING_TIME) {
						this.event.state = 'WAITING'

						// Wait for the specified waiting time and send progress event
						waitFor(this.waitingTime, (remainingTime) => {
							if (this.stopped) return false

							const elapsedTime = this.waitingTime - remainingTime

							if (!this.event.loop) {
								this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
								this.event.totalProgress.progress = Math.max(0, (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100)
							}

							this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
							this.event.frameProgress.remainingTime = remainingTime
							this.event.frameProgress.elapsedTime = this.waitingTime - remainingTime
							this.event.frameProgress.progress = Math.max(0, (1 - remainingTime / this.waitingTime) * 100)
							this.handleCameraCaptureEvent(client, camera, this.event)

							return true
						})
							.then((ok) => {
								if (ok) {
									// Update total exposure progress
									this.totalExposureProgress[0] -= this.waitingTime
									this.totalExposureProgress[1] += this.waitingTime

									// Start the next exposure
									return this.start(client)
								}
							})
							.catch(console.error)

						// Do nothing if it wasn't stopped
						if (!this.stopped) return
					} else {
						// Start the next exposure
						return this.start(client)
					}
				}
			}

			// If no more frames or was stopped, finish the task
			this.event.state = 'IDLE'
			this.event.totalProgress.remainingTime = 0
			this.event.totalProgress.elapsedTime = 0
			this.event.totalProgress.progress = 0
			this.event.frameProgress.remainingTime = 0
			this.event.frameProgress.elapsedTime = 0
			this.event.frameProgress.progress = 0
			this.event.remainingCount = 0
			this.event.elapsedCount = 0
			this.handleCameraCaptureEvent(client, camera, this.event)
		}
	}

	async blobReceived(client: IndiClient, camera: Camera, data: string, cache: Map<string, Buffer>) {
		if (this.camera.name === camera.name) {
			const bytes = Buffer.from(data, 'base64')

			// Save image
			const name = this.request.autoSave ? formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS') : camera.name
			const path = join(await makePathFor(this.request), `${name}.fit`)
			void Bun.write(path, bytes) // Don't wait for writing to file
			cache.set(camera.name, bytes)

			// Send event
			this.event.savedPath = encodePath(path, camera.name)
			this.handleCameraCaptureEvent(client, camera, this.event)
			this.event.savedPath = undefined
		}
	}

	start(client: IndiClient) {
		if (!this.stopped && this.event.remainingCount > 0) {
			this.event.state = 'EXPOSURE_STARTED'
			this.event.elapsedCount++
			this.event.remainingCount--
			this.event.frameProgress.remainingTime = this.event.frameExposureTime
			this.event.frameProgress.elapsedTime = 0
			this.event.frameProgress.progress = 0
			this.handleCameraCaptureEvent(client, this.camera, this.event)
			this.startExposure(client, this.camera, this.request)
		}
	}

	stop(client: IndiClient) {
		if (this.stopped) return
		this.stopped = true
		this.stopExposure(client, this.camera)
	}
}

export function encodePath(...parts: string[]) {
	parts.forEach((e, i) => e.length && (parts[i] = Buffer.from(e).toString('hex')))
	return `:${parts.join(':')}`
}

export function decodePath(encoded: string) {
	if (encoded[0] !== ':') return [encoded]

	const parts = encoded.substring(1).split(':')
	parts.forEach((e, i) => e.length && (parts[i] = Buffer.from(e, 'hex').toString('utf-8')))
	return parts
}

async function waitFor(us: number, callback: (remaining: number) => boolean) {
	let remaining = us

	if (remaining >= MINIMUM_WAITING_TIME) {
		while (true) {
			if (remaining <= 0) {
				return callback(0)
			} else if (!callback(remaining)) {
				return false
			}

			// Sleep for 1 second
			await Bun.sleep(1000)

			// Subtract 1 second from remaining time
			remaining -= 1000000
		}
	}

	return true
}

async function makePathFor(req: CameraCaptureStart) {
	if (req.autoSave) {
		const savePath = req.savePath && (await fs.exists(req.savePath)) ? req.savePath : Bun.env.capturesDir

		if (req.autoSubFolderMode === 'OFF') return savePath

		const now = Date.now()
		const hour = temporalGet(now, 'h')
		const directory = req.autoSubFolderMode === 'MIDNIGHT' || hour < 12 ? formatTemporal(now, 'YYYY-MM-DD') : formatTemporal(temporalSubtract(now, 12, 'h'), 'YYYY-MM-DD')
		const path = join(savePath, directory)
		await mkdir(path, { recursive: true })
		return path
	}

	return Bun.env.capturesDir
}
