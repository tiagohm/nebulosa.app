import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import Elysia from 'elysia'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { AtlasManager, atlas } from 'src/api/atlas'
import { CameraManager, camera } from 'src/api/camera'
import { ConnectionManager, connection } from 'src/api/connection'
import { CoverManager, cover } from 'src/api/cover'
import { DewHeaterManager, dewHeater } from 'src/api/dewheater'
import { ApiError } from 'src/api/exceptions'
import { FlatPanelManager, flatPanel } from 'src/api/flatpanel'
import { GuideOutputManager, guideOutput } from 'src/api/guideoutput'
import { IndiDevicePropertyManager, IndiManager, IndiServerManager, indi } from 'src/api/indi'
import { WebSocketMessageManager } from 'src/api/message'
import { MountManager, mount } from 'src/api/mount'
import { ThermometerManager, thermometer } from 'src/api/thermometer'
import { parseArgs } from 'util'
import { ConfirmationManager, confirmation } from './src/api/confirmation'
import { FileSystemManager, fileSystem } from './src/api/filesystem'
import { FramingManager, framing } from './src/api/framing'
import { ImageManager, image } from './src/api/image'
import { PlateSolverManager, plateSolver } from './src/api/platesolver'
import { StarDetectionManager, starDetection } from './src/api/stardetection'
import { X_IMAGE_INFO_HEADER } from './src/shared/types'
import homeHtml from './src/web/pages/home/index.html'

const args = parseArgs({
	args: Bun.argv,
	options: {
		host: { type: 'string', short: 'h' },
		port: { type: 'string', short: 'p' },
	},
	strict: true,
	allowPositionals: true,
})

const hostname = args.values.host || '0.0.0.0'
const port = +(args.values.port || '1234')

// Initialize environment variables
if (process.platform === 'linux') {
	Bun.env.appDir = join(os.homedir(), '.nebulosa')
} else if (process.platform === 'win32') {
	Bun.env.appDir = '' // TODO: https://stackoverflow.com/a/64807054
}

Bun.env.capturesDir = join(Bun.env.appDir, 'captures')
Bun.env.framingDir = join(Bun.env.appDir, 'framing')

// Create application sub-directories if it doesn't exist
fs.mkdirSync(Bun.env.capturesDir, { recursive: true })
fs.mkdirSync(Bun.env.framingDir, { recursive: true })

// Managers

const wsm = new WebSocketMessageManager()
const connectionManager = new ConnectionManager()
const guideOutputManager = new GuideOutputManager(wsm)
const thermometerManager = new ThermometerManager(wsm)
const indiDevicePropertyManager = new IndiDevicePropertyManager(wsm)
const mountManager = new MountManager(wsm, guideOutputManager, indiDevicePropertyManager)
const cameraManager = new CameraManager(wsm, connectionManager, guideOutputManager, thermometerManager, indiDevicePropertyManager, mountManager)
const dewHeaterManager = new DewHeaterManager(wsm, indiDevicePropertyManager)
const coverManager = new CoverManager(wsm, dewHeaterManager, indiDevicePropertyManager)
const flatPanelManager = new FlatPanelManager(wsm, indiDevicePropertyManager)
const indiManager = new IndiManager(cameraManager, guideOutputManager, thermometerManager, mountManager, coverManager, flatPanelManager, dewHeaterManager, wsm)
const indiServerManager = new IndiServerManager(wsm)
const confirmationManager = new ConfirmationManager(wsm)
const framingManager = new FramingManager()
const fileSystemManager = new FileSystemManager()
const starDetectionManager = new StarDetectionManager()
const plateSolverManager = new PlateSolverManager()
const atlasManager = new AtlasManager()
const imageManager = new ImageManager()

// App

const app = new Elysia({
	serve: {
		// @ts-expect-error
		routes: {
			'/*': homeHtml,
		},
		development: process.env.NODE_ENV !== 'production' && {
			hmr: true,
			console: true,
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
			name: 'heartbeat',
			pattern: '0 */15 * * * *',
			run() {
				console.info('Heartbeat')
			},
		}),
	)

	// Error Handling

	.onError(({ error }) => {
		console.error(error)

		if (error instanceof ApiError) {
			return Response.json(error.message, { status: error.status })
		}
	})

	// Endpoints

	.use(connection(connectionManager, indiManager))
	.use(confirmation(confirmationManager))
	.use(indi(indiManager, indiServerManager, indiDevicePropertyManager, connectionManager))
	.use(camera(cameraManager))
	.use(mount(mountManager, connectionManager))
	.use(thermometer(thermometerManager))
	.use(guideOutput(guideOutputManager, connectionManager))
	.use(cover(coverManager, connectionManager))
	.use(flatPanel(flatPanelManager, connectionManager))
	.use(dewHeater(dewHeaterManager, connectionManager))
	.use(atlas(atlasManager))
	.use(image(imageManager))
	.use(framing(framingManager))
	.use(starDetection(starDetectionManager))
	.use(plateSolver(plateSolverManager))
	.use(fileSystem(fileSystemManager))

	// WebSocket

	.ws('/ws', {
		open: (socket) => wsm.open(socket.raw),
		// message: (socket, message) => wsm.message(socket.raw, message),
		close: (socket, code, reason) => wsm.close(socket.raw, code, reason),
	})

	// Start!

	.listen({ hostname, port })

console.info(`server is started at: http://${app.server!.hostname}:${app.server!.port}`)
