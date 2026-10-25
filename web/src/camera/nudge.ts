import type { MountNudgeDirection, MountNudgeSession, MountState, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { deviceUrl, jsonInit, responseError } from '../http'
import { followPress, type Press, pressRunning, reconcilePress, releasePress, startPress, stopPress } from '../press'

// Mount Nudge runtime of the tab, over the press handling shared with the dome (press.ts): the mount the active
// profile assigns to the MOUNT role, whose real state is the one the control runtime mirrors, the nudge sessions the
// server reports on it, and the one press this tab holds. The server owns every session and stops it when its lease is no longer renewed, so this store never assumes a motion from
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
export interface NudgePress extends Press {
	// Mount the press moves; it never follows a later change of the role's device.
	readonly target: NudgeTarget
	// Direction moved in.
	readonly direction: MountNudgeDirection
}

// Mount Nudge runtime state.
export interface NudgeRuntime {
	// Mount followed; absent when the profile has no MOUNT on an open connection.
	target?: NudgeTarget
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

// Message kept when a stop cannot reach the server.
const UNREACHABLE = 'The server cannot be reached; the mount stops by itself once its lease expires'

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

// Path of the API resource of a press.
export function pressPath(token: string) {
	return `/api/mounts/nudges/${encodeURIComponent(token)}`
}

// Returns whether a session is still running.
export function nudgeRunning(session: Pick<MountNudgeSession, 'phase'> | undefined): boolean {
	return pressRunning(session)
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

// Follows another mount, or none. A press held on the previous mount is released and everything known about the
// previous mount is dropped. The same mount changes nothing.
export function watchNudgeMount(runtime: NudgeRuntime, target: NudgeTarget | undefined, request: typeof fetch = fetch) {
	if (sameTarget(runtime.target, target)) return

	void releaseNudge(runtime, request)
	runtime.target = target && { connectionId: target.connectionId, id: target.id }
	runtime.error = undefined
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

		reconcilePress(runtime, running)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}

// Applies a nudge session event; any other event is ignored. A session event of another press than this tab's only
// updates the session list; an event of this tab's press follows its stage, and its end forgets the press, keeping why
// it ended when that was abnormal.
export function handleNudgeEvent(runtime: NudgeRuntime, event: ServerEvent) {
	if (event.type !== 'mount:nudge') return

	const { session } = event
	const key = nudgeKey(session.connectionId, session.deviceId)
	const known = runtime.sessions[key]

	// An event of an older session of the mount never replaces a newer one.
	if (!known || known.token === session.token || session.startedAt >= known.startedAt) runtime.sessions[key] = session

	followPress(runtime, session, nudgeEndProblem)
}

// Starts a press of the followed mount in a direction. Ignored while this tab already holds a press, so
// a second button cannot combine with the first. Heartbeats renew it at the server's interval from its
// start response on; a press released before that response was already stopped by its token.
export async function pressNudge(runtime: NudgeRuntime, direction: MountNudgeDirection, request: typeof fetch = fetch) {
	const target = runtime.target
	if (!target || runtime.press) return

	const token = nanoid()
	await startPress(runtime, { token, target: { ...target }, direction, phase: 'starting' }, deviceUrl(target.connectionId, 'mount', target.id, 'nudge'), { direction }, pressPath, request)
}

// Releases the press of this tab, if any, and resolves once the server answered. The stop is sent even
// while the start is still in flight, so the server records the press as ended before it can move, and
// it is sent with keepalive so it still leaves a page that is being closed.
export async function releaseNudge(runtime: NudgeRuntime, request: typeof fetch = fetch) {
	await releasePress(runtime, pressPath, UNREACHABLE, request)
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

	await Promise.all(Array.from(tokens, (token) => stopPress(runtime, token, pressPath, UNREACHABLE, request)))
}

// Selects the speed preset of the followed mount. The selection shown follows the mount's own report,
// so it changes only once the driver applied it.
export async function setNudgeSlewRate(runtime: NudgeRuntime, name: string, request: typeof fetch = fetch) {
	const target = runtime.target
	if (!target || runtime.sending || runtime.press) return

	runtime.sending = true
	runtime.error = undefined

	try {
		const response = await request(deviceUrl(target.connectionId, 'mount', target.id, 'slew-rate'), jsonInit('POST', { name }))
		if (!response.ok && sameTarget(runtime.target, target)) runtime.error = await responseError(response)
	} catch {
		if (sameTarget(runtime.target, target)) runtime.error = 'The server cannot be reached'
	} finally {
		runtime.sending = false
	}
}
