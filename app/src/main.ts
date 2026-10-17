import { routes, websocket } from 'api'
import index from 'web/index.html'

// Entry point of the application: serves the API routes, the /api/ws WebSocket, and the web UI from a
// single Bun server. Every path the API does not handle falls back to the UI's HTML entry point.

// Whether the server runs in development mode (HMR and the browser console); false when NODE_ENV is production.
const development = process.env.NODE_ENV !== 'production'

// HTTP server listening on APP_HOST (default localhost) and APP_PORT (default 7000).
const server = Bun.serve({
	hostname: process.env.APP_HOST || 'localhost',
	port: Number(process.env.APP_PORT) || 7000,
	development: development && { hmr: true, console: true },
	routes: {
		...routes,
		'/*': index,
	},
	websocket,
})

console.info(`Nebulosa is running at ${server.url}`)
