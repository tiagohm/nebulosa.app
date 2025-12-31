import Elysia from 'elysia'
import type { AlpacaServer } from 'nebulosa/src/alpaca.server'

export function alpaca(alpacaServer?: AlpacaServer) {
	const app = new Elysia({ prefix: '/alpaca' })
		// Endpoints!
		.get('', () => (alpacaServer ? Array.from(alpacaServer.list()) : []))

	return app
}
