import { describe, expect, test } from 'bun:test'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter } from 'src/api/resource'
import type { ResourceReservation } from 'src/api/resource'
import { compile } from 'src/api/sequencer.compiler'
import { runSequencerPlan } from 'src/api/sequencer.executor'
import type { SequencerExecutorHost, SequencerSafePointObservation } from 'src/api/sequencer.executor'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import { sequencerSlotAttempt } from 'src/api/sequencer.identity'
import type { AnySequencerActionHandler, SequencerActionContext, SequencerActionResult, SequencerFrameSlot } from 'src/api/sequencer.registry'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { Sequencer } from '#/sequencer'
import type { SequencerPlan } from '#/sequencer.plan'
import type { SequencerArtifact, SequencerArtifactDraft, SequencerCheckpoint, SequencerDesiredState, SequencerEventDraft } from '#/sequencer.state'
import { camera, canonical, frame, retry, services } from './sequencer.fixture'

interface Executed {
	readonly nodeId: string
	readonly attempt: number
	readonly slot?: SequencerFrameSlot
}

function definition(overrides?: Partial<Sequencer>): Sequencer {
	const base = canonical()

	return {
		...base,
		guiding: { ...base.guiding, enabled: false },
		dither: { ...base.dither, enabled: false },
		autofocus: { ...base.autofocus, enabled: false },
		meridianFlip: { ...base.meridianFlip, enabled: false },
		cooling: { ...base.cooling, enabled: false },
		capture: { ...base.capture, order: 'sequential', repeat: 1, delay: 0, settle: 0, frames: [frame('lum', { count: 2, camera: camera() })], retry: retry() },
		startup: { ...base.startup, actions: [] },
		shutdown: { ...base.shutdown, actions: [] },
		...overrides,
	}
}

function planOf(overrides?: Partial<Sequencer>): SequencerPlan {
	const compilation = compile(definition(overrides))

	expect(compilation.ok).toBeTrue()

	return compilation.ok ? compilation.plan : ({} as SequencerPlan)
}

interface Harness {
	readonly host: SequencerExecutorHost
	readonly executed: Executed[]
	readonly events: SequencerEventDraft[]
	readonly artifacts: () => readonly SequencerArtifact[]
	readonly controller: AbortController
	readonly holds: string[]
	desired: SequencerDesiredState
	observation: SequencerSafePointObservation
	onHold?: (nodeId: string) => SequencerDesiredState
}

function guidingServices(loop: () => OperationResult<unknown>): SequencerGuidingServices {
	return {
		guiderCommander: {
			running: () => true,
			looping: () => true,
			loop: () => Promise.resolve(loop()),
			startGuiding: () => Promise.resolve(successfulOperationResult(undefined)),
			calibrate: () => Promise.resolve(successfulOperationResult(undefined)),
		},
	} as unknown as SequencerGuidingServices
}

function harness(plan: SequencerPlan, execute?: (context: SequencerActionContext, configuration: unknown) => Promise<SequencerActionResult<unknown>>, guiding?: SequencerGuidingServices): Harness {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const reserved = arbiter.reserve({ id: 'session-1', kind: 'sequencer' }, [])
	const scope = coordinator.reservedScope((reserved as { readonly reservation: ResourceReservation }).reservation)
	const executed: Executed[] = []
	const events: SequencerEventDraft[] = []
	const durable = new Map<string, SequencerArtifact>()
	const staged: SequencerArtifact[] = []
	const controller = new AbortController()
	let sequence = 0

	const store = (artifact: SequencerArtifact) => durable.set(`${artifact.logicalSlotId}#${artifact.attempt}`, artifact)
	const artifacts = () => [...durable.values()]

	const handler = (type: string): AnySequencerActionHandler => ({
		type,
		version: 1,
		validate: (configuration) => ({ ok: true, configuration }),
		resources: () => [],
		execute: async (context, configuration) => {
			executed.push({ nodeId: context.nodeId, attempt: context.attempt, slot: context.frame })

			if (context.frame === undefined) return execute === undefined ? { type: 'completed', value: undefined } : await execute(context, configuration)

			context.artifact({ logicalSlotId: context.frame.logicalSlotId, attempt: context.attempt, status: 'pending' })

			const result = execute === undefined ? ({ type: 'completed', value: undefined } as SequencerActionResult<unknown>) : await execute(context, configuration)

			context.artifact({ logicalSlotId: context.frame.logicalSlotId, attempt: context.attempt, status: result.type === 'completed' ? 'committed' : 'rejected', path: context.frame.path })

			return result
		},
	})

	const holds: string[] = []

	const state: Harness = {
		executed,
		events,
		artifacts,
		controller,
		holds,
		desired: 'running',
		observation: {},
		host: {
			sessionId: 'session-1',
			plan,
			storage: { root: plan.storage.root, session: 'session-1' },
			signal: controller.signal,
			terminalSignal: new AbortController().signal,
			now: Date.now,
			...services(),
			...(guiding === undefined ? {} : { guiding }),
			handler,
			context: (nodeId, attempt, signal, frameSlot) => ({
				sessionId: 'session-1',
				nodeId,
				attempt,
				scope,
				signal,
				now: Date.now,
				request: () => undefined,
				progress: () => undefined,
				artifact: (draft: SequencerArtifactDraft) => {
					const artifact: SequencerArtifact = { ...draft, sessionId: 'session-1', createdAt: sequence++, updatedAt: Date.now() }
					if (draft.status === 'pending') store(artifact)
					else staged.push(artifact)
				},
				auxiliary: () => undefined,
				checkpoint: {} as SequencerCheckpoint,
				frame: frameSlot,
				guider: guiding === undefined ? undefined : 'guider-1',
			}),
			observe: () => state.observation,
			desiredState: () => state.desired,
			slotAttempt: (logicalSlotId) => sequencerSlotAttempt(artifacts(), logicalSlotId),
			hold: (nodeId) => {
				holds.push(nodeId)

				const converged = state.onHold?.(nodeId) ?? 'stopped'

				if (state.desired === 'paused') state.desired = converged

				return Promise.resolve(converged)
			},
			commit: (_, drafts) => {
				events.push(...drafts)
				for (const artifact of staged) store(artifact)
				staged.length = 0
			},
			delay: () => Promise.resolve(),
		},
	}

	return state
}

describe('plan walk', () => {
	test('captures every slot of every group and completes', async () => {
		const plan = planOf()
		const state = harness(plan)
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(outcome.terminal.failure).toBeUndefined()

		const frames = state.executed.filter((it) => it.slot !== undefined)

		expect(frames).toHaveLength(2)
		expect(frames.map((it) => it.slot!.ordinal)).toEqual([0, 1])
		expect(frames.map((it) => it.attempt)).toEqual([0, 0])
		expect(new Set(frames.map((it) => it.slot!.path)).size).toBe(2)
		expect(state.artifacts()).toHaveLength(2)
		expect(outcome.capture.m42?.cycle).toBe(1)
		expect(outcome.capture.m42?.groups).toBeEmpty()
	})

	test('runs the slew and the centering before the first frame', async () => {
		const state = harness(planOf())

		await runSequencerPlan(state.host)

		const order = state.executed.map((it) => it.nodeId)

		expect(order[0]).toBe('target[m42].slew')
		expect(order[1]).toBe('target[m42].center')
		expect(order.slice(2).every((id) => id === 'target[m42].capture.frame[lum]')).toBeTrue()
	})

	test('repeats every cycle of the loop', async () => {
		const base = definition()
		const state = harness(planOf({ capture: { ...base.capture, repeat: 3 } }))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(6)
		expect(outcome.capture.m42?.cycle).toBe(3)
	})

	test('spends a second attempt on a slot whose first exposure failed', async () => {
		const plan = planOf()
		let failed = false
		const state = harness(plan, (context) => {
			if (context.frame === undefined || failed) return Promise.resolve({ type: 'completed', value: undefined })

			failed = true

			return Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })
		})

		const outcome = await runSequencerPlan(state.host)
		const frames = state.executed.filter((it) => it.slot !== undefined)

		expect(outcome.terminal.state).toBe('completed')
		expect(frames).toHaveLength(3)
		expect(frames.map((it) => it.attempt)).toEqual([0, 1, 0])
		expect(frames[0].slot!.logicalSlotId).toBe(frames[1].slot!.logicalSlotId)
		expect(frames[0].slot!.path).not.toBe(frames[1].slot!.path)
	})

	test('exhausts the attempt window of a slot whose every exposure fails', async () => {
		const state = harness(planOf(), (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })))
		const outcome = await runSequencerPlan(state.host)
		const frames = state.executed.filter((it) => it.slot !== undefined)

		expect(outcome.terminal.state).toBe('failed')
		expect(outcome.terminal.failure).toEqual({ reason: 'commandFailed', detail: 'the camera did not answer' })
		expect(frames).toHaveLength(3)
		expect(frames.map((it) => it.attempt)).toEqual([0, 1, 2])
		expect(new Set(frames.map((it) => it.slot!.path)).size).toBe(3)
	})

	test('commits the events produced after the last checkpoint of the walk', async () => {
		const state = harness(planOf(), (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the camera is gone' })))

		await runSequencerPlan(state.host)

		expect(state.events.filter((it) => it.type === 'policyApplied')).toHaveLength(1)
	})

	test('takes the safe point again once the flip window the guard waited for opens', async () => {
		const base = definition()
		const state: Harness = harness(planOf({ meridianFlip: { ...base.meridianFlip, enabled: true } }), (context) => {
			if (context.nodeId.endsWith('.trigger.meridianFlip')) state.observation = { ...state.observation, pierSide: 'EAST' }
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.observation = { hourAngle: 0.15, pierSide: 'WEST', preFlipPierSide: 'WEST' }

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.meridianFlip'))).toHaveLength(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('never spends a second attempt on a slot whose exposure failed fatally', async () => {
		const state = harness(planOf(), (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the camera is gone' })))
		const outcome = await runSequencerPlan(state.host)
		const frames = state.executed.filter((it) => it.slot !== undefined)

		expect(outcome.terminal.state).toBe('failed')
		expect(outcome.terminal.failure).toEqual({ reason: 'commandFailed', detail: 'the camera is gone' })
		expect(frames).toHaveLength(1)
	})

	test('retries the safe point a transient guiding failure interrupted', async () => {
		let suspensions = 0
		const state = harness(
			planOf(),
			undefined,
			guidingServices(() => (suspensions++ === 0 ? failedOperationResult('commandFailed', 'the guider did not stop correcting') : successfulOperationResult(undefined))),
		)
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(suspensions).toBe(3)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('fails the session when the safe point spends the whole retry budget', async () => {
		let suspensions = 0
		const state = harness(
			planOf(),
			undefined,
			guidingServices(() => {
				suspensions++
				return failedOperationResult('commandFailed', 'the guider did not stop correcting')
			}),
		)
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(suspensions).toBe(3)
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('ends as stopped when the operator stops it between two frames', async () => {
		const state: Harness = harness(planOf(), (context) => {
			if (context.frame !== undefined) state.desired = 'stopped'
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(1)
	})

	test('fails the session when a group spends every slot without reaching its target', async () => {
		const base = definition()
		const plan = planOf({ capture: { ...base.capture, retry: { ...base.capture.retry, onExhausted: 'skip' } } })
		const state = harness(plan, (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(outcome.terminal.failure).toEqual({ reason: 'commandFailed', detail: 'the camera did not answer' })
		expect(outcome.capture.m42?.groups.lum?.accepted).toBe(0)
		expect(outcome.capture.m42?.groups.lum?.abandoned).toBeGreaterThan(0)
	})

	test('holds the walk on an operator pause and takes the remaining frames on the resume', async () => {
		let paused = false
		const state: Harness = harness(planOf(), (context) => {
			if (context.frame !== undefined && !paused) {
				paused = true
				state.desired = 'paused'
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.onHold = () => 'running'

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.holds).toHaveLength(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('ends the session when the pause it is holding on is stopped', async () => {
		const state: Harness = harness(planOf(), (context) => {
			if (context.frame !== undefined) state.desired = 'paused'
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.holds).toHaveLength(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(1)
	})

	test('grants a fresh attempt window to a slot resumed after it exhausted the first one', async () => {
		const base = definition()
		const plan = planOf({ capture: { ...base.capture, retry: { ...base.capture.retry, onExhausted: 'pause' } } })
		const state: Harness = harness(plan, (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })))
		let resumed = 0

		state.onHold = () => (resumed++ === 0 ? 'running' : 'stopped')

		const outcome = await runSequencerPlan(state.host)
		const frames = state.executed.filter((it) => it.slot !== undefined)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.holds).toHaveLength(2)
		expect(frames.map((it) => it.attempt)).toEqual([0, 1, 2, 3, 4, 5])
		expect(new Set(frames.map((it) => it.slot!.path)).size).toBe(6)
	})

	test('takes the safe point again instead of exposing when a held slot resumes', async () => {
		const base = definition()
		const plan = planOf({ capture: { ...base.capture, retry: { ...base.capture.retry, onExhausted: 'pause' } } })
		const state: Harness = harness(plan, (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })))

		state.onHold = () => {
			state.desired = 'stopped'
			return 'running'
		}

		const outcome = await runSequencerPlan(state.host)
		const frames = state.executed.filter((it) => it.slot !== undefined)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.holds).toHaveLength(1)
		expect(frames.map((it) => it.attempt)).toEqual([0, 1, 2])
	})

	test('fails the session when a target action reports a fatal failure', async () => {
		const state = harness(planOf(), (context) => (context.nodeId.endsWith('.slew') ? Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the mount did not slew' }) : Promise.resolve({ type: 'completed', value: undefined })))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(outcome.terminal.failure).toEqual({ reason: 'commandFailed', detail: 'the mount did not slew' })
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('runs the finalize pipeline after the plan and never reaches the target when startup refuses it', async () => {
		const base = definition()
		const startup = { ...base.startup, actions: [{ id: 'park', enabled: true, timeout: 30, retry: retry(), type: 'parkMount' as const, required: true }], continueOnFailure: false }
		const state = harness(planOf({ startup }), (context) => (context.nodeId.startsWith('startup.') ? Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the mount did not park' }) : Promise.resolve({ type: 'completed', value: undefined })))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(state.executed.map((it) => it.nodeId)).toEqual(['startup.action[park]'])
	})
})
