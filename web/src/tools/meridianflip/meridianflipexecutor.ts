import type { ExecutorEligibility, FlipVerification, FlipVerificationMode, MeridianFlipArm, MeridianFlipExecuteRequest, MeridianFlipExecution, MeridianFlipExecutionRequest, MeridianFlipExecutionState, MeridianFlipExecutorSnapshot, MeridianFlipStep, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../../http'
import type { StatusTone } from '../../ui/StatusBadge'
import { monitorKey } from './meridianflip'

// Mirror of the Meridian Flip Executor of the server: its executions, its arms, and the requests this tab sends to
// execute, arm, disarm, and cancel them. The executions are the server's: this mirror is fed by
// GET /api/meridian-flip/executions and the meridianFlipExecutor:updated and meridianFlipExecutor:armed events, and no tab,
// profile, or route change starts, arms, or cancels one. Revisions order the snapshot and the events within one server
// process (epoch). Requests carry a token generated here, so a repeated request never flips twice.

// Executions and arms known to the tab and the requests in flight.
export interface MeridianFlipExecutorState {
	// Server process they belong to; absent before the first snapshot or event.
	epoch?: string
	// Latest revision applied from the server.
	revision: number
	// Executions by id, running and recent.
	executions: Record<string, MeridianFlipExecution>
	// Arms by monitorKey of their mount.
	arms: Record<string, MeridianFlipArm>
	// Request in flight, by monitorKey of the mount.
	pending: Record<string, 'execute' | 'arm' | 'disarm' | 'cancel' | 'resume'>
	// Why the last request of a mount failed, by monitorKey.
	errors: Record<string, string>
}

// Executor of the server, shared by every view of the tab.
export const meridianFlipExecutorState = proxy<MeridianFlipExecutorState>({ revision: 0, executions: {}, arms: {}, pending: {}, errors: {} })

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Replaces the executions and arms with a snapshot, unless it is older than the events already applied.
export function applyMeridianFlipExecutorSnapshot(state: MeridianFlipExecutorState, snapshot: MeridianFlipExecutorSnapshot) {
	if (snapshot.epoch === state.epoch && snapshot.revision < state.revision) return
	state.epoch = snapshot.epoch
	state.revision = snapshot.revision
	state.executions = Object.fromEntries(snapshot.executions.map((execution) => [execution.sessionId, execution]))
	state.arms = Object.fromEntries(snapshot.arms.map((arm) => [monitorKey(arm.connectionId, arm.deviceId), arm]))
}

// Fetches the executions again; called on every socket (re)open.
export async function refreshMeridianFlipExecutor(state: MeridianFlipExecutorState, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/meridian-flip/executions')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as MeridianFlipExecutorSnapshot
		if (current === generation) applyMeridianFlipExecutorSnapshot(state, snapshot)
	} catch {
		// The server is unreachable; the next socket open refreshes the executions.
	}
}

// Applies an Executor event; any other event is ignored. An event of another server process starts over from it, and one
// already contained in what the tab knows is dropped.
export function handleMeridianFlipExecutorEvent(state: MeridianFlipExecutorState, event: ServerEvent) {
	if (event.type !== 'meridianFlipExecutor:updated' && event.type !== 'meridianFlipExecutor:armed') return

	if (event.epoch !== state.epoch) {
		state.epoch = event.epoch
		state.executions = {}
		state.arms = {}
	} else if (event.revision <= state.revision) {
		return
	}

	state.revision = event.revision

	if (event.type === 'meridianFlipExecutor:updated') {
		state.executions[event.execution.sessionId] = event.execution
		return
	}

	const key = monitorKey(event.key.connectionId, event.key.deviceId)
	if (event.arm) state.arms[key] = event.arm
	else delete state.arms[key]
}

// Latest execution of a mount, running or ended, or undefined.
export function latestExecution(state: Pick<MeridianFlipExecutorState, 'executions'>, connectionId: string, deviceId: string): MeridianFlipExecution | undefined {
	let latest: MeridianFlipExecution | undefined
	for (const execution of Object.values(state.executions)) if (execution.connectionId === connectionId && execution.deviceId === deviceId && (!latest || execution.startedAt > latest.startedAt)) latest = execution
	return latest
}

// Asks the server what would be decided for a request now; starts nothing. Returns the decision, or why it could not be
// answered.
export async function meridianFlipEligibility(connectionId: string, deviceId: string, body: Omit<MeridianFlipExecutionRequest, 'token'> & { readonly trigger: 'manual' | 'scheduled' | 'automatic' }, request: typeof fetch = fetch): Promise<{ readonly decision: ExecutorEligibility } | { readonly error: string }> {
	try {
		const response = await request(`${executorUrl(connectionId, deviceId)}/eligibility`, jsonInit('POST', { ...body, token: nanoid() }))
		if (!response.ok) return { error: await responseError(response, 'The flip could not be assessed.') }
		return { decision: (await response.json()) as ExecutorEligibility }
	} catch {
		return { error: 'The server is unreachable.' }
	}
}

// Flips a mount now, or once its window opens. Returns whether the server accepted it; a refusal is kept in errors.
export function executeMeridianFlip(state: MeridianFlipExecutorState, connectionId: string, deviceId: string, mode: MeridianFlipExecuteRequest['mode'], body: Omit<MeridianFlipExecutionRequest, 'token'>, request: typeof fetch = fetch) {
	return send(state, connectionId, deviceId, 'execute', `${executorUrl(connectionId, deviceId)}/execute`, { ...body, mode, token: nanoid() }, 'The flip could not be started.', request)
}

// Arms the automatic flip of a mount. Returns whether the server accepted it.
export function armMeridianFlip(state: MeridianFlipExecutorState, connectionId: string, deviceId: string, body: Omit<MeridianFlipExecutionRequest, 'token'>, request: typeof fetch = fetch) {
	return send(state, connectionId, deviceId, 'arm', `${executorUrl(connectionId, deviceId)}/arm`, { ...body, token: nanoid() }, 'The flip could not be armed.', request)
}

// Removes the arm of a mount; commands nothing. Returns whether the request succeeded.
export function disarmMeridianFlip(state: MeridianFlipExecutorState, connectionId: string, deviceId: string, request: typeof fetch = fetch) {
	return send(state, connectionId, deviceId, 'disarm', `${executorUrl(connectionId, deviceId)}/disarm`, undefined, 'The flip could not be disarmed.', request)
}

// Cancels exactly one execution of a mount. Returns whether the request succeeded.
export function cancelMeridianFlip(state: MeridianFlipExecutorState, execution: Pick<MeridianFlipExecution, 'sessionId' | 'connectionId' | 'deviceId'>, request: typeof fetch = fetch) {
	return send(state, execution.connectionId, execution.deviceId, 'cancel', `/api/meridian-flip/executions/${encodeURIComponent(execution.sessionId)}/cancel`, undefined, 'The flip could not be cancelled.', request)
}

// Resumes the capture an execution of a mount left paused, through the capture's own resume route. Returns whether it went on.
export function resumePausedCapture(state: MeridianFlipExecutorState, execution: Pick<MeridianFlipExecution, 'connectionId' | 'deviceId' | 'setup' | 'captureSessionId'>, request: typeof fetch = fetch) {
	const camera = execution.setup.camera
	if (!camera || !execution.captureSessionId) return Promise.resolve(false)
	const url = `/api/connections/${encodeURIComponent(camera.connectionId)}/cameras/${encodeURIComponent(camera.deviceId)}/capture/resume`
	return send(state, execution.connectionId, execution.deviceId, 'resume', url, { sessionId: execution.captureSessionId }, 'The capture could not be resumed.', request)
}

// Sends one request of a mount, one at a time, keeping its refusal in errors.
async function send(state: MeridianFlipExecutorState, connectionId: string, deviceId: string, action: MeridianFlipExecutorState['pending'][string], url: string, body: unknown, fallback: string, request: typeof fetch) {
	const key = monitorKey(connectionId, deviceId)
	if (state.pending[key]) return false

	state.pending[key] = action
	delete state.errors[key]

	try {
		const response = await request(url, body === undefined ? { method: 'POST' } : jsonInit('POST', body))
		if (response.ok) return true
		state.errors[key] = await responseError(response, fallback)
		return false
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// Base URL of the routes of the Executor of a mount.
function executorUrl(connectionId: string, deviceId: string) {
	return `/api/connections/${encodeURIComponent(connectionId)}/mounts/${encodeURIComponent(deviceId)}/meridian-flip`
}

// Text of each step of an execution.
export const MERIDIAN_FLIP_STEP_LABELS: Readonly<Record<MeridianFlipStep, string>> = {
	preflight: 'Preflight',
	waitingForBoundary: 'Waiting for the frame to finish',
	suspendingGuiding: 'Suspending guiding',
	acquiringResources: 'Reserving the equipment',
	referenceSolve: 'Solving before the flip',
	flipping: 'Flipping',
	verifying: 'Verifying the flip',
	settling: 'Mount settling',
	measuring: 'Solving after the flip',
	recentering: 'Recentering',
	autofocusing: 'Auto Focus',
	restoringGuiding: 'Restoring guiding',
	resumingCapture: 'Resuming the capture',
}

// Text of each verification of a flip.
export const FLIP_VERIFICATION_LABELS: Readonly<Record<FlipVerification, string>> = { verified: 'Verified by the pier side', inferred: 'Inferred from plate solutions', unverified: 'Not verified' }

// Text of each verification mode.
export const FLIP_VERIFICATION_MODE_LABELS: Readonly<Record<FlipVerificationMode, string>> = { driverPierSide: 'Pier side reported by the driver', inference: 'Plate solutions before and after', none: 'None: the flip cannot be verified' }

// Headline of an execution: its state in words and the tone it is shown with.
export function meridianFlipExecutionHeadline(execution: Pick<MeridianFlipExecution, 'state' | 'step'> | undefined): readonly [string, StatusTone] {
	if (!execution) return ['Idle', 'muted']
	const states: Readonly<Record<MeridianFlipExecutionState, readonly [string, StatusTone]>> = {
		running: [execution.step ? MERIDIAN_FLIP_STEP_LABELS[execution.step] : 'Running', 'active'],
		completed: ['Flipped', 'success'],
		failed: ['Not completed', 'danger'],
		blocked: ['Needs attention', 'danger'],
		cancelled: ['Cancelled', 'warning'],
	}
	return states[execution.state]
}
