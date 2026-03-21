import { AlpacaClient } from 'nebulosa/src/alpaca.client'
import type { Angle } from 'nebulosa/src/angle'
import { findHnsky290Stars } from 'nebulosa/src/hnsky'
import type { AstronomicalImageStar } from 'nebulosa/src/image.generator'
import { IndiClient, type IndiClientHandler } from 'nebulosa/src/indi.client'
import type { Client, Device } from 'nebulosa/src/indi.device'
import type { DeviceProvider, FocuserManager, GuideOutputManager, MountManager, RotatorManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, type CatalogProviderStar, ClientSimulator, DustCapSimulator, FilterWheelSimulator, FlatPanelSimulator, FocuserSimulator, MountSimulator, RotatorSimulator } from 'nebulosa/src/indi.simulator'
import { join } from 'path'
import bus from '../shared/bus'
import type { Connect, ConnectionEvent, ConnectionStatus } from '../shared/types'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import { directoryExists } from './util'

function save(name: string, properties: unknown) {
	const path = join(Bun.env.configDir, `${name}.json`)
	return Bun.write(path, JSON.stringify(properties))
}

async function load(name: string) {
	const file = Bun.file(join(Bun.env.configDir, `${name}.json`))
	if (await file.exists()) return file.json()
	return []
}

const DEFAULT_ASTRONOMICAL_IMAGE_STAR: Partial<Readonly<AstronomicalImageStar>> = { hfd: 2.5, snr: 130, flux: 0.55 }

async function hnskyCatalogProvider(rightAscension: Angle, declination: Angle, radius: Angle): Promise<readonly CatalogProviderStar[]> {
	const directory = join(Bun.env.starDatabaseDir, 'HNSKY')
	const stars = (await directoryExists(directory)) ? await findHnsky290Stars(directory, 'g16', { rightAscension, declination, radius }) : []
	for (const star of stars) Object.assign(star, DEFAULT_ASTRONOMICAL_IMAGE_STAR)
	return stars as never
}

const catalogProviders = {
	HNSKY: hnskyCatalogProvider,
} as const

export class ConnectionHandler {
	private readonly clients = new Map<string, Client>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove the client from the active connections
			this.disconnect(client)
		})
	}

	get(id?: string) {
		let client: Client | undefined
		if (!id) client = this.clients.values().next().value
		else client = this.clients.get(id)
		if (!client) this.notificationHandler.send({ title: 'CONNECTION', description: 'No active connection!', color: 'danger' })
		return client!
	}

	async connect(req: Connect & { id?: string }, indi: IndiClientHandler & DeviceProvider<Device>, mountManager: MountManager, focuserManager: FocuserManager, rotatorManager: RotatorManager, guideOutputManager: GuideOutputManager): Promise<ConnectionStatus | undefined> {
		for (const [, client] of this.clients) {
			if (
				(client.type === 'SIMULATOR' && req.type === client.type) ||
				client.id === req.id ||
				(client instanceof IndiClient && client.remotePort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) ||
				(client instanceof AlpacaClient && client.remotePort === req.port && client.remoteHost === req.host)
			) {
				console.info('reusing existing connection:', client.id, client.description)
				const status = this.status(client)!
				this.wsm.send<ConnectionEvent>('connection:open', { status, reused: true })
				return status
			}
		}

		if (req.type === 'INDI') {
			const client = new IndiClient({ handler: indi })

			try {
				if (await client.connect(req.host, req.port)) {
					this.clients.set(client.id, client)

					console.info('new connection to:', client.id, client.description)

					const status = this.status(client)!
					this.wsm.send<ConnectionEvent>('connection:open', { status, reused: false })
					return status
				} else {
					this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to INDI server', color: 'danger' })
				}
			} catch (e) {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to INDI server', color: 'danger' })
			}
		} else if (req.type === 'ALPACA') {
			const client = new AlpacaClient(`http${req.secured ? 's' : ''}://${req.host}:${req.port}`, { handler: indi }, indi)

			try {
				if (await client.start()) {
					this.clients.set(client.id, client)

					console.info('new connection to:', client.id, client.description)

					const status = this.status(client)!
					this.wsm.send<ConnectionEvent>('connection:open', { status, reused: false })
					return status
				} else {
					this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to Alpaca server', color: 'danger' })
				}
			} catch (e) {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to Alpaca server', color: 'danger' })
			}
		} else {
			const client = new ClientSimulator('client.simulator', indi)
			this.clients.set(client.id, client)

			const mount = new MountSimulator('Mount Simulator', client, { save, load })
			const camera = new CameraSimulator('Camera Simulator', client, { save, load, mountManager, guideOutputManager, focuserManager, rotatorManager, catalogProviders })
			const focuser = new FocuserSimulator('Focuser Simulator', client, { save, load })
			const filterWheel = new FilterWheelSimulator('Filter Wheel Simulator', client, { save, load })
			const rotator = new RotatorSimulator('Rotator Simulator', client, { save, load })
			const flatPanel = new FlatPanelSimulator('Flat Panel Simulator', client, { save, load })
			const dustCap = new DustCapSimulator('Dust Cap Simulator', client, { save, load })

			console.info('new connection to:', client.id, client.description)

			const status = this.status(client)!
			this.wsm.send<ConnectionEvent>('connection:open', { status, reused: false })
			return status
		}

		return undefined
	}

	disconnect(id: string | Client) {
		if (typeof id === 'string') {
			const client = this.clients.get(id)

			if (client) {
				const status = this.status(client)!

				this.clients.delete(id)
				console.info('disconnected from:', client.id, client.description)

				client[Symbol.dispose]()

				this.wsm.send<ConnectionEvent>('connection:close', { status })
			}
		} else {
			for (const [key, client] of this.clients) {
				if (client === id) {
					const status = this.status(client)!

					this.clients.delete(key)
					console.info('disconnected from:', client.id, client.description)

					client[Symbol.dispose]()

					this.wsm.send<ConnectionEvent>('connection:close', { status })

					break
				}
			}
		}
	}

	status(key: string | Client): ConnectionStatus | undefined {
		if (typeof key === 'string') {
			const client = this.clients.get(key)
			return client && { type: client.type, id: key }
		} else {
			for (const [id, client] of this.clients) {
				if (client === key) {
					return client && { type: client.type, id }
				}
			}
		}

		return undefined
	}

	list() {
		return Array.from(this.clients.values())
			.map((e) => this.status(e))
			.filter((e) => !!e)
	}
}

export function connection(connectionHandler: ConnectionHandler, indi: IndiClientHandler & DeviceProvider<Device>, mountManager: MountManager, focuserManager: FocuserManager, rotatorManager: RotatorManager, guideOutputManager: GuideOutputManager): Endpoints {
	return {
		'/connections': { GET: () => response(connectionHandler.list()), POST: async (req) => response(await connectionHandler.connect(await req.json(), indi, mountManager, focuserManager, rotatorManager, guideOutputManager)) },
		'/connections/:id': { GET: (req) => response(connectionHandler.status(req.params.id)), DELETE: (req) => response(connectionHandler.disconnect(req.params.id)) },
	}
}
