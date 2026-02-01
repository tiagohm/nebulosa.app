import { mkdir } from 'fs/promises'
import type { IndiClient } from 'nebulosa/src/indi.client'
import { type Camera, CLIENT } from 'nebulosa/src/indi.device'
import type { CameraManager, DeviceHandler, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import { formatTemporal, TIMEZONE, temporalAdd, temporalGet, temporalSubtract } from 'nebulosa/src/temporal'
import { join } from 'path'
import { type CameraAdded, type CameraCaptureEvent, type CameraCaptureStart, type CameraRemoved, type CameraUpdated, DEFAULT_CAMERA_CAPTURE_EVENT } from '../shared/types'
import { exposureTimeInMicroseconds, exposureTimeInSeconds } from '../shared/util'
import { type Endpoints, query, response } from './http'
import type { ImageProcessor } from './image'
import type { WebSocketMessageHandler } from './message'
import type { PHD2Handler } from './phd2'
import { directoryExists, waitFor } from './util'

const MINIMUM_WAITING_TIME = 1000000 // 1s in microseconds

export class CameraHandler implements DeviceHandler<Camera> {
	private readonly tasks = new Map<string, CameraCaptureTask>()
	private readonly events = new Map<string, CameraCaptureEvent>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly imageProcessor: ImageProcessor,
		readonly cameraManager: CameraManager,
		readonly mountManager: MountManager,
		readonly wheelManager: WheelManager,
		readonly focuserManager: FocuserManager,
		readonly rotatorManager: RotatorManager,
		readonly phd2Handler?: PHD2Handler,
	) {
		cameraManager.addHandler(this)
	}

	added(device: Camera) {
		this.wsm.send<CameraAdded>('camera:add', { device })
		console.info('camera added:', device.name)
	}

	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		this.wsm.send<CameraUpdated>('camera:update', { device: { id: camera.id, name: camera.name, [property]: camera[property] }, property, state })
		this.tasks.get(camera.id)?.cameraUpdated(camera, property, state)
	}

	removed(camera: Camera) {
		this.wsm.send<CameraRemoved>('camera:remove', { device: camera })
		console.info('camera removed:', camera.name)
	}

	blobReceived(camera: Camera, data: string) {
		this.tasks.get(camera.id)?.blobReceived(camera, data)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.cameraManager.list(client))
	}

	sendEvent(event: CameraCaptureEvent) {
		this.wsm.send('camera:capture', event)
	}

	private handleCameraCaptureEvent({ camera }: CameraCaptureTask, event: CameraCaptureEvent) {
		this.events.set(camera.id, event)
		this.sendEvent(event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.cameraManager.disableBlob(camera)
			this.tasks.get(camera.id)?.stop()
			this.tasks.delete(camera.id)
		}
	}

	start(camera: Camera, req: CameraCaptureStart, onCameraCaptureEvent?: (event: CameraCaptureEvent) => void) {
		// Stop any existing task for this camera and remove its handler
		if (this.tasks.has(camera.id)) {
			const task = this.tasks.get(camera.id)!
			task.stop()
		}

		// Start a new task for the camera
		const task = new CameraCaptureTask(this, req, camera, (task, event) => {
			this.handleCameraCaptureEvent(task, event)
			onCameraCaptureEvent?.(event)
		})

		this.tasks.set(camera.id, task)
		const client = camera[CLIENT]!

		const mount = req.mount ? this.mountManager.get(client, req.mount) : undefined
		const wheel = req.wheel ? this.wheelManager.get(client, req.wheel) : undefined
		const focuser = req.focuser ? this.focuserManager.get(client, req.focuser) : undefined
		const rotator = req.rotator ? this.rotatorManager.get(client, req.rotator) : undefined
		this.cameraManager.snoop(camera, mount, focuser, wheel, rotator)

		return task.start()
	}

	stop(device: Camera) {
		this.tasks.get(device.id)?.stop()
	}
}

export function camera(cameraHandler: CameraHandler): Endpoints {
	const { cameraManager } = cameraHandler

	function cameraFromParams(req: Bun.BunRequest<string>) {
		return cameraManager.get(query(req).client, req.params.id)!
	}

	return {
		'/cameras': { GET: (req) => response(cameraHandler.list(query(req).client)) },
		'/cameras/:id': { GET: (req) => response(cameraFromParams(req)) },
		'/cameras/:id/cooler': { POST: async (req) => response(cameraManager.cooler(cameraFromParams(req), await req.json())) },
		'/cameras/:id/temperature': { POST: async (req) => response(cameraManager.temperature(cameraFromParams(req), await req.json())) },
		'/cameras/:id/start': { POST: async (req) => response(await cameraHandler.start(cameraFromParams(req), await req.json())) },
		'/cameras/:id/stop': { POST: (req) => response(cameraHandler.stop(cameraFromParams(req))) },
	}
}

export class CameraCaptureTask {
	readonly event = structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT)

	private readonly waitingTime: number
	private readonly totalExposureProgress = [0, 0] // remaining, elapsed
	private readonly aborter = new AbortController()
	private stopped = false

	constructor(
		readonly cameraHandler: CameraHandler,
		readonly request: CameraCaptureStart,
		readonly camera: Camera,
		private readonly handleCameraCaptureEvent: (task: CameraCaptureTask, event: CameraCaptureEvent) => void,
	) {
		this.event.loop = request.exposureMode === 'LOOP'
		this.event.camera = camera.id
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
				return this.handleCameraCaptureEvent(this, this.event)
			} else if (state === 'Ok') {
				this.event.state = 'EXPOSURE_FINISHED'
				this.event.frameProgress.remainingTime = 0
				this.event.frameProgress.elapsedTime = this.event.frameExposureTime
				this.event.frameProgress.progress = 100
				this.handleCameraCaptureEvent(this, this.event)

				this.totalExposureProgress[0] -= this.event.frameExposureTime
				this.totalExposureProgress[1] += this.event.frameExposureTime

				// If there are more frames to capture, start the next exposure
				if (!this.stopped && this.event.remainingCount > 0) {
					// Check if we need to wait before the next exposure
					if (this.waitingTime >= MINIMUM_WAITING_TIME) {
						this.event.state = 'WAITING'

						// Wait for the specified waiting time and send progress event
						waitFor(this.waitingTime / 1000, (remainingTime) => {
							if (this.stopped) return false

							remainingTime *= 1000

							const elapsedTime = this.waitingTime - remainingTime

							if (!this.event.loop) {
								this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
								this.event.totalProgress.progress = Math.max(0, (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100)
							}

							this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
							this.event.frameProgress.remainingTime = remainingTime
							this.event.frameProgress.elapsedTime = this.waitingTime - remainingTime
							this.event.frameProgress.progress = Math.max(0, (1 - remainingTime / this.waitingTime) * 100)
							this.handleCameraCaptureEvent(this, this.event)

							return true
						}).then((success) => {
							if (success) {
								// Update total exposure progress
								this.totalExposureProgress[0] -= this.waitingTime
								this.totalExposureProgress[1] += this.waitingTime

								// Start the next exposure
								return this.start()
							} else {
								// Finish
								this.event.state = 'IDLE'
								this.handleCameraCaptureEvent(this, this.event)
							}
						}, console.error)

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
			this.handleCameraCaptureEvent(this, this.event)
		}
	}

	async blobReceived(camera: Camera, data: string) {
		if (this.camera.id === camera.id) {
			const buffer = Buffer.from(data, 'base64')

			// Save image
			const name = this.request.autoSave ? formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS') : camera.name
			const path = join(await makePathFor(this.request), `${name}.fit`)
			this.cameraHandler.imageProcessor.save(buffer, path, camera)

			if (this.request.autoSave) {
				void Bun.write(path, buffer)
			}

			// Send event
			this.event.savedPath = path
			this.handleCameraCaptureEvent(this, this.event)
			this.event.savedPath = undefined
		}
	}

	startExposure(camera: Camera, request: CameraCaptureStart) {
		const { cameraManager } = this.cameraHandler
		cameraManager.enableBlob(camera)
		request.width && request.height && cameraManager.frame(camera, request.x, request.y, request.width, request.height)
		cameraManager.frameType(camera, request.frameType)
		if (request.frameFormat) cameraManager.frameFormat(camera, request.frameFormat)
		cameraManager.bin(camera, request.binX, request.binY)
		cameraManager.gain(camera, request.gain)
		cameraManager.offset(camera, request.offset)
		cameraManager.transferFormat(camera, 'FITS')
		cameraManager.compression(camera, false)
		cameraManager.startExposure(camera, exposureTimeInSeconds(request.exposureTime, request.exposureTimeUnit))
	}

	stopExposure(camera: Camera) {
		this.cameraHandler.cameraManager.stopExposure(camera)
	}

	async start() {
		if (!this.stopped && this.event.remainingCount > 0) {
			if (this.request.dither && this.cameraHandler.phd2Handler?.isRunning) {
				this.event.state = 'DITHERING'
				this.handleCameraCaptureEvent(this, this.event)
				await this.cameraHandler.phd2Handler.dither(undefined, this.aborter.signal)
			}

			this.event.state = 'EXPOSURE_STARTED'
			this.event.elapsedCount++
			this.event.remainingCount--
			this.event.frameProgress.remainingTime = this.event.frameExposureTime
			this.event.frameProgress.elapsedTime = 0
			this.event.frameProgress.progress = 0
			this.handleCameraCaptureEvent(this, this.event)
			this.startExposure(this.camera, this.request)
		}
	}

	stop() {
		if (this.stopped) return
		this.stopped = true
		this.stopExposure(this.camera)
		this.aborter.abort()
		this.cameraHandler.phd2Handler?.settleDone(false)
	}
}

async function makePathFor(req: CameraCaptureStart) {
	if (req.autoSave) {
		const savePath = req.savePath && (await directoryExists(req.savePath)) ? req.savePath : Bun.env.capturesDir

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
