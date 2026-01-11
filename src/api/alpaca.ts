import Elysia from 'elysia'
import { AlpacaDiscoveryServer } from 'nebulosa/src/alpaca.discovery'
import { AlpacaServer } from 'nebulosa/src/alpaca.server'
import type { AlpacaServerOptions } from 'nebulosa/src/alpaca.types'
import type { AlpacaServerStatus } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export interface AlpacaOptions {
	alpacaPort?: number
	alpacaDiscoveryPort?: number
}

export function alpaca(wsm: WebSocketMessageHandler, options: AlpacaServerOptions & AlpacaOptions, shouldStart: boolean) {
	let alpacaServer: AlpacaServer | undefined
	let alpacaDiscoveryServer: AlpacaDiscoveryServer | undefined
	let running = false

	function status(): AlpacaServerStatus {
		return { running, port: alpacaDiscoveryServer?.port ?? -1, devices: alpacaServer ? Array.from(alpacaServer.configuredDevices()) : [] }
	}

	async function start(port: number) {
		if (!running && port) {
			running = true

			try {
				alpacaServer = new AlpacaServer(options)
				alpacaDiscoveryServer = new AlpacaDiscoveryServer({ ignoreLocalhost: true })

				alpacaServer.start(undefined, port)
				console.info('alpaca server is started at port', alpacaServer.port)

				alpacaDiscoveryServer.addPort(alpacaServer.port)
				await alpacaDiscoveryServer.start(undefined, options.alpacaDiscoveryPort)
				console.info('alpaca discovery server is started at port', alpacaDiscoveryServer.port)

				wsm.send('alpaca:start', undefined)
			} catch (e) {
				console.error(e)
				running = false
			}
		}
	}

	function stop() {
		if (running) {
			running = false

			alpacaServer?.stop()
			alpacaServer = undefined

			alpacaDiscoveryServer?.stop()
			alpacaDiscoveryServer = undefined

			wsm.send('alpaca:stop', undefined)

			console.info('alpaca discovery server is stopped')
		}
	}

	if (shouldStart) {
		void start(options.alpacaPort || 2222)
	}

	const app = new Elysia({ prefix: '/alpaca' })
		// Endpoints!
		.get('/status', () => status())
		.post('/start', ({ query }) => start(+query.port))
		.post('/stop', () => stop())

	return app
}
