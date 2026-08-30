import { join } from 'path'
import { VizierGaiaCatalog } from 'nebulosa/src/adapters/catalogs/vizier'
import type { VizierGaiaCatalogEntry } from 'nebulosa/src/adapters/catalogs/vizier'
import { findHnsky290Stars } from 'nebulosa/src/catalogs/stars/hnsky'
import type { Hnsky290Database, Hnsky290Files } from 'nebulosa/src/catalogs/stars/hnsky'
import type { Writable } from 'nebulosa/src/core/types'
import { AlpacaClient } from 'nebulosa/src/devices/alpaca/client'
import { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { IndiClientHandler } from 'nebulosa/src/devices/indi/client'
import type { Client, Device } from 'nebulosa/src/devices/indi/device'
import type { DeviceProvider } from 'nebulosa/src/devices/indi/manager/device'
import type { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import type { GuideOutputManager } from 'nebulosa/src/devices/indi/manager/guideoutput'
import type { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import type { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { CoverSimulator } from 'nebulosa/src/devices/indi/simulator/cover'
import { FlatPanelSimulator } from 'nebulosa/src/devices/indi/simulator/flatpanel'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { RotatorSimulator } from 'nebulosa/src/devices/indi/simulator/rotator'
import type { CatalogSource, CatalogSourceStar, DeviceSimulatorOptions } from 'nebulosa/src/devices/indi/simulator/types'
import { WheelSimulator } from 'nebulosa/src/devices/indi/simulator/wheel'
import type { AstronomicalImageStar } from 'nebulosa/src/imaging/synthetic/generator'
import { clamp } from 'nebulosa/src/math/numerical/math'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { EventBus } from 'src/shared/bus'
import type { ConnectionEvent, Connect, ConnectionStatus } from '#/connection'
import { response } from './http'
import type { Endpoints } from './http'
import { indiBus } from './indi'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import type { OperationCoordinator } from './operation'
import { settlesWithin } from './util'

export interface ConnectionBusEvents {
	readonly open: ConnectionEvent
	readonly close: ConnectionEvent
}

export const connectionBus = new EventBus<ConnectionBusEvents>()

// Maximum milliseconds an expected client disconnect waits for operational cleanup.
const DEFAULT_DISCONNECT_CLEANUP_TIMEOUT = 5000

function save(name: string, properties: unknown) {
	const path = join(Bun.env.appDir, `${name}.config.json`)
	return Bun.write(path, JSON.stringify(properties))
}

async function load(name: string) {
	const file = Bun.file(join(Bun.env.appDir, `${name}.config.json`))
	if (await file.exists()) return file.json()
	return []
}

const DEFAULT_ASTRONOMICAL_IMAGE_STAR: Partial<Readonly<AstronomicalImageStar>> = { hfd: 2.5, snr: 130, flux: 0.55 }

let HNSKY_290_G14_FILES: Hnsky290Files | undefined
let HNSKY_290_G16_FILES: Hnsky290Files | undefined

async function loadHnskyDatabase(database: Hnsky290Database) {
	if (database === 'g14' && HNSKY_290_G14_FILES !== undefined) return true
	if (database === 'g16' && HNSKY_290_G16_FILES !== undefined) return true

	const file = Bun.file(join(Bun.env.appDir, `HNSKY_${database}.tar`))

	if (await file.exists()) {
		const archive = new Bun.Archive(await file.arrayBuffer())
		const files = await archive.files()
		if (database === 'g14') HNSKY_290_G14_FILES = files
		else HNSKY_290_G16_FILES = files
		return true
	} else {
		console.warn('HNSKY database not found at', file.name)
	}

	return false
}

async function hnskyCatalogSource(files: Hnsky290Files, rightAscension: Angle, declination: Angle, radius: Angle): Promise<readonly CatalogSourceStar[]> {
	const database = files === HNSKY_290_G14_FILES ? 'g14' : 'g16'
	const stars = await findHnsky290Stars(files, database, { rightAscension, declination, radius })
	for (const star of stars) Object.assign(star, DEFAULT_ASTRONOMICAL_IMAGE_STAR)
	return stars as never
}

// Queries VizieR around the active mount and projects the stars onto the sensor.
async function vizierCatalogSource(centerRightAscension: Angle, centerDeclination: Angle, radius: Angle) {
	const catalog = new VizierGaiaCatalog()

	const stars = (await catalog.queryCone(centerRightAscension, centerDeclination, radius)) as unknown as Writable<CatalogSourceStar & VizierGaiaCatalogEntry>[]

	if (stars.length === 0) return []

	const hfdSpread = 0.5
	const maxBrightness = 10 ** (-0.4 * -1.46)
	const invMaxBrightness = 1 / maxBrightness

	try {
		for (let i = 0; i < stars.length; i++) {
			const star = stars[i]

			const brightness = 10 ** (-0.4 * star.magnitude)
			star.colorIndex = clamp(star.colorIndex || 0.65, -0.25, 1.9)
			const normalized = clamp(brightness * invMaxBrightness, 0, 1)

			star.flux = 0.2 + 0.848 * normalized
			star.hfd = 1.2 + 2.4 * clamp((1 - normalized) * (0.35 + hfdSpread * 0.65), 0, 1)
			star.snr = 12 + normalized * 180
		}
	} catch (e) {
		console.error('failed to generate stars from vizier', e)
		return []
	}

	return stars
}

// Owns client transports and coordinates their operational cleanup before disposal.
export class ConnectionHandler {
	private readonly clients = new Map<string, Client>()

	// Subscribes to unexpected transport closes and retains the coordinator used during disconnect.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
		readonly operationCoordinator: OperationCoordinator,
		readonly disconnectCleanupTimeout = DEFAULT_DISCONNECT_CLEANUP_TIMEOUT,
	) {
		indiBus.subscribe('close', (client) => {
			this.#unexpectedClose(client)
		})

		connectionBus.subscribe('open', (event) => wsm.send('connection:open', event))
		connectionBus.subscribe('close', (event) => wsm.send('connection:close', event))
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
				this.operationCoordinator.arbiter.markClientAvailable(client.id)
				const status = this.status(client)!
				connectionBus.emit('open', { status, reused: true })
				return status
			}
		}

		if (req.type === 'INDI') {
			const client = new IndiClient({ handler: indi })

			try {
				if (await client.connect(req.host, req.port)) {
					this.operationCoordinator.arbiter.markClientAvailable(client.id)
					this.clients.set(client.id, client)

					console.info('new connection to:', client.id, client.description)

					const status = this.status(client)!
					connectionBus.emit('open', { status, reused: false })
					return status
				} else {
					this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to INDI server', color: 'danger' })
				}
			} catch (e) {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to INDI server', color: 'danger' })
			}
		} else if (req.type === 'ALPACA') {
			const client = new AlpacaClient(`http${req.secured ? 's' : ''}://${req.host}:${req.port}`, { handler: indi }, indi)
			this.operationCoordinator.arbiter.markClientAvailable(client.id)

			try {
				if (await client.start()) {
					this.clients.set(client.id, client)

					console.info('new connection to:', client.id, client.description)

					const status = this.status(client)!
					connectionBus.emit('open', { status, reused: false })
					return status
				} else {
					this.operationCoordinator.arbiter.markClientUnavailable(client.id)
					this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to Alpaca server', color: 'danger' })
				}
			} catch (e) {
				this.operationCoordinator.arbiter.markClientUnavailable(client.id)
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to Alpaca server', color: 'danger' })
			}
		} else {
			const client = new ClientSimulator('client.simulator', indi)
			this.operationCoordinator.arbiter.markClientAvailable(client.id)
			this.clients.set(client.id, client)

			const g14 = await loadHnskyDatabase('g14')
			const g16 = await loadHnskyDatabase('g16')

			const catalogSources: Record<string, CatalogSource | undefined> = {
				VIZIER: vizierCatalogSource,
				HNSKY_G14: g14 ? (rightAscension, declination, radius) => hnskyCatalogSource(HNSKY_290_G14_FILES!, rightAscension, declination, radius) : undefined,
				HNSKY_G16: g16 ? (rightAscension, declination, radius) => hnskyCatalogSource(HNSKY_290_G16_FILES!, rightAscension, declination, radius) : undefined,
			} as const

			const options: DeviceSimulatorOptions = { save, load }
			const mount = new MountSimulator('Mount Simulator', client, options)
			const camera = new CameraSimulator('Camera Simulator', client, { ...options, mountManager, guideOutputManager, focuserManager, rotatorManager, catalogSources })
			const guideCamera = new CameraSimulator('Guide Camera Simulator', client, { ...options, mountManager, guideOutputManager, focuserManager, rotatorManager, catalogSources })
			const focuser = new FocuserSimulator('Focuser Simulator', client, options)
			const wheel = new WheelSimulator('Wheel Simulator', client, options)
			const rotator = new RotatorSimulator('Rotator Simulator', client, options)
			const flatPanel = new FlatPanelSimulator('Flat Panel Simulator', client, options)
			const cover = new CoverSimulator('Dust Cap Simulator', client, options)

			console.info('new connection to:', client.id, client.description)

			const status = this.status(client)!
			connectionBus.emit('open', { status, reused: false })
			return status
		}

		return undefined
	}

	// Blocks a client, waits bounded operational cleanup, then disposes its live transport.
	async disconnect(id: string | Client) {
		const entry = this.#entry(id)

		if (entry === undefined) return

		const [key, client] = entry
		this.operationCoordinator.arbiter.markClientUnavailable(client.id)

		const cleaned = await settlesWithin(this.operationCoordinator.cancelByClient(client.id, 'disconnected'), this.disconnectCleanupTimeout)

		if (!cleaned) console.warn('timed out while cleaning operations for:', client.id, client.description)
		if (this.clients.get(key) === client) this.#remove(key, client, true)
	}

	// Blocks and cancels operations after an unexpected close without waiting on an unavailable transport.
	#unexpectedClose(client: Client) {
		const entry = this.#entry(client)

		if (entry === undefined) return

		const [key] = entry
		this.operationCoordinator.arbiter.markClientUnavailable(client.id)
		void this.operationCoordinator.cancelByClient(client.id, 'disconnected').catch((error) => console.error(error))
		this.#remove(key, client, false)
	}

	// Locates the canonical map entry for either a client id or exact client instance.
	#entry(id: string | Client): readonly [string, Client] | undefined {
		if (typeof id === 'string') {
			const client = this.clients.get(id)
			return client && [id, client]
		}

		for (const entry of this.clients) {
			if (entry[1] === id) return entry
		}
	}

	// Removes one exact client, optionally disposes it, and emits its final connection status once.
	#remove(key: string, client: Client, dispose: boolean) {
		if (this.clients.get(key) !== client) return

		const status = this.status(client)!
		this.clients.delete(key)
		console.info('disconnected from:', client.id, client.description)
		if (dispose) client[Symbol.dispose]()
		connectionBus.emit('close', { status })
	}

	status(client?: string | Client): ConnectionStatus | undefined {
		if (client === undefined) return undefined

		if (typeof client === 'string') {
			client = this.clients.get(client)
			return client && this.status(client)
		} else {
			if (client instanceof IndiClient || client instanceof AlpacaClient) {
				return { id: client.id, host: client.remoteHost ?? '', ip: 'remoteIp' in client ? (client.remoteIp ?? '') : '', port: client.remotePort ?? -1, type: client.type }
			} else {
				return { id: client.id, host: '', ip: '', type: 'SIMULATOR', port: -1 }
			}
		}
	}

	list() {
		return Array.from(this.clients.values())
			.map((e) => this.status(e))
			.filter((e) => !!e)
	}
}

export function connection(connectionHandler: ConnectionHandler, indi: IndiClientHandler & DeviceProvider<Device>, mountManager: MountManager, focuserManager: FocuserManager, rotatorManager: RotatorManager, guideOutputManager: GuideOutputManager) {
	return {
		'/connections': { GET: () => response(connectionHandler.list()), POST: async (req) => response(await connectionHandler.connect(await req.json(), indi, mountManager, focuserManager, rotatorManager, guideOutputManager)) },
		'/connections/:id': { GET: (req) => response(connectionHandler.status(req.params.id)), DELETE: async (req) => response(await connectionHandler.disconnect(req.params.id)) },
	} as const satisfies Endpoints
}
