import type { Confirm, Confirmation } from '../shared/types'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'

export type ConfirmationResolver = (value?: boolean | PromiseLike<boolean>) => void

export class ConfirmationHandler {
	private readonly confirmations = new Map<string, ConfirmationResolver>()

	constructor(readonly wsm?: WebSocketMessageHandler) {}

	confirm(req: Confirm) {
		this.confirmations.get(req.key)?.(req.accepted)
	}

	ask(message: Omit<Confirmation, 'type'>, timeout: number = 30000) {
		const { promise, resolve } = Promise.withResolvers<boolean>()

		const timer = setTimeout(() => {
			this.confirmations.delete(message.key)
			resolve(false)
		}, timeout)

		this.confirmations.set(message.key, (value) => {
			clearTimeout(timer)
			this.confirmations.delete(message.key)
			resolve(value)
		})

		this.wsm?.send<Confirmation>('confirmation', message)

		return promise
	}
}

export function confirmation(confirmationHandler: ConfirmationHandler): Endpoints {
	return {
		'/confirmation': { POST: async (req) => response(confirmationHandler.confirm(await req.json())) },
	}
}
