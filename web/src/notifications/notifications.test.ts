import { expect, test } from 'bun:test'
import type { NotificationRecord, ServerEvent } from 'api'
import { proxy } from 'valtio'
import type { ConnectionInput } from '../connection/connection'
import { dismissToast, handleNotificationEvent, inScope, MAX_TOASTS, type NotificationsState, refreshNotifications, unreadCount, visibleNotifications } from './notifications'

const pi: ConnectionInput = { name: 'Pi', type: 'INDI', host: 'PI.local', port: 7624 }

function notification(id: string, sequence: number, patch: Partial<NotificationRecord> = {}): NotificationRecord {
	return { id, sequence, createdAt: sequence * 1000, level: 'error', code: 'capture.failed', title: 'Capture failed', message: 'Capture failed.', source: { kind: 'capture', connectionId: 'c', endpoint: { type: 'INDI', host: 'pi.local', port: 7624 } }, ...patch }
}

function created(record: NotificationRecord): ServerEvent {
	return { type: 'notification:created', notification: record }
}

function newState() {
	return proxy<NotificationsState>({ records: [], synchronized: false, toasts: [] })
}

function respond(...items: NotificationRecord[]) {
	return (() => Promise.resolve(Response.json({ items }))) as unknown as typeof fetch
}

test('loads the history, newest first, without toasts', async () => {
	const state = newState()
	const ids = await refreshNotifications(state, respond(notification('b', 2), notification('a', 1)))

	expect(ids).toEqual(['b', 'a'])
	expect(state.records.map((r) => r.id)).toEqual(['b', 'a'])
	expect(state.synchronized).toBeTrue()
	expect(state.toasts).toEqual([])
})

test('events before the first synchronization are kept but never toasted', async () => {
	const state = newState()
	handleNotificationEvent(state, created(notification('early', 3)))
	expect(state.toasts).toEqual([])

	await refreshNotifications(state, respond(notification('early', 3), notification('a', 1)))
	expect(state.records.map((r) => r.id)).toEqual(['early', 'a'])
	expect(state.toasts).toEqual([])
})

test('keeps the events received while the request was in flight and drops what the server forgot', async () => {
	const state = newState()
	await refreshNotifications(state, respond(notification('old', 1)))

	const { promise, resolve } = Promise.withResolvers<Response>()
	const refresh = refreshNotifications(state, (() => promise) as unknown as typeof fetch)
	handleNotificationEvent(state, created(notification('live', 5)))
	resolve(Response.json({ items: [notification('a', 2)] }))

	expect(await refresh).toEqual(['live', 'a'])
	expect(state.records.map((r) => r.id)).toEqual(['live', 'a'])
})

test('a stale response is dropped', async () => {
	const state = newState()
	const first = Promise.withResolvers<Response>()
	const stale = refreshNotifications(state, (() => first.promise) as unknown as typeof fetch)
	await refreshNotifications(state, respond(notification('new', 2)))
	first.resolve(Response.json({ items: [notification('stale', 1)] }))

	expect(await stale).toBeUndefined()
	expect(state.records.map((r) => r.id)).toEqual(['new'])
})

test('an unreachable server keeps the history', async () => {
	const state = newState()
	await refreshNotifications(state, respond(notification('a', 1)))
	expect(await refreshNotifications(state, (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch)).toBeUndefined()
	expect(state.records).toHaveLength(1)
})

test('live notifications become toasts once, at most MAX_TOASTS, info never', async () => {
	const state = newState()
	await refreshNotifications(state, respond())

	handleNotificationEvent(state, created(notification('x', 1)))
	handleNotificationEvent(state, created(notification('x', 1)))
	handleNotificationEvent(state, created(notification('info', 2, { level: 'info' })))
	expect(state.records).toHaveLength(2)
	expect(state.toasts.map((t) => t.id)).toEqual(['x'])

	for (let i = 0; i < 4; i++) handleNotificationEvent(state, created(notification(`n${i}`, 10 + i, { level: 'success' })))
	expect(state.toasts.map((t) => t.id)).toEqual(['n1', 'n2', 'n3'])
	expect(state.toasts).toHaveLength(MAX_TOASTS)

	dismissToast(state, 'n2')
	expect(state.toasts.map((t) => t.id)).toEqual(['n1', 'n3'])
	expect(state.records.some((r) => r.id === 'n2')).toBeTrue()
})

test('a reconnect never toasts the history again', async () => {
	const state = newState()
	await refreshNotifications(state, respond())
	await refreshNotifications(state, respond(notification('missed', 1)))
	expect(state.toasts).toEqual([])
})

test('scopes notifications to the endpoint of the active connection', () => {
	const mine = notification('mine', 1)
	const other = notification('other', 2, { source: { kind: 'capture', connectionId: 'd', endpoint: { type: 'SIMULATOR' } } })
	const global = notification('global', 3, { source: { kind: 'app' } })
	const unknown = notification('unknown', 4, { source: { kind: 'capture', connectionId: 'e' } })

	expect(inScope(mine, pi)).toBeTrue()
	expect(inScope(other, pi)).toBeFalse()
	expect(inScope(global, pi)).toBeTrue()
	expect(inScope(unknown, pi)).toBeFalse()
	expect(inScope(mine, undefined)).toBeFalse()
	expect(inScope(global, undefined)).toBeTrue()
	expect(inScope(other, pi, true)).toBeTrue()

	const records = [global, other, mine]
	expect(visibleNotifications(records, { readIds: [], dismissedIds: ['global'] }, pi).map((r) => r.id)).toEqual(['mine'])
	expect(visibleNotifications(records, undefined, pi, true).map((r) => r.id)).toEqual(['global', 'other', 'mine'])
})

test('counts the unread notifications of the profile scope only', () => {
	const records = [notification('a', 1), notification('b', 2), notification('c', 3, { source: { kind: 'capture', connectionId: 'd', endpoint: { type: 'SIMULATOR' } } })]

	expect(unreadCount(records, undefined, pi)).toBe(2)
	expect(unreadCount(records, { readIds: ['a'], dismissedIds: [] }, pi)).toBe(1)
	expect(unreadCount(records, { readIds: ['a'], dismissedIds: ['b'] }, pi)).toBe(0)
	// Another profile reads nothing of the first.
	expect(unreadCount(records, { readIds: [], dismissedIds: [] }, pi)).toBe(2)
})
