import { expect, spyOn, test } from 'bun:test'
import { confirmation as confirmationEndpoints, ConfirmationHandler } from 'src/api/confirmation'
import { WebSocketMessageHandler } from 'src/api/message'
import type { Confirmation } from 'src/shared/types'
import { json, SocketMessager } from './util'

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
	expect(confirmation.confirm({ key: 'duplicate', accepted: true })).toBe(true)
	expect(await first).toBe(true)
})

test('ignores invalid confirmation requests without resolving a pending confirmation', async () => {
	const confirmation = new ConfirmationHandler()
	const pending = confirmation.ask({ key: 'invalid', message: 'Invalid request confirmation' }, 1000)

	expect(confirmation.confirm(undefined)).toBe(false)
	expect(confirmation.confirm(null)).toBe(false)
	expect(confirmation.confirm({ key: '', accepted: true })).toBe(false)
	expect(confirmation.confirm({ key: 1, accepted: true })).toBe(false)

	expect(confirmation.confirm({ key: 'invalid', accepted: true })).toBe(true)
	expect(await pending).toBe(true)
})

test('treats non-true accepted values as rejected', async () => {
	const confirmation = new ConfirmationHandler()
	const values = [false, undefined, 'true', 1, null]

	for (const [index, accepted] of values.entries()) {
		const key = `accepted-${index}`
		const pending = confirmation.ask({ key, message: 'Accepted value confirmation' }, 1000)

		expect(confirmation.confirm({ key, accepted })).toBe(true)
		expect(await pending).toBe(false)
	}
})

test('sends confirmation request through websocket message handler', async () => {
	const wsm = new WebSocketMessageHandler()
	const confirmation = new ConfirmationHandler(wsm)
	const socket = new SocketMessager()
	const message = { key: 'socket', message: 'Socket confirmation' } satisfies Confirmation

	wsm.open(socket)
	const pending = confirmation.ask(message, 1000)

	expect(socket.messages).toEqual([{ type: 'confirmation', body: message }])
	expect(confirmation.confirm({ key: message.key, accepted: true })).toBe(true)
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
	const response = await json<boolean>(await endpoints['/confirmation'].POST(request({ key: 'endpoint', accepted: true })))

	expect(response).toBe(true)
	expect(await pending).toBe(true)
})

test('endpoint returns false for malformed confirmation payloads', async () => {
	const confirmation = new ConfirmationHandler()
	const endpoints = confirmationEndpoints(confirmation)

	expect(await json<boolean>(await endpoints['/confirmation'].POST(request(undefined)))).toBe(false)
	expect(await json<boolean>(await endpoints['/confirmation'].POST(request({ key: '', accepted: true })))).toBe(false)
	expect(await json<boolean>(await endpoints['/confirmation'].POST(request({ accepted: true })))).toBe(false)
})
