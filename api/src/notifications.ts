import { NotificationClassifier, type NotificationDraft, type NotificationLevel, type NotificationSource, type NotificationTarget } from './notifications.rules'
import type { ServerEvent } from './websocket'

// History of the notifications of the server, kept in memory only: facts about operations that ended, failed, or wait
// for someone, never their state. The composition hands every server event to consume after broadcasting it; the
// classifier picks the few transitions worth a notification, and each new occurrence becomes a record published as
// notification:created. The history, and which records are read, is the same for every tab: reading or dismissing a
// record changes it for all of them, published as notification:read and notification:dismissed. A restart of the
// server starts an empty history.
//
// At most MAX_NOTIFICATIONS records younger than NOTIFICATION_RETENTION are kept, the older ones dropped when a record
// is created or the history is read. An occurrence is notified once while its key is younger than the retention, even
// when its record was dismissed or dropped. Classifying and publishing never throw into the service that published the
// event.

// Notification as published to clients.
export interface NotificationRecord {
	// Id of the notification.
	readonly id: string
	// Order of creation, increasing within the history.
	readonly sequence: number
	// Instant the notification was created, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly level: NotificationLevel
	// Stable code of the occurrence, such as capture.completed.
	readonly code: string
	// Short title meant for people, at most MAX_TITLE_LENGTH characters.
	readonly title: string
	// Explanation meant for people, at most MAX_MESSAGE_LENGTH characters.
	readonly message: string
	readonly source: NotificationSource
	// Context the UI may open; absent when there is none.
	readonly target?: NotificationTarget
	// Whether it was read, in any tab.
	readonly read: boolean
}

// Notification published when a notification is created.
export interface NotificationCreatedEvent {
	readonly type: 'notification:created'
	readonly notification: NotificationRecord
}

// Notification published when notifications are read, with the ids of those that were unread.
export interface NotificationReadEvent {
	readonly type: 'notification:read'
	readonly ids: readonly string[]
}

// Notification published when notifications are dismissed, with the ids of those removed from the history.
export interface NotificationDismissedEvent {
	readonly type: 'notification:dismissed'
	readonly ids: readonly string[]
}

// Notifications published by the history.
export type NotificationEvent = NotificationCreatedEvent | NotificationReadEvent | NotificationDismissedEvent

// Snapshot of GET /api/notifications: the whole retained history.
export interface NotificationSnapshot {
	// Notifications, newest first.
	readonly items: readonly NotificationRecord[]
}

// Body of POST /api/notifications/read and POST /api/notifications/dismiss.
export interface NotificationIdsRequest {
	// Ids of the notifications; ids the history no longer retains are ignored.
	readonly ids: readonly string[]
}

// Receiver of the notification events.
export type NotificationListener = (event: NotificationEvent) => void

// Options of the notification service.
export interface NotificationServiceOptions {
	// Current instant, Unix milliseconds (UTC).
	readonly now?: () => number
	// Classifier of the events; a NotificationClassifier naming no devices when absent.
	readonly classifier?: Pick<NotificationClassifier, 'classify'>
}

// Notifications kept; the oldest are dropped first.
export const MAX_NOTIFICATIONS = 500

// Age after which a notification is dropped, and its occurrence may be notified again, in milliseconds (30 days).
export const NOTIFICATION_RETENTION = 30 * 24 * 60 * 60 * 1000

// Longest title kept, in characters.
const MAX_TITLE_LENGTH = 80

// Longest message kept, in characters.
const MAX_MESSAGE_LENGTH = 240

// Text cut to at most length characters, ending with an ellipsis when cut.
function truncate(text: string, length: number) {
	return text.length <= length ? text : `${text.slice(0, length - 1)}…`
}

// History of the notifications, created from the server events, in memory.
export class NotificationService {
	// Current instant, Unix milliseconds (UTC).
	readonly #now: () => number
	// Classifier of the events.
	readonly #classifier: Pick<NotificationClassifier, 'classify'>
	// Retained notifications, oldest first.
	#records: NotificationRecord[] = []
	// Instant each occurrence key was notified, Unix milliseconds (UTC), oldest first.
	readonly #keys = new Map<string, number>()
	// Sequence of the latest notification.
	#sequence = 0

	// Creates the service, publishing every notification event to listener synchronously.
	constructor(
		readonly listener: NotificationListener,
		{ now = Date.now, classifier = new NotificationClassifier() }: NotificationServiceOptions = {},
	) {
		this.#now = now
		this.#classifier = classifier
	}

	// Creates the notifications an event asks for, once per occurrence. Never throws.
	consume(event: ServerEvent) {
		let drafts: NotificationDraft[]

		try {
			drafts = this.#classifier.classify(event)
		} catch (error) {
			console.warn('notifications: an event cannot be classified', error)
			return
		}

		for (const draft of drafts) this.#create(draft)
	}

	// Returns the retained history, newest first.
	snapshot(): NotificationSnapshot {
		this.#prune(this.#now())
		return { items: this.#records.toReversed() }
	}

	// Marks notifications as read for every tab, publishing the ids of those that were unread.
	read(ids: readonly string[]) {
		const wanted = new Set(ids)
		const changed: string[] = []

		this.#records = this.#records.map((record) => {
			if (record.read || !wanted.has(record.id)) return record
			changed.push(record.id)
			return { ...record, read: true }
		})

		if (changed.length > 0) this.#publish({ type: 'notification:read', ids: changed })
	}

	// Removes notifications from the history for every tab, publishing the ids of those it retained. Their occurrences
	// are not notified again.
	dismiss(ids: readonly string[]) {
		const wanted = new Set(ids)
		const changed = this.#records.filter((record) => wanted.has(record.id)).map((record) => record.id)
		if (changed.length === 0) return
		this.#records = this.#records.filter((record) => !wanted.has(record.id))
		this.#publish({ type: 'notification:dismissed', ids: changed })
	}

	// Creates and publishes the notification of a draft, unless its occurrence was already notified.
	#create({ key, level, code, title, message, source, target }: NotificationDraft) {
		const now = this.#now()
		this.#prune(now)
		if (this.#keys.has(key)) return

		const record: NotificationRecord = { id: Bun.randomUUIDv7(), sequence: ++this.#sequence, createdAt: now, level, code, title: truncate(title, MAX_TITLE_LENGTH), message: truncate(message, MAX_MESSAGE_LENGTH), source, ...(target && { target }), read: false }
		this.#keys.set(key, now)
		this.#records.push(record)
		if (this.#records.length > MAX_NOTIFICATIONS) this.#records = this.#records.slice(-MAX_NOTIFICATIONS)
		this.#publish({ type: 'notification:created', notification: record })
	}

	// Drops the notifications and the occurrence keys older than the retention at now, Unix milliseconds (UTC).
	#prune(now: number) {
		const oldest = now - NOTIFICATION_RETENTION
		if (this.#records.length > 0 && this.#records[0].createdAt < oldest) this.#records = this.#records.filter((record) => record.createdAt >= oldest)

		for (const [key, createdAt] of this.#keys) {
			if (createdAt >= oldest) break
			this.#keys.delete(key)
		}
	}

	// Publishes an event to the listener. Never throws.
	#publish(event: NotificationEvent) {
		try {
			this.listener(event)
		} catch (error) {
			console.warn('notifications: a notification event cannot be published', error)
		}
	}
}

// Routes of the notification history.
export function createNotificationRoutes(notifications: NotificationService) {
	return {
		'/api/notifications': {
			// The retained history, newest first.
			GET: () => Response.json(notifications.snapshot()),
		},
		'/api/notifications/read': {
			// Marks notifications as read for every tab (NotificationIdsRequest).
			POST: async (req) => {
				notifications.read(((await req.json()) as NotificationIdsRequest).ids)
				return new Response(null, { status: 204 })
			},
		},
		'/api/notifications/dismiss': {
			// Removes notifications from the history for every tab (NotificationIdsRequest).
			POST: async (req) => {
				notifications.dismiss(((await req.json()) as NotificationIdsRequest).ids)
				return new Response(null, { status: 204 })
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
