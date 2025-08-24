import { Elysia } from 'elysia'
// biome-ignore format: too long!
import type { DefBlobVector, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, DelProperty, IndiClient, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
// biome-ignore format: too long!
import type { Device, DeviceProperties, DeviceProperty, IndiPropertyUpdated, IndiServerStart, IndiServerStarted, IndiServerStatus, IndiServerStopped } from '../shared/types'
import type { CameraManager } from './camera'
import type { ConnectionManager } from './connection'
import type { CoverManager } from './cover'
import type { DewHeaterManager } from './dewheater'
import type { FlatPanelManager } from './flatpanel'
import type { FocuserManager } from './focuser'
import type { GuideOutputManager } from './guideoutput'
import type { WebSocketMessageManager } from './message'
import type { MountManager } from './mount'
import type { ThermometerManager } from './thermometer'

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

export class IndiManager {
	constructor(
		readonly camera: CameraManager,
		readonly guideOutput: GuideOutputManager,
		readonly thermometer: ThermometerManager,
		readonly mount: MountManager,
		readonly focuser: FocuserManager,
		readonly cover: CoverManager,
		readonly flatPanel: FlatPanelManager,
		readonly dewHeater: DewHeaterManager,
		readonly wsm: WebSocketMessageManager,
	) {}

	close(client: IndiClient, server: boolean) {
		bus.emit('indi:close', client)
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		this.camera.switchVector(client, message, tag)
		this.mount.switchVector(client, message, tag)
		this.focuser.switchVector(client, message, tag)
		this.cover.switchVector(client, message, tag)
		this.flatPanel.switchVector(client, message, tag)
		// this.guideOutput.switchVector(client, message, tag)
		// this.thermometer.switchVector(client, message, tag)
		// this.dewHeater.switchVector(client, message, tag)
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		this.camera.numberVector(client, message, tag)
		this.mount.numberVector(client, message, tag)
		this.focuser.numberVector(client, message, tag)
		this.cover.numberVector(client, message, tag)
		this.flatPanel.numberVector(client, message, tag)
		this.guideOutput.numberVector(client, message, tag)
		this.thermometer.numberVector(client, message, tag)
		this.dewHeater.numberVector(client, message, tag)
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		this.camera.textVector(client, message, tag)
		this.mount.textVector(client, message, tag)
		this.focuser.textVector(client, message, tag)
		this.cover.textVector(client, message, tag)
		this.flatPanel.textVector(client, message, tag)
		// this.guideOutput.textVector(client, message, tag)
		// this.thermometer.textVector(client, message, tag)
		// this.dewHeater.textVector(client, message, tag)
	}

	blobVector(client: IndiClient, message: DefBlobVector | SetBlobVector, tag: string) {
		this.camera.blobVector(client, message, tag)
	}

	get(id: string): Device | undefined {
		return this.camera.get(id) || this.mount.get(id) || this.focuser.get(id) || this.cover.get(id) || this.flatPanel.get(id) || this.guideOutput.get(id) || this.thermometer.get(id) || this.dewHeater.get(id)
	}
}

export class IndiDevicePropertyManager {
	private readonly properties = new Map<string, DeviceProperties>()
	private readonly listeners = new Set<string>()

	constructor(readonly wsm: WebSocketMessageManager) {}

	listen(name: string) {
		this.listeners.add(name)
	}

	unlisten(name: string) {
		this.listeners.delete(name)
	}

	send(device: Device, name: string, property: DeviceProperty) {
		if (this.listeners.has(device.name)) {
			this.wsm.send<IndiPropertyUpdated>({ type: 'indi:property:update', device: device.name, name, property })
		}
	}

	get(device: Device) {
		return this.properties.get(device.name)
	}

	add(device: Device, message: DefVector | SetVector, tag: string, send: boolean = true) {
		let properties = this.properties.get(device.name)

		if (!properties) {
			properties = {}
			this.properties.set(device.name, properties)
		}

		if (tag[0] === 'd') {
			const property = message as DeviceProperty
			property.type = tag.includes('Switch') ? 'SWITCH' : tag.includes('Number') ? 'NUMBER' : tag.includes('Text') ? 'TEXT' : tag.includes('BLOB') ? 'BLOB' : 'LIGHT'
			properties[message.name] = property
			if (send) this.send(device, message.name, property)
			return true
		} else {
			let updated = false
			const property = properties[message.name]

			if (property) {
				if (message.state && message.state !== property.state) {
					property.state = message.state
					updated = true
				}

				for (const key in message.elements) {
					const element = property.elements[key]

					if (element) {
						const value = message.elements[key]!.value

						if (value !== element.value) {
							element.value = value
							updated = true
						}
					}
				}

				if (updated && send) {
					this.send(device, message.name, property)
				}
			}

			return updated
		}
	}
}

export class IndiServerManager {
	private process?: Bun.Subprocess

	constructor(readonly wsm: WebSocketMessageManager) {}

	start(req: IndiServerStart) {
		this.stop()

		if (process.platform !== 'linux') return

		const cmd = ['indiserver', '-p', req.port?.toFixed(0) || '7624', '-r', req.repeat?.toFixed(0) || '1', req.verbose ? `-${'v'.repeat(req.verbose)}` : '', ...req.drivers].filter((e) => !!e)
		const p = Bun.spawn({ cmd })

		p.exited.then((code) => {
			bus.emit('indi:server:stop', { pid: p.pid, code })
			this.wsm.send<IndiServerStopped>({ type: 'indi:server:stop', pid: p.pid, code })
		})

		bus.emit('indi:server:start', p.pid)
		this.wsm.send<IndiServerStarted>({ type: 'indi:server:start', pid: p.pid })
		this.process = p
	}

	stop() {
		if (this.process && !this.process.killed) {
			this.process.kill()
			this.process = undefined
		}
	}

	async status() {
		const enabled = process.platform === 'linux' && (await Bun.$`ps aux | grep "indiserver" | grep -v grep | grep -Ec -e "indiserver"`.nothrow().quiet()).text().trim() === '0'
		const running = enabled && !!this.process && !this.process.killed
		// biome-ignore format: don't break lines!
		const drivers = enabled ? (await Bun.$`locate /usr/bin/indi_`.nothrow().quiet()).text().split('\n').map((e) => e.substring(9)).filter((e) => !!e) : []
		return { enabled, running, drivers } as IndiServerStatus
	}
}

export function indi(indi: IndiManager, server: IndiServerManager, property: IndiDevicePropertyManager, connection: ConnectionManager) {
	function deviceFromParams(params: { id: string }) {
		return indi.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/indi' })
		// Endpoints!
		.get('/:id', ({ params }) => deviceFromParams(params))
		.post('/:id/connect', ({ params }) => connect(connection.get(), deviceFromParams(params)))
		.post('/:id/disconnect', ({ params }) => disconnect(connection.get(), deviceFromParams(params)))
		.get('/:id/properties', ({ params }) => property.get(deviceFromParams(params)))
		.post('/:id/properties/listen', ({ params }) => property.listen(decodeURIComponent(params.id)))
		.post('/:id/properties/unlisten', ({ params }) => property.unlisten(decodeURIComponent(params.id)))
		.post('/server/start', ({ body }) => server.start(body as never))
		.post('/server/stop', () => server.stop())
		.get('/server/status', () => server.status())

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
