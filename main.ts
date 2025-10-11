import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import Elysia from 'elysia'
import fs from 'fs/promises'
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

const CREATE_RECURSIVE_DIRECTORY = { recursive: true } as const

const args = parseArgs({
	args: Bun.argv,
	options: {
		host: { type: 'string', short: 'h' },
		port: { type: 'string', short: 'p' },
		secure: { type: 'boolean', short: 's' },
		cert: { type: 'string', short: 'c' },
		key: { type: 'string', short: 'k' },
	},
	strict: true,
	allowPositionals: true,
})

const hostname = args.values.host || '0.0.0.0'
const port = +(args.values.port || '1234')
const cert = args.values.cert || 'cert.pem'
const key = args.values.key || 'key.pem'
const secure = (args.values.secure && !!cert && !!key) || undefined

// Initialize environment variables
if (process.platform === 'linux') {
	Bun.env.appDir = join(os.homedir(), '.nebulosa')
} else if (process.platform === 'win32') {
	Bun.env.appDir = '' // TODO: https://stackoverflow.com/a/64807054
}

Bun.env.capturesDir = join(Bun.env.appDir, 'captures')
Bun.env.framingDir = join(Bun.env.appDir, 'framing')
Bun.env.satellitesDir = join(Bun.env.appDir, 'satellites')

await fs.mkdir(Bun.env.capturesDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.framingDir, CREATE_RECURSIVE_DIRECTORY)
await fs.mkdir(Bun.env.satellitesDir, CREATE_RECURSIVE_DIRECTORY)

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
const imageManager = new ImageManager(notificationManager, cameraManager.cache)
const tppaManager = new TppaManager(wsm, cameraManager, mountManager, plateSolverManager, indiDevicePropertyManager, cacheManager)
const darvManager = new DarvManager(wsm, cameraManager, mountManager, indiDevicePropertyManager)

void atlasManager.refreshImageOfSun()
void atlasManager.refreshSatellites()

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

console.info(`server is started at: http${secure ? 's' : ''}://${app.server!.hostname}:${app.server!.port}`)
