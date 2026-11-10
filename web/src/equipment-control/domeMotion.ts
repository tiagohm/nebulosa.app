import type { DomeMotionSession, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { type ApiFetch, browserFetch, deviceUrl } from '../http'
import { followPress, type Press, refreshPressSessions, releasePress, type SessionHolder, startPress } from '../press'
import { SnapshotRefreshes } from '../refresh'

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
export type DomeMotionRuntime = SessionHolder<DomePress, DomeMotionSession>

// Manual rotation runtime of the tab.
export const domeMotionRuntime = proxy<DomeMotionRuntime>({ sessions: {} })

// Message kept when a stop cannot reach the server.
const UNREACHABLE = 'The server cannot be reached; the dome stops by itself once its lease expires'

// Refreshes of the running sessions, ordered against the session events applied meanwhile, by dome key.
const refreshes = new SnapshotRefreshes()

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
export async function pressDomeMotion(runtime: DomeMotionRuntime, connectionId: string, deviceId: string, direction: DomeDirection, request: ApiFetch = browserFetch) {
	const url = deviceUrl(connectionId, 'dome', deviceId, 'motion')
	await startPress(runtime, { token: nanoid(), connectionId, deviceId, direction, phase: 'starting' }, url, { direction }, motionPath, request)
}

// Releases the press of this tab, if any, and resolves once the server answered.
export async function releaseDomeMotion(runtime: DomeMotionRuntime, request: ApiFetch = browserFetch) {
	await releasePress(runtime, motionPath, UNREACHABLE, request)
}

// Applies a rotation session event: the session list, and the stage or the end of this tab's press.
export function handleDomeMotionEvent(runtime: DomeMotionRuntime, event: ServerEvent) {
	if (event.type !== 'dome:motion') return

	const { session } = event
	const key = domeKey(session.connectionId, session.deviceId)
	const known = runtime.sessions[key]

	// An event of an older session of the dome never replaces a newer one.
	if (!known || known.token === session.token || session.startedAt >= known.startedAt) {
		runtime.sessions[key] = session
		refreshes.updated(key)
	}

	followPress(runtime, session, domeMotionEndProblem)
}

// Replaces the running sessions with the server's list, which may have changed while the socket was closed, leaving
// what an event changed meanwhile, and forgets a press of this tab that no longer runs (refreshPressSessions).
export function refreshDomeMotions(runtime: DomeMotionRuntime, request: ApiFetch = browserFetch) {
	return refreshPressSessions(runtime, '/api/domes/motions', ({ connectionId, deviceId }: DomeMotionSession) => domeKey(connectionId, deviceId), refreshes, request)
}
