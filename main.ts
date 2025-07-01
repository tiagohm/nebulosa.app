import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import Elysia from 'elysia'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { CameraHandler, cameras } from 'src/api/camera'
import { ApiError } from 'src/api/exceptions'
import { GuideOutputHandler, GuideOutputManager, guideOutputs } from 'src/api/guideoutput'
import { ThermometerHandler, ThermometerManager, thermometers } from 'src/api/thermometer'
import { parseArgs } from 'util'
import { AtlasManager, atlas } from './src/api/atlas'
import { ConfirmationManager, confirmation } from './src/api/confirmation'
import { ConnectionManager, connection } from './src/api/connection'
import { FileSystemManager, fileSystem } from './src/api/filesystem'
import { FramingManager, framing } from './src/api/framing'
import { ImageManager, image } from './src/api/image'
import { IndiDeviceHandler, indi } from './src/api/indi'
import { WebSocketMessageHandler } from './src/api/message'
import { PlateSolverManager, plateSolver } from './src/api/platesolver'
import { StarDetectionManager, starDetection } from './src/api/stardetection'
import { X_IMAGE_INFO_HEADER } from './src/api/types'
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
const port = parseInt(args.values.port || '1234')

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

// Services

const webSocketMessageHandler = new WebSocketMessageHandler()

const connectionManager = new ConnectionManager()
const indiDeviceHandler = new IndiDeviceHandler(connectionManager)

// TODO: Handle close event to remove clients

const cameraHandler = new CameraHandler(webSocketMessageHandler, indiDeviceHandler)
const thermometerHandler = new ThermometerHandler(webSocketMessageHandler)
const guideOutputHandler = new GuideOutputHandler(webSocketMessageHandler)

const guideOutputManager = new GuideOutputManager(guideOutputHandler, indiDeviceHandler, connectionManager)
const thermometerManager = new ThermometerManager(thermometerHandler, indiDeviceHandler)
const confirmationManager = new ConfirmationManager(webSocketMessageHandler)
const atlasManager = new AtlasManager()
const imageManager = new ImageManager()
const framingManager = new FramingManager()
const fileSystemManager = new FileSystemManager()
const starDetectionManager = new StarDetectionManager()
const plateSolverManager = new PlateSolverManager()

indiDeviceHandler.addDeviceHandler('CAMERA', cameraHandler)
indiDeviceHandler.addDeviceHandler('THERMOMETER', thermometerHandler)
indiDeviceHandler.addDeviceHandler('GUIDE_OUTPUT', guideOutputHandler)

// App

const app = new Elysia({
	serve: {
		// @ts-ignore
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

app.use(
	cors({
		exposeHeaders: [X_IMAGE_INFO_HEADER],
	}),
)

// Cron

app.use(
	cron({
		name: 'heartbeat',
		pattern: '0 */15 * * * *',
		run() {
			console.info('Heartbeat')
		},
	}),
)

// Error Handling

app.onError(({ error }) => {
	console.error(error)

	if (error instanceof ApiError) {
		return Response.json(error.message, { status: error.status })
	}
})

// Endpoints

app.use(connection(connectionManager, indiDeviceHandler))
app.use(confirmation(confirmationManager))
app.use(indi(indiDeviceHandler, connectionManager))
app.use(cameras(cameraHandler, indiDeviceHandler, connectionManager))
app.use(thermometers(thermometerManager))
app.use(guideOutputs(guideOutputManager))
app.use(atlas(atlasManager))
app.use(image(imageManager))
app.use(framing(framingManager))
app.use(starDetection(starDetectionManager))
app.use(plateSolver(plateSolverManager))
app.use(fileSystem(fileSystemManager))

// WebSocket

app.ws('/ws', {
	open: (socket) => webSocketMessageHandler.open(socket.raw),
	// message: (socket, message) => webSocketMessageHandler.message(socket.raw, message),
	close: (socket, code, reason) => webSocketMessageHandler.close(socket.raw, code, reason),
})

// Start!

app.listen({ hostname, port })

console.info(`server is started at: http://${app.server!.hostname}:${app.server!.port}`)
