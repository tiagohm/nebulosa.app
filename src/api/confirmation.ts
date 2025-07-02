import { molecule } from 'bunshi'
import Elysia from 'elysia'
import { WebSocketMessageMolecule } from './message'
import type { Confirm, Confirmation } from './types'

export type ConfirmationResolver = (value?: boolean | PromiseLike<boolean>) => void

// Molecule that handles confirmation messages.
// It listens for confirmation requests and resolves them based on user input.
export const ConfirmationMolecule = molecule((m) => {
	const wsm = m(WebSocketMessageMolecule)

	const confirmations = new Map<string, ConfirmationResolver>()

	// Confirms a confirmation request.
	function confirm(req: Confirm) {
		confirmations.get(req.key)?.(req.accepted)
	}

	// Asks for confirmation and returns a promise that resolves with the user's response or a timeout occurs.
	function ask(message: Omit<Confirmation, 'type'>, timeout: number = 30000) {
		const { promise, resolve } = Promise.withResolvers<boolean>()

		const timer = setTimeout(() => {
			confirmations.delete(message.key)
			resolve(false)
		}, timeout)

		confirmations.set(message.key, (value) => {
			clearTimeout(timer)
			confirmations.delete(message.key)
			resolve(value)
		})

		wsm.send<Confirmation>({ ...message, type: 'CONFIRMATION' })

		return promise
	}

	// The endpoint for handling confirmation requests
	const app = new Elysia({ prefix: '/confirmation' })

	app.post('', ({ body }) => {
		confirm(body as never)
	})

	return { ask, confirm, app }
})
