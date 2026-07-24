import { expect, spyOn, test } from 'bun:test'
import { confirmation as confirmationEndpoints, ConfirmationHandler } from 'src/api/confirmation'
import { WebSocketMessageHandler } from 'src/api/message'
import { noContent, SocketMessager } from './util'

function request(body?: unknown) {
	return { json: () => body } as unknown as Bun.BunRequest
}

test('confirm', async () => {
	const confirmation = new ConfirmationHandler()

	for (let i = 0; i < 2; i++) {
		setTimeout(() => confirmation.confirm({ key: 'test', accepted: i === 0 }), 10)
		const result = await confirmation.ask({ key: 'test', message: 'Test confirmation' })
		expect(result).toBe(i === 0)
	}
})

test('timed out', async () => {
	const confirmation = new ConfirmationHandler()
	const result = await confirmation.ask({ key: 'test', message: 'Test confirmation' }, 100)
	expect(result).toBe(false)
})

test('rejects duplicate pending confirmations with the same key', async () => {
	const confirmation = new ConfirmationHandler()
	const first = confirmation.ask({ key: 'duplicate', message: 'First confirmation' }, 1000)
	const second = await confirmation.ask({ key: 'duplicate', message: 'Second confirmation' }, 1000)

	expect(second).toBe(false)
	confirmation.confirm({ key: 'duplicate', accepted: true })
	expect(await first).toBe(true)
})

test('treats non-true accepted values as rejected', async () => {
	const confirmation = new ConfirmationHandler()
	const values = [false, undefined, 'true', 1, null]

	for (const [index, accepted] of values.entries()) {
		const key = `accepted-${index}`
		const pending = confirmation.ask({ key, message: 'Accepted value confirmation' }, 1000)

		confirmation.confirm({ key, accepted: accepted as boolean })
		expect(await pending).toBe(false)
	}
})

test('sends confirmation request through websocket message handler', async () => {
	const wsm = new WebSocketMessageHandler()
	const confirmation = new ConfirmationHandler(wsm)
	const socket = new SocketMessager()
	const message = { key: 'socket', message: 'Socket confirmation' } as const

	wsm.open(socket)
	const pending = confirmation.ask(message, 1000)

	expect(socket.messages).toEqual([{ type: 'confirmation', body: message }])
	confirmation.confirm({ key: message.key, accepted: true })
	expect(await pending).toBe(true)

	wsm.close(socket, 1000, 'done')
})

test('resolves false when sending the confirmation request fails', async () => {
	const send = spyOn(console, 'error').mockImplementation(() => {})
	const confirmation = new ConfirmationHandler({
		send() {
			throw new Error('send failed')
		},
	} as unknown as WebSocketMessageHandler)

	try {
		const result = await confirmation.ask({ key: 'send-failed', message: 'Send failure confirmation' }, 1000)

		expect(result).toBe(false)
		expect(send).toHaveBeenCalled()
	} finally {
		send.mockRestore()
	}
})

test('confirms through endpoint', async () => {
	const confirmation = new ConfirmationHandler()
	const endpoints = confirmationEndpoints(confirmation)
	const pending = confirmation.ask({ key: 'endpoint', message: 'Endpoint confirmation' }, 1000)
	await noContent(await endpoints['/confirmation'].POST(request({ key: 'endpoint', accepted: true })))

	expect(await pending).toBe(true)
})
