import type { NotificationLevel, NotificationRecord, NotificationSnapshot, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { type ConnectionInput, sameEndpoint } from '../connection/connection'
import type { NotificationPreferences } from '../profile/schema'

// Notification history of the server as this tab knows it. The server owns the history and the same records reach
// every tab: this store mirrors it from notification:created events and, on every socket (re)open, from the whole
// retained history, keeping the events that arrived while that request was in flight. Which records are read or
// dismissed belongs to the active profile (ProfileSettings.notifications), never to this store or to the server.
// Only notifications that arrive live after the first synchronization become toasts, so a reload or a reconnect
// never replays them.

// Notifications known to the tab and the toasts it shows.
export interface NotificationsState {
	// Retained notifications, newest first.
	records: NotificationRecord[]
	// Whether the history was fetched at least once; earlier events never become toasts.
	synchronized: boolean
	// Notifications shown as toasts, oldest first; at most MAX_TOASTS.
	toasts: NotificationRecord[]
}

// Most toasts shown at once; the oldest is dropped first.
export const MAX_TOASTS = 3

// Severities shown as toasts; info notifications stay in the history only.
const TOAST_LEVELS: ReadonlySet<NotificationLevel> = new Set<NotificationLevel>(['success', 'warning', 'error'])

// Notifications known to the tab.
export const notificationsState = proxy<NotificationsState>({ records: [], synchronized: false, toasts: [] })

// Counter of refreshes; a response is applied only if no later refresh started.
let generation = 0

// Ids of the notifications received as events since the latest refresh started.
let received = new Set<string>()

// Orders notifications newest first.
function newestFirst(a: NotificationRecord, b: NotificationRecord) {
	return b.createdAt - a.createdAt || b.sequence - a.sequence
}

// Applies a notification event; any other event is ignored. A new notification becomes a toast when it is
// worth one and the history was already fetched.
export function handleNotificationEvent(state: NotificationsState, event: ServerEvent) {
	if (event.type !== 'notification:created') return

	const { notification } = event
	received.add(notification.id)
	if (state.records.some((record) => record.id === notification.id)) return

	state.records = [notification, ...state.records].sort(newestFirst)
	if (state.synchronized && TOAST_LEVELS.has(notification.level)) state.toasts = [...state.toasts, notification].slice(-MAX_TOASTS)
}

// Replaces the history with the server's, keeping the notifications received while the request was in flight.
// Notifications the server no longer retains are dropped. Returns the ids of every notification known afterwards, or
// undefined when the server is unreachable or another refresh started meanwhile.
export async function refreshNotifications(state: NotificationsState, request: typeof fetch = fetch): Promise<string[] | undefined> {
	const current = ++generation
	received = new Set()

	try {
		const response = await request('/api/notifications')
		if (!response.ok || current !== generation) return undefined
		const { items } = (await response.json()) as NotificationSnapshot
		if (current !== generation) return undefined

		const retained = new Set(items.map((item) => item.id))
		const live = state.records.filter((record) => received.has(record.id) && !retained.has(record.id))
		state.records = [...live, ...items].sort(newestFirst)
		state.synchronized = true
		return state.records.map((record) => record.id)
	} catch {
		// The server is unreachable; the next socket open refreshes the history.
		return undefined
	}
}

// Removes a toast; its notification stays in the history, read or not.
export function dismissToast(state: NotificationsState, id: string) {
	state.toasts = state.toasts.filter((toast) => toast.id !== id)
}

// Whether a notification concerns the saved connection of the active profile: application-wide ones always do, and
// the others when their endpoint is that connection's, open or not. With all, every notification does.
export function inScope(record: NotificationRecord, connection: ConnectionInput | undefined, all = false) {
	if (all || !record.source.connectionId) return true
	return !!connection && !!record.source.endpoint && sameEndpoint(record.source.endpoint, connection)
}

// Whether a profile has not read a notification.
export function isUnread(record: NotificationRecord, preferences: Readonly<NotificationPreferences> | undefined) {
	return !preferences?.readIds.includes(record.id)
}

// Returns the notifications a profile lists: not dismissed and in scope, newest first.
export function visibleNotifications(records: readonly NotificationRecord[], preferences: Readonly<NotificationPreferences> | undefined, connection: ConnectionInput | undefined, all = false): NotificationRecord[] {
	return records.filter((record) => !preferences?.dismissedIds.includes(record.id) && inScope(record, connection, all))
}

// Number of notifications of the active profile's connection a profile has not read nor dismissed.
export function unreadCount(records: readonly NotificationRecord[], preferences: Readonly<NotificationPreferences> | undefined, connection: ConnectionInput | undefined) {
	return visibleNotifications(records, preferences, connection).filter((record) => isUnread(record, preferences)).length
}
