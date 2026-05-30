import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Focuser } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { Messager, WebSocketMessageHandler } from './message'

export class FocuserHandler implements DeviceHandler<Focuser> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly focuserManager: FocuserManager,
	) {
		focuserManager.addHandler(this)

		bus.subscribe<Messager>('ws:open', (socket) => {
			for (const device of focuserManager.list()) {
				this.wsm.send<FocuserAdded>('focuser:add', { device }, socket)
			}
		})
	}

	added(device: Focuser) {
		this.wsm.send<FocuserAdded>('focuser:add', { device })
		console.info('focuser added:', device.name, device.id)
	}

	updated(device: Focuser, property: keyof Focuser & string, state?: PropertyState) {
		this.wsm.send<FocuserUpdated>('focuser:update', { device: { type: 'focuser', id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Focuser) {
		this.wsm.send<FocuserRemoved>('focuser:remove', { device })
		console.info('focuser removed:', device.name, device.id)
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

export function focuser(focuserHandler: FocuserHandler) {
	const { focuserManager } = focuserHandler

	function focuserFromParams(req: Bun.BunRequest) {
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
	} as const satisfies Endpoints
}

export type WaitForFocuserAction = 'reach' | 'timeout' | 'cancel'

export function waitForFocuser(focuser: Focuser, expectedPosition: number, onCompleted: (action: WaitForFocuserAction) => void, delay: number = 30000) {
	// oxlint-disable-next-line prefer-const
	let timer: ReturnType<typeof setTimeout> | undefined
	let unsubscriber: VoidFunction = () => undefined
	let finished = false

	function complete(action: WaitForFocuserAction) {
		if (!finished) {
			finished = true
			clearTimeout(timer)
			unsubscriber()
			onCompleted(action)
		}
	}

	function hasReachedPosition() {
		return !focuser.moving && focuser.position.value === expectedPosition
	}

	// Wait the focuser reach the position
	unsubscriber = bus.subscribe<FocuserUpdated>('focuser:update', (event) => {
		if (event.device.id === focuser.id && (event.property === 'moving' || event.property === 'position') && hasReachedPosition()) complete('reach')
	})

	timer = setTimeout(() => complete('timeout'), delay)

	if (hasReachedPosition()) {
		// Let callers finish issuing the movement command before reporting an already-reached target.
		queueMicrotask(() => complete('reach'))
	}

	return () => {
		complete('cancel')
	}
}
