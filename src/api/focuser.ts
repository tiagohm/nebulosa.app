import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Focuser } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class FocuserHandler implements DeviceHandler<Focuser> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly focuserManager: FocuserManager,
	) {
		focuserManager.addHandler(this)
	}

	added(device: Focuser) {
		this.wsm.send<FocuserAdded>('focuser:add', { device })
		console.info('focuser added:', device.name)
	}

	updated(device: Focuser, property: keyof Focuser & string, state?: PropertyState) {
		this.wsm.send<FocuserUpdated>('focuser:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Focuser) {
		this.wsm.send<FocuserRemoved>('focuser:remove', { device })
		console.info('focuser removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.focuserManager.list(client))
	}

	moveTo(focuser: Focuser, position: number) {
		this.focuserManager.moveTo(focuser, position)
	}

	moveIn(focuser: Focuser, steps: number) {
		this.focuserManager.moveIn(focuser, steps)
	}

	moveOut(focuser: Focuser, steps: number) {
		this.focuserManager.moveOut(focuser, steps)
	}

	syncTo(focuser: Focuser, position: number) {
		this.focuserManager.syncTo(focuser, position)
	}

	reverse(focuser: Focuser, enabled: boolean) {
		this.focuserManager.reverse(focuser, enabled)
	}

	stop(focuser: Focuser) {
		this.focuserManager.stop(focuser)
	}
}

export function focuser(focuserHandler: FocuserHandler): Endpoints {
	const { focuserManager } = focuserHandler

	function focuserFromParams(req: Bun.BunRequest<string>) {
		return focuserManager.get(query(req).client, req.params.id)!
	}

	return {
		'/focusers': { GET: (req) => response(focuserHandler.list(query(req).client)) },
		'/focusers/:id': { GET: (req) => response(focuserFromParams(req)) },
		'/focusers/:id/moveto': { POST: async (req) => response(focuserHandler.moveTo(focuserFromParams(req), await req.json())) },
		'/focusers/:id/movein': { POST: async (req) => response(focuserHandler.moveIn(focuserFromParams(req), await req.json())) },
		'/focusers/:id/moveout': { POST: async (req) => response(focuserHandler.moveOut(focuserFromParams(req), await req.json())) },
		'/focusers/:id/sync': { POST: async (req) => response(focuserHandler.syncTo(focuserFromParams(req), await req.json())) },
		'/focusers/:id/reverse': { POST: async (req) => response(focuserHandler.reverse(focuserFromParams(req), await req.json())) },
		'/focusers/:id/stop': { POST: (req) => response(focuserHandler.stop(focuserFromParams(req))) },
	}
}

export function waitForFocuser(focuser: Focuser, expectedPosition: number, onCompleted: (action: 'reach' | 'timeout' | 'cancel') => void, delay: number = 30000) {
	let timer: NodeJS.Timeout
	let cancelled = false

	// Wait the focuser reach the position
	const unsubscriber = bus.subscribe<FocuserUpdated>('focuser:update', (event) => {
		if (!cancelled && event.device.id === focuser.id && (event.property === 'moving' || event.property === 'position') && !focuser.moving && focuser.position.value === expectedPosition) {
			clearTimeout(timer)
			unsubscriber()
			onCompleted('reach')
		}
	})

	timer = setTimeout(() => {
		if (cancelled) return
		unsubscriber()
		onCompleted('timeout')
	}, delay)

	return () => {
		cancelled = true
		clearTimeout(timer)
		unsubscriber()
		onCompleted('cancel')
	}
}
