import { normalizeTimeout } from 'src/shared/normalizer'
import type { Confirm, Confirmation } from 'src/types/confirmation'
import { response } from './http'
import type { Endpoints } from './http'
import type { WebSocketMessageHandler } from './message'

export type ConfirmationResolver = (value?: boolean | PromiseLike<boolean>) => void

export type PendingConfirmation = {
	readonly resolve: ConfirmationResolver
	readonly timer: Timer
}

export class ConfirmationHandler {
	private readonly confirmations = new Map<string, PendingConfirmation>()

	constructor(readonly wsm?: WebSocketMessageHandler) {}

	confirm(req: Confirm) {
		this.resolve(req.key, req.accepted === true)
	}

	ask(message: Confirmation, timeout: number = 30000) {
		if (this.confirmations.has(message.key)) {
			return Promise.resolve(false)
		}

		const delay = normalizeTimeout(timeout)
		const { promise, resolve } = Promise.withResolvers<boolean>()

		const timer = setTimeout(() => {
			this.resolve(message.key, false)
		}, delay)

		this.confirmations.set(message.key, { resolve, timer })

		try {
			this.wsm?.send('confirmation', message)
		} catch (e) {
			console.error('failed to send confirmation request', e)
			this.resolve(message.key, false)
		}

		return promise
	}

	private resolve(key: string, value: boolean) {
		const confirmation = this.confirmations.get(key)

		if (!confirmation) return

		clearTimeout(confirmation.timer)
		this.confirmations.delete(key)
		confirmation.resolve(value)
	}
}

export function confirmation(confirmationHandler: ConfirmationHandler) {
	return {
		'/confirmation': { POST: async (req) => response(confirmationHandler.confirm(await req.json())) },
	} as const satisfies Endpoints
}
