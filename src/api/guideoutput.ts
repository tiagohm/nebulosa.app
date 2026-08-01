import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Client, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationCoordinator } from 'src/api/operation'
import { EventBus } from 'src/shared/bus'
import type { GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from '#/guideoutput'
import type { OperationResult } from '#/orchestration'
import type { GuideOutputCommander } from './guideoutput.commander'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import { resourceKey } from './resource'

export interface GuideOutputBusEvents {
	readonly add: GuideOutputAdded
	readonly remove: GuideOutputRemoved
	readonly update: GuideOutputUpdated
}

export const guideOutputBus = new EventBus<GuideOutputBusEvents>()

// Publishes guide output transport events and delegates every mutation to GuideOutputCommander.
export class GuideOutputHandler implements DeviceHandler<GuideOutput> {
	// Registers the guide output transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly guideOutputManager: GuideOutputManager,
		readonly notification: NotificationHandler,
		readonly commander: GuideOutputCommander,
		readonly coordinator: OperationCoordinator,
	) {
		guideOutputManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of guideOutputManager.list()) {
				wsm.send<GuideOutputAdded>('guideOutput:add', { device }, socket)
			}
		})

		guideOutputBus.subscribe('add', (event) => wsm.send('guideOutput:add', event))
		guideOutputBus.subscribe('remove', (event) => wsm.send('guideOutput:remove', event))
		guideOutputBus.subscribe('update', (event) => wsm.send('guideOutput:update', event))
	}

	added(device: GuideOutput) {
		guideOutputBus.emit('add', { device })
		console.info('guide output added:', device.name, device.id)
	}

	updated(device: GuideOutput, property: keyof GuideOutput & string, state?: PropertyState) {
		guideOutputBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: GuideOutput) {
		guideOutputBus.emit('remove', { device })
		console.info('guide output removed:', device.name, device.id)
	}

	list(client?: string | Client) {
		return Array.from(this.guideOutputManager.list(client))
	}

	// Sets the guide rate of both axes, as a fraction of the sidereal rate.
	guideRate(device: GuideOutput, rate: EquatorialCoordinate) {
		return this.commander.setGuideRate(this.coordinator, device, rate.rightAscension, rate.declination)
	}

	// Issues one timed pulse per axis as a whole operation tree owning the device behind the guide output.
	// Durations are in milliseconds and the driver times them, so the pulses outlast the request that asked
	// for them and report their failures as a notification instead.
	pulse(device: GuideOutput, pulses: readonly GuidePulse[]) {
		const directions = pulses.map((pulse) => pulse.direction).join(' and ')

		void this.commander.pulseAxes(this.coordinator, device, pulses).then((result) => {
			if (result.ok) return

			console.error('guide output failed to pulse %s:', directions, device.name, result.reason, result.error ?? '')
			this.notification.send({ title: 'GUIDE OUTPUT', description: `${device.name} failed to pulse ${directions}: ${result.error ?? result.reason}`, color: 'danger' })
		})
	}

	// Stops any pulse: first by cancelling whatever operation owns the device, so its own cleanup runs, and
	// then by zeroing both guide vectors, which also covers motion nobody here started.
	// Both axes are zeroed before the standstill is awaited, since the device reports a single guiding flag
	// and settling on one axis while the other keeps pulsing would only wait out the settle timeout.
	async stop(device: GuideOutput) {
		await this.coordinator.cancelByResource(resourceKey(device))

		return await this.commander.stopPulses(device, ['NORTH', 'WEST'])
	}
}

export function guideOutput(guideOutputHandler: GuideOutputHandler) {
	const { guideOutputManager } = guideOutputHandler

	function guideOutputFromParams(req: Bun.BunRequest) {
		return guideOutputManager.get(query(req).client, req.params.id)!
	}

	return {
		'/guideoutputs': { GET: (req) => response(guideOutputHandler.list(query(req).client)) },
		'/guideoutputs/:id': { GET: (req) => response(guideOutputFromParams(req)) },
		'/guideoutputs/:id/guiderate': { POST: async (req) => response<OperationResult<void>>(await guideOutputHandler.guideRate(guideOutputFromParams(req), await req.json())) },
		'/guideoutputs/:id/pulse': { POST: async (req) => response(guideOutputHandler.pulse(guideOutputFromParams(req), await req.json())) },
		'/guideoutputs/:id/stop': { POST: async (req) => response<OperationResult<void>>(await guideOutputHandler.stop(guideOutputFromParams(req))) },
	} as const satisfies Endpoints
}
