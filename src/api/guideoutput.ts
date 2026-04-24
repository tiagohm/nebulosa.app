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
		this.wsm.send('guideOutput:add', { device } satisfies GuideOutputAdded)
		console.info('guide output added:', device.name)
	}

	updated(device: GuideOutput, property: keyof GuideOutput & string, state?: PropertyState) {
		const event = { device: { id: device.id, name: device.name, [property]: device[property] }, property, state } satisfies CameraUpdated | MountUpdated | GuideOutputUpdated

		if (device.type === 'CAMERA') this.wsm.send('camera:update', event)
		else if (device.type === 'MOUNT') this.wsm.send('mount:update', event)
		this.wsm.send('guideOutput:update', event)
	}

	removed(device: GuideOutput) {
		this.wsm.send('guideOutput:remove', { device } satisfies GuideOutputRemoved)
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

	function guideOutputFromParams(req: Bun.BunRequest) {
		return guideOutputManager.get(query(req).client, req.params.id)!
	}

	return {
		'/guideoutputs': { GET: (req) => response(guideOutputHandler.list(query(req).client)) },
		'/guideoutputs/:id': { GET: (req) => response(guideOutputFromParams(req)) },
		'/guideoutputs/:id/pulse': { POST: async (req) => response(guideOutputHandler.pulse(guideOutputFromParams(req), await req.json())) },
	}
}
