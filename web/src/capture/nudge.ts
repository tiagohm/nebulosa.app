import type { MountNudgeDirection, MountNudgeSession, MountNudgeStartResponse, MountState, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { responseError } from '../http'

// Mount Nudge runtime of the tab: the real state of the mount the active profile assigns to the MOUNT role,
// the nudge sessions the server reports on it, and the one press this tab holds. The server owns every
// session and stops it when its lease is no longer renewed, so this store never assumes a motion from
// local state alone: a press starts only with a pointer down, is renewed by heartbeats while the server
// says it moves, and is released on pointer up or whenever control is lost. A press is never restored
// after a reload or a socket reopen; the running sessions are fetched again instead. Each press has a
// token of its own, so a late event or response of an earlier press never changes the current one. The
// mount is addressed by its connection id and exact device id.

// Mount the runtime follows.
export interface NudgeTarget {
	// Id of the open server connection that provides the mount.
	readonly connectionId: string
	// Exact device id of the mount.
	readonly id: string
}

// Press held by this tab.
export interface NudgePress {
	// Identity of the press, sent with every request about it.
	readonly token: string
	// Mount the press moves; it never follows a later change of the role's device.
	readonly target: NudgeTarget
	// Direction moved in.
	readonly direction: MountNudgeDirection
	// Life stage: starting until the server answers, then the stage the server reports.
	phase: 'starting' | 'moving' | 'stopping'
}

// Mount Nudge runtime state.
export interface NudgeRuntime {
	// Mount followed; absent when the profile has no MOUNT on an open connection.
	target?: NudgeTarget
	// Latest state reported for the target; absent until known or after the mount is removed.
	state?: MountState
	// Latest session of each mount, by mount key (nudgeKey), running or ended, started by any tab.
	sessions: Record<string, MountNudgeSession>
	// Press held by this tab, if any.
	press?: NudgePress
	// Whether a slew rate change is being sent.
	sending: boolean
	// Why this tab's latest command failed, or how its latest press ended abnormally; cleared by the next one.
	error?: string
}

// Mount Nudge runtime of the tab.
export const nudgeRuntime = proxy<NudgeRuntime>({ sessions: {}, sending: false })

// Heartbeat timer of each press of this tab, by token.
const heartbeats = new Map<string, ReturnType<typeof setInterval>>()

// Counter of state fetches; a response is applied only if no later fetch started.
let stateGeneration = 0

// Counter of session fetches; a response is applied only if no later fetch started.
let sessionsGeneration = 0

// Display name of each direction.
export const NUDGE_DIRECTION_LABELS: Readonly<Record<MountNudgeDirection, string>> = {
	N: 'North',
	S: 'South',
	E: 'East',
	W: 'West',
	NE: 'North-East',
	NW: 'North-West',
	SE: 'South-East',
	SW: 'South-West',
}

// Returns the key of a mount: its connection id and exact device id.
export function nudgeKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Whether two targets are the same mount.
function sameTarget(a: NudgeTarget | undefined, b: NudgeTarget | undefined) {
	return a?.connectionId === b?.connectionId && a?.id === b?.id
}

// Path of the API resource of a mount.
function mountPath({ connectionId, id }: NudgeTarget) {
	return `/api/connections/${encodeURIComponent(connectionId)}/mounts/${encodeURIComponent(id)}`
}

// Path of the API resource of a press.
function pressPath(token: string) {
	return `/api/mounts/nudges/${encodeURIComponent(token)}`
}

// Returns whether a session is still running.
export function nudgeRunning(session: Pick<MountNudgeSession, 'phase'> | undefined): boolean {
	return session !== undefined && session.phase !== 'stopped' && session.phase !== 'failed'
}

// Returns whether a direction can be moved in by a mount: each of its axes must accept manual motion.
export function nudgeDirectionSupported(state: Pick<MountState, 'canMoveNS' | 'canMoveWE'> | undefined, direction: MountNudgeDirection) {
	if (!state) return false
	const northSouth = direction.includes('N') || direction.includes('S')
	const westEast = direction.includes('E') || direction.includes('W')
	return (!northSouth || state.canMoveNS) && (!westEast || state.canMoveWE)
}

// Explains how a session that ended abnormally ended, or undefined when it was released normally.
export function nudgeEndProblem(session: MountNudgeSession): string | undefined {
	if (session.phase === 'stopped') return session.stopConfirmed === false ? 'The mount was not observed to stop.' : undefined
	if (session.phase !== 'failed') return undefined
	const stop = session.stopConfirmed === false ? ' The mount was not observed to stop.' : ''

	switch (session.reason) {
		case 'timeout':
			return `Stopped: control of the motion was lost.${stop}`
		case 'disconnected':
		case 'removed':
			return `Stopped: the mount disconnected.${stop}`
		case 'aborted':
			return `The motion was aborted.${stop}`
		default:
			return `${session.error ?? 'The motion failed.'}${stop}`
	}
}

// Stops renewing a press.
function stopHeartbeat(token: string) {
	clearInterval(heartbeats.get(token))
	heartbeats.delete(token)
}

// Forgets the press of this tab when it is the given one.
function forgetPress(runtime: NudgeRuntime, token: string) {
	stopHeartbeat(token)
	if (runtime.press?.token === token) runtime.press = undefined
}

// Follows another mount, or none. A press held on the previous mount is released, everything known about
// the previous mount is dropped, and the new mount's state is fetched. The same mount changes nothing.
export function watchNudgeMount(runtime: NudgeRuntime, target: NudgeTarget | undefined, request: typeof fetch = fetch) {
	if (sameTarget(runtime.target, target)) return

	void releaseNudge(runtime, request)
	runtime.target = target && { connectionId: target.connectionId, id: target.id }
	runtime.state = undefined
	runtime.error = undefined
	void refreshNudgeMount(runtime, request)
}

// Fetches the state of the followed mount. A response is dropped when the target changed or another
// fetch started meanwhile.
export async function refreshNudgeMount(runtime: NudgeRuntime, request: typeof fetch = fetch) {
	const target = runtime.target
	const current = ++stateGeneration
	if (!target) return

	try {
		const response = await request(mountPath(target))
		const state = response.ok ? ((await response.json()) as MountState) : undefined
		if (current === stateGeneration && sameTarget(runtime.target, target)) runtime.state = state
	} catch {
		// The server is unreachable; the next socket open refreshes the state.
	}
}

// Replaces the running sessions with the server's list, which may have changed while the socket was
// closed. A press of this tab that the server no longer runs has ended, so it is forgotten; one still
// waiting for its start response is kept, since that response decides it.
export async function refreshNudges(runtime: NudgeRuntime, request: typeof fetch = fetch) {
	const current = ++sessionsGeneration

	try {
		const response = await request('/api/mounts/nudges')
		if (!response.ok || current !== sessionsGeneration) return
		const running = (await response.json()) as MountNudgeSession[]
		if (current !== sessionsGeneration) return

		for (const [key, session] of Object.entries(runtime.sessions)) if (nudgeRunning(session)) delete runtime.sessions[key]
		for (const session of running) runtime.sessions[nudgeKey(session.connectionId, session.deviceId)] = session

		const press = runtime.press
		if (press && press.phase !== 'starting' && !running.some((session) => session.token === press.token)) forgetPress(runtime, press.token)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies a server event concerning the followed mount or any nudge session. A session event of another
// press than this tab's only updates the session list; an event of this tab's press follows its stage,
// and its end forgets the press, keeping why it ended when that was abnormal.
export function handleNudgeEvent(runtime: NudgeRuntime, event: ServerEvent) {
	const target = runtime.target

	switch (event.type) {
		case 'mount:nudge': {
			const { session } = event
			const key = nudgeKey(session.connectionId, session.deviceId)
			const known = runtime.sessions[key]

			// An event of an older session of the mount never replaces a newer one.
			if (!known || known.token === session.token || session.startedAt >= known.startedAt) runtime.sessions[key] = session

			const press = runtime.press
			if (press?.token !== session.token) return

			if (session.phase === 'moving' || session.phase === 'stopping') {
				press.phase = session.phase
			} else if (!nudgeRunning(session)) {
				forgetPress(runtime, session.token)
				runtime.error = nudgeEndProblem(session)
			}

			return
		}
		case 'mount:updated':
			if (target && sameTarget({ connectionId: event.state.connectionId, id: event.state.id }, target)) runtime.state = event.state
			return
		case 'device:removed':
			if (target && sameTarget({ connectionId: event.connectionId, id: event.id }, target)) runtime.state = undefined
			return
		case 'connection:close':
			if (target?.connectionId === event.id) runtime.state = undefined
	}
}

// Starts a press of the followed mount in a direction. Ignored while this tab already holds a press, so
// a second button cannot combine with the first. Heartbeats renew it at the server's interval from its
// start response on; a press released before that response was already stopped by its token.
export async function pressNudge(runtime: NudgeRuntime, direction: MountNudgeDirection, request: typeof fetch = fetch) {
	const target = runtime.target
	if (!target || runtime.press) return

	const token = crypto.randomUUID()
	runtime.press = { token, target: { ...target }, direction, phase: 'starting' }
	runtime.error = undefined

	try {
		const response = await request(`${mountPath(target)}/nudge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, direction }) })

		if (!response.ok) {
			const message = await responseError(response)
			if (runtime.press?.token === token) runtime.error = message
			forgetPress(runtime, token)
			return
		}

		const { session, heartbeatInterval } = (await response.json()) as MountNudgeStartResponse
		const press = runtime.press

		// Released while starting: its stop is already on the way and owns forgetting it.
		if (press?.token === token && press.phase === 'stopping') return

		if (press?.token !== token || !nudgeRunning(session)) {
			forgetPress(runtime, token)
			return
		}

		if (session.phase === 'moving') press.phase = 'moving'
		heartbeats.set(
			token,
			setInterval(() => void heartbeat(runtime, token, request), heartbeatInterval),
		)
	} catch {
		if (runtime.press?.token === token) runtime.error = 'The server cannot be reached'
		forgetPress(runtime, token)
	}
}

// Renews a press; a press the server no longer runs is forgotten. A failed request is not an end: the
// server stops the press by itself if no later heartbeat arrives in time.
async function heartbeat(runtime: NudgeRuntime, token: string, request: typeof fetch) {
	try {
		const response = await request(`${pressPath(token)}/heartbeat`, { method: 'POST' })
		if (response.status === 404) forgetPress(runtime, token)
	} catch {
		// The server is unreachable; its lease ends the press if this lasts.
	}
}

// Releases the press of this tab, if any, and resolves once the server answered. The stop is sent even
// while the start is still in flight, so the server records the press as ended before it can move, and
// it is sent with keepalive so it still leaves a page that is being closed.
export async function releaseNudge(runtime: NudgeRuntime, request: typeof fetch = fetch) {
	const press = runtime.press
	if (!press || press.phase === 'stopping') return
	press.phase = 'stopping'
	await stopPress(runtime, press.token, request)
}

// Stops the press of this tab and any nudge running on the followed mount, whichever tab holds it. It
// stops only nudges: a slew or any other operation of the mount is left alone.
export async function stopNudges(runtime: NudgeRuntime, request: typeof fetch = fetch) {
	const press = runtime.press
	const target = runtime.target
	const running = target && runtime.sessions[nudgeKey(target.connectionId, target.id)]
	const tokens = new Set<string>()

	if (press) {
		press.phase = 'stopping'
		tokens.add(press.token)
	}

	if (nudgeRunning(running)) tokens.add(running!.token)

	await Promise.all(Array.from(tokens, (token) => stopPress(runtime, token, request)))
}

// Sends the stop of a press and forgets it once answered, keeping the server's reason when the mount
// could not be observed to stop.
async function stopPress(runtime: NudgeRuntime, token: string, request: typeof fetch) {
	stopHeartbeat(token)

	try {
		const response = await request(`${pressPath(token)}/stop`, { method: 'POST', keepalive: true })
		if (!response.ok) runtime.error = await responseError(response)
	} catch {
		runtime.error = 'The server cannot be reached; the mount stops by itself once its lease expires'
	}

	forgetPress(runtime, token)
}

// Selects the speed preset of the followed mount. The selection shown follows the mount's own report,
// so it changes only once the driver applied it.
export async function setNudgeSlewRate(runtime: NudgeRuntime, name: string, request: typeof fetch = fetch) {
	const target = runtime.target
	if (!target || runtime.sending || runtime.press) return

	runtime.sending = true
	runtime.error = undefined

	try {
		const response = await request(`${mountPath(target)}/slew-rate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
		if (!response.ok && sameTarget(runtime.target, target)) runtime.error = await responseError(response)
	} catch {
		if (sameTarget(runtime.target, target)) runtime.error = 'The server cannot be reached'
	} finally {
		runtime.sending = false
	}
}
