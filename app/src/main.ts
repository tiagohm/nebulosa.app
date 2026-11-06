import {
	type AboutInfo,
	type ConnectRequest,
	closeDatabase,
	createAboutRoutes,
	identifyCelestrakClient,
	identifyJplClient,
	reopenConnections,
	startObservatoryCameras,
	startSatelliteDownloads,
	routes,
	startDatabase,
	startEarthOrientation,
	startStores,
	stopObservatoryCameras,
	stopOperations,
	stopServer,
	websocket,
} from 'api'
import index from 'web/index.html'
import { version, description } from '../package.json'
import { serverAddress } from './address'

// Entry point of the application: serves the API routes, the /api/ws WebSocket, and the web UI from a
// single Bun server. Every path the API does not handle falls back to the UI's HTML entry point. A server whose
// operational database cannot be opened stops before serving. A stop signal ends the process once the running device
// operations and the media gateway of the observatory cameras were stopped and the database was closed, which writes its WAL back into the file. Under bun --hot, a change of
// the server code evaluates this module again; the previous run is stopped first and its connections are opened again.

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

// What a run of this module leaves for the next one under bun --hot, which keeps globalThis across evaluations.
interface HotReloadState {
	// Stops the run in place and resolves the connections it had open.
	stop?: () => Promise<readonly ConnectRequest[]>
}

// Key of the hot reload state on globalThis, shared by every evaluation of this module.
const HOT_RELOAD = Symbol.for('nebulosa.hotReload')

// State of the hot reload: empty in the first run, and in production, which never evaluates this module twice.
const hotReload = ((globalThis as { [HOT_RELOAD]?: HotReloadState })[HOT_RELOAD] ??= {})

// The previous run still holds its connections, operations, listeners, and database, so it stops before this one opens them.
const reopened = (await hotReload.stop?.()) ?? []

// A server that cannot keep its records never starts, and says why.
try {
	startDatabase()
} catch (error) {
	console.error(Error.isError(error) ? error.message : error)
	process.exit(1)
}

identifyJplClient(version)
identifyCelestrakClient(version)

// The first request already reads the same Earth orientation data as every later one.
await startEarthOrientation()

// What a crash left of the products of the Calibration Library and Image Stacking is finished without anyone opening them.
startStores()

// The CelesTrak groups chosen for automatic downloads are read again when allowed, then every 6 hours.
startSatelliteDownloads()

// The media gateway of the observatory cameras is started when any is enabled; no camera stream is read until watched.
startObservatoryCameras()

// Host and port of the server: --host and --port, else APP_HOST and APP_PORT, else localhost and 7000 (serverAddress).
const address = serverAddress(process.argv.slice(2), process.env)

// HTTP server listening on that address.
const server = Bun.serve({
	hostname: address.host,
	port: address.port,
	development: development && { hmr: true, console: true },
	routes: {
		...routes,
		...createAboutRoutes(ABOUT),
		'/*': index,
	},
	websocket,
})

// Stops the device work still running, so no device is left moving, and the media gateway of the observatory cameras,
// then closes the database and ends the process.
async function stop() {
	await Promise.all([stopOperations(), stopObservatoryCameras()])
	closeDatabase()
	process.exit(0)
}

// Each signal is handled once, replacing the handler of the previous hot reload; a second one while the operations stop
// ends the process at once, as the default handler does.
for (const signal of STOP_SIGNALS) {
	process.removeAllListeners(signal)
	process.once(signal, () => void stop())
}

hotReload.stop = stopServer

// The connections the previous run had open are opened again, so a change of the server code keeps the equipment connected.
void reopenConnections(reopened)

console.info(`Nebulosa is running at ${server.url}`)
