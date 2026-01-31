import { Cron } from 'croner'
import { existsSync, type MakeDirectoryOptions, rmSync } from 'fs'
import fs from 'fs/promises'
import type { Client, DewHeater, GuideOutput, Thermometer } from 'nebulosa/src/indi.device'
import { CameraManager, CoverManager, DevicePropertyManager, type DeviceProvider, DewHeaterManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, ThermometerManager, WheelManager } from 'nebulosa/src/indi.manager'
import { default as openDefaultApp } from 'open'
import os from 'os'
import { join } from 'path'
import { AlpacaHandler, alpaca } from 'src/api/alpaca'
import { AtlasHandler, atlas } from 'src/api/atlas'
import { AutoFocusHandler, autoFocus } from 'src/api/autofocus'
import { CacheManager } from 'src/api/cache'
import { CameraHandler, camera } from 'src/api/camera'
import { ConnectionHandler, connection } from 'src/api/connection'
import { CoverHandler, cover } from 'src/api/cover'
import { DarvHandler, darv } from 'src/api/darv'
import { DewHeaterHandler, dewHeater } from 'src/api/dewheater'
import { FlatPanelHandler, flatPanel } from 'src/api/flatpanel'
import { FlatWizardHandler, flatWizard } from 'src/api/flatwizard'
import { FocuserHandler, focuser } from 'src/api/focuser'
import { GuideOutputHandler, guideOutput } from 'src/api/guideoutput'
import { IndiDevicePropertyHandler, IndiHandler, IndiServerHandler, indi } from 'src/api/indi'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler, MountRemoteControlHandler, mount } from 'src/api/mount'
import { NotificationHandler } from 'src/api/notification'
import { PHD2Handler, phd2 } from 'src/api/phd2'
import { RotatorHandler, rotator } from 'src/api/rotator'
import { ThermometerHandler, thermometer } from 'src/api/thermometer'
import { TppaHandler, tppa } from 'src/api/tppa'
import { WheelHandler, wheel } from 'src/api/wheel'
import { parseArgs } from 'util'
import { ConfirmationHandler, confirmation } from './src/api/confirmation'
import { FileSystemHandler, fileSystem } from './src/api/filesystem'
import { FramingHandler, framing } from './src/api/framing'
import { ImageHandler, ImageProcessor, image } from './src/api/image'
import { PlateSolverHandler, plateSolver } from './src/api/platesolver'
import { StarDetectionHandler, starDetection } from './src/api/stardetection'
import homeHtml from './src/web/pages/home/index.html'

const CREATE_RECURSIVE_DIRECTORY: MakeDirectoryOptions = { recursive: true }

// Arguments

const args = parseArgs({
	args: Bun.argv,
	options: {
		host: { type: 'string', short: 'h' },
		port: { type: 'string', short: 'p' },
		secure: { type: 'boolean', short: 's' },
		cert: { type: 'string', short: 'c' },
		key: { type: 'string', short: 'k' },
		open: { type: 'boolean', short: 'o' },
		dir: { type: 'string', short: 'd' },
		username: { type: 'string', short: 'u' },
		password: { type: 'string' },
		alpaca: { type: 'boolean', short: 'a' },
		alpacaPort: { type: 'string' },
		alpacaDiscoveryPort: { type: 'string' },
	},
	strict: true,
	allowPositionals: true,
})

const hostname = args.values.host || Bun.env.host || 'localhost'
const port = +(args.values.port || Bun.env.port || '1234')
const cert = args.values.cert || Bun.env.cert || 'cert.pem'
const key = args.values.key || Bun.env.key || 'key.pem'
const secure = args.values.secure || Bun.env.secure === 'true' || undefined
const open = !!args.values.open || Bun.env.open === 'true'
const appDir = args.values.dir || Bun.env.appDir
const username = args.values.username || Bun.env.username || ''
const password = args.values.password || Bun.env.password || ''
const hasAlpaca = args.values.alpaca || Bun.env.alpaca === 'true'
const alpacaPort = +(args.values.alpacaPort || Bun.env.alpacaPort || '') || undefined
const alpacaDiscoveryPort = +(args.values.alpacaDiscoveryPort || Bun.env.alpacaDiscoveryPort || '') || undefined

// Initialize the environment variables

function checkDirAccess(...paths: string[]) {
	const path = join(...paths)

	try {
		fs.access(path, fs.constants.R_OK | fs.constants.W_OK)
	} catch {
		console.error('unable to access the app directory at', Bun.env.homeDir)
		process.exit(0)
	}

	return path
}

if (appDir) {
	checkDirAccess(appDir)
} else {
	Bun.env.homeDir = checkDirAccess(os.homedir())
}

if (process.platform === 'linux') {
	Bun.env.tmpDir = join(checkDirAccess('/dev/shm'), 'nebulosa')
	Bun.env.appDir = appDir || join(Bun.env.homeDir, '.nebulosa')
	Bun.env.capturesDir = join(Bun.env.appDir, 'captures')
	Bun.env.satellitesDir = join(Bun.env.appDir, 'satellites')
} else if (process.platform === 'win32') {
	const documentsDir = appDir || join(checkDirAccess(Bun.env.homeDir, 'Documents'), 'Nebulosa')
	Bun.env.appDir = appDir || join(checkDirAccess(Bun.env.homeDir, 'AppData', 'Local'), 'Nebulosa')
	Bun.env.tmpDir = join(Bun.env.appDir, 'Temp')
	Bun.env.capturesDir = join(documentsDir, 'Captures')
	Bun.env.satellitesDir = join(Bun.env.appDir, 'Satellites')
}

await fs.mkdir(Bun.env.appDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.tmpDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.capturesDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.satellitesDir, CREATE_RECURSIVE_DIRECTORY)

console.info('app directory is located at', Bun.env.appDir)
console.info('captures directory is located at', Bun.env.capturesDir)
console.info('temp directory is located at', Bun.env.tmpDir)

// Running from package.json script has a bug on interrupt signals: https://github.com/oven-sh/bun/issues/11400

function clear(exit: boolean) {
	if (existsSync(Bun.env.tmpDir)) {
		console.info('clearing temp directory...')
		rmSync(Bun.env.tmpDir, { recursive: true })
	}

	exit && process.exit(0)
}

process.once('beforeExit', clear.bind(undefined, true))
process.once('SIGINT', clear.bind(undefined, true))
process.once('SIGTERM', clear.bind(undefined, true))

clear(false)

// DNS caching

process.env.BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS = '86400'

Bun.dns.prefetch('celestrak.org')
Bun.dns.prefetch('ssd.jpl.nasa.gov')
Bun.dns.prefetch('sdo.gsfc.nasa.gov')
Bun.dns.prefetch('hpiers.obspm.fr')

// Handlers & INDI Devices

const wsm = new WebSocketMessageHandler()
const notificationHandler = new NotificationHandler(wsm)
const connectionHandler = new ConnectionHandler(wsm, notificationHandler)
const imageProcessor = new ImageProcessor()
const cacheManager = new CacheManager()

const cameraManager = new CameraManager()
const focuserManager = new FocuserManager()
const wheelManager = new WheelManager()
const mountManager = new MountManager()
const coverManager = new CoverManager()
const flatPanelManager = new FlatPanelManager()
const rotatorManager = new RotatorManager()

const guideOutputProvider: DeviceProvider<GuideOutput> = {
	get: (client: Client, name: string) => {
		return cameraManager.get(client, name) ?? mountManager.get(client, name)
	},
}

const thermometerProvider: DeviceProvider<Thermometer> = {
	get: (client: Client, name: string) => {
		return cameraManager.get(client, name) ?? focuserManager.get(client, name)
	},
}

const dewHeaterProvider: DeviceProvider<DewHeater> = {
	get: (client: Client, name: string) => {
		return coverManager.get(client, name)
	},
}

const guideOutputManager = new GuideOutputManager(guideOutputProvider)
const thermometerManager = new ThermometerManager(thermometerProvider)
const dewHeaterManager = new DewHeaterManager(dewHeaterProvider)

const phd2Handler = new PHD2Handler(wsm, notificationHandler)
const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, phd2Handler)
const mountHandler = new MountHandler(wsm, mountManager, cacheManager)
const mountRemoteControlHandler = new MountRemoteControlHandler(mountManager)
const focuserHandler = new FocuserHandler(wsm, focuserManager)
const wheelHandler = new WheelHandler(wsm, wheelManager)
const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager)
const coverHandler = new CoverHandler(wsm, coverManager)
const flatPanelHandler = new FlatPanelHandler(wsm, flatPanelManager)
const rotatorHandler = new RotatorHandler(wsm, rotatorManager)
const dewHeaterHandler = new DewHeaterHandler(wsm, dewHeaterManager)
const devicePropertyManager = new DevicePropertyManager()
const indiHandler = new IndiHandler(cameraManager, guideOutputManager, thermometerManager, mountManager, focuserManager, wheelManager, coverManager, flatPanelManager, dewHeaterManager, rotatorManager, devicePropertyManager, wsm)
const indiDevicePropertyHandler = new IndiDevicePropertyHandler(wsm, notificationHandler, indiHandler, devicePropertyManager)
const indiServerHandler = new IndiServerHandler(wsm)
const confirmationHandler = new ConfirmationHandler(wsm)
const framingHandler = new FramingHandler(imageProcessor)
const fileSystemHandler = new FileSystemHandler()
const starDetectionHandler = new StarDetectionHandler(imageProcessor)
const plateSolverHandler = new PlateSolverHandler(notificationHandler, imageProcessor)
const atlasHandler = new AtlasHandler(cacheManager, notificationHandler)
const imageHandler = new ImageHandler(imageProcessor, notificationHandler)
const tppaHandler = new TppaHandler(wsm, cameraHandler, mountHandler, plateSolverHandler)
const darvHandler = new DarvHandler(wsm, cameraHandler, mountHandler)
const autoFocusHandler = new AutoFocusHandler(wsm, cameraHandler, focuserHandler, starDetectionHandler)
const flatWizardHandler = new FlatWizardHandler(wsm, cameraHandler)
const alpacaHandler = new AlpacaHandler(wsm, { camera: cameraManager, mount: mountManager, focuser: focuserManager, wheel: wheelManager, cover: coverManager, flatPanel: flatPanelManager, rotator: rotatorManager, guideOutput: guideOutputManager }, alpacaDiscoveryPort)

void atlasHandler.refreshImageOfSun()
void atlasHandler.refreshSatellites()
void atlasHandler.refreshEarthOrientationData()

// Server

const server = Bun.serve({
	hostname,
	port,
	reusePort: false,
	development: process.env.NODE_ENV !== 'production' && {
		hmr: true,
		console: false,
	},
	tls: secure && {
		cert: Bun.file(cert),
		key: Bun.file(key),
	},
	fetch: (req, server) => {
		if (server.upgrade(req)) {
			return
		}
	},
	error: (error) => {
		console.error(error)
	},
	routes: {
		'/': homeHtml,
		...connection(connectionHandler, indiHandler),
		...confirmation(confirmationHandler),
		...indi(indiHandler, indiDevicePropertyHandler, indiServerHandler),
		...camera(cameraHandler),
		...mount(mountHandler, mountRemoteControlHandler),
		...focuser(focuserHandler),
		...wheel(wheelHandler),
		...thermometer(thermometerHandler),
		...guideOutput(guideOutputHandler),
		...cover(coverHandler),
		...flatPanel(flatPanelHandler),
		...rotator(rotatorHandler),
		...dewHeater(dewHeaterHandler),
		...atlas(atlasHandler),
		...image(imageHandler),
		...framing(framingHandler),
		...starDetection(starDetectionHandler),
		...plateSolver(plateSolverHandler),
		...fileSystem(fileSystemHandler),
		...tppa(tppaHandler),
		...darv(darvHandler),
		...flatWizard(flatWizardHandler),
		...autoFocus(autoFocusHandler),
		...alpaca(alpacaHandler, alpacaPort, hasAlpaca),
		...phd2(phd2Handler),
	},
	websocket: {
		open: (socket) => wsm.open(socket),
		message: (socket, body) => wsm.message(socket, body),
		close: (socket, code, reason) => wsm.close(socket, code, reason),
	},
})

const everyMinute = new Cron('0 */1 * * * *', () => {
	imageProcessor.clear()
	indiDevicePropertyHandler.clear()
})

const every15Minutes = new Cron('0 */15 * * * *', () => {
	void atlasHandler.refreshImageOfSun()
})

const everyHour = new Cron('0 0 * * * *', () => {
	cacheManager.clear()
})

const everyDay = new Cron('0 0 0 * * *', () => {
	void atlasHandler.refreshSatellites()
	void atlasHandler.refreshEarthOrientationData()
})

// TODO:
// 	.use(basicAuth({ enabled: username.length >= 5 && password.length >= 8, realm: 'Nebulosa', credentials: [{ username, password }] }))

const url = `http${secure ? 's' : ''}://${server.hostname}:${server.port}`

console.info(`server is started at ${url}`)

if (open) {
	void openDefaultApp(url)
}
