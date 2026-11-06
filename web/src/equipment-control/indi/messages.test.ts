import { describe, expect, test } from 'bun:test'
import type { ClientMessage, IndiDeviceMessage, IndiMessagesSnapshotEvent } from 'api'
import { proxy, snapshot as snap } from 'valtio'
import { disconnectMessages, followMessages, formatMessageTime, handleMessagesEvent, type IndiMessagesViewState, MAX_MESSAGES, messagesText, newIndiMessagesView, pauseMessages, resubscribeMessages, searchMessages, unfollowMessages } from './messages'

const target = { connectionId: 'c', hardwareId: 'h' }

function message(sequence: number, text = `m${sequence}`): IndiDeviceMessage {
	return { id: `id${sequence}`, sequence, receivedAt: Date.UTC(2026, 10, 5, 14, 23, sequence % 60), text }
}

function header(revision: number, epoch = 'e1') {
	return { ...target, epoch, revision }
}

function snapshot(messages: IndiDeviceMessage[], epoch = 'e1', revision = 10): IndiMessagesSnapshotEvent {
	return { type: 'indi:messagesSnapshot', ...header(revision, epoch), messages }
}

function setup() {
	const sent: ClientMessage[] = []
	const state = proxy<IndiMessagesViewState>(newIndiMessagesView())
	return { state, sent, send: (message: ClientMessage) => sent.push(message) > 0 }
}

function ready(messages = [message(1)]) {
	const context = setup()
	followMessages(context.state, target, context.send)
	handleMessagesEvent(context.state, snapshot(messages))
	return context
}

describe('subscription', () => {
	test('following subscribes, and following another device unsubscribes the first and clears the view', () => {
		const { state, sent, send } = ready()
		expect(snap(state)).toMatchObject({ status: 'ready', epoch: 'e1', revision: 10, messages: [message(1)] })

		followMessages(state, { connectionId: 'c', hardwareId: 'k' }, send)

		expect(sent).toEqual([
			{ type: 'indi:messagesSubscribe', ...target },
			{ type: 'indi:messagesUnsubscribe', ...target },
			{ type: 'indi:messagesSubscribe', connectionId: 'c', hardwareId: 'k' },
		])
		expect(snap(state)).toMatchObject({ status: 'loading', revision: 0, messages: [] })
	})

	test('pausing keeps what is shown, and a socket close marks it disconnected until the new snapshot', () => {
		const { state, sent, send } = ready()

		pauseMessages(state, send)
		pauseMessages(state, send)
		disconnectMessages(state)
		expect(state.status).toBe('paused')
		expect(sent.filter((each) => each.type === 'indi:messagesUnsubscribe')).toHaveLength(1)

		followMessages(state, target, send)
		disconnectMessages(state)
		expect(snap(state)).toMatchObject({ status: 'disconnected', messages: [message(1)] })

		resubscribeMessages(state, send)
		expect(snap(state)).toMatchObject({ status: 'loading', messages: [message(1)] })
		handleMessagesEvent(state, snapshot([message(1), message(2)], 'e2', 3))
		expect(snap(state)).toMatchObject({ status: 'ready', epoch: 'e2', revision: 3 })
		expect(state.messages).toHaveLength(2)
	})

	test('unfollowing unsubscribes and drops everything', () => {
		const { state, sent, send } = ready()

		unfollowMessages(state, send)

		expect(sent.at(-1)).toEqual({ type: 'indi:messagesUnsubscribe', ...target })
		expect(snap(state)).toEqual(newIndiMessagesView())
	})
})

describe('stream', () => {
	test('appends new messages of the same epoch in order and drops late or foreign ones', () => {
		const { state } = ready()

		handleMessagesEvent(state, { type: 'indi:messageReceived', ...header(11), message: message(2) })
		handleMessagesEvent(state, { type: 'indi:messageReceived', ...header(11), message: message(3) })
		handleMessagesEvent(state, { type: 'indi:messageReceived', ...header(12, 'e0'), message: message(4) })
		handleMessagesEvent(state, { type: 'indi:messageReceived', connectionId: 'c', hardwareId: 'k', epoch: 'e1', revision: 13, message: message(5) })
		handleMessagesEvent(state, { type: 'indi:messagesSnapshot', connectionId: 'c', hardwareId: 'k', epoch: 'e1', revision: 14, messages: [] })

		expect(state.messages.map((each) => each.sequence)).toEqual([1, 2])
		expect(state.revision).toBe(11)
	})

	test('keeps at most MAX_MESSAGES, the latest ones', () => {
		const { state } = ready(Array.from({ length: MAX_MESSAGES }, (_, i) => message(i + 1)))

		handleMessagesEvent(state, { type: 'indi:messageReceived', ...header(11), message: message(MAX_MESSAGES + 1) })

		expect(state.messages).toHaveLength(MAX_MESSAGES)
		expect(state.messages[0].sequence).toBe(2)
		expect(state.messages.at(-1)?.sequence).toBe(MAX_MESSAGES + 1)
	})

	test('a refusal and the removal of the device are shown', () => {
		const { state } = ready()

		handleMessagesEvent(state, { type: 'indi:deviceRemoved', connectionId: 'c', hardwareId: 'k' })
		expect(state.status).toBe('ready')
		handleMessagesEvent(state, { type: 'indi:deviceRemoved', ...target })
		expect(state.status).toBe('removed')

		handleMessagesEvent(state, { type: 'indi:messagesSubscriptionError', ...target, error: 'The connection has no such device', code: 'notFound' })
		expect(snap(state)).toMatchObject({ status: 'refused', error: 'The connection has no such device' })
	})
})

describe('presentation', () => {
	test('searches the text ignoring case', () => {
		const messages = [message(1, 'Mount parked'), message(2, 'Slewing to target'), message(3, 'PARK failed')]

		expect(searchMessages(messages, '  park ').map((each) => each.sequence)).toEqual([1, 3])
		expect(searchMessages(messages, ' ')).toBe(messages)
	})

	test('formats the instant of receipt in the zone and copies one line per message', () => {
		const messages = [message(5, 'first'), message(6, 'two\nlines')]

		expect(formatMessageTime(messages[0].receivedAt, 'UTC')).toBe('2026-11-05 14:23:05')
		expect(formatMessageTime(messages[0].receivedAt, 'America/Sao_Paulo')).toBe('2026-11-05 11:23:05')
		expect(messagesText(messages, 'Mount', 'UTC')).toBe('2026-11-05 14:23:05\tMount\tfirst\n2026-11-05 14:23:06\tMount\ttwo\nlines')
	})
})
