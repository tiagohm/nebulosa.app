import Elysia from 'elysia'
import type { AlpacaDiscoveryServer, AlpacaServer } from 'nebulosa/src/alpaca.server'
import type { AlpacaServerStatus } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function alpaca(wsm: WebSocketMessageHandler, alpacaServer: AlpacaServer, alpacaDiscoveryServer: AlpacaDiscoveryServer) {
	let running = alpacaServer.running

	function status(): AlpacaServerStatus {
		return { running, port: alpacaDiscoveryServer?.port ?? -1, devices: alpacaServer ? Array.from(alpacaServer.list()) : [] }
	}

	async function start(port?: number) {
		if (!running) {
			running = true

			try {
				alpacaServer.listen()
				await alpacaDiscoveryServer.start(undefined, port)
				wsm.send('alpaca:start', undefined)

				console.info('alpaca discovery server is started at port', alpacaDiscoveryServer.port)
			} catch (e) {
				console.error(e)
				running = false
			}
		}
	}

	function stop() {
		if (running) {
			running = false
			alpacaServer?.unlisten()
			alpacaDiscoveryServer?.stop()
			wsm.send('alpaca:stop', undefined)

			console.info('alpaca discovery server is stopped')
		}
	}

	const app = new Elysia({ prefix: '/alpaca' })
		// Endpoints!
		.get('/status', () => status())
		.post('/start', () => start())
		.post('/stop', () => stop())

	return app
}
