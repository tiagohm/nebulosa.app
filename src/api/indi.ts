import type { IndiClientHandler } from 'nebulosa/src/devices/indi/client'
import { CLIENT, type Client, type Device, type DeviceProperty, type DevicePropertyType, type DeviceType } from 'nebulosa/src/devices/indi/device'
import type { CameraManager, CoverManager, DevicePropertyHandler, DeviceProvider, DewHeaterManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, ThermometerManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
// oxfmt-ignore
import type { DefBlobVector, DefNumberVector, DefSwitchVector, DefTextVector, DefVector, DelProperty, Message, NewVector, SetBlobVector, SetNumberVector, SetSwitchVector, SetTextVector, SetVector } from 'nebulosa/src/devices/indi/types'
import bus from 'src/shared/bus'
import type { IndiPropertyListenEvent, IndiDevicePropertyEvent, IndiServerEvent, IndiServerStart, IndiServerStatus } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { type Endpoints, query, response } from './http'
import type { Messager, WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

const MAX_DEVICE_MESSAGES = 100

export function connect(device: Device) {
	const client = device[CLIENT]

	if (client && !device.connected) {
		client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { CONNECT: true } })
	}
}

export function disconnect(device: Device) {
	const client = device[CLIENT]

	if (client && device.connected) {
		client.sendSwitch({ device: device.name, name: 'CONNECTION', elements: { DISCONNECT: true } })
	}
}

export type IndiMessageListener = (client: Client, message: Message) => void

export class IndiHandler implements IndiClientHandler, DeviceProvider<Device> {
	readonly #messages = new Map<Client, Map<string, Message[]>>()
	readonly #messageListeners = new Set<IndiMessageListener>()

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
		readonly wsm: WebSocketMessageHandler,
	) {}

	addMessageListener(listener: IndiMessageListener) {
		this.#messageListeners.add(listener)
	}

	removeMessageListener(listener: IndiMessageListener) {
		this.#messageListeners.delete(listener)
	}

	properties(type: DeviceType) {
		if (type === 'camera') return this.cameraManager.properties
		else if (type === 'mount') return this.mountManager.properties
		else if (type === 'focuser') return this.focuserManager.properties
		else if (type === 'wheel') return this.wheelManager.properties
		else if (type === 'cover') return this.coverManager.properties
		else if (type === 'flatPanel') return this.flatPanelManager.properties
		else if (type === 'rotator') return this.rotatorManager.properties
		else if (type === 'guideOutput') return this.guideOutputManager.properties
		else if (type === 'thermometer') return this.thermometerManager.properties
		else if (type === 'dewHeater') return this.dewHeaterManager.properties
		else return undefined
	}

	close(client: Client, server: boolean) {
		bus.emit('indi:close', client)

		this.#messages.delete(client)
		this.cameraManager.close(client, server)
		this.mountManager.close(client, server)
		this.focuserManager.close(client, server)
		this.wheelManager.close(client, server)
		this.coverManager.close(client, server)
		this.flatPanelManager.close(client, server)
		this.rotatorManager.close(client, server)
		this.guideOutputManager.close(client, server)
		this.thermometerManager.close(client, server)
		this.dewHeaterManager.close(client, server)
	}

	vector(client: Client, message: DefVector | SetVector, tag: string) {
		this.cameraManager.vector(client, message, tag)
		this.mountManager.vector(client, message, tag)
		this.focuserManager.vector(client, message, tag)
		this.wheelManager.vector(client, message, tag)
		this.coverManager.vector(client, message, tag)
		this.flatPanelManager.vector(client, message, tag)
		this.rotatorManager.vector(client, message, tag)
		this.guideOutputManager.vector(client, message, tag)
		this.thermometerManager.vector(client, message, tag)
		this.dewHeaterManager.vector(client, message, tag)
	}

	switchVector(client: Client, message: DefSwitchVector | SetSwitchVector, tag: string) {
		this.cameraManager.switchVector(client, message, tag)
		this.mountManager.switchVector(client, message, tag)
		this.focuserManager.switchVector(client, message, tag)
		this.wheelManager.switchVector(client, message, tag)
		this.coverManager.switchVector(client, message, tag)
		this.flatPanelManager.switchVector(client, message, tag)
		this.rotatorManager.switchVector(client, message, tag)
		this.guideOutputManager.switchVector(client, message, tag)
		this.thermometerManager.switchVector(client, message, tag)
		this.dewHeaterManager.switchVector(client, message, tag)
	}

	numberVector(client: Client, message: DefNumberVector | SetNumberVector, tag: string) {
		this.cameraManager.numberVector(client, message, tag)
		this.mountManager.numberVector(client, message, tag)
		this.focuserManager.numberVector(client, message, tag)
		this.wheelManager.numberVector(client, message, tag)
		// this.cover.numberVector(client, message, tag)
		this.flatPanelManager.numberVector(client, message, tag)
		this.rotatorManager.numberVector(client, message, tag)
		this.guideOutputManager.numberVector(client, message, tag)
		this.thermometerManager.numberVector(client, message, tag)
		this.dewHeaterManager.numberVector(client, message, tag)
	}

	textVector(client: Client, message: DefTextVector | SetTextVector, tag: string) {
		this.cameraManager.textVector(client, message, tag)
		this.mountManager.textVector(client, message, tag)
		this.focuserManager.textVector(client, message, tag)
		this.wheelManager.textVector(client, message, tag)
		this.coverManager.textVector(client, message, tag)
		this.flatPanelManager.textVector(client, message, tag)
		this.rotatorManager.textVector(client, message, tag)
		// this.guideOutput.textVector(client, message, tag)
		// this.thermometer.textVector(client, message, tag)
		// this.dewHeater.textVector(client, message, tag)
	}

	blobVector(client: Client, message: DefBlobVector | SetBlobVector, tag: string) {
		this.cameraManager.blobVector(client, message, tag)
	}

	delProperty(client: Client, message: DelProperty) {
		this.cameraManager.delProperty(client, message)
		this.mountManager.delProperty(client, message)
		this.focuserManager.delProperty(client, message)
		this.wheelManager.delProperty(client, message)
		this.coverManager.delProperty(client, message)
		this.flatPanelManager.delProperty(client, message)
		this.rotatorManager.delProperty(client, message)
		this.guideOutputManager.delProperty(client, message)
		this.thermometerManager.delProperty(client, message)
		this.dewHeaterManager.delProperty(client, message)
	}

	message(client: Client, message: Message) {
		const device = message.device || 'GLOBAL'

		let messages = this.#messages.get(client)

		if (!messages) {
			messages = new Map()
			this.#messages.set(client, messages)
		}

		let list = messages.get(device)

		if (!list?.length) {
			list = []
			messages.set(device, list)
		}

		if (list.length >= MAX_DEVICE_MESSAGES) {
			list.shift()
		}

		list.push(message)

		for (const listener of this.#messageListeners) {
			try {
				listener(client, message)
			} catch (e) {
				this.#messageListeners.delete(listener)
				console.error('failed to notify INDI message listener', e)
			}
		}
	}

	get(client: Client | string | undefined, id: string, type?: DeviceType): Device | undefined {
		if (!type) {
			return (
				this.cameraManager.get(client, id) ??
				this.mountManager.get(client, id) ??
				this.focuserManager.get(client, id) ??
				this.wheelManager.get(client, id) ??
				this.coverManager.get(client, id) ??
				this.flatPanelManager.get(client, id) ??
				this.rotatorManager.get(client, id) ??
				this.guideOutputManager.get(client, id) ??
				this.thermometerManager.get(client, id) ??
				this.dewHeaterManager.get(client, id)
			)
		}

		if (type === 'camera') return this.cameraManager.get(client, id)
		else if (type === 'mount') return this.mountManager.get(client, id)
		else if (type === 'focuser') return this.focuserManager.get(client, id)
		else if (type === 'wheel') return this.wheelManager.get(client, id)
		else if (type === 'cover') return this.coverManager.get(client, id)
		else if (type === 'flatPanel') return this.flatPanelManager.get(client, id)
		else if (type === 'rotator') return this.rotatorManager.get(client, id)
		else if (type === 'guideOutput') return this.guideOutputManager.get(client, id)
		else if (type === 'thermometer') return this.thermometerManager.get(client, id)
		else if (type === 'dewHeater') return this.dewHeaterManager.get(client, id)
		else return undefined
	}

	messages(client: Client | string, id?: string) {
		let resolvedClient = typeof client === 'string' ? undefined : client

		if (typeof client === 'string') {
			for (const current of this.#messages.keys()) {
				if (current.id === client) {
					resolvedClient = current
					break
				}
			}
		}

		if (!resolvedClient) return []

		const device = id && this.get(resolvedClient, id)
		return this.#messages.get(resolvedClient)?.get((device && device?.name) || id || 'GLOBAL') ?? []
	}
}

const DEVICE_TYPES: readonly DeviceType[] = ['camera', 'mount', 'focuser', 'wheel', 'cover', 'flatPanel', 'rotator', 'guideOutput', 'thermometer', 'dewHeater']

export class IndiDevicePropertyHandler implements DevicePropertyHandler<Device>, Disposable {
	readonly #listeners = new Map<string, Set<Messager>>()
	readonly #unsubscribers: VoidFunction[] = []

	readonly #messageListener: IndiMessageListener = (client, message) => {
		if (!message.device) {
			this.notificationHandler.send({ title: 'INFO', description: message.message, color: 'primary' })
		} else {
			const device = this.indiHandler.get(client, message.device)

			if (device !== undefined) {
				this.wsm.send('indi:message', { ...message, device: device.id, client: client.id } satisfies Message & { client: string })
			}
		}
	}

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
		readonly indiHandler: IndiHandler,
	) {
		for (const type of DEVICE_TYPES) indiHandler.properties(type)?.addHandler(this)
		indiHandler.addMessageListener(this.#messageListener)

		this.#unsubscribers[0] = bus.subscribe<IndiPropertyListenEvent>('indi:listen', (event) => {
			this.listen(event)
		})

		this.#unsubscribers[1] = bus.subscribe<IndiPropertyListenEvent>('indi:unlisten', ({ id, socket }) => {
			const sockets = this.#listeners.get(id)

			if (!sockets?.size) return

			if (sockets.delete(socket)) {
				console.info(`indi stopped listening to ${id}`)

				if (sockets.size === 0) {
					this.#listeners.delete(id)
				}
			}
		})

		this.#unsubscribers[2] = bus.subscribe('ws:close', (socket: Messager) => {
			for (const [key, sockets] of this.#listeners.entries()) {
				if (sockets.delete(socket)) {
					console.info(`indi stopped listening to ${key}`)

					if (sockets.size === 0) {
						this.#listeners.delete(key)
					}
				}
			}
		})
	}

	added(device: Device, property: DeviceProperty) {
		this.notify(device, property, 'add')
	}

	updated(device: Device, property: DeviceProperty) {
		this.notify(device, property, 'update')
	}

	removed(device: Device, property: DeviceProperty) {
		this.notify(device, property, 'remove')
	}

	notify(device: Device, property: DeviceProperty, type: 'add' | 'update' | 'remove') {
		const sockets = this.#listeners.get(device.id)

		if (!sockets?.size) return

		const topic = `indi:property:${type}`
		const event: IndiDevicePropertyEvent = { client: device.client.id, device: device.id, name: property.name, property }

		for (const socket of sockets) {
			this.wsm.send(topic, event, socket)
		}
	}

	list(device: Device) {
		const properties = this.indiHandler.properties(device.type)
		return properties?.get(device as never)
	}

	send(client: string, type: DevicePropertyType, message: NewVector) {
		if (!client) return

		const device = this.indiHandler.get(client, message.device)
		const indi = device?.[CLIENT]

		if (!device || !indi) return

		if (type === 'SWITCH') indi.sendSwitch(message as never)
		else if (type === 'NUMBER') indi.sendNumber(message as never)
		else if (type === 'TEXT') indi.sendText(message as never)
	}

	private listen({ id, socket }: IndiPropertyListenEvent) {
		const sockets = this.#listeners.get(id) ?? new Set<Messager>()
		sockets.add(socket) && console.info(`indi started listening to ${id}`)
		this.#listeners.set(id, sockets)
	}

	dispose() {
		for (const type of DEVICE_TYPES) this.indiHandler.properties(type)?.removeHandler(this)
		this.indiHandler.removeMessageListener(this.#messageListener)

		unsubscribe(this.#unsubscribers)

		this.#listeners.clear()
	}

	[Symbol.dispose]() {
		this.dispose()
	}
}

export class IndiServerHandler {
	private subprocess?: Bun.Subprocess

	constructor(readonly wsm: WebSocketMessageHandler) {}

	start(req: IndiServerStart) {
		if (process.platform !== 'linux') return

		this.stop()

		const cmd = ['indiserver', '-p', port(req.port).toFixed(0), '-r', repeat(req.repeat).toFixed(0), verbose(req.verbose), ...drivers(req.drivers)].filter((e) => !!e)
		const p = Bun.spawn({ cmd })

		void p.exited.then((code) => {
			if (this.subprocess !== p) return
			this.subprocess = undefined
			this.wsm.send('indi:server:stop', { pid: p.pid, code } satisfies IndiServerEvent)
		})

		this.wsm.send('indi:server:start', { pid: p.pid } satisfies IndiServerEvent)
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
			.map((e) => e.slice(9).trim())
			.filter((e) => !!e)
	}
}

export function indi(indiHandler: IndiHandler, indiDevicePropertyHandler: IndiDevicePropertyHandler, indiServerHandler: IndiServerHandler) {
	function deviceFromParams(req: Bun.BunRequest) {
		return indiHandler.get(query(req).client, req.params.id)!
	}

	return {
		'/indi/messages': { GET: (req) => response(indiHandler.messages(query(req).client, req.params.device)) },
		'/indi/:id/connect': { POST: (req) => response(connect(deviceFromParams(req))) },
		'/indi/:id/disconnect': { POST: (req) => response(disconnect(deviceFromParams(req))) },
		'/indi/:id/properties': { GET: (req) => response(indiDevicePropertyHandler.list(deviceFromParams(req))) },
		'/indi/:id/properties/send': { POST: async (req) => response(indiDevicePropertyHandler.send(query(req).client, req.params.type as never, await req.json())) },
		'/indi/server/start': { POST: async (req) => response(indiServerHandler.start(await req.json())) },
		'/indi/server/stop': { POST: () => response(indiServerHandler.stop()) },
		'/indi/server/status': { GET: async () => response(await indiServerHandler.status()) },
		'/indi/server/drivers': { GET: async () => response(await indiServerHandler.drivers()) },
	} as const satisfies Endpoints
}

function port(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535 ? value : 7624
}

function repeat(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1
}

function verbose(value: unknown) {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? `-${'v'.repeat(Math.min(value, 4))}` : ''
}

function drivers(value: unknown) {
	return Array.isArray(value) ? value.filter((e): e is string => typeof e === 'string' && e.length > 0) : []
}
