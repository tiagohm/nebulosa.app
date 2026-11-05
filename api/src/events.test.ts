import { expect, spyOn, test } from 'bun:test'
import { AppDatabase } from './database'
import { ServerEventDispatcher } from './events'
import { type NotificationCreatedEvent, NotificationService } from './notifications'
import type { NotificationDraft } from './notifications.rules'
import type { ServerEvent } from './websocket'

function event(id: string): ServerEvent {
	return { type: 'operation:updated', operation: { operationId: id, kind: 'mount.goto', devices: [], state: 'failed', startedAt: 0 } }
}

// Operation id of an event of these tests.
function idOf(received: ServerEvent) {
	return received.type === 'operation:updated' ? received.operation.operationId : received.type
}

test('observers receive the events published while they are subscribed, in subscription order', () => {
	const events = new ServerEventDispatcher()
	const received: string[] = []
	const first = events.subscribe((e) => received.push(`first:${idOf(e)}`))
	events.publish(event('a'))
	const second = events.subscribe((e) => received.push(`second:${idOf(e)}`))
	events.publish(event('b'))

	first()
	first()
	events.publish(event('c'))
	second()
	events.publish(event('d'))

	expect(received).toEqual(['first:a', 'first:b', 'second:b', 'second:c'])
})

test('the same observer subscribed twice is called twice and unsubscribed once per subscription', () => {
	const events = new ServerEventDispatcher()
	const received: string[] = []
	const observer = (e: ServerEvent) => received.push(idOf(e))
	const one = events.subscribe(observer)
	events.subscribe(observer)

	events.publish(event('a'))
	one()
	events.publish(event('b'))

	expect(received).toEqual(['a', 'a', 'b'])
})

test('a subscription changed during a delivery applies to the next events only', () => {
	const events = new ServerEventDispatcher()
	const received: string[] = []
	let late: VoidFunction | undefined
	const second = (e: ServerEvent) => received.push(`second:${idOf(e)}`)

	events.subscribe((e) => {
		received.push(`first:${idOf(e)}`)
		late ??= events.subscribe((each) => received.push(`late:${idOf(each)}`))
		unsubscribe()
	})
	const unsubscribe = events.subscribe(second)

	events.publish(event('a'))
	events.publish(event('b'))

	expect(received).toEqual(['first:a', 'second:a', 'first:b', 'late:b'])
})

test('an observer that throws is reported and neither stops the next observers nor reaches the publisher', () => {
	const events = new ServerEventDispatcher()
	const error = spyOn(console, 'error').mockImplementation(() => undefined)
	const received: string[] = []
	events.subscribe(() => {
		throw new Error('observer failure')
	})
	events.subscribe((e) => received.push(idOf(e)))

	expect(() => events.publish(event('a'))).not.toThrow()
	expect(received).toEqual(['a'])
	expect(error).toHaveBeenCalledTimes(1)
	error.mockRestore()
})

test('an extra observer, failing or not, changes nothing of the notification history', () => {
	const classifier = {
		classify: (e: ServerEvent): NotificationDraft[] => (e.type === 'operation:updated' ? [{ key: e.operation.operationId, level: 'error', code: 'test.failed', title: 'Failed', message: `Operation ${e.operation.operationId} failed.`, source: { kind: 'operation', connectionId: 'c' } }] : []),
	}
	const error = spyOn(console, 'error').mockImplementation(() => undefined)

	// History created from a dispatcher with the notifications alone, or followed by extra observers.
	const history = (extra: boolean) => {
		const created: NotificationCreatedEvent[] = []
		const notifications = new NotificationService((e) => created.push(e), { database: AppDatabase.memory(), now: () => 1000, classifier })
		const events = new ServerEventDispatcher()
		events.subscribe((e) => notifications.consume(e))

		if (extra) {
			events.subscribe(() => undefined)
			events.subscribe(() => {
				throw new Error('observer failure')
			})
		}

		for (const id of ['a', 'a', 'b']) events.publish(event(id))
		return notifications.snapshot().items.map(({ sequence, code, message }) => ({ sequence, code, message }))
	}

	expect(history(true)).toEqual(history(false))
	expect(history(false)).toHaveLength(2)
	error.mockRestore()
})
