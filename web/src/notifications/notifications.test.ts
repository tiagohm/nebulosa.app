import { expect, test } from 'bun:test'
import type { NotificationRecord, ServerEvent } from 'api'
import { proxy } from 'valtio'
import type { ConnectionInput } from '../connection/connection'
import { dismissNotifications, dismissToast, handleNotificationEvent, inScope, MAX_TOASTS, markNotificationsRead, notificationAge, type NotificationsState, refreshNotifications, setServerLink, unreadCount, visibleNotifications } from './notifications'

const pi: ConnectionInput = { name: 'Pi', type: 'INDI', host: 'PI.local', port: 7624 }

function notification(id: string, sequence: number, patch: Partial<NotificationRecord> = {}): NotificationRecord {
	return { id, sequence, createdAt: sequence * 1000, level: 'error', code: 'capture.failed', title: 'Capture failed', message: 'Capture failed.', source: { kind: 'capture', connectionId: 'c', endpoint: { type: 'INDI', host: 'pi.local', port: 7624 } }, read: false, ...patch }
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
	await refreshNotifications(state, respond(notification('b', 2), notification('a', 1)))

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

test('replays the events received while the request was in flight and drops what the server forgot', async () => {
	const state = newState()
	await refreshNotifications(state, respond(notification('old', 1)))

	const { promise, resolve } = Promise.withResolvers<Response>()
	const refresh = refreshNotifications(state, () => promise)
	handleNotificationEvent(state, created(notification('live', 5)))
	handleNotificationEvent(state, { type: 'notification:read', ids: ['a'] })
	handleNotificationEvent(state, { type: 'notification:dismissed', ids: ['b'] })
	resolve(Response.json({ items: [notification('b', 3), notification('a', 2)] }))
	await refresh

	expect(state.records.map((r) => [r.id, r.read])).toEqual([
		['live', false],
		['a', true],
	])
})

test('a stale response is dropped', async () => {
	const state = newState()
	const first = Promise.withResolvers<Response>()
	const stale = refreshNotifications(state, () => first.promise)
	await refreshNotifications(state, respond(notification('new', 2)))
	first.resolve(Response.json({ items: [notification('stale', 1)] }))
	await stale

	expect(state.records.map((r) => r.id)).toEqual(['new'])
})

test('an unreachable server keeps the history', async () => {
	const state = newState()
	await refreshNotifications(state, respond(notification('a', 1)))
	await refreshNotifications(state, () => Promise.reject(new Error('offline')))
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
	expect(visibleNotifications(records, pi).map((r) => r.id)).toEqual(['global', 'mine'])
	expect(visibleNotifications(records, pi, true).map((r) => r.id)).toEqual(['global', 'other', 'mine'])
})

test('counts the unread notifications of the connection scope only', () => {
	const records = [notification('a', 1), notification('b', 2, { read: true }), notification('c', 3, { source: { kind: 'capture', connectionId: 'd', endpoint: { type: 'SIMULATOR' } } })]
	expect(unreadCount(records, pi)).toBe(1)
	expect(unreadCount(records, undefined)).toBe(0)
})

test('applies what any tab read or dismissed, removing the dismissed toasts', async () => {
	const state = newState()
	await refreshNotifications(state, respond())
	handleNotificationEvent(state, created(notification('a', 1)))
	handleNotificationEvent(state, created(notification('b', 2)))

	handleNotificationEvent(state, { type: 'notification:read', ids: ['a'] })
	expect(state.records.map((r) => [r.id, r.read])).toEqual([
		['b', false],
		['a', true],
	])

	handleNotificationEvent(state, { type: 'notification:dismissed', ids: ['b'] })
	expect(state.records.map((r) => r.id)).toEqual(['a'])
	expect(state.toasts.map((t) => t.id)).toEqual(['a'])
})

test('reading and dismissing are asked of the server, never applied before its event', async () => {
	const state = newState()
	await refreshNotifications(state, respond(notification('a', 1)))
	const sent: { path: string; body: unknown }[] = []
	const request = ((path: string, init?: RequestInit) => {
		sent.push({ path, body: JSON.parse(init?.body as string) })
		return Promise.resolve(new Response(null, { status: 204 }))
	}) as typeof fetch

	await markNotificationsRead(['a'], request)
	await dismissNotifications(['a'], request)
	await dismissNotifications([], request)
	expect(sent).toEqual([
		{ path: '/api/notifications/read', body: { ids: ['a'] } },
		{ path: '/api/notifications/dismiss', body: { ids: ['a'] } },
	])
	expect(state.records).toHaveLength(1)
	await expect(markNotificationsRead(['a'], () => Promise.reject(new Error('offline')))).resolves.toBeUndefined()
})

test('formats the age of a notification', () => {
	expect(notificationAge(0, 59_000)).toBe('now')
	expect(notificationAge(0, 5 * 60_000)).toBe('5 min ago')
	expect(notificationAge(0, 3 * 3_600_000)).toBe('3 h ago')
	expect(notificationAge(0, 50 * 3_600_000)).toBe('2 d ago')
})

test('follows the event socket without touching the history', async () => {
	const state = newState()
	await refreshNotifications(state, respond(notification('a', 1)))
	expect(state.server).toBeUndefined()

	setServerLink(state, 'online')
	setServerLink(state, 'offline')
	expect(state.server).toBe('offline')
	expect(state.records).toHaveLength(1)
	expect(state.toasts).toEqual([])
})
