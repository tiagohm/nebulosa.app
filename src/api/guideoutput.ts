import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { IndiClient } from 'nebulosa/src/indi.client'
import type { GuideOutput } from 'nebulosa/src/indi.device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from '../shared/types'
import { type Endpoints, query, response } from './http'
import type { Messager, WebSocketMessageHandler } from './message'

export class GuideOutputHandler implements DeviceHandler<GuideOutput> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly guideOutputManager: GuideOutputManager,
	) {
		guideOutputManager.addHandler(this)

		bus.subscribe<Messager>('ws:open', (socket) => {
			for (const device of guideOutputManager.list()) {
				this.wsm.send<GuideOutputAdded>('guideOutput:add', { device }, socket)
			}
		})
	}

	added(device: GuideOutput) {
		this.wsm.send<GuideOutputAdded>('guideOutput:add', { device })
		console.info('guide output added:', device.name, device.id)
	}

	updated(device: GuideOutput, property: keyof GuideOutput & string, state?: PropertyState) {
		const event: GuideOutputUpdated = { device: { type: device.type, id: device.id, name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'camera') this.wsm.send('camera:update', event)
		else if (device.type === 'mount') this.wsm.send('mount:update', event)
		this.wsm.send('guideOutput:update', event)
	}

	removed(device: GuideOutput) {
		this.wsm.send<GuideOutputRemoved>('guideOutput:remove', { device })
		console.info('guide output removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.guideOutputManager.list(client))
	}

	guideRate(device: GuideOutput, rate: EquatorialCoordinate) {
		return this.guideOutputManager.guideRate(device, rate.rightAscension, rate.declination)
	}

	pulse(device: GuideOutput, pulse: GuidePulse) {
		return this.guideOutputManager.pulse(device, pulse.direction, pulse.duration)
	}
}

export function guideOutput(guideOutputHandler: GuideOutputHandler): Endpoints {
	const { guideOutputManager } = guideOutputHandler

	function guideOutputFromParams(req: Bun.BunRequest) {
		return guideOutputManager.get(query(req).client, req.params.id)!
	}

	return {
		'/guideoutputs': { GET: (req) => response(guideOutputHandler.list(query(req).client)) },
		'/guideoutputs/:id': { GET: (req) => response(guideOutputFromParams(req)) },
		'/guideoutputs/:id/guiderate': { POST: async (req) => response(guideOutputHandler.guideRate(guideOutputFromParams(req), await req.json())) },
		'/guideoutputs/:id/pulse': { POST: async (req) => response(guideOutputHandler.pulse(guideOutputFromParams(req), await req.json())) },
	}
}
