import type { IndiClient, IndiClientHandler } from 'nebulosa/src/indi.client'
import { CLIENT, type Device, type DeviceProperty, type DevicePropertyType } from 'nebulosa/src/indi.device'
import type { CameraManager, CoverManager, DevicePropertyHandler, DevicePropertyManager, DewHeaterManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, ThermometerManager, WheelManager } from 'nebulosa/src/indi.manager'
// biome-ignore format: too long!
import type { DefBlobVector, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, DelProperty, Message, NewVector, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/indi.types'
import bus from '../shared/bus'
import type { IndiDevicePropertyEvent, IndiServerEvent, IndiServerStart, IndiServerStatus } from '../shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

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

export function isInterfaceType(value: number, type: DeviceInterfaceType) {
	return (value & type) !== 0
}

export function connect(device: Device) {
	if (!device.connected) {
		device[CLIENT]!.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { CONNECT: true } })
	}
}

export function disconnect(device: Device) {
	if (device.connected) {
		device[CLIENT]!.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { DISCONNECT: true } })
	}
}

export type IndiMessageListener = (client: IndiClient, message: Message) => void

export class IndiHandler implements IndiClientHandler {
	private readonly messageMap = new Map<IndiClient, Map<string, Message[]>>()
	private readonly messageListeners = new Set<IndiMessageListener>()

	constructor(
		readonly cameraManager: CameraManager,
		readonly guideOutputManager: GuideOutputManager,
		readonly thermometerManager: ThermometerManager,
		readonly mountManager: MountManager,
		readonly focuserManager: FocuserManager,
		readonly wheelManager: WheelManager,
		readonly coverManager: CoverManager,
		readonly flatPanelManager: FlatPanelManager,
		readonly dewHeaterManager: DewHeaterManager,
		readonly rotatorManager: RotatorManager,
		readonly properties: DevicePropertyManager,
		readonly wsm: WebSocketMessageHandler,
	) {}

	addMessageListener(listener: IndiMessageListener) {
		this.messageListeners.add(listener)
	}

	remoteMessageListener(listener: IndiMessageListener) {
		this.messageListeners.delete(listener)
	}

	close(client: IndiClient, server: boolean) {
		bus.emit('indi:close', client)

		this.properties.close(client, server)
		this.messageMap.delete(client)
		this.cameraManager.close(client, server)
		this.mountManager.close(client, server)
		this.focuserManager.close(client, server)
		this.wheelManager.close(client, server)
		this.coverManager.close(client, server)
		this.flatPanelManager.close(client, server)
		this.guideOutputManager.close(client, server)
		this.thermometerManager.close(client, server)
		this.dewHeaterManager.close(client, server)
		this.rotatorManager.close(client, server)
	}

	vector(client: IndiClient, message: DefVector | SetVector, tag: string) {
		this.properties.vector(client, message, tag)
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		this.cameraManager.switchVector(client, message, tag)
		this.mountManager.switchVector(client, message, tag)
		this.focuserManager.switchVector(client, message, tag)
		this.wheelManager.switchVector(client, message, tag)
		this.coverManager.switchVector(client, message, tag)
		this.flatPanelManager.switchVector(client, message, tag)
		this.guideOutputManager.switchVector(client, message, tag)
		this.thermometerManager.switchVector(client, message, tag)
		this.dewHeaterManager.switchVector(client, message, tag)
		this.rotatorManager.switchVector(client, message, tag)
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		this.cameraManager.numberVector(client, message, tag)
		this.mountManager.numberVector(client, message, tag)
		this.focuserManager.numberVector(client, message, tag)
		this.wheelManager.numberVector(client, message, tag)
		// this.cover.numberVector(client, message, tag)
		this.flatPanelManager.numberVector(client, message, tag)
		this.guideOutputManager.numberVector(client, message, tag)
		this.thermometerManager.numberVector(client, message, tag)
		this.dewHeaterManager.numberVector(client, message, tag)
		this.rotatorManager.numberVector(client, message, tag)
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		this.cameraManager.textVector(client, message, tag)
		this.mountManager.textVector(client, message, tag)
		this.focuserManager.textVector(client, message, tag)
		this.wheelManager.textVector(client, message, tag)
		this.coverManager.textVector(client, message, tag)
		this.flatPanelManager.textVector(client, message, tag)
		// this.guideOutput.textVector(client, message, tag)
		// this.thermometer.textVector(client, message, tag)
		// this.dewHeater.textVector(client, message, tag)
		this.rotatorManager.textVector(client, message, tag)
	}

	blobVector(client: IndiClient, message: DefBlobVector | SetBlobVector, tag: string) {
		this.cameraManager.blobVector(client, message, tag)
	}

	delProperty(client: IndiClient, message: DelProperty) {
		this.cameraManager.delProperty(client, message)
		this.mountManager.delProperty(client, message)
		this.focuserManager.delProperty(client, message)
		this.wheelManager.delProperty(client, message)
		this.coverManager.delProperty(client, message)
		this.flatPanelManager.delProperty(client, message)
		this.guideOutputManager.delProperty(client, message)
		this.thermometerManager.delProperty(client, message)
		this.dewHeaterManager.delProperty(client, message)
		this.rotatorManager.delProperty(client, message)
		this.properties.delProperty(client, message)
	}

	message(client: IndiClient, message: Message) {
		const device = message.device || 'GLOBAL'

		let messages = this.messageMap.get(client)

		if (!messages) {
			messages = new Map()
			this.messageMap.set(client, messages)
		}

		let list = messages.get(device)

		if (!list?.length) {
			list = []
			messages.set(device, list)
		}

		if (list.length > 100) {
			list.shift()
		}

		list.push(message)

		this.messageListeners.forEach((e) => e(client, message))
	}

	get(client: IndiClient | string, id: string): Device | undefined {
		return (
			this.cameraManager.get(client, id) ||
			this.mountManager.get(client, id) ||
			this.focuserManager.get(client, id) ||
			this.wheelManager.get(client, id) ||
			this.coverManager.get(client, id) ||
			this.flatPanelManager.get(client, id) ||
			this.rotatorManager.get(client, id) ||
			this.guideOutputManager.get(client, id) ||
			this.thermometerManager.get(client, id) ||
			this.dewHeaterManager.get(client, id)
		)
	}

	messages(client: IndiClient | string, device?: string) {
		client = typeof client === 'string' ? this.messageMap.keys().find((e) => e.id === client)! : client
		return this.messageMap.get(client)?.get(device || 'GLOBAL') ?? []
	}
}

export class IndiDevicePropertyHandler implements DevicePropertyHandler {
	private readonly listeners = new Map<string, number>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
		readonly indiHandler: IndiHandler,
		readonly properties: DevicePropertyManager,
	) {
		properties.addHandler(this)

		indiHandler.addMessageListener((client, message) => {
			if (!message.device) {
				notificationHandler.send({ title: 'INFO', description: message.message, color: 'primary' })
			} else if (this.listeners.has(`${client.id}:${message.device}`)) {
				wsm.send<Message & { clientId: string }>('indi:message', { ...message, clientId: client.id! })
			}
		})
	}

	added(client: IndiClient, device: string, property: DeviceProperty) {
		this.notify(client.id!, device, property, 'update')
	}

	updated(client: IndiClient, device: string, property: DeviceProperty) {
		this.notify(client.id!, device, property, 'update')
	}

	removed(client: IndiClient, device: string, property: DeviceProperty) {
		this.notify(client.id!, device, property, 'remove')
	}

	ping(clientId: string, name: string) {
		this.listeners.set(`${clientId}:${name}`, Date.now())
	}

	clear() {
		const now = Date.now()

		for (const [name, ping] of this.listeners) {
			if (now - ping >= 10000) {
				this.listeners.delete(name)
				console.info('device', name, 'was unlistened')
			}
		}
	}

	notify(clientId: string, device: string, property: DeviceProperty, type: 'update' | 'remove') {
		if (this.listeners.has(`${clientId}:${device}`)) {
			this.wsm.send<IndiDevicePropertyEvent>(`indi:property:${type}`, { clientId, device, name: property.name, property })
		}
	}

	send(client: string, type: DevicePropertyType, message: NewVector) {
		const device = this.indiHandler.get(client, message.device)!

		if (type === 'SWITCH') device[CLIENT]!.sendSwitch(message as never)
		else if (type === 'NUMBER') device[CLIENT]!.sendNumber(message as never)
		else if (type === 'TEXT') device[CLIENT]!.sendText(message as never)
	}
}

export class IndiServerHandler {
	private subprocess?: Bun.Subprocess

	constructor(readonly wsm: WebSocketMessageHandler) {}

	start(req: IndiServerStart) {
		if (process.platform !== 'linux') return

		this.stop()

		const cmd = ['indiserver', '-p', req.port?.toFixed(0) || '7624', '-r', req.repeat?.toFixed(0) || '1', req.verbose ? `-${'v'.repeat(req.verbose)}` : '', ...req.drivers].filter((e) => !!e)
		const p = Bun.spawn({ cmd })

		p.exited.then((code) => this.wsm.send<IndiServerEvent>('indi:server:stop', { pid: p.pid, code }))

		this.wsm.send<IndiServerEvent>('indi:server:start', { pid: p.pid })
		this.subprocess = p
	}

	stop() {
		if (this.subprocess && !this.subprocess.killed) {
			this.subprocess.kill()
			this.subprocess = undefined
		}
	}

	async status() {
		const enabled = process.platform === 'linux' && (!!this.subprocess || (await Bun.$`ps aux | grep "indiserver" | grep -v grep | grep -Ec -e "indiserver"`.nothrow().quiet()).text().trim() === '0')
		const running = enabled && !!this.subprocess && !this.subprocess.killed
		return { enabled, running } as IndiServerStatus
	}

	async drivers() {
		if (process.platform !== 'linux') return []

		return (await Bun.$`ls /usr/bin/indi_* -1`.nothrow().quiet())
			.text()
			.split('\n')
			.map((e) => e.substring(9).trim())
			.filter((e) => !!e)
	}
}

export function indi(indiHandler: IndiHandler, indiDevicePropertyHandler: IndiDevicePropertyHandler, indiServerHandler: IndiServerHandler): Endpoints {
	const { properties } = indiDevicePropertyHandler

	function deviceFromParams(req: Bun.BunRequest<string>) {
		return indiHandler.get(query(req).client, req.params.id)!
	}

	return {
		'/indi/devices': { GET: (req) => response(properties.names(query(req).client)) },
		'/indi/messages': { GET: (req) => response(indiHandler.messages(query(req).client, req.params.device)) },
		'/indi/:id/connect': { POST: (req) => response(connect(deviceFromParams(req))) },
		'/indi/:id/disconnect': { POST: (req) => response(disconnect(deviceFromParams(req))) },
		'/indi/:id/properties': { GET: (req) => response(properties.get(query(req).client, req.params.id)) },
		'/indi/:id/properties/ping': { POST: (req) => response(indiDevicePropertyHandler.ping(query(req).client, req.params.id)) },
		'/indi/:id/properties/send': { POST: async (req) => response(indiDevicePropertyHandler.send(query(req).client, req.params.type as never, await req.json())) },
		'/indi/server/start': { POST: async (req) => response(indiServerHandler.start(await req.json())) },
		'/indi/server/stop': { POST: () => response(indiServerHandler.stop()) },
		'/indi/server/status': { GET: async () => response(await indiServerHandler.status()) },
		'/indi/server/drivers': { GET: async () => response(await indiServerHandler.drivers()) },
	}
}
