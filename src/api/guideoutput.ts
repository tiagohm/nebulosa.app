import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { Client, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from '../shared/types'
import { type Endpoints, query, response } from './http'
import { webSocketBus, type WebSocketMessageHandler } from './message'

export interface GuideOutputBusEvents {
	readonly add: GuideOutputAdded
	readonly remove: GuideOutputRemoved
	readonly update: GuideOutputUpdated
}

export const guideOutputBus = new EventBus<GuideOutputBusEvents>()

export class GuideOutputHandler implements DeviceHandler<GuideOutput> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly guideOutputManager: GuideOutputManager,
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

	guideRate(device: GuideOutput, rate: EquatorialCoordinate) {
		return this.guideOutputManager.guideRate(device, rate.rightAscension, rate.declination)
	}

	pulse(device: GuideOutput, pulse: GuidePulse) {
		return this.guideOutputManager.pulse(device, pulse.direction, pulse.duration)
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
		'/guideoutputs/:id/guiderate': { POST: async (req) => response(guideOutputHandler.guideRate(guideOutputFromParams(req), await req.json())) },
		'/guideoutputs/:id/pulse': { POST: async (req) => response(guideOutputHandler.pulse(guideOutputFromParams(req), await req.json())) },
	} as const satisfies Endpoints
}
