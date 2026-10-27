import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { NotificationClassifier, type NotificationDraft, type NotificationLevel, type NotificationSource, type NotificationTarget } from './notifications.rules'
import { errorCode, isRecord, writeAtomically } from './util'
import type { ServerEvent } from './websocket'

// History of the notifications of the server: facts about operations that ended, failed, or wait for someone,
// never their state. The composition hands every server event to consume after broadcasting it; the classifier
// picks the few transitions worth a notification, and each new occurrence becomes an immutable record,
// published as notification:created and kept in a versioned JSON file of the server. The history is the same
// for every tab: which records a profile has read or dismissed is kept by the browser, never here.
//
// At most MAX_NOTIFICATIONS records younger than NOTIFICATION_RETENTION are kept. Each change is written at once,
// one write at a time, the changes made during a write coalesced into the next one, so a crash loses at most the
// records of the write in progress. Classifying, storing, and publishing never throw into the service that
// published the event, and never wait for the file.

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
	// File the history is persisted in; DEFAULT_NOTIFICATIONS_FILE when absent.
	readonly file?: string
	// Current instant, Unix milliseconds (UTC).
	readonly now?: () => number
	// Classifier of the events; a NotificationClassifier naming no devices when absent.
	readonly classifier?: Pick<NotificationClassifier, 'classify'>
}

// Record as kept in the file, with the key of the occurrence it reports.
interface StoredNotification extends NotificationRecord {
	// Identity of the occurrence; never published.
	readonly key: string
}

// File the history is persisted in when none is given.
export const DEFAULT_NOTIFICATIONS_FILE = join(homedir(), 'Nebulosa', 'notifications.json')

// Version of the history file format written by this version.
const NOTIFICATIONS_VERSION = 1

// Notifications kept; the oldest are forgotten first.
export const MAX_NOTIFICATIONS = 500

// Age after which a notification is forgotten, in milliseconds (30 days).
export const NOTIFICATION_RETENTION = 30 * 24 * 60 * 60 * 1000

// Longest title kept, in characters.
const MAX_TITLE_LENGTH = 80

// Longest message kept, in characters.
const MAX_MESSAGE_LENGTH = 240

// Severities a stored record may have.
const LEVELS: ReadonlySet<unknown> = new Set<NotificationLevel>(['info', 'success', 'warning', 'error'])

// Whether a value read from the file, which is not trusted, is a stored notification.
function isStoredNotification(value: unknown): value is StoredNotification {
	if (!isRecord(value)) return false
	const { id, key, sequence, createdAt, level, code, title, message, source, target } = value
	return (
		typeof id === 'string' &&
		typeof key === 'string' &&
		Number.isInteger(sequence) &&
		Number.isFinite(createdAt) &&
		LEVELS.has(level) &&
		typeof code === 'string' &&
		typeof title === 'string' &&
		typeof message === 'string' &&
		isRecord(source) &&
		typeof source.kind === 'string' &&
		(target === undefined || isRecord(target))
	)
}

// Record as published, without its key.
function publicRecord({ key, ...record }: StoredNotification): NotificationRecord {
	return record
}

// Text cut to at most length characters, ending with an ellipsis when cut.
function truncate(text: string, length: number) {
	return text.length <= length ? text : `${text.slice(0, length - 1)}…`
}

// History of the notifications, created from the server events. The file is read on first use, so creating the
// service has no side effect.
export class NotificationService {
	// File the history is persisted in.
	readonly file: string
	// Current instant, Unix milliseconds (UTC).
	readonly #now: () => number
	// Classifier of the events.
	readonly #classifier: Pick<NotificationClassifier, 'classify'>
	// Retained records, oldest first, once read.
	#records?: StoredNotification[]
	// Keys of the retained records.
	readonly #keys = new Set<string>()
	// Sequence of the latest record created.
	#sequence = 0
	// Whether the file was written by a newer version, so it is never overwritten.
	#newer = false
	// Tail of the writes, which run one at a time.
	#queue: Promise<void> = Promise.resolve()
	// Whether a write is queued and not started yet; it writes the history as it is when it starts.
	#queued = false

	// Creates the service, publishing every created notification to listener synchronously.
	constructor(
		readonly listener: NotificationListener,
		{ file = DEFAULT_NOTIFICATIONS_FILE, now = Date.now, classifier = new NotificationClassifier() }: NotificationServiceOptions = {},
	) {
		this.file = file
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
		return { items: this.#prune().map(publicRecord).toReversed() }
	}

	// Resolves once the changes made so far are written, or failed to be; never rejects.
	flush(): Promise<void> {
		return this.#queue
	}

	// Creates, stores, and publishes the notification of a draft, unless its occurrence was already notified.
	#create(draft: NotificationDraft) {
		const records = this.#load()
		if (this.#keys.has(draft.key)) return

		const { key, level, code, title, message, source, target } = draft
		const record: StoredNotification = { id: crypto.randomUUID(), sequence: ++this.#sequence, createdAt: this.#now(), level, code, title: truncate(title, MAX_TITLE_LENGTH), message: truncate(message, MAX_MESSAGE_LENGTH), source, ...(target && { target }), key }
		records.push(record)
		this.#keys.add(key)
		this.#prune()
		this.#save()

		try {
			this.listener({ type: 'notification:created', notification: publicRecord(record) })
		} catch (error) {
			console.warn('notifications: a notification cannot be published', error)
		}
	}

	// Returns the retained records, reading the file on first use. A missing or unreadable file gives an empty
	// history; a file of a newer version is read as far as it is understood and never overwritten.
	#load(): StoredNotification[] {
		if (this.#records) return this.#records

		let records: StoredNotification[] = []

		try {
			const data: unknown = JSON.parse(readFileSync(this.file, 'utf-8'))

			if (isRecord(data) && Number.isInteger(data.version) && Array.isArray(data.records)) {
				records = data.records.filter(isStoredNotification).sort((a, b) => a.sequence - b.sequence)
				this.#sequence = Math.max(Number.isInteger(data.nextSequence) ? (data.nextSequence as number) - 1 : 0, records.at(-1)?.sequence ?? 0)
				this.#newer = (data.version as number) > NOTIFICATIONS_VERSION
				if (this.#newer) console.warn('notifications: the history file was written by a newer version of Nebulosa and will not be overwritten')
			} else {
				console.warn('notifications: the history file is not a Nebulosa notification history')
			}
		} catch (error) {
			const code = errorCode(error)
			if (code !== 'ENOENT' && code !== 'ENOTDIR') console.warn('notifications: the history file cannot be read', error)
		}

		this.#records = records
		for (const record of records) this.#keys.add(record.key)
		this.#prune()
		return records
	}

	// Forgets the records older than the retention and beyond the limit. Returns the retained records.
	#prune(): StoredNotification[] {
		const records = this.#load()
		const cutoff = this.#now() - NOTIFICATION_RETENTION
		let first = Math.max(0, records.length - MAX_NOTIFICATIONS)
		while (first < records.length && records[first].createdAt < cutoff) first++
		if (first === 0) return records

		for (const record of records.splice(0, first)) this.#keys.delete(record.key)
		return records
	}

	// Queues a write of the history, unless one is already queued, which then writes this change too.
	#save() {
		if (this.#newer || this.#queued) return
		this.#queued = true

		this.#queue = this.#queue.then(async () => {
			this.#queued = false
			const text = `${JSON.stringify({ version: NOTIFICATIONS_VERSION, nextSequence: this.#sequence + 1, records: this.#records }, undefined, '\t')}\n`

			try {
				await writeAtomically(this.file, text)
			} catch (error) {
				console.warn('notifications: the history file cannot be written', error)
			}
		})
	}
}

// Routes of the notification history.
export function createNotificationRoutes(notifications: NotificationService) {
	return {
		'/api/notifications': {
			// The retained history, newest first; read and dismissed states are kept by each browser profile.
			GET: () => Response.json(notifications.snapshot()),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
