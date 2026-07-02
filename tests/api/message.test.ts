import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { indiBus, type IndiBusEvents } from 'src/api/indi'
import { webSocketBus, WebSocketMessageHandler, type Messager, type WebSocketBusEvents } from 'src/api/message'
import { SocketMessager, waitUntil } from './util'

const wsm = new WebSocketMessageHandler()
const socket = new SocketMessager()
const secondarySocket = new SocketMessager()

afterEach(() => {
	wsm.close(socket, 1000, 'reset')
	wsm.close(secondarySocket, 1000, 'reset')
	socket.clear()
	secondarySocket.clear()
})

function webSocketBusRecorder<K extends keyof WebSocketBusEvents>(topic: K) {
	const events: WebSocketBusEvents[K][] = []
	const unsubscribe = webSocketBus.subscribe(topic, (event) => events.push(event))
	return { events, unsubscribe } as const
}

function indiBusRecorder<K extends keyof IndiBusEvents>(topic: K) {
	const events: IndiBusEvents[K][] = []
	const unsubscribe = indiBus.subscribe(topic, (event) => events.push(event))
	return { events, unsubscribe } as const
}

describe('websocket message handler', () => {
	test('opens and closes sockets with bus events only once', async () => {
		const opened = webSocketBusRecorder('open')
		const closed = webSocketBusRecorder('close')

		try {
			wsm.open(socket)
			wsm.open(socket)
			expect(await waitUntil(() => opened.events.length === 1)).toBeTrue()

			wsm.close(socket, 1000, 'done')
			wsm.close(socket, 1000, 'done')
			expect(await waitUntil(() => closed.events.length === 1)).toBeTrue()

			expect(opened.events).toEqual([socket])
			expect(closed.events).toEqual([socket])
		} finally {
			opened.unsubscribe()
			closed.unsubscribe()
		}
	})

	test('broadcasts serialized json payloads to all open sockets', () => {
		const payload = { id: 'camera', connected: true, exposure: 1.5 }

		wsm.open(socket)
		wsm.open(secondarySocket)
		wsm.send('camera:update', payload)

		expect(socket.messages).toEqual([{ type: 'camera:update', body: payload }])
		expect(secondarySocket.messages).toEqual([{ type: 'camera:update', body: payload }])
	})

	test('sends undefined and null payloads as empty websocket messages', () => {
		wsm.open(socket)

		wsm.send('empty:undefined', undefined)
		wsm.send('empty:null', null)

		expect(socket.messages).toEqual([
			{ type: 'empty:undefined', body: undefined },
			{ type: 'empty:null', body: undefined },
		])
	})

	test('can send directly to a socket without registering it', () => {
		wsm.open(socket)

		wsm.send('direct', { ok: true }, secondarySocket)

		expect(socket.messages).toHaveLength(0)
		expect(secondarySocket.messages).toEqual([{ type: 'direct', body: { ok: true } }])
	})

	test('ignores empty message types and types containing the separator', () => {
		wsm.open(socket)

		wsm.send('', { ignored: true })
		wsm.send('invalid@type', { ignored: true })

		expect(socket.messages).toHaveLength(0)
	})

	test('logs serialization failures without sending a message', () => {
		const consoleError = spyOn(console, 'error').mockImplementation(() => {})
		const payload: Record<string, unknown> = {}
		payload.self = payload

		try {
			wsm.open(socket)

			wsm.send('cyclic', payload)

			expect(socket.messages).toHaveLength(0)
			expect(consoleError.mock.calls[0][0]).toBe('failed to serialize web socket message')
			expect(consoleError.mock.calls[0][1]).toBeInstanceOf(TypeError)
		} finally {
			consoleError.mockRestore()
		}
	})

	test('removes failing sockets, emits close event, and keeps broadcasting to healthy sockets', async () => {
		const error = new Error('send failed')
		const consoleError = spyOn(console, 'error').mockImplementation(() => {})
		const closed = webSocketBusRecorder('close')
		const failingSocket: Messager = {
			sendText() {
				throw error
			},
		}

		try {
			wsm.open(failingSocket)
			wsm.open(socket)
			wsm.send('status', { value: 1 })
			expect(await waitUntil(() => closed.events.length === 1)).toBeTrue()

			socket.clear()
			wsm.send('status', { value: 2 })

			expect(closed.events).toEqual([failingSocket])
			expect(socket.messages).toEqual([{ type: 'status', body: { value: 2 } }])
			expect(consoleError).toHaveBeenCalledWith('failed to send web socket message', error)
		} finally {
			closed.unsubscribe()
			wsm.close(failingSocket, 1000, 'reset')
			consoleError.mockRestore()
		}
	})

	test('emits indi listen and unlisten events from string messages', async () => {
		const listens = indiBusRecorder('listen')
		const unlistens = indiBusRecorder('unlisten')

		try {
			wsm.message(socket, 'indi:listen:camera-1')
			wsm.message(socket, 'indi:unlisten:camera-1')

			expect(await waitUntil(() => listens.events.length === 1 && unlistens.events.length === 1)).toBeTrue()
			expect(listens.events).toEqual([{ id: 'camera-1', socket }])
			expect(unlistens.events).toEqual([{ id: 'camera-1', socket }])
		} finally {
			listens.unsubscribe()
			unlistens.unsubscribe()
		}
	})

	test('ignores non-string messages and listen messages without device id', async () => {
		const listens = indiBusRecorder('listen')
		const unlistens = indiBusRecorder('unlisten')

		try {
			wsm.message(socket, undefined)
			wsm.message(socket, { type: 'indi:listen:camera-1' })
			wsm.message(socket, 'indi:listen:')
			wsm.message(socket, 'indi:unlisten:')
			await Bun.sleep(0)

			expect(listens.events).toHaveLength(0)
			expect(unlistens.events).toHaveLength(0)
		} finally {
			listens.unsubscribe()
			unlistens.unsubscribe()
		}
	})
})
