import { expect, test } from 'bun:test'
import { createNotificationRoutes, MAX_NOTIFICATIONS, NOTIFICATION_RETENTION, type NotificationCreatedEvent, type NotificationEvent, NotificationService } from './notifications'
import { type NotificationDraft, NotificationClassifier } from './notifications.rules'
import type { ServerEvent } from './websocket'

// Classifier turning every operation:updated event into the draft keyed by its operation id.
const classifier = {
	classify: (event: ServerEvent): NotificationDraft[] => (event.type === 'operation:updated' ? [{ key: event.operation.operationId, level: 'error', code: 'test.failed', title: 'Failed', message: `Operation ${event.operation.operationId} failed.`, source: { kind: 'operation', connectionId: 'c' } }] : []),
}

function event(id: string): ServerEvent {
	return { type: 'operation:updated', operation: { operationId: id, kind: 'mount.goto', devices: [], state: 'failed', startedAt: 0 } }
}

function newService(now = () => 1000) {
	const events: NotificationEvent[] = []
	const service = new NotificationService((e) => events.push(e), { now, classifier })
	return { service, events }
}

function created(events: readonly NotificationEvent[]) {
	return events.filter((e): e is NotificationCreatedEvent => e.type === 'notification:created')
}

test('creates one unread record per occurrence and publishes it', () => {
	const { service, events } = newService()
	service.consume({ type: 'connection:close', id: 'c', cause: 'requested' })
	service.consume(event('a'))
	service.consume(event('a'))

	expect(events).toHaveLength(1)
	const { notification } = created(events)[0]
	expect(notification).toEqual({ id: expect.any(String), sequence: 1, createdAt: 1000, level: 'error', code: 'test.failed', title: 'Failed', message: 'Operation a failed.', source: { kind: 'operation', connectionId: 'c' }, read: false })
	expect(notification).not.toHaveProperty('key')
	expect(service.snapshot()).toEqual({ items: [notification] })
})

test('keeps at most MAX_NOTIFICATIONS records younger than the retention, newest first', () => {
	let now = 0
	const { service } = newService(() => now)

	for (let i = 0; i < MAX_NOTIFICATIONS + 2; i++) service.consume(event(`n${i}`))
	const items = service.snapshot().items
	expect(items).toHaveLength(MAX_NOTIFICATIONS)
	expect(items[0].message).toBe(`Operation n${MAX_NOTIFICATIONS + 1} failed.`)
	expect(items.at(-1)?.message).toBe('Operation n2 failed.')

	now = NOTIFICATION_RETENTION + 1
	expect(service.snapshot().items).toEqual([])
	service.consume(event('late'))
	expect(service.snapshot().items.map((n) => n.message)).toEqual(['Operation late failed.'])

	// An occurrence older than the retention may be notified again, under a sequence never used before.
	service.consume(event('n10'))
	expect(service.snapshot().items.map((n) => n.sequence)).toEqual([MAX_NOTIFICATIONS + 4, MAX_NOTIFICATIONS + 3])
})

test('reading and dismissing change the history for every tab and publish what changed', () => {
	const { service, events } = newService()
	service.consume(event('a'))
	service.consume(event('b'))
	const [b, a] = service.snapshot().items.map(({ id }) => id)
	events.length = 0

	service.read([a, 'unknown'])
	service.read([a])
	expect(events).toEqual([{ type: 'notification:read', ids: [a] }])
	expect(service.snapshot().items.map((n) => n.read)).toEqual([false, true])

	service.dismiss([b, 'unknown'])
	service.dismiss([b])
	expect(events.at(-1)).toEqual({ type: 'notification:dismissed', ids: [b] })
	expect(events).toHaveLength(2)
	expect(service.snapshot().items.map((n) => n.id)).toEqual([a])

	// A dismissed occurrence is not notified again.
	service.consume(event('b'))
	expect(events).toHaveLength(2)
})

test('a failing classifier or listener never throws into the publisher', () => {
	const service = new NotificationService(
		() => {
			throw new Error('socket gone')
		},
		{
			classifier: {
				classify: (e) => {
					if (e.type === 'device:updated') throw new Error('bad event')
					return classifier.classify(e)
				},
			},
		},
	)

	expect(() => service.consume({ type: 'device:updated', connectionId: 'c', id: 'd', connected: true })).not.toThrow()
	expect(() => service.consume(event('a'))).not.toThrow()
	expect(service.snapshot().items).toHaveLength(1)
})

test('the routes answer the snapshot and read and dismiss notifications', async () => {
	const { service } = newService()
	service.consume(event('a'))
	service.consume(event('b'))
	const [b, a] = service.snapshot().items.map(({ id }) => id)
	const routes = createNotificationRoutes(service)
	const post = (ids: string[]) => new Request('http://localhost', { method: 'POST', body: JSON.stringify({ ids }) })

	expect((await routes['/api/notifications/read'].POST(post([a]) as never)).status).toBe(204)
	expect((await routes['/api/notifications/dismiss'].POST(post([b]) as never)).status).toBe(204)

	const response = routes['/api/notifications'].GET()
	expect(response.status).toBe(200)
	const body = (await response.json()) as { items: { message: string; read: boolean }[] }
	expect(body.items).toMatchObject([{ message: 'Operation a failed.', read: true }])
})

test('records a global INDI message once per occurrence, cut to the message limit', () => {
	const events: NotificationEvent[] = []
	const service = new NotificationService((e) => events.push(e), { now: () => 1000, classifier: new NotificationClassifier() })
	const global = (id: string, text: string): ServerEvent => ({ type: 'indi:globalMessage', connectionId: 'c', epoch: 'e', id, receivedAt: 1000, text })

	service.consume(global('m1', 'same'))
	service.consume(global('m1', 'same'))
	service.consume(global('m2', 'same'))
	service.consume(global('m3', 'x'.repeat(300)))

	const notifications = created(events).map((e) => e.notification)
	expect(notifications.map((n) => n.message)).toEqual(['same', 'same', `${'x'.repeat(239)}…`])
	expect(notifications.every((n) => n.level === 'info' && n.target === undefined)).toBeTrue()
})
