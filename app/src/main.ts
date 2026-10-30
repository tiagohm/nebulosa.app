import { type AboutInfo, createAboutRoutes, flushStores, routes, websocket } from 'api'
import index from 'web/index.html'
import { version, description } from '../package.json'

// Entry point of the application: serves the API routes, the /api/ws WebSocket, and the web UI from a
// single Bun server. Every path the API does not handle falls back to the UI's HTML entry point. A stop signal ends
// the process only after the persisted stores wrote their pending changes; a second signal ends it at once.

// Whether the server runs in development mode (HMR and the browser console); false when NODE_ENV is production.
const development = process.env.NODE_ENV !== 'production'

// Identity of this distribution for the About page: the package version, the commits and compile time that
// build.ts inlines into the executable (absent when running from source), and the runtime of this process.
const ABOUT: AboutInfo = {
	version,
	description,
	commit: process.env.NEBULOSA_BUILD_COMMIT || undefined,
	coreCommit: process.env.NEBULOSA_CORE_COMMIT || undefined,
	builtAt: process.env.NEBULOSA_BUILT_AT || undefined,
	runtime: `Bun ${Bun.version_with_sha}`,
	platform: `${process.platform}/${process.arch}`,
}

// Signals that stop the server: Ctrl+C, a service manager, and a closed terminal or console window.
const STOP_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

// HTTP server listening on APP_HOST (default localhost) and APP_PORT (default 7000).
const server = Bun.serve({
	hostname: process.env.APP_HOST || 'localhost',
	port: Number(process.env.APP_PORT) || 7000,
	development: development && { hmr: true, console: true },
	routes: {
		...routes,
		...createAboutRoutes(ABOUT),
		'/*': index,
	},
	websocket,
})

// Each signal is handled once, replacing the handler of the previous hot reload.
for (const signal of STOP_SIGNALS) {
	process.removeAllListeners(signal)
	process.once(signal, () => void flushStores().then(() => process.exit(0)))
}

console.info(`Nebulosa is running at ${server.url}`)
