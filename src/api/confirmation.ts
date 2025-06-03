import Elysia from 'elysia'
import type { WebSocketMessageHandler } from './message'
import type { Confirm, Confirmation } from './types'

export const CONFIRMATION_TYPE = 'CONFIRMATION'

export type ConfirmationResolver = (value?: boolean | PromiseLike<boolean>) => void

export class ConfirmationEndpoint {
	private readonly confirmations = new Map<string, ConfirmationResolver>()

	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {}

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

		this.webSocketMessageHandler.send<Confirmation>({ ...message, type: CONFIRMATION_TYPE })

		return promise
	}
}

export function confirmation(confirmation: ConfirmationEndpoint) {
	const app = new Elysia({ prefix: '/confirmation' })

	app.post('/', ({ body }) => {
		confirmation.confirm(body as never)
	})

	return app
}
