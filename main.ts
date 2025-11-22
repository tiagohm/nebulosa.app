import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import Elysia from 'elysia'
import type { MakeDirectoryOptions } from 'fs'
import fs from 'fs/promises'
import { default as openDefaultApp } from 'open'
import os from 'os'
import { join } from 'path'
import { AtlasManager, atlas } from 'src/api/atlas'
import { CacheManager } from 'src/api/cache'
import { CameraManager, camera } from 'src/api/camera'
import { ConnectionManager, connection } from 'src/api/connection'
import { CoverManager, cover } from 'src/api/cover'
import { DarvManager, darv } from 'src/api/darv'
import { DewHeaterManager, dewHeater } from 'src/api/dewheater'
import { FlatPanelManager, flatPanel } from 'src/api/flatpanel'
import { FocuserManager, focuser } from 'src/api/focuser'
import { GuideOutputManager, guideOutput } from 'src/api/guideoutput'
import { IndiDevicePropertyManager, IndiManager, IndiServerManager, indi } from 'src/api/indi'
import { WebSocketMessageManager } from 'src/api/message'
import { MountManager, MountRemoteControlManager, mount } from 'src/api/mount'
import { NotificationManager } from 'src/api/notification'
import { ThermometerManager, thermometer } from 'src/api/thermometer'
import { TppaManager, tppa } from 'src/api/tppa'
import { WheelManager, wheel } from 'src/api/wheel'
import { parseArgs } from 'util'
import { ConfirmationManager, confirmation } from './src/api/confirmation'
import { FileSystemManager, fileSystem } from './src/api/filesystem'
import { FramingManager, framing } from './src/api/framing'
import { ImageManager, image } from './src/api/image'
import { PlateSolverManager, plateSolver } from './src/api/platesolver'
import { StarDetectionManager, starDetection } from './src/api/stardetection'
import { X_IMAGE_INFO_HEADER, X_IMAGE_PATH_HEADER } from './src/shared/types'
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
	},
	strict: true,
	allowPositionals: true,
})

const hostname = args.values.host || Bun.env.host || 'localhost'
const port = +(args.values.port || Bun.env.port || '1234')
const cert = args.values.cert || Bun.env.cert || 'cert.pem'
const key = args.values.key || Bun.env.key || 'key.pem'
const secure = ((args.values.secure || Bun.env.secure === 'true') && !!cert && !!key) || undefined
const open = !!args.values.open || Bun.env.open === 'true'
const appDir = args.values.dir || Bun.env.appDir

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

// Managers

const cacheManager = new CacheManager()
const wsm = new WebSocketMessageManager()
const notificationManager = new NotificationManager(wsm)
const indiDevicePropertyManager = new IndiDevicePropertyManager(wsm)
const connectionManager = new ConnectionManager(wsm, notificationManager)
const guideOutputManager = new GuideOutputManager(wsm)
const thermometerManager = new ThermometerManager(wsm)
const focuserManager = new FocuserManager(wsm, thermometerManager)
const wheelManager = new WheelManager(wsm)
const mountManager = new MountManager(wsm, guideOutputManager, cacheManager)
const mountRemoteControlManager = new MountRemoteControlManager(connectionManager)
const cameraManager = new CameraManager(wsm, guideOutputManager, thermometerManager, mountManager, wheelManager, focuserManager)
const dewHeaterManager = new DewHeaterManager(wsm)
const coverManager = new CoverManager(wsm, dewHeaterManager)
const flatPanelManager = new FlatPanelManager(wsm)
const indiManager = new IndiManager(cameraManager, guideOutputManager, thermometerManager, mountManager, focuserManager, wheelManager, coverManager, flatPanelManager, dewHeaterManager, indiDevicePropertyManager, wsm)
const indiServerManager = new IndiServerManager(wsm)
const confirmationManager = new ConfirmationManager(wsm)
const framingManager = new FramingManager()
const fileSystemManager = new FileSystemManager()
const starDetectionManager = new StarDetectionManager()
const plateSolverManager = new PlateSolverManager(notificationManager)
const atlasManager = new AtlasManager(cacheManager, notificationManager)
const imageManager = new ImageManager(cameraManager.cache, notificationManager)
const tppaManager = new TppaManager(wsm, cameraManager, mountManager, plateSolverManager, indiDevicePropertyManager, cacheManager)
const darvManager = new DarvManager(wsm, cameraManager, mountManager, indiDevicePropertyManager)

void atlasManager.refreshImageOfSun()
void atlasManager.refreshSatellites()
void atlasManager.refreshEarthOrientationData()

// App

const app = new Elysia({
	serve: {
		routes: {
			'/*': homeHtml,
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
			exposeHeaders: [X_IMAGE_INFO_HEADER, X_IMAGE_PATH_HEADER],
		}),
	)

	// Cron

	.use(
		cron({
			name: 'every-15-minutes',
			pattern: '0 */15 * * * *',
			run: () => {
				void atlasManager.refreshImageOfSun()
			},
		}),
	)
	.use(
		cron({
			name: 'every-day',
			pattern: '0 0 0 * * *',
			run: () => {
				void atlasManager.refreshSatellites()
				void atlasManager.refreshEarthOrientationData()
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

	// After Response

	.onAfterResponse((res) => {
		const headers = res.set.headers

		if (res.path === '/image/open') {
			const path = decodeURIComponent(headers[X_IMAGE_PATH_HEADER] as never)
			path && fs.unlink(path).catch(console.error)
		}
	})

	// Endpoints

	.use(connection(connectionManager, indiManager))
	.use(confirmation(confirmationManager))
	.use(indi(indiManager, indiServerManager, indiDevicePropertyManager, connectionManager))
	.use(camera(cameraManager, connectionManager, indiDevicePropertyManager))
	.use(mount(mountManager, mountRemoteControlManager, connectionManager))
	.use(focuser(focuserManager, connectionManager))
	.use(wheel(wheelManager, connectionManager))
	.use(thermometer(thermometerManager))
	.use(guideOutput(guideOutputManager, connectionManager))
	.use(cover(coverManager, connectionManager))
	.use(flatPanel(flatPanelManager, connectionManager))
	.use(dewHeater(dewHeaterManager, connectionManager, indiDevicePropertyManager))
	.use(atlas(atlasManager))
	.use(image(imageManager))
	.use(framing(framingManager))
	.use(starDetection(starDetectionManager))
	.use(plateSolver(plateSolverManager))
	.use(fileSystem(fileSystemManager))
	.use(tppa(tppaManager, connectionManager))
	.use(darv(darvManager, connectionManager))

	// WebSocket

	.ws('/ws', {
		open: (socket) => wsm.open(socket.raw),
		message: (socket, message) => wsm.message(socket.raw, message),
		close: (socket, code, reason) => wsm.close(socket.raw, code, reason),
	})

	// Start!

	.listen({ hostname, port })

const schema = `http${secure ? 's' : ''}`
const url = `${schema}://${app.server!.hostname}:${app.server!.port}`

console.info(`server is started at: ${url}`)

if (open) {
	void openDefaultApp(url)
}
