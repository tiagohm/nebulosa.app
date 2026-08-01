import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Rotator } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, RotatorManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationCoordinator } from 'src/api/operation'
import { EventBus } from 'src/shared/bus'
import type { OperationResult } from '#/orchestration'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from '#/rotator'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import { resourceKey } from './resource'
import type { RotatorCommander } from './rotator.commander'

export interface RotatorBusEvents {
	readonly add: RotatorAdded
	readonly update: RotatorUpdated
	readonly remove: RotatorRemoved
}

export const rotatorBus = new EventBus<RotatorBusEvents>()

// Publishes rotator transport events and delegates every mutation to RotatorCommander.
export class RotatorHandler implements DeviceHandler<Rotator> {
	// Registers the rotator transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly rotatorManager: RotatorManager,
		readonly notification: NotificationHandler,
		readonly commander: RotatorCommander,
		readonly coordinator: OperationCoordinator,
	) {
		rotatorManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of rotatorManager.list()) {
				wsm.send<RotatorAdded>('rotator:add', { device }, socket)
			}
		})

		rotatorBus.subscribe('add', (event) => wsm.send('rotator:add', event))
		rotatorBus.subscribe('update', (event) => wsm.send('rotator:update', event))
		rotatorBus.subscribe('remove', (event) => wsm.send('rotator:remove', event))
	}

	added(device: Rotator) {
		rotatorBus.emit('add', { device })
		console.info('rotator added:', device.name, device.id)
	}

	updated(device: Rotator, property: keyof Rotator & string, state?: PropertyState) {
		rotatorBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Rotator) {
		rotatorBus.emit('remove', { device })
		console.info('rotator removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.rotatorManager.list(client))
	}

	// Rotates to an absolute angle, in degrees, as a whole operation tree owning the rotator. Reaching the
	// angle takes longer than the request that asked for it, so it reports through rotator events.
	moveTo(rotator: Rotator, angle: number) {
		this.#detach(rotator, `move to angle ${angle}`, () => this.commander.moveTo(this.coordinator, rotator, angle))
	}

	// Homes the rotator, which moves it and therefore also outlasts the request.
	home(rotator: Rotator) {
		this.#detach(rotator, 'home', () => this.commander.home(this.coordinator, rotator))
	}

	// Redefines the angle the rotator reports, in degrees, which the driver applies without any movement.
	syncTo(rotator: Rotator, angle: number) {
		return this.commander.syncTo(this.coordinator, rotator, angle)
	}

	// Inverts the direction the rotator turns for a given angle at the driver.
	reverse(rotator: Rotator, enabled: boolean) {
		return this.commander.reverse(this.coordinator, rotator, enabled)
	}

	// Stops the rotator: first by cancelling whatever operation owns it, so its own cleanup runs, and then
	// by the physical abort, which also covers motion nobody here started.
	async stop(rotator: Rotator) {
		await this.coordinator.cancelByResource(resourceKey(rotator))
		return await this.commander.stopMotion(rotator)
	}

	// Runs a command whose physical completion outlasts the request that asked for it.
	//
	// The HTTP response is gone by the time the rotator settles, and a refused command moves nothing, so it
	// emits no device update either: without a notification the user would see the action silently
	// discarded. Failures are therefore pushed over the WebSocket, which is the same path every other
	// asynchronous failure in the API already uses.
	#detach(rotator: Rotator, action: string, command: () => Promise<OperationResult<unknown>>) {
		void command().then((result) => {
			if (result.ok) return

			console.error('rotator failed to %s:', action, rotator.name, result.reason, result.error ?? '')
			this.notification.send({ title: 'ROTATOR', description: `${rotator.name} failed to ${action}: ${result.error ?? result.reason}`, color: 'danger' })
		})
	}
}

export function rotator(rotatorHandler: RotatorHandler) {
	const { rotatorManager } = rotatorHandler

	function rotatorFromParams(req: Bun.BunRequest) {
		return rotatorManager.get(query(req).client, req.params.id)!
	}

	return {
		'/rotators': { GET: (req) => response(rotatorHandler.list(query(req).client)) },
		'/rotators/:id': { GET: (req) => response(rotatorFromParams(req)) },
		'/rotators/:id/moveto': { POST: async (req) => response(rotatorHandler.moveTo(rotatorFromParams(req), await req.json())) },
		'/rotators/:id/sync': { POST: async (req) => response<OperationResult<void>>(await rotatorHandler.syncTo(rotatorFromParams(req), await req.json())) },
		'/rotators/:id/home': { POST: (req) => response(rotatorHandler.home(rotatorFromParams(req))) },
		'/rotators/:id/reverse': { POST: async (req) => response<OperationResult<void>>(await rotatorHandler.reverse(rotatorFromParams(req), await req.json())) },
		'/rotators/:id/stop': { POST: async (req) => response<OperationResult<void>>(await rotatorHandler.stop(rotatorFromParams(req))) },
	} as const satisfies Endpoints
}
