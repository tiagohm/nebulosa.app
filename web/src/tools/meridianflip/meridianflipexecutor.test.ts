import { describe, expect, test } from 'bun:test'
import type { MeridianFlipArm, MeridianFlipExecution, MeridianFlipExecutorEvent } from 'api'
import { proxy } from 'valtio'
import { DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY } from '../../profile/schema'
import { monitorKey } from './meridianflip'
import { applyMeridianFlipExecutorSnapshot, cancelMeridianFlip, disarmMeridianFlip, executeMeridianFlip, handleMeridianFlipExecutorEvent, latestExecution, meridianFlipExecutionHeadline, type MeridianFlipExecutorState, resumePausedCapture } from './meridianflipexecutor'

function newState() {
	return proxy<MeridianFlipExecutorState>({ revision: 0, executions: {}, arms: {}, pending: {}, errors: {} })
}

function execution(sessionId: string, startedAt: number, patch: Partial<MeridianFlipExecution> = {}): MeridianFlipExecution {
	return {
		sessionId,
		connectionId: 'c',
		deviceId: 'd',
		mountName: 'GEM',
		trigger: 'manual',
		state: 'running',
		steps: [],
		setup: {},
		policy: DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY,
		target: { rightAscension: 1, declination: 0.5, source: 'derivedFromMount' },
		strategy: 'forcedGoto',
		verificationMode: 'driverPierSide',
		contextId: 'context',
		passage: 'passage',
		warnings: [],
		startedAt,
		revision: 1,
		...patch,
	}
}

function arm(): MeridianFlipArm {
	return { armId: 'arm', connectionId: 'c', deviceId: 'd', mountName: 'GEM', trigger: 'automatic', armedAt: 1, decision: { decision: 'wait', code: 'notDue', reason: 'Waiting' }, policy: DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY }
}

function updated(epoch: string, revision: number, value: MeridianFlipExecution): MeridianFlipExecutorEvent {
	return { type: 'meridianFlipExecutor:updated', epoch, revision, execution: value }
}

function armed(epoch: string, revision: number, value?: MeridianFlipArm): MeridianFlipExecutorEvent {
	return { type: 'meridianFlipExecutor:armed', epoch, revision, key: { connectionId: 'c', deviceId: 'd' }, arm: value }
}

// A fetch that answers every request with response, recording them.
function recording(response: () => Response) {
	const requests: { readonly url: string; readonly body?: unknown }[] = []
	const request = (url: string, init?: RequestInit) => {
		requests.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined })
		return Promise.resolve(response())
	}
	return { requests, request: request as typeof fetch }
}

describe('mirror', () => {
	test('applies executions and arms in revision order, and starts over for another server process', () => {
		const state = newState()
		handleMeridianFlipExecutorEvent(state, updated('e', 2, execution('x', 10)))
		handleMeridianFlipExecutorEvent(state, updated('e', 1, execution('stale', 5)))
		handleMeridianFlipExecutorEvent(state, armed('e', 3, arm()))
		expect(Object.keys(state.executions)).toEqual(['x'])
		expect(state.arms[monitorKey('c', 'd')]).toMatchObject({ armId: 'arm' })

		handleMeridianFlipExecutorEvent(state, armed('e', 4))
		expect(state.arms).toEqual({})

		handleMeridianFlipExecutorEvent(state, updated('other', 1, execution('y', 20)))
		expect(Object.keys(state.executions)).toEqual(['y'])
		expect(state.epoch).toBe('other')
	})

	test('a snapshot older than the events applied is dropped', () => {
		const state = newState()
		handleMeridianFlipExecutorEvent(state, updated('e', 5, execution('x', 10, { state: 'completed' })))
		applyMeridianFlipExecutorSnapshot(state, { epoch: 'e', revision: 4, executions: [execution('x', 10)], arms: [] })
		expect(state.executions.x.state).toBe('completed')
		applyMeridianFlipExecutorSnapshot(state, { epoch: 'e', revision: 6, executions: [], arms: [arm()] })
		expect(state.executions).toEqual({})
		expect(Object.values(state.arms)).toHaveLength(1)
	})

	test('the latest execution of a mount is the one started last', () => {
		const state = newState()
		handleMeridianFlipExecutorEvent(state, updated('e', 1, execution('old', 10)))
		handleMeridianFlipExecutorEvent(state, updated('e', 2, execution('new', 20)))
		handleMeridianFlipExecutorEvent(state, updated('e', 3, execution('other', 30, { deviceId: 'other' })))
		expect(latestExecution(state, 'c', 'd')?.sessionId).toBe('new')
		expect(latestExecution(state, 'c', 'none')).toBeUndefined()
	})

	test('headlines tell a running step from the outcomes', () => {
		expect(meridianFlipExecutionHeadline(undefined)).toEqual(['Idle', 'muted'])
		expect(meridianFlipExecutionHeadline({ state: 'running', step: 'flipping' })).toEqual(['Flipping', 'active'])
		expect(meridianFlipExecutionHeadline({ state: 'completed' })).toEqual(['Flipped', 'success'])
		expect(meridianFlipExecutionHeadline({ state: 'blocked' })).toEqual(['Needs attention', 'danger'])
	})
})

describe('requests', () => {
	test('a flip request carries a fresh token and the mode, and a refusal is kept', async () => {
		const state = newState()
		const ok = recording(() => new Response(null, { status: 202 }))
		const body = { setup: {}, policy: DEFAULT_MERIDIAN_FLIP_EXECUTOR_POLICY }

		expect(await executeMeridianFlip(state, 'c', 'd', 'now', body, ok.request)).toBeTrue()
		expect(await executeMeridianFlip(state, 'c', 'd', 'now', body, ok.request)).toBeTrue()
		expect(ok.requests.map((request) => request.url)).toEqual(['/api/connections/c/mounts/d/meridian-flip/execute', '/api/connections/c/mounts/d/meridian-flip/execute'])
		const [first, second] = ok.requests.map((request) => request.body as { readonly token: string; readonly mode: string })
		expect(first.mode).toBe('now')
		expect(first.token).not.toBe(second.token)

		const refused = recording(() => Response.json({ error: 'The flip window has not opened', code: 'notDue' }, { status: 409 }))
		expect(await executeMeridianFlip(state, 'c', 'd', 'now', body, refused.request)).toBeFalse()
		expect(state.errors[monitorKey('c', 'd')]).toBe('The flip window has not opened')
		expect(state.pending).toEqual({})
	})

	test('disarm, cancel, and resume address exactly their mount, execution, and capture', async () => {
		const state = newState()
		const ok = recording(() => new Response(null, { status: 204 }))
		const flip = execution('x', 1, { setup: { camera: { connectionId: 'c', deviceId: 'cam' } }, captureSessionId: 'capture' })

		await disarmMeridianFlip(state, 'c', 'd', ok.request)
		await cancelMeridianFlip(state, flip, ok.request)
		await resumePausedCapture(state, flip, ok.request)
		expect(await resumePausedCapture(state, execution('y', 1), ok.request)).toBeFalse()

		expect(ok.requests).toEqual([
			{ url: '/api/connections/c/mounts/d/meridian-flip/disarm', body: undefined },
			{ url: '/api/meridian-flip/executions/x/cancel', body: undefined },
			{ url: '/api/connections/c/cameras/cam/capture/resume', body: { sessionId: 'capture' } },
		])
	})
})
