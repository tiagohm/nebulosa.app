import Elysia from 'elysia'
import fs, { mkdir } from 'fs/promises'
import { type Camera, CLIENT } from 'nebulosa/src/indi.device'
import type { CameraManager, DeviceHandler, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import { formatTemporal, TIMEZONE, temporalAdd, temporalGet, temporalSubtract } from 'nebulosa/src/temporal'
import { join } from 'path'
import { type CameraAdded, type CameraCaptureEvent, type CameraCaptureStart, type CameraRemoved, type CameraUpdated, DEFAULT_CAMERA_CAPTURE_EVENT } from '../shared/types'
import { exposureTimeInMicroseconds, exposureTimeInSeconds } from '../shared/util'
import type { ImageProcessor } from './image'
import type { WebSocketMessageHandler } from './message'

const MINIMUM_WAITING_TIME = 1000000 // 1s in microseconds

export class CameraHandler implements DeviceHandler<Camera> {
	private readonly tasks = new Map<string, CameraCaptureTask>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly imageProcessor: ImageProcessor,
		readonly cameraManager: CameraManager,
		readonly mountManager: MountManager,
		readonly wheelManager: WheelManager,
		readonly focuserManager: FocuserManager,
		readonly rotatorManager: RotatorManager,
	) {}

	added(device: Camera) {
		this.wsm.send<CameraAdded>('camera:add', { device })
		console.info('camera added:', device.name)
	}

	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		this.wsm.send<CameraUpdated>('camera:update', { device: { name: camera.name, [property]: camera[property] }, property, state })
		this.tasks.get(camera.name)?.cameraUpdated(camera, property, state)
	}

	removed(camera: Camera) {
		this.wsm.send<CameraRemoved>('camera:remove', { device: camera })
		console.info('camera removed:', camera.name)
	}

	blobReceived(camera: Camera, data: string) {
		this.tasks.get(camera.name)?.blobReceived(camera, data)
	}

	handleCameraCaptureEvent(camera: Camera, event: CameraCaptureEvent) {
		this.wsm.send('camera:capture', event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.tasks.delete(camera.name)
			this.cameraManager.disableBlob(camera)
		}
	}

	private startExposure(camera: Camera, request: CameraCaptureStart) {
		this.cameraManager.enableBlob(camera)
		request.width && request.height && this.cameraManager.frame(camera, request.x, request.y, request.width, request.height)
		this.cameraManager.frameType(camera, request.frameType)
		if (request.frameFormat) this.cameraManager.frameFormat(camera, request.frameFormat)
		this.cameraManager.bin(camera, request.binX, request.binY)
		this.cameraManager.gain(camera, request.gain)
		this.cameraManager.offset(camera, request.offset)
		this.cameraManager.transferFormat(camera, 'FITS')
		this.cameraManager.compression(camera, false)
		this.cameraManager.startExposure(camera, exposureTimeInSeconds(request.exposureTime, request.exposureTimeUnit))
	}

	private stopExposure(camera: Camera) {
		this.cameraManager.stopExposure(camera)
	}

	startCapture(camera: Camera, req: CameraCaptureStart) {
		// Stop any existing task for this camera and remove its handler
		if (this.tasks.has(camera.name)) {
			const task = this.tasks.get(camera.name)!
			task.stop()
		}

		// Start a new task for the camera
		const task = new CameraCaptureTask(camera, req, this.imageProcessor, this.startExposure.bind(this), this.stopExposure.bind(this), this.handleCameraCaptureEvent.bind(this))

		this.tasks.set(camera.name, task)
		const client = camera[CLIENT]!
		const mount = req.mount ? this.mountManager.get(client, req.mount) : undefined
		const wheel = req.wheel ? this.wheelManager.get(client, req.wheel) : undefined
		const focuser = req.focuser ? this.focuserManager.get(client, req.focuser) : undefined
		const rotator = req.rotator ? this.rotatorManager.get(client, req.rotator) : undefined
		this.cameraManager.snoop(camera, ...[mount, wheel, focuser, rotator].filter((e) => !!e))
		task.start()
	}

	stopCapture(device: Camera) {
		this.tasks.get(device.name)?.stop()
	}
}

export function camera(cameraHandler: CameraHandler) {
	function cameraFromParams(clientId: string, id: string) {
		return cameraHandler.cameraManager.get(clientId, decodeURIComponent(id))!
	}

	const app = new Elysia({ prefix: '/cameras' })
		// Endpoints!
		.get('', ({ query }) => Array.from(cameraHandler.cameraManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => cameraFromParams(query.clientId, params.id))
		.post('/:id/cooler', ({ params, query, body }) => cameraHandler.cameraManager.cooler(cameraFromParams(query.clientId, params.id), body as never))
		.post('/:id/temperature', ({ params, query, body }) => cameraHandler.cameraManager.temperature(cameraFromParams(query.clientId, params.id), body as never))
		.post('/:id/start', ({ params, body, query }) => cameraHandler.startCapture(cameraFromParams(query.clientId, params.id), body as never))
		.post('/:id/stop', ({ params, query }) => cameraHandler.stopCapture(cameraFromParams(query.clientId, params.id)))

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
		private readonly imageProcessor: ImageProcessor,
		private readonly startExposure: (camera: Camera, request: CameraCaptureStart) => void,
		private readonly stopExposure: (camera: Camera) => void,
		private readonly handleCameraCaptureEvent: (camera: Camera, event: CameraCaptureEvent) => void,
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

	cameraUpdated(camera: Camera, property: keyof Camera, state?: PropertyState) {
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
				return this.handleCameraCaptureEvent(camera, this.event)
			} else if (state === 'Ok') {
				this.event.state = 'EXPOSURE_FINISHED'
				this.event.frameProgress.remainingTime = 0
				this.event.frameProgress.elapsedTime = this.event.frameExposureTime
				this.event.frameProgress.progress = 100
				this.handleCameraCaptureEvent(camera, this.event)

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
							this.handleCameraCaptureEvent(camera, this.event)

							return true
						})
							.then((ok) => {
								if (ok) {
									// Update total exposure progress
									this.totalExposureProgress[0] -= this.waitingTime
									this.totalExposureProgress[1] += this.waitingTime

									// Start the next exposure
									return this.start()
								}
							})
							.catch(console.error)

						// Do nothing if it wasn't stopped
						if (!this.stopped) return
					} else {
						// Start the next exposure
						return this.start()
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
			this.handleCameraCaptureEvent(camera, this.event)
		}
	}

	async blobReceived(camera: Camera, data: string) {
		if (this.camera.name === camera.name) {
			const buffer = Buffer.from(data, 'base64')

			// Save image
			const name = this.request.autoSave ? formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS') : camera.name
			const path = join(await makePathFor(this.request), `${name}.fit`)
			this.imageProcessor.save(buffer, path, camera.name)

			if (this.request.autoSave) {
				void Bun.write(path, buffer)
			}

			// Send event
			this.event.savedPath = path
			this.handleCameraCaptureEvent(camera, this.event)
			this.event.savedPath = undefined
		}
	}

	start() {
		if (!this.stopped && this.event.remainingCount > 0) {
			this.event.state = 'EXPOSURE_STARTED'
			this.event.elapsedCount++
			this.event.remainingCount--
			this.event.frameProgress.remainingTime = this.event.frameExposureTime
			this.event.frameProgress.elapsedTime = 0
			this.event.frameProgress.progress = 0
			this.handleCameraCaptureEvent(this.camera, this.event)
			this.startExposure(this.camera, this.request)
		}
	}

	stop() {
		if (this.stopped) return
		this.stopped = true
		this.stopExposure(this.camera)
	}
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

		const now = temporalAdd(Date.now(), TIMEZONE, 'm')
		const hour = temporalGet(now, 'h')
		const directory = req.autoSubFolderMode === 'MIDNIGHT' || hour < 12 ? formatTemporal(now, 'YYYY-MM-DD') : formatTemporal(temporalSubtract(now, 12, 'h'), 'YYYY-MM-DD')
		const path = join(savePath, directory)
		await mkdir(path, { recursive: true })
		return path
	}

	return Bun.env.capturesDir
}
