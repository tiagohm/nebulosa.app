import type { DomeMotionSession, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { deviceUrl } from '../http'
import { followPress, type Press, type PressHolder, pressRunning, reconcilePress, releasePress, startPress } from '../press'

// Manual rotation of domes from this tab: the rotation sessions the server reports, started by any tab,
// and the one press this tab holds, through the lease handling shared with the mount nudge (press.ts).
// A press starts only on a pointer down on a direction button and is released on pointer up or whenever
// control is lost; it is never restored after a reload or a socket reopen.

// Direction of a manual rotation.
export type DomeDirection = DomeMotionSession['direction']

// Press of a dome held by this tab.
export interface DomePress extends Press {
	// Id of the open connection that provides the dome.
	readonly connectionId: string
	// Exact device id of the dome; the press never follows a change of the device shown.
	readonly deviceId: string
	// Direction rotated in.
	readonly direction: DomeDirection
}

// Manual rotation runtime of the tab.
export interface DomeMotionRuntime extends PressHolder<DomePress> {
	// Latest session of each dome, by connection id and device id, running or ended, started by any tab.
	sessions: Record<string, DomeMotionSession>
}

// Manual rotation runtime of the tab.
export const domeMotionRuntime = proxy<DomeMotionRuntime>({ sessions: {} })

// Message kept when a stop cannot reach the server.
const UNREACHABLE = 'The server cannot be reached; the dome stops by itself once its lease expires'

// Counter of session fetches; a response is applied only if no later fetch started.
let generation = 0

// Returns the key of a dome: its connection id and exact device id.
export function domeKey(connectionId: string, deviceId: string) {
	return `${connectionId}:${deviceId}`
}

// Path of the API resource of a manual rotation.
function motionPath(token: string) {
	return `/api/domes/motions/${encodeURIComponent(token)}`
}

// Explains how a rotation that ended abnormally ended, or undefined when it was released normally.
export function domeMotionEndProblem(session: DomeMotionSession): string | undefined {
	const stop = session.stopConfirmed === false ? ' The dome was not observed to stop.' : ''
	if (session.phase === 'stopped') return stop ? stop.trim() : undefined
	if (session.phase !== 'failed') return undefined
	if (session.reason === 'timeout') return `Stopped: control of the rotation was lost.${stop}`
	if (session.reason === 'disconnected' || session.reason === 'removed') return `Stopped: the dome disconnected.${stop}`
	if (session.reason === 'aborted') return `The rotation was aborted.${stop}`
	return `${session.error ?? 'The rotation failed.'}${stop}`
}

// Starts a press of a dome in a direction; ignored while this tab already holds a press.
export async function pressDomeMotion(runtime: DomeMotionRuntime, connectionId: string, deviceId: string, direction: DomeDirection, request: typeof fetch = fetch) {
	const url = deviceUrl(connectionId, 'dome', deviceId, 'motion')
	await startPress(runtime, { token: nanoid(), connectionId, deviceId, direction, phase: 'starting' }, url, { direction }, motionPath, request)
}

// Releases the press of this tab, if any, and resolves once the server answered.
export async function releaseDomeMotion(runtime: DomeMotionRuntime, request: typeof fetch = fetch) {
	await releasePress(runtime, motionPath, UNREACHABLE, request)
}

// Applies a rotation session event: the session list, and the stage or the end of this tab's press.
export function handleDomeMotionEvent(runtime: DomeMotionRuntime, event: ServerEvent) {
	if (event.type !== 'dome:motion') return

	const { session } = event
	const key = domeKey(session.connectionId, session.deviceId)
	const known = runtime.sessions[key]

	// An event of an older session of the dome never replaces a newer one.
	if (!known || known.token === session.token || session.startedAt >= known.startedAt) runtime.sessions[key] = session
	followPress(runtime, session, domeMotionEndProblem)
}

// Replaces the running sessions with the server's list, which may have changed while the socket was
// closed, and forgets a press of this tab the server no longer runs.
export async function refreshDomeMotions(runtime: DomeMotionRuntime, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/domes/motions')
		if (!response.ok || current !== generation) return
		const running = (await response.json()) as DomeMotionSession[]
		if (current !== generation) return

		for (const [key, session] of Object.entries(runtime.sessions)) if (pressRunning(session)) delete runtime.sessions[key]
		for (const session of running) runtime.sessions[domeKey(session.connectionId, session.deviceId)] = session
		reconcilePress(runtime, running)
	} catch {
		// The server is unreachable; the next socket open refreshes the sessions.
	}
}
