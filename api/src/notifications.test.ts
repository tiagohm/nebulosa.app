import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createNotificationRoutes, MAX_NOTIFICATIONS, NOTIFICATION_RETENTION, type NotificationCreatedEvent, NotificationService } from './notifications'
import type { NotificationDraft } from './notifications.rules'
import type { ServerEvent } from './websocket'

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-notifications-'))
let files = 0

afterAll(() => rmSync(directory, { recursive: true, force: true }))

function newFile() {
	return join(directory, `notifications-${++files}.json`)
}

// Classifier turning every operation:updated event into the draft keyed by its operation id.
const classifier = {
	classify: (event: ServerEvent): NotificationDraft[] => (event.type === 'operation:updated' ? [{ key: event.operation.operationId, level: 'error', code: 'test.failed', title: 'Failed', message: `Operation ${event.operation.operationId} failed.`, source: { kind: 'operation', connectionId: 'c' } }] : []),
}

function event(id: string): ServerEvent {
	return { type: 'operation:updated', operation: { operationId: id, kind: 'mount.goto', devices: [], state: 'failed', startedAt: 0 } }
}

function newService(file = newFile(), now = () => 1000) {
	const events: NotificationCreatedEvent[] = []
	const service = new NotificationService((e) => events.push(e), { file, now, classifier })
	return { service, events, file }
}

test('creates one record per occurrence and publishes it', async () => {
	const { service, events, file } = newService()
	service.consume({ type: 'connection:close', id: 'c', cause: 'requested' })
	service.consume(event('a'))
	service.consume(event('a'))

	expect(events).toHaveLength(1)
	const { notification } = events[0]
	expect(notification).toEqual({ id: expect.any(String), sequence: 1, createdAt: 1000, level: 'error', code: 'test.failed', title: 'Failed', message: 'Operation a failed.', source: { kind: 'operation', connectionId: 'c' } })
	expect(notification).not.toHaveProperty('key')
	expect(service.snapshot()).toEqual({ items: [notification] })

	await service.flush()
	const stored = JSON.parse(readFileSync(file, 'utf-8'))
	expect(stored).toEqual({ version: 1, nextSequence: 2, records: [{ ...notification, key: 'a' }] })
})

test('lists the newest first and survives a restart without duplicating', async () => {
	const { service, file } = newService()
	service.consume(event('a'))
	service.consume(event('b'))
	await service.flush()

	const restarted = newService(file)
	expect(restarted.service.snapshot().items.map((n) => n.message)).toEqual(['Operation b failed.', 'Operation a failed.'])

	restarted.service.consume(event('a'))
	restarted.service.consume(event('c'))
	expect(restarted.events.map((e) => e.notification.sequence)).toEqual([3])
})

test('keeps at most MAX_NOTIFICATIONS records younger than the retention', () => {
	let now = 0
	const { service } = newService(newFile(), () => now)

	for (let i = 0; i < MAX_NOTIFICATIONS + 2; i++) service.consume(event(`n${i}`))
	const items = service.snapshot().items
	expect(items).toHaveLength(MAX_NOTIFICATIONS)
	expect(items.at(-1)?.message).toBe('Operation n2 failed.')

	now = NOTIFICATION_RETENTION + 1
	service.consume(event('late'))
	expect(service.snapshot().items.map((n) => n.message)).toEqual(['Operation late failed.'])

	// A forgotten occurrence may be notified again.
	service.consume(event('n10'))
	expect(service.snapshot().items).toHaveLength(2)
})

test('never overwrites a file of a newer version', async () => {
	const file = newFile()
	const text = JSON.stringify({ version: 2, nextSequence: 5, records: [{ id: 'x', key: 'old', sequence: 4, createdAt: 900, level: 'info', code: 'future', title: 'T', message: 'M', source: { kind: 'future' } }], extra: true })
	writeFileSync(file, text)

	const { service } = newService(file)
	service.consume(event('a'))
	await service.flush()

	expect(readFileSync(file, 'utf-8')).toBe(text)
	expect(service.snapshot().items.map((n) => n.sequence)).toEqual([5, 4])
})

test('starts empty from a malformed file and drops invalid records', () => {
	const malformed = newFile()
	writeFileSync(malformed, '{ not json')
	expect(newService(malformed).service.snapshot()).toEqual({ items: [] })

	const partial = newFile()
	writeFileSync(partial, JSON.stringify({ version: 1, nextSequence: 3, records: [{ id: 'x' }, { id: 'y', key: 'k', sequence: 2, createdAt: 900, level: 'loud', code: 'c', title: 't', message: 'm', source: { kind: 's' } }] }))
	const { service, events } = newService(partial)
	expect(service.snapshot()).toEqual({ items: [] })

	service.consume(event('a'))
	expect(events[0].notification.sequence).toBe(3)
})

test('keeps the records in memory when the file cannot be written', async () => {
	const blocker = newFile()
	mkdirSync(blocker)
	const { service, events } = newService(join(blocker, 'inside', 'notifications.json'))
	writeFileSync(join(blocker, 'inside'), 'a file where a directory is expected')

	service.consume(event('a'))
	await service.flush()

	expect(events).toHaveLength(1)
	expect(service.snapshot().items).toHaveLength(1)
})

test('coalesces the changes made during a write into the final state', async () => {
	const { service, file } = newService()
	for (let i = 0; i < 20; i++) service.consume(event(`n${i}`))
	await service.flush()

	const stored = JSON.parse(readFileSync(file, 'utf-8'))
	expect(stored.records).toHaveLength(20)
	expect(stored.nextSequence).toBe(21)
})

test('a failing classifier or listener never throws into the publisher', () => {
	const service = new NotificationService(
		() => {
			throw new Error('socket gone')
		},
		{
			file: newFile(),
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
