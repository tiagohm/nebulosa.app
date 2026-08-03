import type { GuiderConnect, GuiderDither, GuiderLoopStart, GuiderSessionInfo } from '#/guider'
import type { OperationResult } from '#/orchestration'
import { guiderBus, GuiderCommander } from './guider.session'
import type { GuiderCommandOptions, GuiderFindStarResult } from './guider.session'
import { response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

// Transport adapter over the coordinated guider sessions.
// It owns nothing about guiding: every command is delegated to GuiderCommander, which holds the
// transports, their devices, and the serialization between commands. What lives here is HTTP shape and
// WebSocket fanout. Several sessions may be open at once, so every route and every event names one.
export class GuiderHandler {
	// Wires presentation fanout over the guider bus.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notification: NotificationHandler,
		readonly commander: GuiderCommander,
	) {
		// A socket that connects mid-run has no other way to learn which sessions already exist.
		webSocketBus.subscribe('open', (socket) => {
			for (const session of commander.list()) {
				wsm.send<GuiderSessionInfo>('guider:add', session, socket)
			}
		})

		guiderBus.subscribe('add', (event) => wsm.send('guider:add', event))
		guiderBus.subscribe('update', (event) => wsm.send('guider:update', event))
		guiderBus.subscribe('remove', (event) => wsm.send('guider:remove', event))
	}

	// Lists the open sessions.
	list() {
		return this.commander.list()
	}

	// Describes one session.
	session(guider: string) {
		return this.commander.info(guider)
	}

	// Latest presentation snapshot of one session.
	event(guider: string) {
		return this.commander.event(guider)
	}

	// Opens a session and notifies the user when the transport could not be attached, since a rejected
	// connection produces no further event the UI could react to.
	async connect(request: GuiderConnect) {
		const result = await this.commander.connect(request)

		if (!result.ok) {
			console.error('guider failed to connect:', result.reason, result.error ?? '')
			this.notification.send({ title: 'CONNECTION', description: result.error ?? `failed to connect to the guider: ${result.reason}`, color: 'danger' })
		}

		return result
	}

	// Ends one session and resolves after its devices have been released.
	disconnect(guider: string) {
		return this.commander.disconnect(guider)
	}

	// Starts looping exposures without guide output.
	loop(guider: string, request: GuiderLoopStart, options?: GuiderCommandOptions) {
		return this.commander.loop(guider, request, options)
	}

	// Locks onto the best star of the latest frame.
	findStar(guider: string, options?: GuiderCommandOptions) {
		return this.commander.findStar(guider, options)
	}

	// Starts guiding, calibrating first when no solution exists yet.
	start(guider: string, options?: GuiderCommandOptions) {
		return this.commander.startGuiding(guider, options)
	}

	// Stops capture and releases the guide camera and guide output.
	stop(guider: string, options?: GuiderCommandOptions) {
		return this.commander.stopGuiding(guider, options)
	}

	// Forces a new calibration.
	calibrate(guider: string, options?: GuiderCommandOptions) {
		return this.commander.calibrate(guider, options)
	}

	// Dithers and resolves only after the guider settles.
	dither(guider: string, request?: Partial<GuiderDither>, options?: GuiderCommandOptions) {
		return this.commander.dither(guider, request, options)
	}

	// Reports connection and activity of one session.
	status(guider: string) {
		return this.commander.status(guider)
	}

	// Drops the accumulated guide-error statistics of one session.
	clear(guider: string) {
		this.commander.clear(guider)
	}
}

// Builds guider HTTP routes over the coordinated session commander.
export function guider(guiderHandler: GuiderHandler) {
	return {
		'/guiders': { GET: () => response(guiderHandler.list()) },
		'/guiders/connect': { POST: async (req) => response<OperationResult<GuiderSessionInfo>>(await guiderHandler.connect(await req.json())) },
		'/guiders/:id': { GET: (req) => response(guiderHandler.session(req.params.id)) },
		'/guiders/:id/status': { GET: async (req) => response(await guiderHandler.status(req.params.id)) },
		'/guiders/:id/event': { GET: (req) => response(guiderHandler.event(req.params.id)) },
		'/guiders/:id/clear': { POST: (req) => response(guiderHandler.clear(req.params.id)) },
		'/guiders/:id/disconnect': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.disconnect(req.params.id)) },
		'/guiders/:id/loop': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.loop(req.params.id, await req.json())) },
		'/guiders/:id/findstar': { POST: async (req) => response<OperationResult<GuiderFindStarResult>>(await guiderHandler.findStar(req.params.id)) },
		'/guiders/:id/start': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.start(req.params.id)) },
		'/guiders/:id/stop': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.stop(req.params.id)) },
		'/guiders/:id/calibrate': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.calibrate(req.params.id)) },
		'/guiders/:id/dither': { POST: async (req) => response<OperationResult<void>>(await guiderHandler.dither(req.params.id, await req.json())) },
	} as const satisfies Endpoints
}
