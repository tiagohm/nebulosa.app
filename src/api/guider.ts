import type { GuiderConnect, GuiderDither } from '#/guider'
import { guiderBus, GuiderCommander } from './guider.session'
import type { GuiderCommandOptions, GuiderFindStarResult } from './guider.session'
import { response } from './http'
import type { Endpoints } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import type { OperationResult } from './operation'

// Transport adapter over the coordinated guider session.
//
// It owns nothing about guiding: every command is delegated to GuiderCommander, which holds the transport,
// its devices, and the serialization between commands. What lives here is HTTP shape and WebSocket fanout.
export class GuiderHandler {
	// Wires presentation fanout over the guider bus.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notification: NotificationHandler,
		readonly commander: GuiderCommander,
	) {
		guiderBus.subscribe('close', () => wsm.send('guider:close', undefined))
		guiderBus.subscribe('update', (event) => wsm.send('guider:update', event))
	}

	// Latest presentation snapshot published by the live session.
	get event() {
		return this.commander.event
	}

	// Opens a session and notifies the user when the transport could not be attached, because the HTTP
	// answer is a boolean the UI turns into a connection state and carries no room for a cause.
	async connect(request: GuiderConnect) {
		const result = await this.commander.connect(request)

		if (!result.ok) {
			console.error('guider failed to connect:', result.reason, result.error ?? '')
			this.notification.send({ title: 'CONNECTION', description: result.error ?? `failed to connect to the guider: ${result.reason}`, color: 'danger' })
		}

		return result.ok
	}

	// Ends the session and resolves after its devices have been released.
	disconnect() {
		return this.commander.disconnect()
	}

	// Starts looping exposures without guide output.
	loop(options?: GuiderCommandOptions) {
		return this.commander.loop(options)
	}

	// Locks onto the best star of the latest frame.
	findStar(options?: GuiderCommandOptions) {
		return this.commander.findStar(options)
	}

	// Starts guiding, calibrating first when no solution exists yet.
	start(options?: GuiderCommandOptions) {
		return this.commander.startGuiding(options)
	}

	// Stops capture and releases the guide camera and guide output.
	stop(options?: GuiderCommandOptions) {
		return this.commander.stopGuiding(options)
	}

	// Forces a new calibration.
	calibrate(options?: GuiderCommandOptions) {
		return this.commander.calibrate(options)
	}

	// Dithers and resolves only after the guider settles.
	dither(request?: Partial<GuiderDither>, options?: GuiderCommandOptions) {
		return this.commander.dither(request, options)
	}

	// Reports connection and activity.
	status() {
		return this.commander.status()
	}

	// Drops the accumulated guide-error statistics.
	clear() {
		this.commander.clear()
	}
}

// Builds guider HTTP routes over the coordinated session service.
export function guider(guiderHandler: GuiderHandler) {
	return {
		'/guider/connect': { POST: async (req) => response(await guiderHandler.connect(await req.json())) },
		'/guider/dither': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.dither(await req.json())) },
		'/guider/disconnect': { POST: async () => response<OperationResult<void>>(await guiderHandler.disconnect()) },
		'/guider/status': { GET: async () => response(await guiderHandler.status()) },
		'/guider/event': { GET: () => response(guiderHandler.event) },
		'/guider/clear': { POST: () => response(guiderHandler.clear()) },
		'/guider/start': { POST: async () => response<OperationResult<void>>(await guiderHandler.start()) },
		'/guider/stop': { POST: async () => response<OperationResult<void>>(await guiderHandler.stop()) },
		'/guider/loop': { POST: async () => response<OperationResult<void>>(await guiderHandler.loop()) },
		'/guider/findstar': { POST: async () => response<OperationResult<GuiderFindStarResult>>(await guiderHandler.findStar()) },
		'/guider/calibrate': { POST: async () => response<OperationResult<void>>(await guiderHandler.calibrate()) },
	} as const satisfies Endpoints
}
