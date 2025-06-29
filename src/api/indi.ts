import { Elysia } from 'elysia'
import type { CfaPattern } from 'nebulosa/src/image'
// biome-ignore format: too many
import type { DefBlobVector, DefNumber, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, IndiClient, IndiClientHandler, OneNumber, PropertyState, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/indi'
import type { ConnectionProvider } from './connection'
import { deviceNotFound } from './exceptions'
import type { Camera, Device, DeviceType, GuideOutput, Thermometer } from './types'
import { DEFAULT_CAMERA, isCamera, isGuideOutput } from './types'

export enum DeviceInterfaceType {
	TELESCOPE = 0x0001, // Telescope interface, must subclass INDI::Telescope.
	CCD = 0x0002, // CCD interface, must subclass INDI::CCD.
	GUIDER = 0x0004, // Guider interface, must subclass INDI::GuiderInterface.
	FOCUSER = 0x0008, // Focuser interface, must subclass INDI::FocuserInterface.
	FILTER = 0x0010, // Filter interface, must subclass INDI::FilterInterface.
	DOME = 0x0020, // Dome interface, must subclass INDI::Dome.
	GPS = 0x0040, // GPS interface, must subclass INDI::GPS.
	WEATHER = 0x0080, // Weather interface, must subclass INDI::Weather.
	AO = 0x0100, // Adaptive Optics Interface.
	DUSTCAP = 0x0200, // Dust Cap Interface.
	LIGHTBOX = 0x0400, // Light Box Interface.
	DETECTOR = 0x0800, // Detector interface, must subclass INDI::Detector.
	ROTATOR = 0x1000, // Rotator interface, must subclass INDI::RotatorInterface.
	SPECTROGRAPH = 0x2000, // Spectrograph interface.
	CORRELATOR = 0x4000, // Correlators (interferometers) interface.
	AUXILIARY = 0x8000, // Auxiliary interface.
	OUTPUT = 0x10000, // Digital Output (e.g. Relay) interface.
	INPUT = 0x20000, // Digital/Analog Input (e.g. GPIO) interface.
	POWER = 0x40000, // Auxiliary interface.
	SENSOR_INTERFACE = SPECTROGRAPH | DETECTOR | CORRELATOR,
}

// This interface defines the methods that should be implemented by any class that handles INDI device events.
export interface IndiDeviceEventHandler<T extends Device = Device> {
	readonly deviceUpdated: (device: T, property: keyof T & string, state?: PropertyState) => void
	readonly deviceAdded: (device: T, type: DeviceType) => void
	readonly deviceRemoved: (device: T, type: DeviceType) => void
}

// This is an abstract class that provides a base implementation for handling devices in INDI.
export abstract class DeviceHandler<D extends Device = Device> implements IndiDeviceEventHandler<D> {
	readonly devices: D[] = []

	abstract deviceUpdated(device: D, property: keyof D & string, state?: PropertyState): void

	deviceAdded(device: D) {
		this.devices.push(device)
	}

	deviceRemoved(device: D) {
		const index = this.devices.indexOf(device)
		index >= 0 && this.devices.splice(index, 1)
	}
}

interface DeviceHandlerMap {
	readonly CAMERA: IndiDeviceEventHandler<Camera>[]
	readonly THERMOMETER: IndiDeviceEventHandler<Thermometer>[]
	readonly GUIDE_OUTPUT: IndiDeviceEventHandler<GuideOutput>[]
	readonly MOUNT: IndiDeviceEventHandler<Device>[]
	readonly FOCUSER: IndiDeviceEventHandler<Device>[]
	readonly WHEEL: IndiDeviceEventHandler<Device>[]
	readonly ROTATOR: IndiDeviceEventHandler<Device>[]
	readonly GPS: IndiDeviceEventHandler<Device>[]
	readonly DOME: IndiDeviceEventHandler<Device>[]
	readonly LIGHT_BOX: IndiDeviceEventHandler<Device>[]
	readonly DUST_CAP: IndiDeviceEventHandler<Device>[]
	readonly DEW_HEATER: IndiDeviceEventHandler<Device>[]
}

export function isInterfaceType(value: number, type: DeviceInterfaceType) {
	return (value & type) !== 0
}

// This function is used to ask the IndiClient for properties of a specific device.
export function ask(client: IndiClient, device: Device) {
	client.getProperties({ device: device.name })
}

const THERMOMETER_PROPERTIES = ['temperature', 'connected']
const GUIDE_OUTPUT_PROPERTIES = ['pulseGuiding', 'connected']

// Handles all the INDI devices.
export class IndiDeviceHandler implements IndiClientHandler {
	private readonly cameraMap = new Map<string, Camera>()
	private readonly thermometerMap = new Map<string, Thermometer>()
	private readonly guideOutputMap = new Map<string, GuideOutput>()
	private readonly enqueuedMessages: [string, DefVector | SetVector][] = []
	private readonly devicePropertyMap = new Map<string, Record<string, DefVector | undefined>>()
	private readonly rejectedDevices = new Set<string>()

	private readonly handlers: DeviceHandlerMap = {
		CAMERA: [],
		THERMOMETER: [],
		GUIDE_OUTPUT: [],
		MOUNT: [],
		FOCUSER: [],
		WHEEL: [],
		ROTATOR: [],
		GPS: [],
		DOME: [],
		LIGHT_BOX: [],
		DUST_CAP: [],
		DEW_HEATER: [],
	}

	constructor(private readonly connection: ConnectionProvider) {}

	// Adds a handler for a specific device type
	addDeviceHandler<K extends keyof DeviceHandlerMap>(type: K, handler: DeviceHandlerMap[K][number]) {
		this.handlers[type].push(handler as never)
	}

	// Removes a handler for a specific device type
	removeDeviceHandler<K extends keyof DeviceHandlerMap>(type: K, handler: DeviceHandlerMap[K][number]) {
		const handlers = this.handlers[type]
		const index = handlers.indexOf(handler as never)
		index >= 0 && handlers.splice(index, 1)
	}

	close(client: IndiClient, server: boolean) {
		this.connection.disconnect(client)

		this.cameraMap.values().forEach((e) => this.removeCamera(e))
		this.thermometerMap.values().forEach((e) => this.removeThermometer(e))
		this.guideOutputMap.values().forEach((e) => this.removeGuideOutput(e))
		this.enqueuedMessages.length = 0
		this.devicePropertyMap.clear()
		this.rejectedDevices.clear()
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.deviceIfExists(message.device)

		if (!device) {
			this.enqueueMessage(message, tag)
			return
		}

		this.addProperty(device, message, tag)

		switch (message.name) {
			case 'CONNECTION': {
				const connected = message.elements.CONNECT?.value === true

				if (connected !== device.connected) {
					device.connected = connected
					this.deviceUpdated(device, 'connected', message.state)
					if (connected) ask(client, device)
				}

				return
			}
			case 'CCD_COOLER': {
				if (isCamera(device)) {
					if (tag[0] === 'd') {
						device.hasCoolerControl = true
						this.deviceUpdated(device, 'hasCoolerControl', message.state)
					}

					const cooler = message.elements.COOLER_ON?.value === true

					if (cooler !== device.cooler) {
						device.cooler = cooler
						this.deviceUpdated(device, 'cooler', message.state)
					}
				}

				return
			}
			case 'CCD_CAPTURE_FORMAT': {
				if (isCamera(device)) {
					if (tag[0] === 'd') {
						device.frameFormats = Object.keys(message.elements)
						this.deviceUpdated(device, 'frameFormats', message.state)
					}
				}

				return
			}
			case 'CCD_ABORT_EXPOSURE': {
				if (isCamera(device)) {
					if (tag[0] === 'd') {
						const canAbort = (message as DefSwitchVector).permission !== 'ro'
						device.canAbort = canAbort
						this.deviceUpdated(device, 'canAbort', message.state)
					}
				}

				return
			}
		}
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		switch (message.name) {
			case 'DRIVER_INFO': {
				const type = parseInt(message.elements.DRIVER_INTERFACE.value)
				const executable = message.elements.DRIVER_EXEC.value
				const version = message.elements.DRIVER_VERSION.value

				let reject = true

				if (isInterfaceType(type, DeviceInterfaceType.CCD)) {
					reject = false

					if (!this.cameraMap.has(message.device)) {
						const camera: Camera = { ...structuredClone(DEFAULT_CAMERA), id: message.device, name: message.device, driver: { executable, version }, client: this.connection.status(client)! }
						this.cameraMap.set(camera.name, camera)
						this.addProperty(camera, message, tag)
						this.processEnqueuedMessages(client, camera)
						this.fireDeviceAdded(camera, 'CAMERA')
					}
				} else if (this.cameraMap.has(message.device)) {
					const camera = this.cameraMap.get(message.device)!
					this.removeCamera(camera)
				}

				if (reject) {
					this.rejectedDevices.add(message.device)
				}

				return
			}
		}

		const device = this.deviceIfExists(message.device)

		if (!device) {
			this.enqueueMessage(message, tag)
			return
		}

		this.addProperty(device, message, tag)

		switch (message.name) {
			case 'CCD_CFA': {
				if (isCamera(device)) {
					device.cfa.offsetX = parseInt(message.elements.CFA_OFFSET_X.value)
					device.cfa.offsetY = parseInt(message.elements.CFA_OFFSET_Y.value)
					device.cfa.type = message.elements.CFA_TYPE.value as CfaPattern
					this.deviceUpdated(device, 'cfa', message.state)
				}

				return
			}
		}
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.deviceIfExists(message.device)

		if (!device) {
			this.enqueueMessage(message, tag)
			return
		}

		this.addProperty(device, message, tag)

		switch (message.name) {
			case 'CCD_INFO': {
				if (isCamera(device)) {
					const x = message.elements.CCD_PIXEL_SIZE_X?.value ?? 0
					const y = message.elements.CCD_PIXEL_SIZE_Y?.value ?? 0

					if (device.pixelSize.x !== x || device.pixelSize.y !== y) {
						device.pixelSize.x = x
						device.pixelSize.y = y
						this.deviceUpdated(device, 'pixelSize', message.state)
					}
				}

				return
			}
			case 'CCD_EXPOSURE': {
				if (isCamera(device)) {
					const value = message.elements.CCD_EXPOSURE_VALUE
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
						this.deviceUpdated(device, 'exposure', message.state)
					}
				}

				return
			}
			case 'CCD_COOLER_POWER': {
				if (isCamera(device)) {
					const coolerPower = message.elements.CCD_COOLER_POWER?.value ?? 0

					if (device.coolerPower !== coolerPower) {
						device.coolerPower = coolerPower
						this.deviceUpdated(device, 'coolerPower', message.state)
					}
				}

				return
			}
			case 'CCD_TEMPERATURE': {
				if (isCamera(device)) {
					if (tag[0] === 'd') {
						if (!device.hasCooler) {
							device.hasCooler = true
							this.deviceUpdated(device, 'hasCooler', message.state)
						}

						const canSetTemperature = (message as DefNumberVector).permission !== 'ro'

						if (device.canSetTemperature !== canSetTemperature) {
							device.canSetTemperature = canSetTemperature
							this.deviceUpdated(device, 'canSetTemperature', message.state)
						}

						if (!device.hasThermometer) {
							this.addThermometer(device)
						}
					}

					const temperatue = message.elements.CCD_TEMPERATURE_VALUE.value

					if (device.temperature !== temperatue) {
						device.temperature = temperatue
						this.deviceUpdated(device, 'temperature', message.state)
					}
				}

				return
			}
			case 'CCD_FRAME': {
				if (isCamera(device)) {
					const x = message.elements.X
					const y = message.elements.Y
					const width = message.elements.WIDTH
					const height = message.elements.HEIGHT

					let update = false

					if (tag[0] === 'd') {
						const canSubFrame = (message as DefNumberVector).permission !== 'ro'

						if (device.canSubFrame !== canSubFrame) {
							device.canSubFrame = canSubFrame
							this.deviceUpdated(device, 'canSubFrame', message.state)
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
						this.deviceUpdated(device, 'frame', message.state)
					}
				}

				return
			}
			case 'CCD_BINNING': {
				if (isCamera(device)) {
					const binX = message.elements.HOR_BIN
					const binY = message.elements.VER_BIN

					if (tag[0] === 'd') {
						const canBin = (message as DefNumberVector).permission !== 'ro'

						if (device.canBin !== canBin) {
							device.canBin = canBin
							this.deviceUpdated(device, 'canBin', message.state)
						}

						device.bin.maxX = (binX as DefNumber).max
						device.bin.maxY = (binY as DefNumber).max
					}

					device.bin.x = binX.value
					device.bin.y = binY.value

					this.deviceUpdated(device, 'bin', message.state)
				}

				return
			}
			// ZWO ASI, SVBony, etc
			case 'CCD_CONTROLS': {
				if (isCamera(device)) {
					const gain = message.elements.Gain

					if (gain) {
						this.processGain(device.gain, gain, tag)
						this.deviceUpdated(device, 'gain', message.state)
					}

					const offset = message.elements.Offset

					if (offset) {
						this.processOffset(device.offset, offset, tag)
						this.deviceUpdated(device, 'offset', message.state)
					}
				}

				return
			}
			// CCD Simulator
			case 'CCD_GAIN': {
				if (isCamera(device)) {
					const gain = message.elements.GAIN

					if (gain && this.processGain(device.gain, gain, tag)) {
						this.deviceUpdated(device, 'gain', message.state)
					}
				}

				return
			}
			case 'CCD_OFFSET': {
				if (isCamera(device)) {
					const offset = message.elements.OFFSET

					if (offset && this.processOffset(device.offset, offset, tag)) {
						this.deviceUpdated(device, 'offset', message.state)
					}
				}

				return
			}
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE': {
				if (isGuideOutput(device)) {
					if (tag[0] === 'd') {
						if (!device.canPulseGuide) {
							this.addGuideOutput(device)
						}
					} else if (device.canPulseGuide) {
						const pulseGuiding = message.state === 'Busy'

						if (pulseGuiding !== device.pulseGuiding) {
							device.pulseGuiding = pulseGuiding
							this.deviceUpdated(device, 'pulseGuiding', message.state)
						}
					}
				}
			}
		}
	}

	blobVector(client: IndiClient, message: DefBlobVector | SetBlobVector, tag: string) {
		// const device = this.device(message.device)
	}

	deviceIfExists(id: string): Device | undefined {
		return this.cameraMap.get(id) || this.thermometerMap.get(id) || this.guideOutputMap.get(id)
	}

	device(id: string) {
		const device = this.deviceIfExists(id)
		if (!device) throw deviceNotFound('Device')
		return device
	}

	deviceProperties(id: string) {
		return this.devicePropertyMap.get(id)
	}

	deviceConnect(client: IndiClient, device: Device) {
		if (!device.connected) {
			client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { CONNECT: true } })
		}
	}

	deviceDisconnect(client: IndiClient, device: Device) {
		if (device.connected) {
			client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { DISCONNECT: true } })
		}
	}

	enableBlob(client: IndiClient, device: Device) {
		client.enableBlob({ device: device.name, value: 'Also' })
	}

	disableBlob(client: IndiClient, device: Device) {
		client.enableBlob({ device: device.name, value: 'Never' })
	}

	cameras() {
		return Array.from(this.cameraMap.values())
	}

	camera(id: string) {
		const device = this.cameraMap.get(id)
		if (!device) throw deviceNotFound('Camera')
		return device
	}

	thermometers() {
		return Array.from(this.thermometerMap.values())
	}

	thermometer(id: string) {
		const device = this.thermometerMap.get(id)
		if (!device) throw deviceNotFound('Thermometer')
		return device
	}

	guideOutputs() {
		return Array.from(this.guideOutputMap.values())
	}

	guideOutput(id: string) {
		const device = this.guideOutputMap.get(id)
		if (!device) throw deviceNotFound('Guide Output')
		return device
	}

	private enqueueMessage(message: DefVector | SetVector, tag: string) {
		if (!this.rejectedDevices.has(message.device)) {
			this.enqueuedMessages.push([tag, message])
		}
	}

	private addProperty(device: Device, message: DefVector | SetVector, tag: string) {
		if (!this.devicePropertyMap.has(device.name)) {
			this.devicePropertyMap.set(device.name, {})
		}

		if (tag[0] === 'd') {
			this.devicePropertyMap.get(device.name)![message.name] = message as DefVector
		} else {
			const properties = this.devicePropertyMap.get(device.name)![message.name]

			if (properties) {
				if (message.state) properties.state = message.state

				for (const key in message.elements) {
					if (key in properties.elements) {
						properties.elements[key].value = message.elements[key].value
					}
				}
			}
		}
	}

	private fireDeviceUpdated(device: Device, property: string, state: PropertyState | undefined, type: DeviceType) {
		this.handlers[type].forEach((handler) => handler.deviceUpdated(device as never, property as never, state))
	}

	private fireDeviceAdded(device: Device, type: DeviceType) {
		this.handlers[type].forEach((handler) => handler.deviceAdded(device as never, type))
	}

	private fireDeviceRemoved(device: Device, type: DeviceType) {
		this.handlers[type].forEach((handler) => handler.deviceRemoved(device as never, type))
	}

	private deviceUpdated<D extends Device>(device: D, property: keyof D & string, state?: PropertyState) {
		if (this.cameraMap.has(device.name)) this.fireDeviceUpdated(device as never, property as never, state, 'CAMERA')
		if (this.thermometerMap.has(device.name) && THERMOMETER_PROPERTIES.includes(property)) this.fireDeviceUpdated(device as never, property as never, state, 'THERMOMETER')
		if (this.guideOutputMap.has(device.name) && GUIDE_OUTPUT_PROPERTIES.includes(property)) this.fireDeviceUpdated(device as never, property as never, state, 'GUIDE_OUTPUT')
	}

	private removeCamera(camera: Camera) {
		this.cameraMap.delete(camera.name)
		this.devicePropertyMap.delete(camera.name)

		this.fireDeviceRemoved(camera, 'CAMERA')

		// TODO: Call it on deleteProperty
		this.removeThermometer(camera)
		this.removeGuideOutput(camera)
	}

	private addThermometer(thermometer: Thermometer) {
		thermometer.hasThermometer = true
		this.thermometerMap.set(thermometer.name, thermometer)
		this.fireDeviceAdded(thermometer, 'THERMOMETER')
	}

	private removeThermometer(thermometer: Thermometer) {
		if (this.thermometerMap.has(thermometer.name)) {
			this.thermometerMap.delete(thermometer.name)

			thermometer.hasThermometer = false
			this.fireDeviceRemoved(thermometer, 'THERMOMETER')
		}
	}

	private addGuideOutput(guideOutput: GuideOutput) {
		guideOutput.canPulseGuide = true
		this.guideOutputMap.set(guideOutput.name, guideOutput)
		this.fireDeviceAdded(guideOutput, 'GUIDE_OUTPUT')
	}

	private removeGuideOutput(guideOutput: GuideOutput) {
		if (this.guideOutputMap.has(guideOutput.name)) {
			this.guideOutputMap.delete(guideOutput.name)

			guideOutput.canPulseGuide = false
			this.fireDeviceRemoved(guideOutput, 'GUIDE_OUTPUT')
		}
	}

	private processGain(gain: Camera['gain'], element: DefNumber | OneNumber, tag: string) {
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

	private processOffset(offset: Camera['offset'], element: DefNumber | OneNumber, tag: string) {
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

	private processEnqueuedMessages(client: IndiClient, device: Device) {
		for (let i = 0; i < this.enqueuedMessages.length; i++) {
			const [tag, message] = this.enqueuedMessages[i]

			if (message.device === device.name) {
				this.enqueuedMessages.splice(i--, 1)

				if (tag.includes('Switch')) {
					this.switchVector(client, message as never, tag)
				} else if (tag.includes('Text')) {
					this.textVector(client, message as never, tag)
				} else if (tag.includes('Number')) {
					this.numberVector(client, message as never, tag)
				} else if (tag.includes('BLOB')) {
					this.blobVector(client, message as never, tag)
				}
			}
		}
	}
}

export function indi(indi: IndiDeviceHandler, connection: ConnectionProvider) {
	const app = new Elysia({ prefix: '/indi' })

	app.get('/:id', ({ params }) => {
		return indi.device(decodeURIComponent(params.id))
	})

	app.post('/:id/connect', ({ params }) => {
		const device = indi.device(decodeURIComponent(params.id))
		const client = connection.client()
		client && indi.deviceConnect(client, device)
	})

	app.post('/:id/disconnect', ({ params }) => {
		const device = indi.device(decodeURIComponent(params.id))
		const client = connection.client()
		client && indi.deviceDisconnect(client, device)
	})

	app.get('/:id/properties', ({ params }) => {
		return indi.deviceProperties(decodeURIComponent(params.id))
	})

	return app
}
