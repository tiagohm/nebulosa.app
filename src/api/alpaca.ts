import { AlpacaDiscoveryServer } from 'nebulosa/src/alpaca.discovery'
import { AlpacaServer } from 'nebulosa/src/alpaca.server'
import type { AlpacaServerOptions } from 'nebulosa/src/alpaca.types'
import type { AlpacaServerStatus } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class AlpacaHandler {
	private alpacaServer?: AlpacaServer
	private alpacaDiscoveryServer?: AlpacaDiscoveryServer
	private running = false

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly options: AlpacaServerOptions,
		private readonly alpacaDiscoveryPort?: number,
	) {}

	status(): AlpacaServerStatus {
		return { running: this.running, serverPort: this.alpacaServer?.port ?? -1, discoveryPort: this.alpacaDiscoveryServer?.port ?? -1, devices: Array.from(this.alpacaServer?.configuredDevices() ?? []) }
	}

	async start(port: number) {
		if (!this.running && port) {
			this.running = true

			try {
				this.alpacaServer = new AlpacaServer(this.options)
				this.alpacaDiscoveryServer = new AlpacaDiscoveryServer({ ignoreLocalhost: true })

				this.alpacaServer.start(undefined, port)
				console.info('alpaca server is started at port', this.alpacaServer.port)

				this.alpacaDiscoveryServer.addPort(this.alpacaServer.port)
				await this.alpacaDiscoveryServer.start(undefined, this.alpacaDiscoveryPort)
				console.info('alpaca discovery server is started at port', this.alpacaDiscoveryServer.port)

				this.wsm.send('alpaca:start', undefined)
			} catch (e) {
				console.error(e)
				this.running = false
			}
		}
	}

	stop() {
		if (this.running) {
			this.running = false

			this.alpacaServer?.stop()
			this.alpacaServer = undefined
			console.info('alpaca server is stopped')

			this.alpacaDiscoveryServer?.stop()
			this.alpacaDiscoveryServer = undefined
			console.info('alpaca discovery server is stopped')

			this.wsm.send('alpaca:stop', undefined)
		}
	}
}

export function alpaca(alpacaHandler: AlpacaHandler, alpacaPort: number | undefined, shouldStart: boolean): Endpoints {
	if (shouldStart) {
		void alpacaHandler.start(alpacaPort || 2222)
	}

	return {
		'/alpaca/status': { GET: () => response(alpacaHandler.status()) },
		'/alpaca/start': { POST: async (req) => response(await alpacaHandler.start(+query(req).port)) },
		'/alpaca/stop': { POST: () => response(alpacaHandler.stop()) },
	}
}
