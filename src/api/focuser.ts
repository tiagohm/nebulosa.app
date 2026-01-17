import Elysia from 'elysia'
import type { Focuser } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
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

	moveTo(focuser: Focuser, position: number) {
		this.focuserManager.moveTo(focuser, position)
	}

	moveIn(focuser: Focuser, steps: number) {
		this.focuserManager.moveTo(focuser, steps)
	}

	moveOut(focuser: Focuser, steps: number) {
		this.focuserManager.moveTo(focuser, steps)
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
	function focuserFromParams(clientId: string, id: string) {
		return focuserHandler.focuserManager.get(clientId, decodeURIComponent(id))!
	}

	const app = new Elysia({ prefix: '/focusers' })
		// Endpoints!
		.get('', ({ query }) => Array.from(focuserHandler.focuserManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => focuserFromParams(query.clientId, params.id))
		.post('/:id/moveto', ({ params, query, body }) => focuserHandler.moveTo(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/movein', ({ params, query, body }) => focuserHandler.moveIn(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/moveout', ({ params, query, body }) => focuserHandler.moveOut(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/sync', ({ params, query, body }) => focuserHandler.syncTo(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/reverse', ({ params, query, body }) => focuserHandler.reverse(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/stop', ({ params, query }) => focuserHandler.stop(focuserFromParams(query.clientId, params.id)))

	return app
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
