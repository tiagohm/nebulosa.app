import { basicAuth } from '@eelkevdbos/elysia-basic-auth'
import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import Elysia from 'elysia'
import type { MakeDirectoryOptions } from 'fs'
import fs from 'fs/promises'
import type { DewHeater, GuideOutput, Thermometer } from 'nebulosa/src/indi.device'
import { CameraManager, CoverManager, DevicePropertyManager, type DeviceProvider, DewHeaterManager, FlatPanelManager, FocuserManager, GuideOutputManager, MountManager, ThermometerManager, WheelManager } from 'nebulosa/src/indi.manager'
import { default as openDefaultApp } from 'open'
import os from 'os'
import { join } from 'path'
import { AtlasHandler, atlas } from 'src/api/atlas'
import { CacheManager } from 'src/api/cache'
import { CameraHandler, camera } from 'src/api/camera'
import { ConnectionHandler, connection } from 'src/api/connection'
import { CoverHandler, cover } from 'src/api/cover'
import { DarvHandler, darv } from 'src/api/darv'
import { DewHeaterHandler, dewHeater } from 'src/api/dewheater'
import { FlatPanelHandler, flatPanel } from 'src/api/flatpanel'
import { FocuserHandler, focuser } from 'src/api/focuser'
import { GuideOutputHandler, guideOutput } from 'src/api/guideoutput'
import { IndiDevicePropertyHandler, IndiHandler, IndiServerHandler, indi } from 'src/api/indi'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler, MountRemoteControlHandler, mount } from 'src/api/mount'
import { NotificationHandler } from 'src/api/notification'
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
import { X_IMAGE_INFO_HEADER } from './src/shared/types'
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

// Initialize the environment variables

function checkDirAccess(...paths: string[]) {
	const path = join(...paths)

	try {
		fs.access(path, fs.constants.R_OK | fs.constants.W_OK)
	} catch {
		console.error('unable to access directory at', Bun.env.homeDir)
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
	Bun.env.tmpDir = checkDirAccess('/dev/shm')
	Bun.env.appDir = appDir || join(Bun.env.homeDir, '.nebulosa')
	Bun.env.capturesDir = join(Bun.env.appDir, 'captures')
	Bun.env.framingDir = join(Bun.env.appDir, 'framing')
	Bun.env.satellitesDir = join(Bun.env.appDir, 'satellites')
} else if (process.platform === 'win32') {
	Bun.env.tmpDir = checkDirAccess(os.tmpdir())
	const documentsDir = appDir || join(checkDirAccess(Bun.env.homeDir, 'Documents'), 'Nebulosa')
	Bun.env.appDir = appDir || join(checkDirAccess(Bun.env.homeDir, 'AppData', 'Local'), 'Nebulosa')
	Bun.env.capturesDir = join(documentsDir, 'Captures')
	Bun.env.framingDir = join(Bun.env.appDir, 'Framing')
	Bun.env.satellitesDir = join(Bun.env.appDir, 'Satellites')
}

await fs.mkdir(Bun.env.appDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.capturesDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.framingDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.satellitesDir, CREATE_RECURSIVE_DIRECTORY)

console.info('app directory is located at', Bun.env.appDir)
console.info('captures directory is located at', Bun.env.capturesDir)

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

const cameraManager = new CameraManager()
const focuserManager = new FocuserManager()
const wheelManager = new WheelManager()
const mountManager = new MountManager()
const coverManager = new CoverManager()
const flatPanelManager = new FlatPanelManager()

const guideOutputProvider: DeviceProvider<GuideOutput> = {
	get: (name: string) => {
		return cameraManager.get(name) ?? mountManager.get(name)
	},
}

const thermometerProvider: DeviceProvider<Thermometer> = {
	get: (name: string) => {
		return cameraManager.get(name) ?? focuserManager.get(name)
	},
}

const dewHeaterProvider: DeviceProvider<DewHeater> = {
	get: (name: string) => {
		return coverManager.get(name)
	},
}

const guideOutputManager = new GuideOutputManager(guideOutputProvider)
const thermometerManager = new ThermometerManager(thermometerProvider)
const dewHeaterManager = new DewHeaterManager(dewHeaterProvider)

const imageProcessor = new ImageProcessor()

const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, guideOutputManager, thermometerManager, mountManager, wheelManager, focuserManager)
cameraManager.addHandler(cameraHandler)

const mountHandler = new MountHandler(wsm)
mountManager.addHandler(mountHandler)
const mountRemoteControlHandler = new MountRemoteControlHandler(mountManager, connectionHandler)

const focuserHandler = new FocuserHandler(wsm)
focuserManager.addHandler(focuserHandler)

const wheelHandler = new WheelHandler(wsm)
wheelManager.addHandler(wheelHandler)

const flatPanelHandler = new FlatPanelHandler(wsm)
flatPanelManager.addHandler(flatPanelHandler)

const coverHandler = new CoverHandler(wsm)
coverManager.addHandler(coverHandler)

const guideOutputHandler = new GuideOutputHandler(wsm)
guideOutputManager.addHandler(guideOutputHandler)

const thermometerHandler = new ThermometerHandler(wsm)
thermometerManager.addHandler(thermometerHandler)

const dewHeaterHandler = new DewHeaterHandler(wsm)
dewHeaterManager.addHandler(dewHeaterHandler)

const devicePropertyManager = new DevicePropertyManager()
const indiDevicePropertyHandler = new IndiDevicePropertyHandler(wsm, devicePropertyManager)
devicePropertyManager.addHandler(indiDevicePropertyHandler)

const cacheManager = new CacheManager()

const indiHandler = new IndiHandler(cameraManager, guideOutputManager, thermometerManager, mountManager, focuserManager, wheelManager, coverManager, flatPanelManager, dewHeaterManager, devicePropertyManager, wsm)
const indiServerHandler = new IndiServerHandler(wsm)
const confirmationHandler = new ConfirmationHandler(wsm)
const framingHandler = new FramingHandler(imageProcessor)
const fileSystemHandler = new FileSystemHandler()
const starDetectionHandler = new StarDetectionHandler()
const plateSolverHandler = new PlateSolverHandler(notificationHandler)
const atlasHandler = new AtlasHandler(cacheManager, notificationHandler)
const imageHandler = new ImageHandler(imageProcessor, notificationHandler)
const tppaHandler = new TppaHandler(wsm, cameraHandler, mountManager, plateSolverHandler)
const darvHandler = new DarvHandler(wsm, cameraHandler, mountManager)

void atlasHandler.refreshImageOfSun()
void atlasHandler.refreshSatellites()
void atlasHandler.refreshEarthOrientationData()

// App

const app = new Elysia({
	serve: {
		routes: {
			'/': homeHtml,
		},
		development: process.env.NODE_ENV !== 'production' && {
			hmr: true,
			console: false,
		},
		tls: secure && {
			cert: Bun.file(cert),
			key: Bun.file(key),
		},
	},
})

	// Cross-Origin Resource Sharing (CORS)

	.use(
		cors({
			exposeHeaders: [X_IMAGE_INFO_HEADER],
		}),
	)

	// Cron

	.use(
		cron({
			name: 'every-minute',
			pattern: '0 */1 * * * *',
			run: () => {
				void imageProcessor.cleanUp()
				indiDevicePropertyHandler.cleanUp()
			},
		}),
	)
	.use(
		cron({
			name: 'every-15-minutes',
			pattern: '0 */15 * * * *',
			run: () => {
				void atlasHandler.refreshImageOfSun()
			},
		}),
	)
	.use(
		cron({
			name: 'every-day',
			pattern: '0 0 0 * * *',
			run: () => {
				void atlasHandler.refreshSatellites()
				void atlasHandler.refreshEarthOrientationData()
			},
		}),
	)

	// Error Handling

	.onError((req) => {
		console.error(req.error)
		return undefined
	})

	// Before Response

	.onAfterHandle(({ path, set }) => {
		if (path === '/atlas/sun/image') {
			set.headers['cache-control'] = 'public, max-age=900, immutable' // 15 minutes
		} else {
			set.headers['cache-control'] = 'no-cache, no-store, must-revalidate'
			set.headers.pragma = 'no-cache'
			set.headers.expires = '0'
		}
	})

	// Endpoints

	.use(connection(connectionHandler, indiHandler))
	.use(confirmation(confirmationHandler))
	.use(indi(indiHandler, indiServerHandler, indiDevicePropertyHandler, connectionHandler))
	.use(camera(cameraManager, cameraHandler, connectionHandler))
	.use(mount(mountManager, mountRemoteControlHandler, connectionHandler))
	.use(focuser(focuserManager, connectionHandler))
	.use(wheel(wheelManager, connectionHandler))
	.use(thermometer(thermometerManager))
	.use(guideOutput(guideOutputManager, connectionHandler))
	.use(cover(coverManager, connectionHandler))
	.use(flatPanel(flatPanelManager, connectionHandler))
	.use(dewHeater(dewHeaterManager, connectionHandler))
	.use(atlas(atlasHandler))
	.use(image(imageHandler))
	.use(framing(framingHandler))
	.use(starDetection(starDetectionHandler))
	.use(plateSolver(plateSolverHandler))
	.use(fileSystem(fileSystemHandler))
	.use(tppa(tppaHandler, connectionHandler))
	.use(darv(darvHandler, connectionHandler))

	// WebSocket

	.ws('/ws', {
		open: (socket) => wsm.open(socket.raw),
		message: (socket, message) => wsm.message(socket.raw, message),
		close: (socket, code, reason) => wsm.close(socket.raw, code, reason),
	})

	// Basic Auth

	.use(basicAuth({ enabled: username.length >= 5 && password.length >= 8, realm: 'Nebulosa', credentials: [{ username, password }] }))

	// Start!

	.listen({ hostname, port })

const schema = `http${secure ? 's' : ''}`
const url = `${schema}://${app.server!.hostname}:${app.server!.port}`

console.info(`server is started at: ${url}`)

if (open) {
	void openDefaultApp(url)
}
