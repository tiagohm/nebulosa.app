import Elysia from 'elysia'
import fs, { mkdir } from 'fs/promises'
import { dateNow } from 'nebulosa/src/datetime'
import type { CfaPattern } from 'nebulosa/src/image'
import type { DefBlobVector, DefNumber, DefNumberVector, DefSwitchVector, DefTextVector, IndiClient, OneNumber, PropertyState, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import { join } from 'path'
import bus from '../shared/bus'
import { type Camera, type CameraAdded, type CameraCaptureStart, type CameraCaptureTaskEvent, type CameraRemoved, type CameraUpdated, DEFAULT_CAMERA, DEFAULT_CAMERA_CAPTURE_TASK_EVENT, type FrameType, type Mount } from '../shared/types'
import { exposureTimeInMicroseconds, exposureTimeInSeconds } from '../shared/util'
import type { ConnectionManager } from './connection'
import type { GuideOutputManager } from './guideoutput'
import { addProperty, ask, DeviceInterfaceType, enableBlob, handleConnection, isInterfaceType } from './indi'
import type { WebSocketMessageManager } from './message'
import type { MountManager } from './mount'
import type { ThermometerManager } from './thermometer'

const MINIMUM_WAITING_TIME = 1000000 // 1s in microseconds

export function cooler(client: IndiClient, camera: Camera, value: boolean) {
	if (camera.hasCoolerControl && camera.cooler !== value) {
		client.sendSwitch({ device: camera.name, name: 'CCD_COOLER', elements: { [value ? 'COOLER_ON' : 'COOLER_OFF']: true } })
	}
}

export function temperature(client: IndiClient, camera: Camera, value: number) {
	if (camera.canSetTemperature) {
		client.sendNumber({ device: camera.name, name: 'CCD_TEMPERATURE', elements: { CCD_TEMPERATURE_VALUE: value } })
	}
}

export function frameFormat(client: IndiClient, camera: Camera, value: string) {
	if (value && camera.frameFormats.includes(value)) {
		client.sendSwitch({ device: camera.name, name: 'CCD_CAPTURE_FORMAT', elements: { [value]: true } })
	}
}

export function frameType(client: IndiClient, camera: Camera, value: FrameType) {
	client.sendSwitch({ device: camera.name, name: 'CCD_FRAME_TYPE', elements: { [`FRAME_${value}`]: true } })
}

export function frame(client: IndiClient, camera: Camera, X: number, Y: number, WIDTH: number, HEIGHT: number) {
	if (camera.canSubFrame) {
		client.sendNumber({ device: camera.name, name: 'CCD_FRAME', elements: { X, Y, WIDTH, HEIGHT } })
	}
}

export function bin(client: IndiClient, camera: Camera, x: number, y: number) {
	if (camera.canBin) {
		client.sendNumber({ device: camera.name, name: 'CCD_BINNING', elements: { HOR_BIN: x, VER_BIN: y } })
	}
}

export function gain(client: IndiClient, camera: Camera, value: number) {
	const properties = camera.properties

	if (properties?.CCD_CONTROLS?.elements.Gain) {
		client.sendNumber({ device: camera.name, name: 'CCD_CONTROLS', elements: { Gain: value } })
	} else if (properties?.CCD_GAIN?.elements?.GAIN) {
		client.sendNumber({ device: camera.name, name: 'CCD_GAIN', elements: { GAIN: value } })
	}
}

export function offset(client: IndiClient, camera: Camera, value: number) {
	const properties = camera.properties

	if (properties?.CCD_CONTROLS?.elements.Offset) {
		client.sendNumber({ device: camera.name, name: 'CCD_CONTROLS', elements: { Offset: value } })
	} else if (properties?.CCD_OFFSET?.elements?.OFFSET) {
		client.sendNumber({ device: camera.name, name: 'CCD_OFFSET', elements: { OFFSET: value } })
	}
}

export function startExposure(client: IndiClient, camera: Camera, exposureTimeInSeconds: number) {
	client.sendSwitch({ device: camera.name, name: 'CCD_COMPRESSION', elements: { INDI_DISABLED: true } })
	client.sendSwitch({ device: camera.name, name: 'CCD_TRANSFER_FORMAT', elements: { FORMAT_FITS: true } })
	client.sendNumber({ device: camera.name, name: 'CCD_EXPOSURE', elements: { CCD_EXPOSURE_VALUE: exposureTimeInSeconds } })
}

export function stopExposure(client: IndiClient, camera: Camera) {
	client.sendSwitch({ device: camera.name, name: 'CCD_ABORT_EXPOSURE', elements: { ABORT: true } })
}

export function snoop(client: IndiClient, camera: Camera, mount?: Mount) {
	client.sendText({ device: camera.name, name: 'ACTIVE_DEVICES', elements: { ACTIVE_TELESCOPE: mount?.name ?? '', ACTIVE_ROTATOR: '', ACTIVE_FOCUSER: '', ACTIVE_FILTER: '' } })
}

// Manager for handling camera-related operations
export class CameraManager {
	private readonly cameras = new Map<string, Camera>()
	private readonly tasks = new Map<string, CameraCaptureTask>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly connection: ConnectionManager,
		readonly guideOutput: GuideOutputManager,
		readonly thermometer: ThermometerManager,
		readonly mount: MountManager,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all cameras associated with the client
			this.cameras.forEach((device) => this.remove(device))
		})
	}

	// Handles incoming switch vector messages.
	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.cameras.get(message.device)

		if (!device) return

		// Add the property to the device
		addProperty(device, message, tag)

		switch (message.name) {
			case 'CONNECTION':
				if (handleConnection(client, device, message)) {
					this.update(device, 'connected', message.state)

					if (!device.connected) {
						this.guideOutput.remove(device)
						this.thermometer.remove(device)
					}
				}

				return
			case 'CCD_COOLER': {
				if (tag[0] === 'd') {
					if (!device.hasCoolerControl) {
						device.hasCoolerControl = true
						this.update(device, 'hasCoolerControl', message.state)
					}
				}

				const cooler = message.elements.COOLER_ON?.value === true

				if (cooler !== device.cooler) {
					device.cooler = cooler
					this.update(device, 'cooler', message.state)
				}

				return
			}
			case 'CCD_CAPTURE_FORMAT':
				if (tag[0] === 'd') {
					device.frameFormats = Object.keys(message.elements)
					this.update(device, 'frameFormats', message.state)
				}

				return
			case 'CCD_ABORT_EXPOSURE':
				if (tag[0] === 'd') {
					const canAbort = (message as DefSwitchVector).permission !== 'ro'

					if (device.canAbort !== canAbort) {
						device.canAbort = canAbort
						this.update(device, 'canAbort', message.state)
					}
				}

				return
		}
	}

	// Handles incoming number vector messages.
	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.cameras.get(message.device)

		if (!device) return

		// Add the property to the device
		addProperty(device, message, tag)

		switch (message.name) {
			case 'CCD_INFO': {
				const x = message.elements.CCD_PIXEL_SIZE_X?.value ?? 0
				const y = message.elements.CCD_PIXEL_SIZE_Y?.value ?? 0

				if (device.pixelSize.x !== x || device.pixelSize.y !== y) {
					device.pixelSize.x = x
					device.pixelSize.y = y
					this.update(device, 'pixelSize', message.state)
				}

				return
			}
			case 'CCD_EXPOSURE': {
				const value = message.elements.CCD_EXPOSURE_VALUE!
				let update = false

				if (tag[0] === 'd') {
					const { min, max } = value as DefNumber
					device.exposure.min = min
					device.exposure.max = max
					update = true
				}

				if (message.state && message.state !== device.exposure.state) {
					device.exposure.state = message.state
					update = true
				}

				if (device.exposure.state === 'Busy' || device.exposure.state === 'Ok') {
					device.exposure.time = value.value
					update = true
				}

				if (update) {
					this.update(device, 'exposure', message.state)
				}

				return
			}
			case 'CCD_COOLER_POWER': {
				const coolerPower = message.elements.CCD_COOLER_POWER?.value ?? 0

				if (device.coolerPower !== coolerPower) {
					device.coolerPower = coolerPower
					this.update(device, 'coolerPower', message.state)
				}

				return
			}
			case 'CCD_TEMPERATURE':
				if (tag[0] === 'd') {
					if (!device.hasCooler) {
						device.hasCooler = true
						this.update(device, 'hasCooler', message.state)
					}

					const canSetTemperature = (message as DefNumberVector).permission !== 'ro'

					if (device.canSetTemperature !== canSetTemperature) {
						device.canSetTemperature = canSetTemperature
						this.update(device, 'canSetTemperature', message.state)
					}

					if (!device.hasThermometer) {
						device.hasThermometer = true
						this.update(device, 'hasThermometer', message.state)
						this.thermometer.add(device)
					}
				}

				return
			case 'CCD_FRAME': {
				const x = message.elements.X!
				const y = message.elements.Y!
				const width = message.elements.WIDTH!
				const height = message.elements.HEIGHT!

				let update = false

				if (tag[0] === 'd') {
					const canSubFrame = (message as DefNumberVector).permission !== 'ro'

					if (device.canSubFrame !== canSubFrame) {
						device.canSubFrame = canSubFrame
						this.update(device, 'canSubFrame', message.state)
					}

					device.frame.minX = (x as DefNumber).min
					device.frame.maxX = (x as DefNumber).max
					device.frame.minY = (y as DefNumber).min
					device.frame.maxY = (y as DefNumber).max
					device.frame.minWidth = (width as DefNumber).min
					device.frame.maxWidth = (width as DefNumber).max
					device.frame.minHeight = (height as DefNumber).min
					device.frame.maxHeight = (height as DefNumber).max

					update = true
				}

				if (update || device.frame.x !== x.value || device.frame.y !== y.value || device.frame.width !== width.value || device.frame.height !== height.value) {
					device.frame.x = x.value
					device.frame.y = y.value
					device.frame.width = width.value
					device.frame.height = height.value
					update = true
				}

				if (update) {
					this.update(device, 'frame', message.state)
				}

				return
			}
			case 'CCD_BINNING': {
				const binX = message.elements.HOR_BIN!
				const binY = message.elements.VER_BIN!

				if (tag[0] === 'd') {
					const canBin = (message as DefNumberVector).permission !== 'ro'

					if (device.canBin !== canBin) {
						device.canBin = canBin
						this.update(device, 'canBin', message.state)
					}

					device.bin.maxX = (binX as DefNumber).max
					device.bin.maxY = (binY as DefNumber).max
				}

				device.bin.x = binX.value
				device.bin.y = binY.value

				this.update(device, 'bin', message.state)

				return
			}
			// ZWO ASI, SVBony, etc
			case 'CCD_CONTROLS': {
				const gain = message.elements.Gain

				if (gain && handleGain(device.gain, gain, tag)) {
					this.update(device, 'gain', message.state)
				}

				const offset = message.elements.Offset

				if (offset && handleOffset(device.offset, offset, tag)) {
					this.update(device, 'offset', message.state)
				}

				return
			}
			// CCD Simulator
			case 'CCD_GAIN': {
				const gain = message.elements.GAIN

				if (gain && handleGain(device.gain, gain, tag)) {
					this.update(device, 'gain', message.state)
				}

				return
			}
			case 'CCD_OFFSET': {
				const offset = message.elements.OFFSET

				if (offset && handleOffset(device.offset, offset, tag)) {
					this.update(device, 'offset', message.state)
				}

				return
			}
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE':
				if (tag[0] === 'd') {
					if (!device.canPulseGuide) {
						device.canPulseGuide = true
						this.update(device, 'canPulseGuide', message.state)
						this.guideOutput.add(device)
					}
				}

				return
		}
	}

	// Handles incoming text vector messages.
	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		if (message.name === 'DRIVER_INFO') {
			const type = +message.elements.DRIVER_INTERFACE!.value

			if (isInterfaceType(type, DeviceInterfaceType.CCD)) {
				const executable = message.elements.DRIVER_EXEC!.value
				const version = message.elements.DRIVER_VERSION!.value

				if (!this.cameras.has(message.device)) {
					const camera: Camera = { ...structuredClone(DEFAULT_CAMERA), id: message.device, name: message.device, driver: { executable, version } }
					this.add(camera)
					addProperty(camera, message, tag)
					ask(client, camera)
				}
			} else if (this.cameras.has(message.device)) {
				this.remove(this.cameras.get(message.device)!)
			}

			return
		}

		const device = this.cameras.get(message.device)

		if (!device) return

		// Add the property to the device
		addProperty(device, message, tag)

		switch (message.name) {
			case 'CCD_CFA':
				device.cfa.offsetX = +message.elements.CFA_OFFSET_X!.value
				device.cfa.offsetY = +message.elements.CFA_OFFSET_Y!.value
				device.cfa.type = message.elements.CFA_TYPE!.value as CfaPattern
				this.update(device, 'cfa', message.state)

				return
		}
	}

	// Handles incoming blob vector messages.
	blobVector(client: IndiClient, message: DefBlobVector | SetBlobVector, tag: string) {
		const device = this.cameras.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'CCD1':
				if (tag[0] === 's') {
					const value = message.elements.CCD1?.value

					if (value) {
						this.tasks.forEach((task) => task.blobReceived(device, value))
					} else {
						console.warn(`received empty BLOB for device ${device.name}`)
					}
				}

				return
		}
	}

	// Sends an update for a camera device
	update(device: Camera, property: keyof Camera, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		this.wsm.send<CameraUpdated>({ type: 'camera:update', device: value, property, state })
		bus.emit('camera:update', value)
		this.tasks.forEach((task) => task.cameraUpdated(device, property, state))
	}

	// Adds a camera device
	add(device: Camera) {
		this.cameras.set(device.name, device)
		this.wsm.send<CameraAdded>({ type: 'camera:add', device })
		bus.emit('camera:add', device)
		console.info('camera added:', device.name)
	}

	// Removes a camera device
	remove(device: Camera) {
		if (this.cameras.has(device.name)) {
			this.cameras.delete(device.name)

			// TODO: Call it on deleteProperty
			this.guideOutput.remove(device)
			this.thermometer.remove(device)

			this.wsm.send<CameraRemoved>({ type: 'camera:remove', device })
			bus.emit('camera:remove', device)
			console.info('camera removed:', device.name)
		}
	}

	// Handles the camera capture task event
	handleCameraCaptureTaskEvent(event: CameraCaptureTaskEvent) {
		this.wsm.send(event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.tasks.delete(event.device)
		}
	}

	// Lists all camera devices
	list() {
		return Array.from(this.cameras.values())
	}

	// Gets a camera device by its id
	get(id: string) {
		return this.cameras.get(id)
	}

	startCameraCaptureTask(device: Camera, req: CameraCaptureStart) {
		// Stop any existing task for this camera and remove its handler
		if (this.tasks.has(device.name)) {
			const task = this.tasks.get(device.name)!
			task.stop()
		}

		// Start a new task for the camera
		const client = this.connection.get()
		const task = new CameraCaptureTask(device, req, client, this.handleCameraCaptureTaskEvent.bind(this))
		this.tasks.set(device.name, task)
		const mount = req.mount ? this.mount.get(req.mount) : undefined
		snoop(client, device, mount)
		task.start()
	}

	stopCameraCaptureTask(device: Camera) {
		this.tasks.get(device.name)?.stop()
	}
}

// Endpoints for handling camera-related requests.
export function camera(camera: CameraManager) {
	function cameraFromParams(params: { id: string }) {
		return camera.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/cameras' })
		// Endpoints!
		.get('', () => camera.list())
		.get('/:id', ({ params }) => cameraFromParams(params))
		.post('/:id/cooler', ({ params, body }) => cooler(camera.connection.get(), cameraFromParams(params), body as never))
		.post('/:id/temperature', ({ params, body }) => temperature(camera.connection.get(), cameraFromParams(params), body as never))
		.post('/:id/start', ({ params, body }) => camera.startCameraCaptureTask(cameraFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => camera.stopCameraCaptureTask(cameraFromParams(params)))

	return app
}

// Task that capture one or more frames from camera
export class CameraCaptureTask {
	readonly event = structuredClone(DEFAULT_CAMERA_CAPTURE_TASK_EVENT)

	private readonly waitingTime: number
	private readonly totalExposureProgress = [0, 0] // remaining, elapsed
	private stopped = false

	constructor(
		private readonly camera: Camera,
		private readonly request: CameraCaptureStart,
		private readonly client: IndiClient,
		private readonly handleCameraCaptureTaskEvent: (event: CameraCaptureTaskEvent) => void,
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

	get isStopped() {
		return this.stopped
	}

	cameraUpdated(device: Camera, property: keyof Camera, state?: PropertyState) {
		if (this.camera.name === device.name) {
			if (property === 'exposure') {
				const { exposure } = device

				const remainingTime = exposureTimeInMicroseconds(exposure.time, 'SECOND')
				const elapsedTime = this.event.frameExposureTime - remainingTime

				if (state === 'Busy') {
					this.event.state = 'EXPOSING'

					if (!this.event.loop) {
						this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
						this.event.totalProgress.progress = (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100
					}

					this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
					this.event.frameProgress.remainingTime = remainingTime
					this.event.frameProgress.elapsedTime = elapsedTime
					this.event.frameProgress.progress = (1 - remainingTime / this.event.frameExposureTime) * 100
					return this.handleCameraCaptureTaskEvent(this.event)
				} else if (state === 'Ok') {
					this.event.state = 'EXPOSURE_FINISHED'
					this.event.frameProgress.remainingTime = 0
					this.event.frameProgress.elapsedTime = this.event.frameExposureTime
					this.event.frameProgress.progress = 100
					this.handleCameraCaptureTaskEvent(this.event)

					this.totalExposureProgress[0] -= this.event.frameExposureTime
					this.totalExposureProgress[1] += this.event.frameExposureTime

					if (!this.stopped && this.event.remainingCount > 0) {
						// If there are more frames to capture, start the next exposure
						if (this.waitingTime >= MINIMUM_WAITING_TIME) {
							this.event.state = 'WAITING'

							waitFor(this.waitingTime, this, (remainingTime) => {
								const elapsedTime = this.waitingTime - remainingTime

								if (!this.event.loop) {
									this.event.totalProgress.remainingTime = this.totalExposureProgress[0] - elapsedTime
								}

								this.event.totalProgress.elapsedTime = this.totalExposureProgress[1] + elapsedTime
								this.event.totalProgress.progress = (1 - this.event.totalProgress.remainingTime / this.event.totalExposureTime) * 100
								this.event.frameProgress.remainingTime = remainingTime
								this.event.frameProgress.elapsedTime = this.waitingTime - remainingTime
								this.event.frameProgress.progress = (1 - remainingTime / this.waitingTime) * 100
								this.handleCameraCaptureTaskEvent(this.event)
							})
								.then(() => {
									if (!this.stopped && remainingTime === 0) {
										this.totalExposureProgress[0] -= this.waitingTime
										this.totalExposureProgress[1] += this.waitingTime

										return this.start()
									}
								})
								.catch(console.error)

							if (!this.stopped) return
						} else {
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
				this.handleCameraCaptureTaskEvent(this.event)
			}
		}
	}

	async blobReceived(device: Camera, data: string) {
		if (this.camera.name === device.name) {
			const savePath = await savePathFor(this.request)
			const name = this.request.autoSave ? dateNow().format('YYYYMMDD.HHmmssSSS') : device.name
			const path = join(savePath, `${name}.fit`)
			await Bun.write(path, Buffer.from(data, 'base64'))
			console.info('saved frame to', path)

			this.event.savedPath = path
			this.handleCameraCaptureTaskEvent(this.event)
			this.event.savedPath = undefined
		}
	}

	// Starts the camera exposure
	start() {
		if (this.event.remainingCount > 0) {
			this.event.state = 'EXPOSURE_STARTED'
			this.event.elapsedCount++
			this.event.remainingCount--
			this.event.frameProgress.remainingTime = this.event.frameExposureTime
			this.event.frameProgress.elapsedTime = 0
			this.event.frameProgress.progress = 0
			this.handleCameraCaptureTaskEvent(this.event)

			enableBlob(this.client, this.camera)
			frame(this.client, this.camera, this.request.x, this.request.y, this.request.width, this.request.height)
			frameType(this.client, this.camera, this.request.frameType)
			if (this.request.frameFormat) frameFormat(this.client, this.camera, this.request.frameFormat)
			bin(this.client, this.camera, this.request.binX, this.request.binY)
			gain(this.client, this.camera, this.request.gain)
			offset(this.client, this.camera, this.request.offset)
			startExposure(this.client, this.camera, exposureTimeInSeconds(this.request.exposureTime, this.request.exposureTimeUnit))
		}
	}

	// Stops the camera exposure
	stop() {
		if (this.stopped) return
		this.stopped = true
		stopExposure(this.client, this.camera)
	}
}

// Waits for a specified time and call a callback with the remaining time
async function waitFor(us: number, stop: { readonly isStopped: boolean }, callback: (remaining: number) => void) {
	let remaining = us

	if (remaining >= MINIMUM_WAITING_TIME) {
		while (!stop.isStopped && remaining >= 0) {
			if (remaining <= 0) {
				return callback(0)
			} else {
				callback(remaining)
			}

			await Bun.sleep(1000)

			remaining -= 1000000 // 1s
		}
	}
}

// Handles the gain property of a camera
function handleGain(gain: Camera['gain'], element: DefNumber | OneNumber, tag: string) {
	let update = false

	if (tag[0] === 'd') {
		gain.min = (element as DefNumber).min
		gain.max = (element as DefNumber).max
		update = true
	}

	if (update || gain.value !== element.value) {
		gain.value = element.value
		update = true
	}

	return update
}

// Handles the offset property of a camera
function handleOffset(offset: Camera['offset'], element: DefNumber | OneNumber, tag: string) {
	let update = false

	if (tag[0] === 'd') {
		offset.min = (element as DefNumber).min
		offset.max = (element as DefNumber).max
		update = true
	}

	if (update || offset.value !== element.value) {
		offset.value = element.value
		update = true
	}

	return update
}

async function savePathFor(req: CameraCaptureStart) {
	if (req.autoSave) {
		const savePath = req.savePath && (await fs.exists(req.savePath)) ? req.savePath : Bun.env.capturesDir

		if (req.autoSubFolderMode === 'OFF') return savePath

		const date = dateNow()
		const directory = req.autoSubFolderMode === 'MIDNIGHT' || date.hour() < 12 ? date.format('YYYY-MM-DD') : date.subtract(12, 'h').format('YYYY-MM-dd')
		const path = join(savePath, directory)
		await mkdir(path, { recursive: true })
		return path
	}

	return Bun.env.capturesDir
}
