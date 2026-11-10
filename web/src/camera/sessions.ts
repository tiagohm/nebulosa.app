import { type ApiFetch, responseError } from '../http'
import type { SnapshotRefreshes } from '../refresh'
import { cameraKey } from './capture'

// Mirror of the sessions of a camera operation (Auto Focus, TPPA, DARV, Flat Wizard, Dark Library Wizard, Target
// Centering, Guiding), shared by their stores. The server owns every session, whichever tab started it, and keeps the
// latest one of each camera, so a store only mirrors it: the summary of each camera's latest session arrives with every
// event of the kind and, on every socket (re)open, with the snapshot at the kind's url; the complete record of a session,
// when the kind has one, is fetched from url/<session id> when its summary says it changed. A summary of an older session
// never replaces a newer one, nor an earlier revision a later one, and a snapshot leaves what an event changed during its
// fetch (SnapshotRefreshes). Commands of a camera are sent one at a time, and their refusals are kept for it. What a
// session holds, when its record is out of date, and what its commands send belong to each store.

// Summary fields every camera operation publishes for a session.
export interface CameraSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Camera of the session, by its exact connection and device ids.
	readonly camera: { readonly connectionId: string; readonly deviceId: string }
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Number of the latest change of the session, increasing; absent for a kind that does not count them.
	readonly revision?: number
}

// Fields of the complete record of a session the mirror reads.
export interface CameraSessionRecord {
	// Id of the session.
	readonly sessionId: string
	// Number of the latest change of the session the record holds; absent for a kind that does not count them.
	readonly revision?: number
}

// Sessions of a camera operation as a tab mirrors them, and the commands it sends.
export interface CameraSessions<S extends CameraSessionSummary> {
	// Latest session of each camera, by camera key (cameraKey).
	sessions: Record<string, S>
	// Cameras with a command of this tab waiting for the server.
	pending: Record<string, boolean>
	// Why this tab's last command to a camera failed; cleared by its next command.
	errors: Record<string, string>
}

// Sessions of a camera operation whose complete records are fetched apart.
export interface CameraSessionRecords<S extends CameraSessionSummary, D extends CameraSessionRecord> extends CameraSessions<S> {
	// Complete record of each session fetched so far, by session id.
	details: Record<string, D>
}

// Where the sessions of a camera operation are read, and the refreshes of their snapshot.
export interface CameraSessionSource {
	// Route of the snapshot, such as /api/tppa; a complete record is at url/<session id>.
	readonly url: string
	// Refreshes of the snapshot, ordered against the events applied meanwhile, by camera key.
	readonly refreshes: SnapshotRefreshes
}

// How the complete records of the sessions of a camera operation are kept current.
export interface CameraSessionKind<S extends CameraSessionSummary, D extends CameraSessionRecord> extends CameraSessionSource {
	// Whether the record of session must be fetched again: its summary just replaced known (undefined for the first
	// summary of its camera), and details is its record fetched so far, if any.
	readonly stale: (session: S, known: S | undefined, details: D | undefined) => boolean
	// Whether a fetched record is newer than the one known, so a late response never replaces a newer one; by default,
	// the later revision.
	readonly newer?: (loaded: D, known: D) => boolean
}

// Message kept for a command that could not reach the server.
const UNREACHABLE = 'Unable to reach the server.'

// Returns the camera key of a session.
export function sessionKey({ camera }: CameraSessionSummary) {
	return cameraKey(camera.connectionId, camera.deviceId)
}

// Whether a record is a later revision than the one known.
function newerRevision(loaded: CameraSessionRecord, known: CameraSessionRecord) {
	return (loaded.revision ?? 0) > (known.revision ?? 0)
}

// Applies the summary of a session from an event, unless it is older than the one known for its camera: a summary of an
// earlier session, or an earlier revision of the same one. Records the camera as changed for a refresh in flight. Returns
// the summary it replaced (absent for the first one of its camera), or undefined when it was ignored.
export function acceptSession<S extends CameraSessionSummary>(state: CameraSessions<S>, refreshes: SnapshotRefreshes, session: S): { readonly known?: S } | undefined {
	const key = sessionKey(session)
	const known = state.sessions[key]
	if (known && known.sessionId !== session.sessionId && known.startedAt > session.startedAt) return undefined
	if (known?.sessionId === session.sessionId && session.revision !== undefined && known.revision !== undefined && known.revision >= session.revision) return undefined

	refreshes.updated(key)
	state.sessions[key] = session
	return { known }
}

// Applies the summary of a session from an event (acceptSession); a new session of a camera forgets the records of the
// others, and the record of the session is fetched again when the kind says it is out of date.
export function applySession<S extends CameraSessionSummary, D extends CameraSessionRecord>(state: CameraSessionRecords<S, D>, kind: CameraSessionKind<S, D>, session: S, request: ApiFetch) {
	const accepted = acceptSession(state, kind.refreshes, session)
	if (!accepted) return

	const { known } = accepted
	if (known?.sessionId !== session.sessionId) for (const id of Object.keys(state.details)) if (id !== session.sessionId) delete state.details[id]
	if (kind.stale(session, known, state.details[session.sessionId])) void loadSessionRecord(state, kind, session.sessionId, request)
}

// Fetches the complete record of a session; a record no newer than the one known, as a late response can be, never
// replaces it, and a session the server no longer keeps is forgotten.
export async function loadSessionRecord<S extends CameraSessionSummary, D extends CameraSessionRecord>(state: CameraSessionRecords<S, D>, kind: CameraSessionKind<S, D>, sessionId: string, request: ApiFetch) {
	try {
		const response = await request(`${kind.url}/${encodeURIComponent(sessionId)}`)

		if (response.status === 404) {
			delete state.details[sessionId]
			return
		}

		if (!response.ok) return
		const record = (await response.json()) as D
		const known = state.details[sessionId]
		if (known === undefined || (kind.newer ?? newerRevision)(record, known)) state.details[sessionId] = record
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Replaces the sessions with the server's snapshot, which may have changed while the socket was closed, leaving what an
// event changed meanwhile, so a session that ended during the request is never shown running again, then hands kept the
// ids of the sessions the tab now knows and waits for what it does with them. A response is dropped when another refresh
// of the source started meanwhile.
export async function refreshSessions<S extends CameraSessionSummary>(state: CameraSessions<S>, source: CameraSessionSource, request: ApiFetch, kept: (sessionIds: readonly string[]) => unknown) {
	const { refreshes } = source
	const token = refreshes.start()

	try {
		const response = await request(source.url)
		if (!response.ok || !refreshes.current(token)) return
		const snapshot = (await response.json()) as { readonly sessions: readonly S[] }
		if (!refreshes.current(token)) return

		state.sessions = refreshes.merge(state.sessions, snapshot.sessions, sessionKey)
		await kept(Object.values(state.sessions).map(({ sessionId }) => sessionId))
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	} finally {
		refreshes.end(token)
	}
}

// Refreshes the sessions (refreshSessions), forgets the records of the sessions no longer kept, and fetches the records of
// the others.
export function refreshSessionRecords<S extends CameraSessionSummary, D extends CameraSessionRecord>(state: CameraSessionRecords<S, D>, kind: CameraSessionKind<S, D>, request: ApiFetch) {
	return refreshSessions(state, kind, request, (kept) => {
		for (const id of Object.keys(state.details)) if (!kept.includes(id)) delete state.details[id]
		for (const id of kept) void loadSessionRecord(state, kind, id, request)
	})
}

// Sends a command of what key names (a camera, by camera key, or a mount pointing model, by its id), ignored while another
// command of it waits for the server, and records its refusal under key. When the server cannot be reached, the command
// may still have been applied, so refresh fetches the snapshot again instead of assuming nothing happened. Resolves to
// the response of an accepted command, whose body is left unread, or undefined.
export async function sendSessionCommand(state: Pick<CameraSessions<CameraSessionSummary>, 'pending' | 'errors'>, key: string, url: string, init: RequestInit, refresh: () => Promise<unknown>, request: ApiFetch): Promise<Response | undefined> {
	if (state.pending[key]) return undefined
	state.pending[key] = true
	delete state.errors[key]

	try {
		const response = await request(url, init)
		if (response.ok) return response
		state.errors[key] = await responseError(response)
		return undefined
	} catch {
		state.errors[key] = UNREACHABLE
		await refresh()
		return undefined
	} finally {
		delete state.pending[key]
	}
}
