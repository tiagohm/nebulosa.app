import type { LeasedSession } from 'api'
import { jsonInit, responseError } from './http'

// Client side of a manual motion held by a lease (the mount nudge and the manual rotation of a dome): the
// one press a tab holds, its heartbeats, and its release. The server owns every session and stops it when
// its lease is no longer renewed, so a press is never assumed from local state alone: it starts only on an
// explicit user action, is renewed by heartbeats at the interval the server answers, and is released on
// pointer up or whenever control is lost. Each press has a token of its own, so a late event or response of
// an earlier press never changes the current one, and a stop sent while the start is still in flight makes
// the server record the press as ended before it can move.

// Life stage of a press of this tab: starting until the server answers, then the stage the server reports.
export type PressPhase = 'starting' | 'moving' | 'stopping'

// Press held by this tab.
export interface Press {
	// Identity of the press, sent with every request about it.
	readonly token: string
	// Life stage.
	phase: PressPhase
}

// Store holding at most one press of this tab and the outcome of its latest one.
export interface PressHolder<P extends Press> {
	// Press held by this tab, if any.
	press?: P
	// Why this tab's latest command failed, or how its latest press ended abnormally; cleared by the next one.
	error?: string
}

// Response of an accepted press: the session and the interval of the heartbeats, in milliseconds.
export interface PressStartResponse<S extends LeasedSession> {
	// Session as it stands after the start.
	readonly session: S
	// Interval between two heartbeats, in milliseconds.
	readonly heartbeatInterval: number
}

// Heartbeat timer of each press of this tab, by token.
const heartbeats = new Map<string, ReturnType<typeof setInterval>>()

// Returns whether a session is still running.
export function pressRunning(session: Pick<LeasedSession, 'phase'> | undefined): boolean {
	return session !== undefined && session.phase !== 'stopped' && session.phase !== 'failed'
}

// Stops renewing a press.
function stopHeartbeat(token: string) {
	clearInterval(heartbeats.get(token))
	heartbeats.delete(token)
}

// Forgets the press of this tab when it is the given one.
export function forgetPress<P extends Press>(holder: PressHolder<P>, token: string) {
	stopHeartbeat(token)
	if (holder.press?.token === token) holder.press = undefined
}

// Starts a press: posts the start request with its token and, once the server answers that it runs,
// renews it at the server's heartbeat interval. Ignored while this tab already holds a press. path returns
// the URL of the session resource of a token, under which /heartbeat and /stop are addressed.
export async function startPress<P extends Press>(holder: PressHolder<P>, press: P, url: string, body: object, path: (token: string) => string, request: typeof fetch = fetch) {
	if (holder.press) return

	const { token } = press
	holder.press = press
	holder.error = undefined

	try {
		const response = await request(url, jsonInit('POST', { ...body, token }))

		if (!response.ok) {
			const message = await responseError(response)
			if (holder.press?.token === token) holder.error = message
			forgetPress(holder, token)
			return
		}

		const { session, heartbeatInterval } = (await response.json()) as PressStartResponse<LeasedSession>
		const current = holder.press

		// Released while starting: its stop is already on the way and owns forgetting it.
		if (current?.token === token && current.phase === 'stopping') return

		if (current?.token !== token || !pressRunning(session)) {
			forgetPress(holder, token)
			return
		}

		if (session.phase === 'moving') current.phase = 'moving'
		heartbeats.set(
			token,
			setInterval(() => void heartbeat(holder, token, path, request), heartbeatInterval),
		)
	} catch {
		if (holder.press?.token === token) holder.error = 'The server cannot be reached'
		forgetPress(holder, token)
	}
}

// Renews a press; a press the server no longer runs is forgotten. A failed request is not an end: the
// server stops the press by itself if no later heartbeat arrives in time.
async function heartbeat<P extends Press>(holder: PressHolder<P>, token: string, path: (token: string) => string, request: typeof fetch) {
	try {
		const response = await request(`${path(token)}/heartbeat`, { method: 'POST' })
		if (response.status === 404) forgetPress(holder, token)
	} catch {
		// The server is unreachable; its lease ends the press if this lasts.
	}
}

// Sends the stop of a press and forgets it once answered, keeping the server's reason when the device
// could not be observed to stop. It is sent with keepalive so it still leaves a page that is being closed;
// unreachable is the message kept when the server cannot be reached.
export async function stopPress<P extends Press>(holder: PressHolder<P>, token: string, path: (token: string) => string, unreachable: string, request: typeof fetch = fetch) {
	stopHeartbeat(token)

	try {
		const response = await request(`${path(token)}/stop`, { method: 'POST', keepalive: true })
		if (!response.ok) holder.error = await responseError(response)
	} catch {
		holder.error = unreachable
	}

	forgetPress(holder, token)
}

// Releases the press of this tab, if any, and resolves once the server answered.
export async function releasePress<P extends Press>(holder: PressHolder<P>, path: (token: string) => string, unreachable: string, request: typeof fetch = fetch) {
	const press = holder.press
	if (!press || press.phase === 'stopping') return
	press.phase = 'stopping'
	await stopPress(holder, press.token, path, unreachable, request)
}

// Follows a session event of this tab's press: its stage while it runs, and its end, which forgets the
// press and keeps endProblem's description of an abnormal end. Events of other presses are ignored.
export function followPress<P extends Press, S extends LeasedSession>(holder: PressHolder<P>, session: S, endProblem: (session: S) => string | undefined) {
	const press = holder.press
	if (press?.token !== session.token) return

	if (session.phase === 'moving' || session.phase === 'stopping') {
		press.phase = session.phase
	} else if (!pressRunning(session)) {
		forgetPress(holder, session.token)
		holder.error = endProblem(session)
	}
}

// Forgets the press of this tab when the server's list of running sessions no longer has it; a press
// still waiting for its start response is kept, since that response decides it.
export function reconcilePress<P extends Press>(holder: PressHolder<P>, running: readonly Pick<LeasedSession, 'token'>[]) {
	const press = holder.press
	if (press && press.phase !== 'starting' && !running.some((session) => session.token === press.token)) forgetPress(holder, press.token)
}
