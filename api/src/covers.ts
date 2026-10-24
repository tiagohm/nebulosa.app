import { CoverCommander } from 'nebulosa/src/devices/commanders/cover'
import { type ClientResolver, type CommandRequest, connectedDevice, findDevice, notFound, startCommand, stateResponse, stopResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Dust cover commands of every open connection, over the toolkit's CoverCommander: open (unpark), close
// (park), and stop. A motion runs as a cover.open or cover.close operation that resolves only once the
// cover reports standing open or closed; a cover that already stands there is not commanded. A cover and
// a flat panel of one flip-flat share the physical device, so the panel is busy while the cover moves.

// Dust cover commands over the covers of every open connection.
export class CoverCommands implements Disposable {
	// Commander driving the covers and observing their motion.
	readonly #commander: CoverCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations runs and publishes every motion.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new CoverCommander(devices.covers)
	}

	// Commander of the covers, shared with the services that move them inside their own operations (Flat Wizard), so
	// every motion of one cover is observed by the same handler.
	get commander(): CoverCommander {
		return this.#commander
	}

	// Responds with the state of a cover, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this, connectionId, 'cover', deviceId, 'Cover')
	}

	// Starts opening a cover. Responds 202 with the operation id; 404, 409 disconnected or busy, 422 when the
	// cover cannot be opened and closed.
	open(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const cover = connectedDevice(this, connectionId, 'cover', deviceId, 'Cover')
		if (cover instanceof Response) return cover
		if (!cover.canPark) return unsupported('The cover cannot be opened or closed')
		return startCommand(this.operations, 'cover.open', connectionId, cover, request, () => this.#commander.unpark(this.operations.coordinator, cover))
	}

	// Starts closing a cover; answered like open.
	close(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const cover = connectedDevice(this, connectionId, 'cover', deviceId, 'Cover')
		if (cover instanceof Response) return cover
		if (!cover.canPark) return unsupported('The cover cannot be opened or closed')
		return startCommand(this.operations, 'cover.close', connectionId, cover, request, () => this.#commander.park(this.operations.coordinator, cover))
	}

	// Cancels the motion of a cover and stops it where it is. Responds 204 once it stands still, 404, and 409
	// when the stop could not be confirmed, such as for a moving cover without abort.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const cover = findDevice(this, connectionId, 'cover', deviceId)
		if (!cover) return notFound('Cover')
		return await stopResponse(this.operations, cover, () => this.#commander.stopMotion(cover))
	}

	// Stops observing the covers; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}

// Routes of the dust cover commands.
export function createCoverRoutes(covers: CoverCommands) {
	return {
		'/api/connections/:id/covers/:deviceId': {
			// Position and capabilities of a cover; 404 when the connection is not open or has no such cover.
			GET: (req) => covers.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/covers/:deviceId/open': {
			// Starts opening a cover; the outcome arrives as operation:updated events.
			POST: async (req) => covers.open(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/covers/:deviceId/close': {
			// Starts closing a cover; the outcome arrives as operation:updated events.
			POST: async (req) => covers.close(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/covers/:deviceId/stop': {
			// Cancels the motion of a cover and stops it.
			POST: (req) => covers.stop(req.params.id, req.params.deviceId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
