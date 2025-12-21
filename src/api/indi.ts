import cron from '@elysiajs/cron'
import { Elysia } from 'elysia'
// biome-ignore format: too long!
import type { DefBlobVector, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, DelProperty, IndiClient, IndiClientHandler, NewVector, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/indi'
import type { Device, DeviceProperty, DevicePropertyType } from 'nebulosa/src/indi.device'
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
		readonly cameraManager: CameraManager,
		readonly guideOutputManager: GuideOutputManager,
		readonly thermometerManager: ThermometerManager,
		readonly mountManager: MountManager,
		readonly focuserManager: FocuserManager,
		readonly wheelManager: WheelManager,
		readonly coverManager: CoverManager,
		readonly flatPanelManager: FlatPanelManager,
		readonly dewHeaterManager: DewHeaterManager,
		readonly properties: DevicePropertyManager,
		readonly wsm: WebSocketMessageHandler,
	) {}

	close(client: IndiClient, server: boolean) {
		bus.emit('indi:close', client)

		this.cameraManager.close(client, server)
		this.mountManager.close(client, server)
		this.focuserManager.close(client, server)
		this.wheelManager.close(client, server)
		this.coverManager.close(client, server)
		this.flatPanelManager.close(client, server)
		this.guideOutputManager.close(client, server)
		this.thermometerManager.close(client, server)
		this.dewHeaterManager.close(client, server)
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
		this.properties.delProperty(client, message)
	}

	get(id: string): Device | undefined {
		return this.cameraManager.get(id) || this.mountManager.get(id) || this.focuserManager.get(id) || this.wheelManager.get(id) || this.coverManager.get(id) || this.flatPanelManager.get(id) || this.guideOutputManager.get(id) || this.thermometerManager.get(id) || this.dewHeaterManager.get(id)
	}
}

export function indi(wsm: WebSocketMessageHandler, indi: IndiHandler, properties: DevicePropertyManager, connectionHandler: ConnectionHandler) {
	function deviceFromParams(params: { id: string }) {
		return indi.get(decodeURIComponent(params.id))!
	}

	const listeners = new Map<string, number>()
	let subprocess: Bun.Subprocess | undefined

	function ping(name: string) {
		listeners.set(name, Date.now())
	}

	function clear() {
		const now = Date.now()

		for (const [name, ping] of listeners) {
			if (now - ping >= 10000) {
				listeners.delete(name)
				console.info('unlisten device:', name)
			}
		}
	}

	function notify(device: string, property: DeviceProperty, type: 'update' | 'remove') {
		if (listeners.has(device)) {
			wsm.send<IndiDevicePropertyEvent>(`indi:property:${type}`, { device, name: property.name, property })
		}
	}

	const handler: DevicePropertyHandler = {
		added: (device: string, property: DeviceProperty) => {
			notify(device, property, 'update')
		},

		updated: (device: string, property: DeviceProperty) => {
			notify(device, property, 'update')
		},

		removed: (device: string, property: DeviceProperty) => {
			notify(device, property, 'remove')
		},
	}

	properties.addHandler(handler)

	function start(req: IndiServerStart) {
		if (process.platform !== 'linux') return

		stop()

		const cmd = ['indiserver', '-p', req.port?.toFixed(0) || '7624', '-r', req.repeat?.toFixed(0) || '1', req.verbose ? `-${'v'.repeat(req.verbose)}` : '', ...req.drivers].filter((e) => !!e)
		const p = Bun.spawn({ cmd })

		p.exited.then((code) => wsm.send<IndiServerEvent>('indi:server:stop', { pid: p.pid, code }))

		wsm.send<IndiServerEvent>('indi:server:start', { pid: p.pid })
		subprocess = p
	}

	function stop() {
		if (subprocess && !subprocess.killed) {
			subprocess.kill()
			subprocess = undefined
		}
	}

	async function status() {
		const enabled = process.platform === 'linux' && (!!subprocess || (await Bun.$`ps aux | grep "indiserver" | grep -v grep | grep -Ec -e "indiserver"`.nothrow().quiet()).text().trim() === '0')
		const running = enabled && !!subprocess && !subprocess.killed
		return { enabled, running } as IndiServerStatus
	}

	async function drivers() {
		if (process.platform !== 'linux') return []

		return (await Bun.$`ls /usr/bin/indi_* -1`.nothrow().quiet())
			.text()
			.split('\n')
			.map((e) => e.substring(9).trim())
			.filter((e) => !!e)
	}

	function send(client: IndiClient, type: DevicePropertyType, message: NewVector) {
		if (type === 'SWITCH') client.sendSwitch(message as never)
		else if (type === 'NUMBER') client.sendNumber(message as never)
		else if (type === 'TEXT') client.sendText(message as never)
	}

	const app = new Elysia({ prefix: '/indi' })
		// Endpoints!
		.get('/devices', () => properties.names())
		.post('/:id/connect', ({ params }) => connect(connectionHandler.get(), deviceFromParams(params)))
		.post('/:id/disconnect', ({ params }) => disconnect(connectionHandler.get(), deviceFromParams(params)))
		.get('/:id/properties', ({ params }) => properties.get(decodeURIComponent(params.id)))
		.post('/:id/properties/ping', ({ params }) => ping(decodeURIComponent(params.id)))
		.post('/:id/properties/send', ({ query, body }) => send(connectionHandler.get(), query.type as never, body as never))
		.post('/server/start', ({ body }) => start(body as never))
		.post('/server/stop', () => stop())
		.get('/server/status', () => status())
		.get('/server/drivers', () => drivers())
		.use(cron({ name: 'ping', pattern: '0 */1 * * * *', run: clear }))

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
