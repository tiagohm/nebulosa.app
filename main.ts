import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import { getDefaultInjector } from 'bunshi'
import Elysia from 'elysia'
import fs from 'fs'
import os from 'os'
import { join } from 'path'
import { CameraMolecule } from 'src/api/camera'
import { ConnectionMolecule } from 'src/api/connection'
import { ApiError } from 'src/api/exceptions'
import { GuideOutputMolecule } from 'src/api/guideoutput'
import { IndiMolecule } from 'src/api/indi'
import { WebSocketMessageMolecule } from 'src/api/message'
import { MountMolecule } from 'src/api/mount'
import { ThermometerMolecule } from 'src/api/thermometer'
import { parseArgs } from 'util'
import { AtlasMolecule } from './src/api/atlas'
import { ConfirmationMolecule } from './src/api/confirmation'
import { FileSystemMolecule } from './src/api/filesystem'
import { FramingMolecule } from './src/api/framing'
import { ImageMolecule } from './src/api/image'
import { PlateSolverMolecule } from './src/api/platesolver'
import { StarDetectionMolecule } from './src/api/stardetection'
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

// Molecules

const injector = getDefaultInjector()

const wsm = injector.get(WebSocketMessageMolecule)
const connection = injector.get(ConnectionMolecule)
const camera = injector.get(CameraMolecule)
const mount = injector.get(MountMolecule)
const guideOutput = injector.get(GuideOutputMolecule)
const thermometer = injector.get(ThermometerMolecule)
const indi = injector.get(IndiMolecule)
const confirmation = injector.get(ConfirmationMolecule)
const framing = injector.get(FramingMolecule)
const fileSystem = injector.get(FileSystemMolecule)
const starDetection = injector.get(StarDetectionMolecule)
const plateSolver = injector.get(PlateSolverMolecule)
const atlas = injector.get(AtlasMolecule)
const image = injector.get(ImageMolecule)

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

app.use(connection.app)
app.use(confirmation.app)
app.use(indi.app)
app.use(camera.app)
app.use(mount.app)
app.use(thermometer.app)
app.use(guideOutput.app)
app.use(atlas.app)
app.use(image.app)
app.use(framing.app)
app.use(starDetection.app)
app.use(plateSolver.app)
app.use(fileSystem.app)

// WebSocket

app.ws('/ws', {
	open: (socket) => wsm.open(socket.raw),
	// message: (socket, message) => wsm.message(socket.raw, message),
	close: (socket, code, reason) => wsm.close(socket.raw, code, reason),
})

// Start!

app.listen({ hostname, port })

console.info(`server is started at: http://${app.server!.hostname}:${app.server!.port}`)
