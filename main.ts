import { cors } from '@elysiajs/cors'
import { cron } from '@elysiajs/cron'
import Elysia from 'elysia'
import type { PropertyState } from 'nebulosa/src/indi'
import { parseArgs } from 'util'
import { AtlasEndpoint, atlas } from './src/api/atlas'
import { ConfirmationEndpoint, confirmation } from './src/api/confirmation'
import { ConnectionEndpoint, connection } from './src/api/connection'
import { FileSystemEndpoint, fileSystem } from './src/api/filesystem'
import { FramingEndpoint, framing } from './src/api/framing'
import { ImageEndpoint, image } from './src/api/image'
import { type IndiDeviceEventHandler, IndiEndpoint, cameras, guideOutputs, indi, thermometers } from './src/api/indi'
import { WebSocketMessageHandler } from './src/api/message'
import { PlateSolverEndpoint, plateSolver } from './src/api/platesolver'
import { StarDetectionEndpoint, starDetection } from './src/api/stardetection'
import type { Device, DeviceType, SubDeviceType } from './src/api/types'
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

class IndiDeviceEventHandlers implements IndiDeviceEventHandler {
	private readonly handlers: IndiDeviceEventHandler[] = []

	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {}

	// TODO: Handle close event to remove clients

	addHandler(handler: IndiDeviceEventHandler) {
		this.handlers.push(handler)
	}

	deviceUpdated(device: Device, property: string, state?: PropertyState) {
		console.debug('updated:', property, JSON.stringify((device as never)[property]))
		this.webSocketMessageHandler.send({ type: 'CAMERA.UPDATED', device })
		this.handlers.forEach((e) => e.deviceUpdated?.(device, property, state))
	}

	deviceAdded(device: Device, type: DeviceType | SubDeviceType) {
		console.debug('added:', type, device.name)
		this.webSocketMessageHandler.send({ type: 'CAMERA.ADDED', device })
		this.handlers.forEach((e) => e.deviceAdded?.(device, type))
	}

	deviceRemoved(device: Device, type: DeviceType | SubDeviceType) {
		console.debug('removed:', type, device.name)
		this.webSocketMessageHandler.send({ type: 'CAMERA.REMOVED', device })
		this.handlers.forEach((e) => e.deviceRemoved?.(device, type))
	}
}

// Endpoints

const webSocketMessageHandler = new WebSocketMessageHandler()
const indiDeviceEventHandlers = new IndiDeviceEventHandlers(webSocketMessageHandler)
const connectionEndpoint = new ConnectionEndpoint()
const indiEndpoint = new IndiEndpoint(indiDeviceEventHandlers, connectionEndpoint)
const confirmationEndpoint = new ConfirmationEndpoint(webSocketMessageHandler)
const atlasEndpoint = new AtlasEndpoint()
const imageEndpoint = new ImageEndpoint()
const framingEndpoint = new FramingEndpoint()
const fileSystemEndpoint = new FileSystemEndpoint()
const starDetectionEndpoint = new StarDetectionEndpoint()
const plateSolverEndpoint = new PlateSolverEndpoint()

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

// CORS

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
			console.log('Heartbeat')
		},
	}),
)

// Error Handling

app.onError(({ code, error }) => {
	return Response.json({ message: `${error}`, code })
})

// Endpoints

app.use(connection(connectionEndpoint, indiEndpoint))
app.use(confirmation(confirmationEndpoint))
app.use(indi(indiEndpoint, connectionEndpoint))
app.use(cameras(indiEndpoint))
app.use(thermometers(indiEndpoint))
app.use(guideOutputs(indiEndpoint, connectionEndpoint))
app.use(atlas(atlasEndpoint))
app.use(image(imageEndpoint))
app.use(framing(framingEndpoint))
app.use(starDetection(starDetectionEndpoint))
app.use(plateSolver(plateSolverEndpoint))
app.use(fileSystem(fileSystemEndpoint))

// WebSocket

app.ws('/ws', {
	open: (socket) => webSocketMessageHandler.open(socket.raw),
	// message: (socket, message) => webSocketMessageHandler.message(socket.raw, message),
	close: (socket, code, reason) => webSocketMessageHandler.close(socket.raw, code, reason),
})

// Start!

app.listen({ hostname, port })

console.info(`server is started at port: ${app.server!.port}`)
