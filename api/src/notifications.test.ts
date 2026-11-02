import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import { createNotificationRoutes, MAX_NOTIFICATIONS, NOTIFICATION_RETENTION, type NotificationCreatedEvent, NotificationService } from './notifications'
import type { NotificationDraft } from './notifications.rules'
import type { ServerEvent } from './websocket'
import { Workspace } from './workspace'

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-notifications-'))

afterAll(() => rmSync(directory, { recursive: true, force: true }))

// Classifier turning every operation:updated event into the draft keyed by its operation id.
const classifier = {
	classify: (event: ServerEvent): NotificationDraft[] => (event.type === 'operation:updated' ? [{ key: event.operation.operationId, level: 'error', code: 'test.failed', title: 'Failed', message: `Operation ${event.operation.operationId} failed.`, source: { kind: 'operation', connectionId: 'c' } }] : []),
}

function event(id: string): ServerEvent {
	return { type: 'operation:updated', operation: { operationId: id, kind: 'mount.goto', devices: [], state: 'failed', startedAt: 0 } }
}

function newService(database = AppDatabase.memory(), now = () => 1000) {
	const events: NotificationCreatedEvent[] = []
	const service = new NotificationService((e) => events.push(e), { database, now, classifier })
	return { service, events, database }
}

test('creates one record per occurrence and publishes it once committed', () => {
	const { service, events, database } = newService()
	service.consume({ type: 'connection:close', id: 'c', cause: 'requested' })
	service.consume(event('a'))
	service.consume(event('a'))

	expect(events).toHaveLength(1)
	const { notification } = events[0]
	expect(notification).toEqual({ id: expect.any(String), sequence: 1, createdAt: 1000, level: 'error', code: 'test.failed', title: 'Failed', message: 'Operation a failed.', source: { kind: 'operation', connectionId: 'c' } })
	expect(notification).not.toHaveProperty('key')
	expect(service.snapshot()).toEqual({ items: [notification] })
	expect(database.db.query('SELECT id, key FROM notifications').all()).toEqual([{ id: notification.id, key: 'a' }])
})

test('lists the newest first and survives a restart without duplicating', () => {
	const file = join(directory, 'restart', 'nebulosa.sqlite')
	const first = newService(new AppDatabase(file))
	first.service.consume(event('a'))
	first.service.consume(event('b'))
	first.database.close()

	const restarted = newService(new AppDatabase(file))
	expect(restarted.service.snapshot().items.map((n) => n.message)).toEqual(['Operation b failed.', 'Operation a failed.'])

	restarted.service.consume(event('a'))
	restarted.service.consume(event('c'))
	expect(restarted.events.map((e) => e.notification.sequence)).toEqual([3])
	restarted.database.close()
})

test('keeps at most MAX_NOTIFICATIONS records younger than the retention', () => {
	let now = 0
	const { service } = newService(AppDatabase.memory(), () => now)

	for (let i = 0; i < MAX_NOTIFICATIONS + 2; i++) service.consume(event(`n${i}`))
	const items = service.snapshot().items
	expect(items).toHaveLength(MAX_NOTIFICATIONS)
	expect(items.at(-1)?.message).toBe('Operation n2 failed.')

	now = NOTIFICATION_RETENTION + 1
	service.consume(event('late'))
	expect(service.snapshot().items.map((n) => n.message)).toEqual(['Operation late failed.'])

	// A deleted occurrence may be notified again, under a sequence never used before.
	service.consume(event('n10'))
	expect(service.snapshot().items.map((n) => n.sequence)).toEqual([MAX_NOTIFICATIONS + 4, MAX_NOTIFICATIONS + 3])
})

test('the read state of a profile goes with its notification', () => {
	let now = 0
	const { service, database } = newService(AppDatabase.memory(), () => now)
	const workspace = new Workspace(database)
	workspace.ensureProfile()
	const profileId = workspace.snapshot().profiles[0].id

	service.consume(event('a'))
	service.consume(event('b'))
	const [b, a] = service.snapshot().items.map(({ id }) => id)
	workspace.saveNotificationState(profileId, { readIds: [a, b, 'unknown'], dismissedIds: [a] })
	workspace.saveNotificationState(profileId, { readIds: [], dismissedIds: [] })
	expect(workspace.profile(profileId)!.notifications).toEqual({ readIds: [a, b], dismissedIds: [a] })

	now = NOTIFICATION_RETENTION + 1
	service.consume(event('late'))
	expect(workspace.profile(profileId)!.notifications).toEqual({ readIds: [], dismissedIds: [] })
	expect(database.db.query('SELECT count(*) AS count FROM profile_notification_state').get()).toEqual({ count: 0 })
})

test('a record that cannot be written is not published and never throws', () => {
	const { service, events, database } = newService()
	database.db.run('PRAGMA query_only = ON')

	expect(() => service.consume(event('a'))).not.toThrow()
	expect(events).toEqual([])
	expect(service.snapshot()).toEqual({ items: [] })
})

test('a failing classifier or listener never throws into the publisher', () => {
	const service = new NotificationService(
		() => {
			throw new Error('socket gone')
		},
		{
			database: AppDatabase.memory(),
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

test('GET /api/notifications answers the snapshot', async () => {
	const { service } = newService()
	service.consume(event('a'))
	service.consume(event('b'))

	const response = createNotificationRoutes(service)['/api/notifications'].GET()
	expect(response.status).toBe(200)
	const body = (await response.json()) as { items: { message: string }[] }
	expect(body.items.map((n) => n.message)).toEqual(['Operation b failed.', 'Operation a failed.'])
})
