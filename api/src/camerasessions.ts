import type { OperationRegistry } from './operations'

// Bookkeeping shared by the sessions of the camera operations (Auto Focus, TPPA, Target Centering, Flat Wizard, Dark
// Library Wizard, Guiding): the latest session of each camera, which the snapshot lists and the routes of a session id
// find, the session each operation started, so a repeated start token answers it, and the publication of a changed
// summary with the next revision, only while the session is still the latest of its camera, so a session replaced by a
// newer one changes silently. What a session holds, runs, and answers belongs to its service. It serves the sessions run
// by one operation each; DARV, whose session runs an operation per measurement, and the mount pointing sessions, which
// outlive their pauses without one and run an operation per stretch of work, keep their own. A session a newer one
// replaced stays known by its operation (see MAX_SESSIONS), so a start token repeated afterwards still answers it instead
// of starting nothing under a new session.

// Sessions remembered by operation once a newer one replaced them; the oldest are forgotten, as command tokens are.
const MAX_SESSIONS = 256

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
	// Session of each operation a start token started, oldest first (see MAX_SESSIONS).
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

	// Returns the session a start token started, the latest of its camera or one a newer session replaced, while the
	// token and the session are remembered.
	repeated(token: string): T | undefined {
		const known = this.operations.started(token)
		return known && this.#byOperation.get(known.operationId)
	}

	// Makes a session the latest of its camera, by its resource key, once the operation running it started: the one it
	// replaces changes silently from then on, operationId is remembered, so a repeated start token answers the session,
	// and the session is published with it. A service calls it right after starting the operation,
	// in the same synchronous step, so the first summary of a session published already names its operation (what the
	// start of the operation changed is published with it) and no repeated request can come in between.
	adopt(key: string, session: T, operationId: string) {
		this.#latest.set(key, session)
		this.#keys.set(session, key)
		this.#byOperation.set(operationId, session)
		if (this.#byOperation.size > MAX_SESSIONS) this.#byOperation.delete(this.#byOperation.keys().next().value!)
		this.replace(session, { ...session.summary, operationId })
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
