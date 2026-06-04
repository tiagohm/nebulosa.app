import { type AlpacaDeviceServer, AlpacaDiscoveryClient, AlpacaDiscoveryServer } from 'nebulosa/src/alpaca.discovery'
import { AlpacaServer } from 'nebulosa/src/alpaca.server'
import type { AlpacaServerHandler, AlpacaServerOptions } from 'nebulosa/src/alpaca.server'
import type { AlpacaConfiguredDevice } from 'nebulosa/src/alpaca.types'
import type { Device } from 'nebulosa/src/indi.device'
import { normalizePort } from 'src/shared/normalizer'
import type { AlpacaServerStatus } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class AlpacaHandler implements AlpacaServerHandler {
	private alpacaServer?: AlpacaServer
	private alpacaDiscoveryServer?: AlpacaDiscoveryServer
	private startTask?: Promise<void>
	private running = false

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly options: Omit<AlpacaServerOptions, 'handler'>,
		private readonly alpacaDiscoveryPort?: number,
	) {}

	status(): AlpacaServerStatus {
		const running = this.running && !!this.alpacaServer?.running && !!this.alpacaDiscoveryServer?.running
		return { running, serverPort: this.alpacaServer?.port ?? -1, discoveryPort: this.alpacaDiscoveryServer?.port ?? -1, devices: Array.from(this.alpacaServer?.configuredDevices() ?? []) }
	}

	deviceAdded(server: AlpacaServer, device: Device, configuredDevice: AlpacaConfiguredDevice) {
		this.wsm.send('alpaca:device:add', configuredDevice)
	}

	deviceRemoved(server: AlpacaServer, device: Device, configuredDevice: AlpacaConfiguredDevice) {
		this.wsm.send('alpaca:device:remove', configuredDevice)
	}

	async start(port: unknown) {
		const serverPort = normalizePort(port)
		if (!serverPort || this.running) return
		if (this.startTask) return this.startTask

		this.startTask = this.startServer(serverPort)

		try {
			await this.startTask
		} finally {
			this.startTask = undefined
		}
	}

	private async startServer(port: number) {
		const options = { ...this.options, handler: this }
		const alpacaServer = new AlpacaServer(options)
		const alpacaDiscoveryServer = new AlpacaDiscoveryServer({ ignoreLocalhost: true })
		let started = false

		try {
			alpacaServer.start(undefined, port)
			console.info('alpaca server is started at port', alpacaServer.port)

			alpacaDiscoveryServer.addPort(alpacaServer.port)
			await alpacaDiscoveryServer.start(undefined, normalizePort(this.alpacaDiscoveryPort))
			console.info('alpaca discovery server is started at port', alpacaDiscoveryServer.port)

			this.alpacaServer = alpacaServer
			this.alpacaDiscoveryServer = alpacaDiscoveryServer
			this.running = true
			started = true

			this.wsm.send('alpaca:start', this.status())
		} catch (e) {
			console.error(e)
		} finally {
			if (!started) {
				alpacaDiscoveryServer.stop()
				alpacaServer.stop()
				this.running = false
			}
		}
	}

	async stop() {
		if (this.startTask) await this.startTask
		if (!this.running && !this.alpacaServer && !this.alpacaDiscoveryServer) return

		this.running = false

		this.alpacaServer?.stop()
		this.alpacaServer = undefined
		console.info('alpaca server is stopped')

		this.alpacaDiscoveryServer?.stop()
		this.alpacaDiscoveryServer = undefined
		console.info('alpaca discovery server is stopped')

		this.wsm.send('alpaca:stop', undefined)
	}

	async discovery() {
		const alpacaDiscoveryClient = new AlpacaDiscoveryClient()
		const servers: AlpacaDeviceServer[] = []
		const seen = new Set<string>()

		try {
			await alpacaDiscoveryClient.discovery(
				(e) => {
					const key = `${e.address}:${e.port}`
					if (seen.has(key)) return
					seen.add(key)
					servers.push(e)
				},
				{ timeout: 5000, fetch: true, wait: true },
			)
		} finally {
			alpacaDiscoveryClient.close()
		}

		return servers
	}
}

export function alpaca(alpacaHandler: AlpacaHandler, alpacaPort: number | undefined, shouldStart: boolean) {
	if (shouldStart) void alpacaHandler.start(alpacaPort || 2222)

	return {
		'/alpaca/status': { GET: () => response(alpacaHandler.status()) },
		'/alpaca/start': { POST: async (req) => response(await alpacaHandler.start(+query(req).port)) },
		'/alpaca/stop': { POST: async () => response(await alpacaHandler.stop()) },
		'/alpaca/discovery': { POST: async () => response(await alpacaHandler.discovery()) },
	} as const satisfies Endpoints
}
