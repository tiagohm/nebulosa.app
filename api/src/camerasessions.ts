import type { OperationRegistry } from './operations'

// Bookkeeping shared by the sessions of the camera operations (Auto Focus, TPPA, Target Centering, Flat Wizard, Dark
// Library Wizard, Guiding): the latest session of each camera, which the snapshot lists and the routes of a session id
// find, the session each operation started, so a repeated start token answers it, and the publication of a changed
// summary with the next revision, only while the session is still the latest of its camera, so a session replaced by a
// newer one changes silently. What a session holds, runs, and answers belongs to its service.

// Summary fields of every session the registry keeps.
export interface CameraSessionFields {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation running the session; empty until it started.
	readonly operationId: string
	// Number of the latest change of the summary, from 0, increasing with every publication.
	readonly revision: number
}

// Session of a service, as the registry keeps it: its published summary, replaced on every change.
export interface CameraSession<S extends CameraSessionFields> {
	// Published summary.
	summary: S
}

// Latest session of each camera of one service, and the session of each operation it started.
export class CameraSessionRegistry<S extends CameraSessionFields, T extends CameraSession<S>> {
	// Latest session of each camera, by camera resource key.
	readonly #latest = new Map<string, T>()
	// Camera resource key each session was adopted under.
	readonly #keys = new WeakMap<T, string>()
	// Session of each operation a start token started, while the session is the latest of its camera.
	readonly #byOperation = new Map<string, T>()

	// Creates the sessions of a service: operations knows the operation each start token started, and publish receives
	// every summary published, synchronously.
	constructor(
		readonly operations: Pick<OperationRegistry, 'started'>,
		readonly publish: (summary: S) => void,
	) {}

	// Returns the summary of the latest session of every camera.
	summaries(): S[] {
		return Array.from(this.#latest.values(), (session) => session.summary)
	}

	// Returns the latest session of every camera.
	sessions(): IterableIterator<T> {
		return this.#latest.values()
	}

	// Returns the latest session of a camera, by its resource key.
	of(key: string): T | undefined {
		return this.#latest.get(key)
	}

	// Returns the latest session of a camera with this id; undefined for an unknown id or a session a newer one replaced.
	find(sessionId: string): T | undefined {
		for (const session of this.#latest.values()) if (session.summary.sessionId === sessionId) return session
		return undefined
	}

	// Returns the session a start token started, while it is the latest of its camera and the token is remembered.
	repeated(token: string): T | undefined {
		const known = this.operations.started(token)
		return known && this.#byOperation.get(known.operationId)
	}

	// Makes a session the latest of its camera, by its resource key, forgetting the operation of the one it replaces, whose
	// later changes are then silent.
	adopt(key: string, session: T) {
		const previous = this.#latest.get(key)
		if (previous) this.#byOperation.delete(previous.summary.operationId)
		this.#latest.set(key, session)
		this.#keys.set(session, key)
	}

	// Remembers the operation a session runs under, so a repeated start token answers the session.
	track(operationId: string, session: T) {
		this.#byOperation.set(operationId, session)
	}

	// Whether a session is still the latest of its camera.
	latest(session: T): boolean {
		const key = this.#keys.get(session)
		return key !== undefined && this.#latest.get(key) === session
	}

	// Replaces the summary of a session with patch applied and the next revision, and publishes it while the session is
	// the latest of its camera.
	update(session: T, patch: Partial<S>) {
		this.replace(session, { ...session.summary, ...patch })
	}

	// Replaces the summary of a session with summary, given the next revision, and publishes it while the session is the
	// latest of its camera; for a service that derives a field from the summary it replaces.
	replace(session: T, summary: S) {
		session.summary = { ...summary, revision: session.summary.revision + 1 }
		if (this.latest(session)) this.publish(session.summary)
	}
}
