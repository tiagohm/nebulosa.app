import Elysia from 'elysia'
import type { Confirm, Confirmation } from '../shared/types'
import type { WebSocketMessageManager } from './message'

export type ConfirmationResolver = (value?: boolean | PromiseLike<boolean>) => void

// Manager that handles confirmation messages.
// It listens for confirmation requests and resolves them based on user input.
export class ConfirmationManager {
	private readonly confirmations = new Map<string, ConfirmationResolver>()

	constructor(readonly wsm?: WebSocketMessageManager) {}

	// Confirms a confirmation request.
	confirm(req: Confirm) {
		this.confirmations.get(req.key)?.(req.accepted)
	}

	// Asks for confirmation and returns a promise that resolves with the user's response or a timeout occurs.
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

		this.wsm?.send<Confirmation>({ ...message, type: 'confirmation' })

		return promise
	}
}

// Endpoints for handling confirmation requests
export function confirmation(confirmation: ConfirmationManager) {
	const app = new Elysia({ prefix: '/confirmation' })
		// Endpoints!
		.post('', ({ body }) => confirmation.confirm(body as never))

	return app
}
