import { Elysia } from 'elysia'
// biome-ignore format: too long!
import type { DefBlobVector, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, DelProperty, IndiClient, IndiClientHandler, NewVector, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/indi'
import type { Device, DeviceProperty } from 'nebulosa/src/indi.device'
import type { CameraManager, CoverManager, DevicePropertyHandler, DevicePropertyManager, DewHeaterManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, ThermometerManager, WheelManager } from 'nebulosa/src/indi.manager'
import bus from '../shared/bus'
import type { IndiDevicePropertyEvent, IndiServerEvent, IndiServerStart, IndiServerStatus } from '../shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

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

export function ask(client: IndiClient, device: Device) {
	client.getProperties({ device: device.name })
}

export function enableBlob(client: IndiClient, device: Device) {
	client.enableBlob({ device: device.name, value: 'Also' })
}

export function disableBlob(client: IndiClient, device: Device) {
	client.enableBlob({ device: device.name, value: 'Never' })
}

export function connect(client: IndiClient, device: Device) {
	if (!device.connected) {
		client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { CONNECT: true } })
	}
}

export function disconnect(client: IndiClient, device: Device) {
	if (device.connected) {
		client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { DISCONNECT: true } })
	}
}

export class IndiHandler implements IndiClientHandler {
	constructor(
		readonly camera: CameraManager,
		readonly guideOutput: GuideOutputManager,
		readonly thermometer: ThermometerManager,
		readonly mount: MountManager,
		readonly focuser: FocuserManager,
		readonly wheel: WheelManager,
		readonly cover: CoverManager,
		readonly flatPanel: FlatPanelManager,
		readonly dewHeater: DewHeaterManager,
		readonly properties: DevicePropertyManager,
		readonly wsm: WebSocketMessageHandler,
	) {}

	close(client: IndiClient, server: boolean) {
		bus.emit('indi:close', client)
	}

	vector(client: IndiClient, message: DefVector | SetVector, tag: string) {
		this.properties.vector(client, message, tag)
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		this.camera.switchVector(client, message, tag)
		this.mount.switchVector(client, message, tag)
		this.focuser.switchVector(client, message, tag)
		this.wheel.switchVector(client, message, tag)
		this.cover.switchVector(client, message, tag)
		this.flatPanel.switchVector(client, message, tag)
		this.guideOutput.switchVector(client, message, tag)
		this.thermometer.switchVector(client, message, tag)
		this.dewHeater.switchVector(client, message, tag)
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		this.camera.numberVector(client, message, tag)
		this.mount.numberVector(client, message, tag)
		this.focuser.numberVector(client, message, tag)
		this.wheel.numberVector(client, message, tag)
		// this.cover.numberVector(client, message, tag)
		this.flatPanel.numberVector(client, message, tag)
		this.guideOutput.numberVector(client, message, tag)
		this.thermometer.numberVector(client, message, tag)
		this.dewHeater.numberVector(client, message, tag)
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		this.camera.textVector(client, message, tag)
		this.mount.textVector(client, message, tag)
		this.focuser.textVector(client, message, tag)
		this.wheel.textVector(client, message, tag)
		this.cover.textVector(client, message, tag)
		this.flatPanel.textVector(client, message, tag)
		// this.guideOutput.textVector(client, message, tag)
		// this.thermometer.textVector(client, message, tag)
		// this.dewHeater.textVector(client, message, tag)
	}

	blobVector(client: IndiClient, message: DefBlobVector | SetBlobVector, tag: string) {
		this.camera.blobVector(client, message, tag)
	}

	delProperty(client: IndiClient, message: DelProperty) {
		this.camera.delProperty(client, message)
		this.mount.delProperty(client, message)
		this.focuser.delProperty(client, message)
		this.wheel.delProperty(client, message)
		this.cover.delProperty(client, message)
		this.flatPanel.delProperty(client, message)
		this.guideOutput.delProperty(client, message)
		this.thermometer.delProperty(client, message)
		this.dewHeater.delProperty(client, message)
		this.properties.delProperty(client, message)
	}

	get(id: string): Device | undefined {
		return this.camera.get(id) || this.mount.get(id) || this.focuser.get(id) || this.wheel.get(id) || this.cover.get(id) || this.flatPanel.get(id) || this.guideOutput.get(id) || this.thermometer.get(id) || this.dewHeater.get(id)
	}
}

export class IndiDevicePropertyHandler implements DevicePropertyHandler {
	private readonly listeners = new Map<string, number>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly properties: DevicePropertyManager,
	) {
		properties.addHandler(this)

		setInterval(() => {
			const now = Date.now()

			for (const [name, ping] of this.listeners) {
				if (now - ping > 10000) {
					this.listeners.delete(name)
				}
			}
		}, 5000)
	}

	devices() {
		return this.properties.names()
	}

	get(name: string) {
		return this.properties.get(name)
	}

	ping(name: string) {
		this.listeners.set(name, Date.now())
	}

	private notify(device: string, property: DeviceProperty, type: 'update' | 'remove') {
		if (this.listeners.has(device)) {
			this.wsm.send<IndiDevicePropertyEvent>(`indi:property:${type}`, { device, name: property.name, property })
		}
	}

	added(device: string, property: DeviceProperty) {
		this.notify(device, property, 'update')
	}

	updated(device: string, property: DeviceProperty) {
		this.notify(device, property, 'update')
	}

	removed(device: string, property: DeviceProperty) {
		this.notify(device, property, 'remove')
	}

	send(client: IndiClient, type: DeviceProperty['type'], message: NewVector) {
		if (type === 'SWITCH') client.sendSwitch(message as never)
		else if (type === 'NUMBER') client.sendNumber(message as never)
		else if (type === 'TEXT') client.sendText(message as never)
	}
}

export class IndiServerHandler {
	private process?: Bun.Subprocess

	constructor(readonly wsm: WebSocketMessageHandler) {}

	start(req: IndiServerStart) {
		this.stop()

		if (process.platform !== 'linux') return

		const cmd = ['indiserver', '-p', req.port?.toFixed(0) || '7624', '-r', req.repeat?.toFixed(0) || '1', req.verbose ? `-${'v'.repeat(req.verbose)}` : '', ...req.drivers].filter((e) => !!e)
		const p = Bun.spawn({ cmd })

		p.exited.then((code) => this.wsm.send<IndiServerEvent>('indi:server:stop', { pid: p.pid, code }))

		this.wsm.send<IndiServerEvent>('indi:server:start', { pid: p.pid })
		this.process = p
	}

	stop() {
		if (this.process && !this.process.killed) {
			this.process.kill()
			this.process = undefined
		}
	}

	async status() {
		const enabled = process.platform === 'linux' && (!!this.process || (await Bun.$`ps aux | grep "indiserver" | grep -v grep | grep -Ec -e "indiserver"`.nothrow().quiet()).text().trim() === '0')
		const running = enabled && !!this.process && !this.process.killed
		return { enabled, running } as IndiServerStatus
	}

	async drivers() {
		return (await Bun.$`locate /usr/bin/indi_`.nothrow().quiet())
			.text()
			.split('\n')
			.map((e) => e.substring(9))
			.filter((e) => !!e)
	}
}

export function indi(indi: IndiHandler, server: IndiServerHandler, property: IndiDevicePropertyHandler, connection: ConnectionHandler) {
	function deviceFromParams(params: { id: string }) {
		return indi.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/indi' })
		// Endpoints!
		.get('/devices', () => property.devices())
		.post('/:id/connect', ({ params }) => connect(connection.get(), deviceFromParams(params)))
		.post('/:id/disconnect', ({ params }) => disconnect(connection.get(), deviceFromParams(params)))
		.get('/:id/properties', ({ params }) => property.get(decodeURIComponent(params.id)))
		.post('/:id/properties/ping', ({ params }) => property.ping(decodeURIComponent(params.id)))
		.post('/:id/properties/send', ({ query, body }) => property.send(connection.get(), query.type as never, body as never))
		.post('/server/start', ({ body }) => server.start(body as never))
		.post('/server/stop', () => server.stop())
		.get('/server/status', () => server.status())
		.get('/server/drivers', () => server.drivers())

	return app
}

export function delProperty(device: Device, message: DelProperty) {
	// TODO!
}

export function connectionFor(client: IndiClient, device: Device, message: DefSwitchVector | SetSwitchVector) {
	const connected = message.elements.CONNECT?.value === true

	if (connected !== device.connected) {
		device.connected = connected
		if (connected) ask(client, device)
		return true
	}

	return false
}
