import type { AppDatabase } from './database'
import { NotificationClassifier, type NotificationDraft, type NotificationLevel, type NotificationSource, type NotificationTarget } from './notifications.rules'
import type { ServerEvent } from './websocket'

// History of the notifications of the server: facts about operations that ended, failed, or wait for someone,
// never their state. The composition hands every server event to consume after broadcasting it; the classifier
// picks the few transitions worth a notification, and each new occurrence becomes an immutable record, a row of
// the operational database, published as notification:created once committed. The history is the same for every
// tab; which records a profile has read or dismissed belongs to the profile (profile_notification_state, Workspace).
//
// At most MAX_NOTIFICATIONS records younger than NOTIFICATION_RETENTION are kept: the older ones are deleted with the
// read states of every profile in the transaction that creates a record. Classifying, storing, and publishing never
// throw into the service that published the event; a record that cannot be written is reported on the console and
// not published.

// Notification as published to clients.
export interface NotificationRecord {
	// Id of the notification, stable across restarts of the server.
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
}

// Notification published when a notification is created.
export interface NotificationCreatedEvent {
	readonly type: 'notification:created'
	readonly notification: NotificationRecord
}

// Snapshot of GET /api/notifications: the whole retained history.
export interface NotificationSnapshot {
	// Notifications, newest first.
	readonly items: readonly NotificationRecord[]
}

// Receiver of the created notifications.
export type NotificationListener = (event: NotificationCreatedEvent) => void

// Options of the notification service.
export interface NotificationServiceOptions {
	// Operational database the history is kept in.
	readonly database: AppDatabase
	// Current instant, Unix milliseconds (UTC).
	readonly now?: () => number
	// Classifier of the events; a NotificationClassifier naming no devices when absent.
	readonly classifier?: Pick<NotificationClassifier, 'classify'>
}

// Notifications kept; the oldest are deleted first.
export const MAX_NOTIFICATIONS = 500

// Age after which a notification is deleted, in milliseconds (30 days).
export const NOTIFICATION_RETENTION = 30 * 24 * 60 * 60 * 1000

// Longest title kept, in characters.
const MAX_TITLE_LENGTH = 80

// Longest message kept, in characters.
const MAX_MESSAGE_LENGTH = 240

// Text cut to at most length characters, ending with an ellipsis when cut.
function truncate(text: string, length: number) {
	return text.length <= length ? text : `${text.slice(0, length - 1)}…`
}

// Row of notifications.
interface NotificationRow {
	readonly sequence: number
	readonly id: string
	readonly created_at: number
	readonly level: NotificationLevel
	readonly code: string
	readonly title: string
	readonly message: string
	readonly source: string
	readonly target: string | null
}

// Returns the record of a row.
function rowRecord({ sequence, id, created_at, level, code, title, message, source, target }: NotificationRow): NotificationRecord {
	return { id, sequence, createdAt: created_at, level, code, title, message, source: JSON.parse(source) as NotificationSource, ...(target !== null && { target: JSON.parse(target) as NotificationTarget }) }
}

// History of the notifications, created from the server events, in the operational database.
export class NotificationService {
	// Operational database the history is kept in.
	readonly database: AppDatabase
	// Current instant, Unix milliseconds (UTC).
	readonly #now: () => number
	// Classifier of the events.
	readonly #classifier: Pick<NotificationClassifier, 'classify'>

	// Creates the service, publishing every created notification to listener synchronously.
	constructor(
		readonly listener: NotificationListener,
		{ database, now = Date.now, classifier = new NotificationClassifier() }: NotificationServiceOptions,
	) {
		this.database = database
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
		const rows = this.database.db.query<NotificationRow, [number, number]>('SELECT sequence, id, created_at, level, code, title, message, source, target FROM notifications WHERE created_at >= ? ORDER BY sequence DESC LIMIT ?').all(this.#now() - NOTIFICATION_RETENTION, MAX_NOTIFICATIONS)
		return { items: rows.map(rowRecord) }
	}

	// Creates and publishes the notification of a draft, unless its occurrence was already notified, deleting in the same
	// transaction what the history no longer retains.
	#create({ key, level, code, title, message, source, target }: NotificationDraft) {
		const now = this.#now()
		let record: NotificationRecord | undefined

		try {
			record = this.database.write(() => {
				const { db } = this.database
				if (db.query('SELECT 1 FROM notifications WHERE key = ?').get(key)) return undefined
				const id = Bun.randomUUIDv7()
				const inserted = db
					.query<NotificationRow, [string, string, number, string, string, string, string, string, string | null]>(
						'INSERT INTO notifications (id, key, created_at, level, code, title, message, source, target) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING RETURNING sequence, id, created_at, level, code, title, message, source, target',
					)
					.get(id, key, now, level, code, truncate(title, MAX_TITLE_LENGTH), truncate(message, MAX_MESSAGE_LENGTH), JSON.stringify(source), target ? JSON.stringify(target) : null)
				db.query('DELETE FROM notifications WHERE created_at < ? OR sequence <= (SELECT sequence FROM notifications ORDER BY sequence DESC LIMIT 1 OFFSET ?)').run(now - NOTIFICATION_RETENTION, MAX_NOTIFICATIONS)
				return inserted ? rowRecord(inserted) : undefined
			})
		} catch (error) {
			console.warn('notifications: a notification cannot be recorded', error)
			return
		}

		if (!record) return

		try {
			this.listener({ type: 'notification:created', notification: record })
		} catch (error) {
			console.warn('notifications: a notification cannot be published', error)
		}
	}
}

// Routes of the notification history.
export function createNotificationRoutes(notifications: NotificationService) {
	return {
		'/api/notifications': {
			// The retained history, newest first; read and dismissed states belong to each profile (GET /api/workspace).
			GET: () => Response.json(notifications.snapshot()),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
