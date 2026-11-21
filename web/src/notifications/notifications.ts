import type { NotificationEvent, NotificationIdsRequest, NotificationLevel, NotificationRecord, NotificationSnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { type Connection, type ConnectionInput, sameEndpoint } from '../connection/connection'
import { type ApiFetch, browserFetch, jsonInit } from '../http'

// Notification history of the server as this tab knows it. The server owns the history, in memory, and the same
// records reach every tab: this store mirrors it from the notification events and, on every socket (re)open, from the
// whole retained history, replaying the events that arrived while that request was in flight. Reading and dismissing
// are asked of the server, so they reach every tab, and the tab applies them when their events arrive. Only
// notifications that arrive live after the first synchronization become toasts, so a reload or a reconnect never
// replays them. Toasts that read the same merge into one with a count; errors and warnings stay until hidden or viewed,
// and a full stack drops a success before either of them. The store also follows the event socket itself, so the tab can
// tell when it lost the server, which no server notification can report. For the panel, it merges the history into groups
// that read the same, tells which need the operator, and says the unread notifications in words.

// Notifications known to the tab and the toasts it shows.
export interface NotificationsState {
	// Retained notifications, newest first.
	records: NotificationRecord[]
	// Whether the history was fetched at least once; earlier events never become toasts.
	synchronized: boolean
	// Toasts shown, oldest first; at most MAX_TOASTS.
	toasts: NotificationToast[]
	// Whether the event socket is open (online) or closed after it was open (offline); absent before it first opened.
	server?: ServerLink
}

// State of the event socket of the tab.
export type ServerLink = 'online' | 'offline'

// Toast of one or more notifications that read the same: same code, title, message, and connection.
export interface NotificationToast {
	// Latest notification merged into the toast; its id keys the toast.
	readonly record: NotificationRecord
	// Ids of every notification merged into the toast, oldest first; never empty.
	readonly ids: readonly string[]
}

// Most toasts shown at once; the oldest success is dropped first, and the oldest toast only when none is a success.
export const MAX_TOASTS = 3

// Severities shown as toasts; info notifications stay in the history only.
const TOAST_LEVELS: ReadonlySet<NotificationLevel> = new Set<NotificationLevel>(['success', 'warning', 'error'])

// Shortest time a success toast stays, in milliseconds.
const SUCCESS_TOAST_BASE = 2000

// Time added to a success toast per character of its title and message, in milliseconds: a slow reading pace for an
// operator glancing over from the rig.
const SUCCESS_TOAST_PER_CHARACTER = 40

// Longest time a success toast stays, in milliseconds.
const SUCCESS_TOAST_MAX = 8000

// Time a toast stays before it hides itself, in milliseconds while nobody hovers or focuses it, or undefined when it
// stays until hidden or viewed: errors and warnings, which ask for attention, never time out.
export function toastDuration(record: Pick<NotificationRecord, 'level' | 'title' | 'message'>): number | undefined {
	if (record.level === 'error' || record.level === 'warning') return undefined
	return Math.min(SUCCESS_TOAST_MAX, SUCCESS_TOAST_BASE + SUCCESS_TOAST_PER_CHARACTER * (record.title.length + record.message.length))
}

// Identity of what a toast reads: notifications with the same one merge.
function toastKey({ code, title, message, source }: NotificationRecord) {
	return JSON.stringify([code, title, message, source.connectionId])
}

// Shows a notification as a toast: merged into the toast that reads the same, which moves to the end, or added at the
// end, dropping the oldest success (or the oldest toast when none is one) beyond MAX_TOASTS.
function pushToast(state: NotificationsState, notification: NotificationRecord) {
	const key = toastKey(notification)
	const merged = state.toasts.find((toast) => toastKey(toast.record) === key)
	const toasts = [...state.toasts.filter((toast) => toast !== merged), { record: notification, ids: [...(merged?.ids ?? []), notification.id] }]

	while (toasts.length > MAX_TOASTS) {
		const success = toasts.findIndex((toast) => toast.record.level === 'success')
		toasts.splice(Math.max(success, 0), 1)
	}

	state.toasts = toasts
}

// Notifications known to the tab.
export const notificationsState = proxy<NotificationsState>({ records: [], synchronized: false, toasts: [] })

// Counter of refreshes; a response is applied only if no later refresh started.
let generation = 0

// Notification events received since the latest refresh started, replayed on its response; absent while none is in flight.
let pending: NotificationEvent[] | undefined

// Orders notifications newest first.
function newestFirst(a: NotificationRecord, b: NotificationRecord) {
	return b.createdAt - a.createdAt || b.sequence - a.sequence
}

// Applies a notification event to the state. A new notification becomes a toast when toast is set, it is worth one,
// and the history was already fetched; a dismissed one leaves the history and the toasts.
function applyNotificationEvent(state: NotificationsState, event: NotificationEvent, toast: boolean) {
	switch (event.type) {
		case 'notification:created': {
			const { notification } = event
			if (state.records.some((record) => record.id === notification.id)) return
			state.records = [notification, ...state.records].sort(newestFirst)
			if (toast && state.synchronized && TOAST_LEVELS.has(notification.level)) pushToast(state, notification)
			return
		}
		case 'notification:read': {
			const ids = new Set(event.ids)
			state.records = state.records.map((record) => (!record.read && ids.has(record.id) ? { ...record, read: true } : record))
			return
		}
		case 'notification:dismissed': {
			const ids = new Set(event.ids)
			state.records = state.records.filter((record) => !ids.has(record.id))
			state.toasts = state.toasts.filter((toast) => !ids.has(toast.record.id)).map((toast) => ({ record: toast.record, ids: toast.ids.filter((id) => !ids.has(id)) }))
		}
	}
}

// Applies a notification event; any other event is ignored.
export function handleNotificationEvent(state: NotificationsState, event: ServerEvent) {
	if (event.type !== 'notification:created' && event.type !== 'notification:read' && event.type !== 'notification:dismissed') return
	pending?.push(event)
	applyNotificationEvent(state, event, true)
}

// Replaces the history with the server's, then replays the notification events received while the request was in
// flight. Notifications the server no longer retains are dropped. Keeps the history when the server is unreachable or
// another refresh started meanwhile.
export async function refreshNotifications(state: NotificationsState, request: ApiFetch = browserFetch) {
	const current = ++generation
	pending = []

	try {
		const response = await request('/api/notifications')
		if (!response.ok || current !== generation) return
		const { items } = (await response.json()) as NotificationSnapshot
		if (current !== generation) return

		state.records = [...items]
		for (const event of pending) applyNotificationEvent(state, event, false)
		state.synchronized = true
	} catch {
		// The server is unreachable; the next socket open refreshes the history.
	} finally {
		if (current === generation) pending = undefined
	}
}

// Asks the server to mark notifications as read for every tab; the tab applies it when notification:read arrives.
// A failure leaves them unread.
export async function markNotificationsRead(ids: readonly string[], request: ApiFetch = browserFetch) {
	await postIds('/api/notifications/read', ids, request)
}

// Asks the server to remove notifications from the history for every tab; the tab applies it when
// notification:dismissed arrives. A failure leaves them listed.
export async function dismissNotifications(ids: readonly string[], request: ApiFetch = browserFetch) {
	await postIds('/api/notifications/dismiss', ids, request)
}

// Posts the ids of notifications to a route of the history, unless there are none. Never throws.
async function postIds(path: string, ids: readonly string[], request: ApiFetch) {
	if (ids.length === 0) return

	try {
		await request(path, jsonInit('POST', { ids } satisfies NotificationIdsRequest))
	} catch {
		// The server is unreachable; nothing changed.
	}
}

// Records that the event socket opened (online) or that an open one closed (offline).
export function setServerLink(state: NotificationsState, link: ServerLink) {
	state.server = link
}

// Hides the toast of a notification; its notifications stay in the history, read or not.
export function dismissToast(state: NotificationsState, id: string) {
	state.toasts = state.toasts.filter((toast) => toast.record.id !== id)
}

// Whether a notification concerns the saved connection of the active profile: application-wide ones always do, and
// the others when their endpoint is that connection's, open or not. With all, every notification does.
export function inScope(record: NotificationRecord, connection: ConnectionInput | undefined, all = false) {
	if (all || !record.source.connectionId) return true
	return !!connection && !!record.source.endpoint && sameEndpoint(record.source.endpoint, connection)
}

// Returns the notifications listed in scope, newest first.
export function visibleNotifications(records: readonly NotificationRecord[], connection: ConnectionInput | undefined, all = false): NotificationRecord[] {
	return records.filter((record) => inScope(record, connection, all))
}

// Number of unread notifications of the active profile's connection.
export function unreadCount(records: readonly NotificationRecord[], connection: ConnectionInput | undefined) {
	return visibleNotifications(records, connection).filter((record) => !record.read).length
}

// Severities from the most to the least pressing: what failed, what needs a look, what to know, and what went well.
const LEVEL_ORDER: readonly NotificationLevel[] = ['error', 'warning', 'info', 'success']

// Severities that ask for the operator: an unread notification of one of them needs them.
const ATTENTION_LEVELS: ReadonlySet<NotificationLevel> = new Set<NotificationLevel>(['warning', 'error'])

// Returns the most pressing severity among notifications, or undefined when there are none.
export function worstLevel(records: readonly Pick<NotificationRecord, 'level'>[]): NotificationLevel | undefined {
	return LEVEL_ORDER.find((level) => records.some((record) => record.level === level))
}

// Returns the unread notifications in words, the errors and warnings first: "1 error, 2 warnings, 8 unread", "3 unread",
// or "No unread notifications".
export function unreadText(records: readonly Pick<NotificationRecord, 'level' | 'read'>[]) {
	const unread = records.filter((record) => !record.read)
	if (unread.length === 0) return 'No unread notifications'
	const errors = unread.filter((record) => record.level === 'error').length
	const warnings = unread.filter((record) => record.level === 'warning').length
	const parts = [errors > 0 && `${errors} ${errors === 1 ? 'error' : 'errors'}`, warnings > 0 && `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`, `${unread.length} unread`]
	return parts.filter(Boolean).join(', ')
}

// Notifications that read the same (same code, title, message, and connection), listed as one row with a count.
export interface NotificationGroup {
	// Latest notification of the group; its id keys the row and its instant dates it.
	readonly record: NotificationRecord
	// Ids of every notification of the group, newest first; never empty.
	readonly ids: readonly string[]
	// Ids of the unread notifications of the group, newest first; empty when every one was read.
	readonly unreadIds: readonly string[]
}

// Merges notifications that read the same into groups, in the order of their latest notification; records come newest
// first, as the history keeps them.
export function groupNotifications(records: readonly NotificationRecord[]): NotificationGroup[] {
	const groups = new Map<string, { record: NotificationRecord; ids: string[]; unreadIds: string[] }>()

	for (const record of records) {
		const key = toastKey(record)
		const group = groups.get(key) ?? { record, ids: [], unreadIds: [] }
		group.ids.push(record.id)
		if (!record.read) group.unreadIds.push(record.id)
		groups.set(key, group)
	}

	return Array.from(groups.values())
}

// Whether a group needs the operator: it is a warning or an error not read yet.
export function needsOperator(group: NotificationGroup) {
	return group.unreadIds.length > 0 && ATTENTION_LEVELS.has(group.record.level)
}

// Returns the name of the connection a notification concerns: the saved connection of its endpoint, else the endpoint
// itself ("Simulator", "pi.local:7624"); undefined for an application-wide notification.
export function connectionName(record: NotificationRecord, connections: readonly Connection[]) {
	const { endpoint } = record.source
	if (!endpoint) return undefined
	const saved = connections.find((connection) => sameEndpoint(endpoint, connection))
	if (saved) return saved.name
	return endpoint.type === 'SIMULATOR' ? 'Simulator' : `${endpoint.host}:${endpoint.port}`
}
