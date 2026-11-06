import { afterEach, describe, expect, test } from 'bun:test'
import { makeHardwareId } from 'nebulosa/src/devices/indi/properties'
import { ConnectionManager } from './connection'
import { type IndiDeviceMessage, IndiMessageService, type IndiMessageServiceOptions, type IndiMessagesSnapshotEvent, messageText } from './indimessages'
import type { EventSocket, ServerEvent } from './websocket'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

const RELAY = '<defSwitchVector device="Relay" name="CONNECTION" group="Main Control" state="Ok" perm="rw" rule="OneOfMany"><defSwitch name="CONNECT">On</defSwitch><defSwitch name="DISCONNECT">Off</defSwitch></defSwitchVector>'

function define(device: string) {
	return `<defNumberVector device="${device}" name="LEVEL" group="Main" state="Idle" perm="rw"><defNumber name="VALUE" format="%g" min="0" max="10" step="1">1</defNumber></defNumberVector>`
}

function message(text: string, device?: string, timestamp?: string) {
	return `<message${device === undefined ? '' : ` device="${device}"`}${timestamp === undefined ? '' : ` timestamp="${timestamp}"`} message="${text}"/>`
}

async function until(condition: () => boolean, timeout = 2000) {
	const end = Date.now() + timeout
	while (!condition()) {
		if (Date.now() > end) throw new Error('condition not reached')
		await Bun.sleep(5)
	}
}

// Fake indiserver writing the XML a test pushes to every client socket.
function listenIndi() {
	const sockets = new Set<Bun.Socket>()
	const server = Bun.listen({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open: (socket) => void sockets.add(socket),
			data: () => {},
			close: (socket) => void sockets.delete(socket),
		},
	})
	disposables.push({ [Symbol.dispose]: () => server.stop(true) })

	return {
		port: server.port,
		sockets,
		push: (xml: string) => {
			for (const socket of sockets) socket.write(xml)
		},
	}
}

function fakeSocket() {
	const events: ServerEvent[] = []
	let buffered = 0
	const socket: EventSocket = {
		send: (data) => {
			events.push(JSON.parse(data) as ServerEvent)
			return data.length
		},
		getBufferedAmount: () => buffered,
	}

	return { socket, events, congest: (amount: number) => (buffered = amount) }
}

async function setup(options?: IndiMessageServiceOptions) {
	const indi = listenIndi()
	const manager = new ConnectionManager()
	disposables.push(manager)
	const published: ServerEvent[] = []
	let now = 1_000_000
	const service = new IndiMessageService(
		manager.devices,
		(id) => manager.client(id),
		(event) => published.push(event),
		{ now: () => now, ...options },
	)
	disposables.push(service)
	manager.listen((event) => service.connectionChanged(event))

	const { id } = await manager.connect({ type: 'INDI', host: '127.0.0.1', port: indi.port })
	await until(() => indi.sockets.size === 1)
	const client = manager.client(id)!

	indi.push(RELAY)
	await until(() => manager.devices.properties.device(client, 'Relay') !== undefined)
	const relay = manager.devices.properties.device(client, 'Relay')!

	// Pushes the XML, then a sentinel message of the device Sentinel, and waits for the sentinel, so everything before it was handled.
	const settle = async (xml: string) => {
		const sentinel = service.history(id, makeHardwareId(client, 'Sentinel')).length
		indi.push(xml + message('sentinel', 'Sentinel'))
		await until(() => service.history(id, makeHardwareId(client, 'Sentinel')).length > sentinel)
	}

	return { indi, manager, service, published, id, client, relay, settle, advance: (ms: number) => (now += ms) }
}

function texts(messages: readonly IndiDeviceMessage[]) {
	return messages.map((each) => each.text)
}

describe('routing', () => {
	test('publishes a message without a device, or with an empty one, as a global message', async () => {
		const { service, published, id, relay, settle } = await setup()

		await settle(message('server ready') + message('second', ''))

		expect(published).toEqual([
			{ type: 'indi:globalMessage', connectionId: id, epoch: expect.any(String), id: expect.any(String), receivedAt: 1_000_000, text: 'server ready' },
			{ type: 'indi:globalMessage', connectionId: id, epoch: expect.any(String), id: expect.any(String), receivedAt: 1_000_000, text: 'second' },
		])
		expect(service.history(id, relay.hardwareId)).toBeEmpty()
	})

	test('keeps a message of a known device with its driver timestamp as sent', async () => {
		const { service, published, id, relay, settle } = await setup()

		await settle(message('relay armed', 'Relay', '2026-10-26T12:00:00') + message('no zone', 'Relay', 'yesterday'))

		expect(service.history(id, relay.hardwareId)).toEqual([
			{ id: expect.any(String), sequence: 1, receivedAt: 1_000_000, timestamp: '2026-10-26T12:00:00', text: 'relay armed' },
			{ id: expect.any(String), sequence: 2, receivedAt: 1_000_000, timestamp: 'yesterday', text: 'no zone' },
		])
		expect(published).toBeEmpty()
	})

	test('keeps a message of a device not defined yet under the hardware id it gets', async () => {
		const { indi, manager, service, id, client, settle } = await setup()

		await settle(message('booting', 'Focuser'))
		indi.push(define('Focuser'))
		await until(() => manager.devices.properties.device(client, 'Focuser') !== undefined)

		expect(texts(service.history(id, manager.devices.properties.device(client, 'Focuser')!.hardwareId))).toEqual(['booting'])
	})

	test('names a device by its exact name', async () => {
		const { service, id, client, relay, settle } = await setup()

		await settle(message('lower', 'relay') + message('spaced', 'Relay '))

		expect(service.history(id, relay.hardwareId)).toBeEmpty()
		expect(texts(service.history(id, makeHardwareId(client, 'relay')))).toEqual(['lower'])
		expect(texts(service.history(id, makeHardwareId(client, 'Relay ')))).toEqual(['spaced'])
	})

	test('keeps every occurrence of a text and ignores blank ones', async () => {
		const { service, published, id, relay, settle } = await setup()

		await settle(message('same', 'Relay') + message('same', 'Relay') + message('   ', 'Relay') + message('') + message('&#9;'))

		const history = service.history(id, relay.hardwareId)
		expect(texts(history)).toEqual(['same', 'same'])
		expect(history[0].id).not.toBe(history[1].id)
		expect(published).toBeEmpty()
	})

	test('keeps markup as text and cuts a long text', async () => {
		const { service, published, id, relay, settle } = await setup({ maxTextLength: 12 })

		await settle(message('&lt;b onclick=&quot;x&quot;&gt;bold&lt;/b&gt;', 'Relay') + message('line one&#10;line two', 'Relay') + message('a&#10;  b', ''))

		expect(service.history(id, relay.hardwareId)).toMatchObject([
			{ text: '<b onclick="', truncated: true },
			{ text: 'line one\nlin', truncated: true },
		])
		expect(published).toMatchObject([{ type: 'indi:globalMessage', text: 'a b' }])
	})

	test('never collects the message attribute of vectors', async () => {
		const { service, published, id, relay, settle } = await setup()

		await settle(
			'<setSwitchVector device="Relay" name="CONNECTION" state="Alert" message="port busy"><oneSwitch name="CONNECT">Off</oneSwitch><oneSwitch name="DISCONNECT">On</oneSwitch></setSwitchVector>' +
				'<defTextVector device="Relay" name="NOTE" group="Main" state="Idle" perm="ro" message="defined"><defText name="TEXT">x</defText></defTextVector>' +
				'<delProperty device="Relay" name="NOTE" message="deleted"/>',
		)

		expect(service.history(id, relay.hardwareId)).toBeEmpty()
		expect(published).toBeEmpty()
	})

	test('keeps the connections apart, even with devices of the same name', async () => {
		const { indi, manager, service, id, relay, settle } = await setup()
		const other = listenIndi()
		const { id: otherId } = await manager.connect({ type: 'INDI', host: '127.0.0.1', port: other.port })
		await until(() => other.sockets.size === 1)
		const otherClient = manager.client(otherId)!

		other.push(RELAY)
		await until(() => manager.devices.properties.device(otherClient, 'Relay') !== undefined)
		const otherRelay = manager.devices.properties.device(otherClient, 'Relay')!

		indi.push(message('first', 'Relay'))
		await settle(message('global'))
		other.push(message('second', 'Relay'))
		await until(() => service.history(otherId, otherRelay.hardwareId).length === 1)

		expect(otherRelay.hardwareId).not.toBe(relay.hardwareId)
		expect(texts(service.history(id, relay.hardwareId))).toEqual(['first'])
		expect(texts(service.history(otherId, otherRelay.hardwareId))).toEqual(['second'])
		expect(service.history(otherId, relay.hardwareId)).toBeEmpty()
	})
})

describe('history', () => {
	test('keeps the latest messages of a device in order', async () => {
		const { service, id, relay, settle } = await setup({ maxMessages: 3 })

		await settle(['a', 'b', 'c', 'd', 'e'].map((text) => message(text, 'Relay')).join(''))

		expect(service.history(id, relay.hardwareId).map(({ sequence, text }) => [sequence, text])).toEqual([
			[3, 'c'],
			[4, 'd'],
			[5, 'e'],
		])
	})

	test('drops the history of the least recently active device', async () => {
		const { service, id, client, settle } = await setup({ maxDevices: 3 })

		// With the sentinel device, A is the least recently active after C.
		await settle(message('a', 'A') + message('b', 'B'))
		await settle(message('c', 'C'))

		expect(service.history(id, makeHardwareId(client, 'A'))).toBeEmpty()
		expect(texts(service.history(id, makeHardwareId(client, 'B')))).toEqual(['b'])
		expect(texts(service.history(id, makeHardwareId(client, 'C')))).toEqual(['c'])
	})

	test('drops the session of a closed connection and starts a new one when it opens again', async () => {
		const { indi, manager, service, id, relay, settle } = await setup()
		const a = fakeSocket()

		await settle(message('before', 'Relay'))
		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: relay.hardwareId })
		const first = a.events[0] as IndiMessagesSnapshotEvent

		manager.disconnect(id)
		expect(service.history(id, relay.hardwareId)).toBeEmpty()
		expect(service.subscribers(id, relay.hardwareId)).toBe(0)

		await manager.connect({ type: 'INDI', host: '127.0.0.1', port: indi.port })
		await until(() => indi.sockets.size === 1)
		const client = manager.client(id)!
		indi.push(RELAY)
		await until(() => manager.devices.properties.device(client, 'Relay') !== undefined)

		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: relay.hardwareId })
		const second = a.events[1] as IndiMessagesSnapshotEvent

		expect(second).toMatchObject({ type: 'indi:messagesSnapshot', messages: [] })
		expect(second.epoch).not.toBe(first.epoch)
	})

	test('stops collecting once disposed', async () => {
		const { indi, service, id, relay, published } = await setup()

		service[Symbol.dispose]()
		indi.push(message('late', 'Relay') + message('late'))
		await Bun.sleep(50)

		expect(service.history(id, relay.hardwareId)).toBeEmpty()
		expect(published).toBeEmpty()
	})
})

describe('global messages', () => {
	test('publishes at most the limit per window and one suppression for the rest', async () => {
		const { published, id, settle, advance } = await setup({ globalLimit: 2, globalWindow: 1000 })

		await settle(['1', '2', '3', '4'].map((text) => message(text)).join(''))

		expect(published).toEqual([expect.objectContaining({ type: 'indi:globalMessage', text: '1' }), expect.objectContaining({ type: 'indi:globalMessage', text: '2' }), { type: 'indi:globalMessagesSuppressed', connectionId: id, epoch: expect.any(String), windowStart: 1_000_000, limit: 2, window: 1000 }])

		advance(999)
		await settle(message('5'))
		expect(published).toHaveLength(3)

		advance(1)
		await settle(message('6') + message('7') + message('8') + message('9'))

		expect(published.slice(3)).toEqual([expect.objectContaining({ type: 'indi:globalMessage', text: '6' }), expect.objectContaining({ type: 'indi:globalMessage', text: '7' }), expect.objectContaining({ type: 'indi:globalMessagesSuppressed', windowStart: 1_001_000 })])
	})

	test('never limits the messages of a device', async () => {
		const { service, id, relay, settle } = await setup({ globalLimit: 1 })

		await settle(message('a', 'Relay') + message('b', 'Relay') + message('c', 'Relay'))

		expect(texts(service.history(id, relay.hardwareId))).toEqual(['a', 'b', 'c'])
	})
})

describe('stream', () => {
	test('sends the kept messages, then each new one, to the subscribed socket only', async () => {
		const { service, id, relay, settle } = await setup()
		const a = fakeSocket()
		const b = fakeSocket()

		await settle(message('before', 'Relay'))
		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: relay.hardwareId })

		const snapshot = a.events[0] as IndiMessagesSnapshotEvent
		expect(snapshot).toMatchObject({ type: 'indi:messagesSnapshot', connectionId: id, hardwareId: relay.hardwareId, epoch: expect.any(String), messages: [{ sequence: 1, text: 'before' }] })

		await settle(message('after', 'Relay') + message('other', 'Other') + message('global'))

		expect(a.events).toHaveLength(2)
		expect(a.events[1]).toMatchObject({ type: 'indi:messageReceived', epoch: snapshot.epoch, message: { sequence: 2, text: 'after' } })
		expect((a.events[1] as { revision: number }).revision).toBeGreaterThan(snapshot.revision)
		expect(b.events).toBeEmpty()
	})

	test('keeps every subscriber apart and resends the snapshot on a repeated subscription', async () => {
		const { service, id, relay, settle } = await setup()
		const a = fakeSocket()
		const b = fakeSocket()
		const target = { connectionId: id, hardwareId: relay.hardwareId }

		service.message(a.socket, { type: 'indi:messagesSubscribe', ...target })
		service.message(b.socket, { type: 'indi:messagesSubscribe', ...target })
		service.message(b.socket, { type: 'indi:messagesSubscribe', ...target })
		expect(service.subscribers(id, relay.hardwareId)).toBe(2)
		expect(b.events.map((event) => event.type)).toEqual(['indi:messagesSnapshot', 'indi:messagesSnapshot'])

		await settle(message('both', 'Relay'))
		expect(a.events).toHaveLength(2)
		expect(b.events).toHaveLength(3)

		service.closed(a.socket)
		service.message(b.socket, { type: 'indi:messagesUnsubscribe', ...target })
		service.message(b.socket, { type: 'indi:messagesUnsubscribe', ...target })
		expect(service.subscribers(id, relay.hardwareId)).toBe(0)

		await settle(message('none', 'Relay'))
		expect(a.events).toHaveLength(2)
		expect(b.events).toHaveLength(3)
	})

	test('ignores the control messages of the property streams', async () => {
		const { service, id, relay } = await setup()
		const a = fakeSocket()
		const target = { connectionId: id, hardwareId: relay.hardwareId }

		service.message(a.socket, { type: 'indi:messagesSubscribe', ...target })
		service.message(a.socket, { type: 'indi:subscribe', ...target })
		service.message(a.socket, { type: 'indi:unsubscribe', ...target })

		expect(service.subscribers(id, relay.hardwareId)).toBe(1)
		expect(a.events).toHaveLength(1)
	})

	test('refuses an unknown connection or device, and a connection that is not INDI', async () => {
		const { manager, service, id } = await setup()
		const a = fakeSocket()
		const { id: simulatorId } = await manager.connect({ type: 'SIMULATOR' })

		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: 'unknown', hardwareId: 'x' })
		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: 'x' })
		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: 'Relay' })
		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: simulatorId, hardwareId: 'x' })

		expect(a.events).toEqual([
			{ type: 'indi:messagesSubscriptionError', connectionId: 'unknown', hardwareId: 'x', error: expect.any(String), code: 'notFound' },
			{ type: 'indi:messagesSubscriptionError', connectionId: id, hardwareId: 'x', error: expect.any(String), code: 'notFound' },
			{ type: 'indi:messagesSubscriptionError', connectionId: id, hardwareId: 'Relay', error: expect.any(String), code: 'notFound' },
			{ type: 'indi:messagesSubscriptionError', connectionId: simulatorId, hardwareId: 'x', error: expect.any(String), code: 'unsupported' },
		])
	})

	test('resynchronizes a congested socket with a fresh snapshot once it drains', async () => {
		const { service, id, relay, settle } = await setup({ maxBufferedAmount: 100 })
		const a = fakeSocket()

		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: relay.hardwareId })
		a.congest(1000)
		await settle(message('skipped', 'Relay') + message('also skipped', 'Relay'))
		expect(a.events).toHaveLength(1)

		a.congest(0)
		service.drained(a.socket)
		service.drained(a.socket)

		expect(a.events).toHaveLength(2)
		expect(a.events[1]).toMatchObject({ type: 'indi:messagesSnapshot', messages: [{ text: 'skipped' }, { text: 'also skipped' }] })

		await settle(message('live', 'Relay'))
		expect(a.events[2]).toMatchObject({ type: 'indi:messageReceived', message: { text: 'live' } })
	})

	test('ends the subscriptions of a removed device and keeps its history', async () => {
		const { indi, manager, service, id, client, relay, settle } = await setup()
		const a = fakeSocket()

		await settle(message('going away', 'Relay'))
		service.subscribe(a.socket, { type: 'indi:messagesSubscribe', connectionId: id, hardwareId: relay.hardwareId })
		indi.push('<delProperty device="Relay"/>')
		await until(() => manager.devices.properties.device(client, 'Relay') === undefined)

		expect(service.subscribers(id, relay.hardwareId)).toBe(0)
		await settle(message('gone', 'Relay'))
		expect(a.events).toHaveLength(1)
		expect(texts(service.history(id, relay.hardwareId))).toEqual(['going away', 'gone'])
	})
})

// Escape character, which starts a terminal control sequence.
const ESC = String.fromCharCode(0x1b)

describe('messageText', () => {
	test('removes control characters and bidirectional overrides, and normalizes line breaks', () => {
		expect(messageText(`${ESC}[31mred${ESC}[0m${String.fromCharCode(7)}`)).toBe('[31mred[0m')
		expect(messageText('a\r\nb\rc\td\u0085')).toBe('a\nb\nc\td')
		expect(messageText(`safe${String.fromCharCode(0x202e)}txt.exe${String.fromCharCode(0x2066)}`)).toBe('safetxt.exe')
		expect(messageText(' \n\t ')).toBe('')
	})
})
