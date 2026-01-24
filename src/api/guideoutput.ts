import type { IndiClient } from 'nebulosa/src/indi.client'
import type { GuideOutput } from 'nebulosa/src/indi.device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CameraUpdated, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse, MountUpdated } from '../shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class GuideOutputHandler implements DeviceHandler<GuideOutput> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly guideOutputManager: GuideOutputManager,
	) {
		guideOutputManager.addHandler(this)
	}

	added(device: GuideOutput) {
		this.wsm.send<GuideOutputAdded>('guideOutput:add', { device })
		console.info('guide output added:', device.name)
	}

	updated(device: GuideOutput, property: keyof GuideOutput & string, state?: PropertyState) {
		const event = { device: { id: device.id, name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'CAMERA') this.wsm.send<CameraUpdated>('camera:update', event)
		else if (device.type === 'MOUNT') this.wsm.send<MountUpdated>('mount:update', event)
		this.wsm.send<GuideOutputUpdated>('guideOutput:update', event)
	}

	removed(device: GuideOutput) {
		this.wsm.send<GuideOutputRemoved>('guideOutput:remove', { device })
		console.info('guide output removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.guideOutputManager.list(client))
	}

	pulse(device: GuideOutput, body: GuidePulse) {
		return this.guideOutputManager.pulse(device, body.direction, body.duration)
	}
}

export function guideOutput(guideOutputHandler: GuideOutputHandler): Endpoints {
	const { guideOutputManager } = guideOutputHandler

	function guideOutputFromParams(req: Bun.BunRequest<string>) {
		return guideOutputManager.get(query(req).client, req.params.id)!
	}

	return {
		'/guideoutputs': { GET: (req) => response(guideOutputHandler.list(query(req).client)) },
		'/guideoutputs/:id': { GET: (req) => response(guideOutputFromParams(req)) },
		'/guideoutputs/:id/pulse': { POST: async (req) => response(guideOutputHandler.pulse(guideOutputFromParams(req), await req.json())) },
	}
}
