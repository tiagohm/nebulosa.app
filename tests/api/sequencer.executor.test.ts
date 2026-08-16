import { describe, expect, test } from 'bun:test'
import type { PierSide } from 'nebulosa/src/devices/indi/device'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter } from 'src/api/resource'
import type { ResourceReservation } from 'src/api/resource'
import { compile } from 'src/api/sequencer.compiler'
import type { SequencerMeridianFlipTrigger } from 'src/api/sequencer.compiler'
import { runSequencerPlan } from 'src/api/sequencer.executor'
import type { SequencerExecutorHost, SequencerSafePointObservation } from 'src/api/sequencer.executor'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import { sequencerSlotAttempt } from 'src/api/sequencer.identity'
import type { SequencerPreparationServices } from 'src/api/sequencer.prepare'
import type { AnySequencerActionHandler, SequencerActionContext, SequencerActionResult, SequencerFrameSlot } from 'src/api/sequencer.registry'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { Sequencer } from '#/sequencer'
import type { SequencerPlan } from '#/sequencer.plan'
import type { SequencerArtifact, SequencerArtifactDraft, SequencerCheckpoint, SequencerDesiredState, SequencerEventDraft, SequencerFailure } from '#/sequencer.state'
import { action, camera, canonical, frame, retry, services } from './sequencer.fixture'

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
		capture: { ...base.capture, order: 'sequential', repeat: 1, delay: 0, frames: [frame('lum', { count: 2, camera: camera() })], retry: retry() },
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

function guided(): SequencerPlan {
	const base = definition()

	return planOf({ guiding: { ...base.guiding, enabled: true }, dither: { ...base.dither, enabled: true, everyFrames: 1, beforeFirstFrame: true }, startup: { ...base.startup, actions: [action('guide', { type: 'startGuiding', required: true })] } })
}

interface Harness {
	readonly host: SequencerExecutorHost
	readonly executed: Executed[]
	readonly events: SequencerEventDraft[]
	readonly artifacts: () => readonly SequencerArtifact[]
	readonly controller: AbortController
	readonly action: AbortController
	readonly holds: string[]
	readonly phases: string[]
	desired: SequencerDesiredState
	observation: SequencerSafePointObservation
	devices?: Record<string, { readonly device: unknown }>
	onHold?: (nodeId: string) => SequencerDesiredState
	onObserve?: () => void
	onOpen?: () => SequencerFailure | undefined
	clock?: () => number
	refuseCommit?: () => boolean
}

function guidingServices(loop: () => OperationResult<unknown>, dither?: () => OperationResult<unknown>): SequencerGuidingServices {
	return {
		guiderCommander: {
			running: () => true,
			looping: () => true,
			loop: () => Promise.resolve(loop()),
			startGuiding: () => Promise.resolve(successfulOperationResult(undefined)),
			calibrate: () => Promise.resolve(successfulOperationResult(undefined)),
			dither: () => Promise.resolve(dither === undefined ? successfulOperationResult(undefined) : dither()),
		},
	} as unknown as SequencerGuidingServices
}

function harness(plan: SequencerPlan, execute?: (context: SequencerActionContext, configuration: unknown) => Promise<SequencerActionResult<unknown>>, guiding?: SequencerGuidingServices, preparation?: SequencerPreparationServices): Harness {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const reserved = arbiter.reserve({ id: 'session-1', kind: 'sequencer' }, [])
	const scope = coordinator.reservedScope((reserved as { readonly reservation: ResourceReservation }).reservation)
	const executed: Executed[] = []
	const events: SequencerEventDraft[] = []
	const durable = new Map<string, SequencerArtifact>()
	const staged: SequencerArtifact[] = []
	const controller = new AbortController()
	const action = new AbortController()
	let sequence = 0

	controller.signal.addEventListener('abort', () => action.abort(), { once: true })

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
	const phases: string[] = []

	const state: Harness = {
		executed,
		events,
		artifacts,
		controller,
		action,
		holds,
		phases,
		desired: 'running',
		observation: {},
		host: {
			sessionId: 'session-1',
			plan,
			storage: { root: plan.storage.root, session: 'session-1' },
			signal: action.signal,
			waitSignal: controller.signal,
			terminalSignal: new AbortController().signal,
			now: () => state.clock?.() ?? Date.now(),
			...services(),
			...(guiding === undefined ? {} : { guiding }),
			...(preparation === undefined ? {} : { preparation }),
			handler,
			context: (nodeId, attempt, signal, frameSlot) => ({
				sessionId: 'session-1',
				nodeId,
				attempt,
				scope,
				signal,
				now: Date.now,
				request: (role) => state.devices?.[role] as never,
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
			observe: () => {
				state.onObserve?.()
				return state.observation
			},
			desiredState: () => state.desired,
			slotAttempt: (logicalSlotId) => sequencerSlotAttempt(artifacts(), logicalSlotId),
			hold: (nodeId) => {
				holds.push(nodeId)

				const converged = state.onHold?.(nodeId) ?? 'stopped'

				if (state.desired === 'paused') state.desired = converged

				return Promise.resolve(converged)
			},
			open: () => Promise.resolve(state.onOpen?.()),
			capturing: () => void state.phases.push('capturing'),
			finalizing: () => void state.phases.push('finalizing'),
			commit: (_, drafts) => {
				if (state.refuseCommit?.()) return false

				events.push(...drafts)
				for (const artifact of staged) store(artifact)
				staged.length = 0

				return true
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

	test('makes the artifact row of a frame durable together with the progress counting it', async () => {
		const base = definition()
		const checkpoint = { afterEveryAction: false, afterEveryFrame: false, afterEveryArtifact: true, interval: 0 }
		let seen: readonly SequencerArtifact[] = []
		const state: Harness = harness(planOf({ execution: { ...base.execution, checkpoint } }), (context) => {
			if (context.frame?.ordinal === 1) seen = state.artifacts()
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(seen.filter((it) => it.status === 'committed')).toHaveLength(1)
	})

	test('commits the events produced after the last checkpoint of the walk', async () => {
		const state = harness(planOf(), (context) => (context.frame === undefined ? Promise.resolve({ type: 'completed', value: undefined }) : Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the camera is gone' })))

		await runSequencerPlan(state.host)

		expect(state.events.filter((it) => it.type === 'policyApplied')).toHaveLength(1)
	})

	test('carries the events a refused commit could not place into the next one', async () => {
		let refuse = false
		let failed = false

		const state: Harness = harness(planOf(), (context) => {
			if (context.frame !== undefined && !failed) {
				failed = true
				refuse = true

				return Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.refuseCommit = () => {
			const refused = refuse
			refuse = false
			return refused
		}

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.events.filter((it) => it.type === 'policyApplied')).toHaveLength(1)
	})

	test('asks the meridian guard again before the retry of an exposure that failed', async () => {
		const base = definition()
		let failures = 0
		const state: Harness = harness(planOf({ meridianFlip: { ...base.meridianFlip, enabled: true } }), (context) => {
			if (context.nodeId.endsWith('.trigger.meridianFlip')) {
				state.observation = { ...state.observation, pierSide: 'EAST' }

				return Promise.resolve({ type: 'completed', value: undefined })
			}

			if (context.frame !== undefined && failures++ === 0) {
				state.observation = { ...state.observation, preFlipPierSide: 'WEST' }

				return Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the camera did not answer' })
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.observation = { hourAngle: 0.099, pierSide: 'WEST', preFlipPierSide: 'EAST' }

		const outcome = await runSequencerPlan(state.host)

		const flipped = state.executed.findIndex((it) => it.nodeId.endsWith('.trigger.meridianFlip'))

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.meridianFlip'))).toHaveLength(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(3)
		expect(state.executed.slice(0, flipped).filter((it) => it.slot !== undefined)).toHaveLength(1)
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

	test('leaves the plan stopped when a stop ends the wait for the flip window', async () => {
		const base = definition()
		const capture = { ...base.capture, frames: [frame('lum', { count: 2, exposureTime: 1300, camera: camera() })] }
		const state = harness(planOf({ capture, meridianFlip: { ...base.meridianFlip, enabled: true } }))
		let readings = 0

		state.observation = { hourAngle: 0.005, pierSide: 'WEST', preFlipPierSide: 'WEST' }
		state.onObserve = () => {
			if (++readings < 4) return

			state.desired = 'stopped'
			state.controller.abort()
		}

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('finishes the recovery of a flip a pause interrupted after the crossing', async () => {
		const base = definition()
		const entries: (PierSide | undefined)[] = []
		const state: Harness = harness(planOf({ meridianFlip: { ...base.meridianFlip, enabled: true } }), (context, configuration) => {
			if (context.nodeId.endsWith('.trigger.meridianFlip')) {
				entries.push((configuration as SequencerMeridianFlipTrigger).crossedFrom)

				if (entries.length === 1) {
					state.observation = { ...state.observation, pierSide: 'EAST' }
					state.desired = 'paused'

					return Promise.resolve({ type: 'retryableFailure', reason: 'aborted', detail: 'the recentering after the crossing was cancelled' })
				}
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.observation = { hourAngle: 0.05, pierSide: 'WEST', preFlipPierSide: 'WEST' }
		state.onHold = () => 'running'

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(entries).toEqual([undefined, 'WEST'])
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('ends the plan at the meridian boundary of a mount that publishes no pier side', async () => {
		const base = definition()
		const state = harness(planOf({ meridianFlip: { ...base.meridianFlip, enabled: true } }))

		state.observation = { hourAngle: 0.099 }

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(outcome.terminal.failure?.reason).toBe('unexpectedState')
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('exposes ahead of the meridian boundary of a mount that publishes no pier side', async () => {
		const base = definition()
		const state = harness(planOf({ meridianFlip: { ...base.meridianFlip, enabled: true } }))

		state.observation = { hourAngle: -0.5 }

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('guards the exposure against the sky as it stands after the safe point instead of before it', async () => {
		const base = definition()
		const capture = { ...base.capture, frames: [frame('lum', { count: 1, camera: camera() })] }
		const state: Harness = harness(planOf({ capture, autofocus: { ...base.autofocus, enabled: true }, meridianFlip: { ...base.meridianFlip, enabled: true } }), (context) => {
			if (context.nodeId.endsWith('.trigger.autofocus')) state.observation = { ...state.observation, hourAngle: 0.095 }
			if (context.nodeId.endsWith('.trigger.meridianFlip')) state.observation = { ...state.observation, pierSide: 'EAST' }
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.observation = { hourAngle: -0.5, pierSide: 'WEST', preFlipPierSide: 'WEST' }

		const outcome = await runSequencerPlan(state.host)
		const order = state.executed.map((it) => it.nodeId)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.meridianFlip'))).toHaveLength(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(1)
		expect(order.findIndex((id) => id.endsWith('.trigger.meridianFlip'))).toBeLessThan(order.findIndex((id) => id.endsWith('.frame[lum]')))
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
			guided(),
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
			guided(),
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

	test('commands nothing again when the operator stops the session inside the retry delay of the safe point', async () => {
		let suspensions = 0
		const state: Harness = harness(
			guided(),
			undefined,
			guidingServices(() => {
				suspensions++
				state.desired = 'stopped'

				return failedOperationResult('commandFailed', 'the guider did not stop correcting')
			}),
		)

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(suspensions).toBe(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('spends the guiding budget and not the execution default on a suspension that keeps failing', async () => {
		const base = definition()
		let suspensions = 0
		const state = harness(
			planOf({
				guiding: { ...base.guiding, enabled: true, retry: { ...retry(), maxAttempts: 2 } },
				dither: { ...base.dither, enabled: true, everyFrames: 1, beforeFirstFrame: true },
				startup: { ...base.startup, actions: [action('guide', { type: 'startGuiding', required: true })] },
			}),
			undefined,
			guidingServices(() => {
				suspensions++
				return failedOperationResult('commandFailed', 'the guider did not stop correcting')
			}),
		)

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(suspensions).toBe(2)
	})

	test('gives up the frame instead of exposing it when the preparation is skipped', async () => {
		const base = definition()
		const mount = { type: 'mount', name: 'Mount Simulator', id: 'mount-1', connected: true, tracking: false, trackMode: 'SIDEREAL' }
		let commanded = 0
		const preparation = {
			mountCommander: {
				setTracking: () => {
					commanded++
					return Promise.resolve(failedOperationResult('commandFailed', 'the mount did not resume tracking'))
				},
			},
		} as unknown as SequencerPreparationServices
		const state = harness(planOf({ execution: { ...base.execution, defaultRetry: { ...retry(), maxAttempts: 1, onExhausted: 'skip' } } }), undefined, undefined, preparation)

		state.devices = { mount: { device: mount } }

		const outcome = await runSequencerPlan(state.host)

		expect(commanded).toBe(2)
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
		expect(state.artifacts()).toBeEmpty()
		expect(outcome.terminal.state).toBe('failed')
		expect(outcome.terminal.failure?.reason).toBe('commandFailed')
	})

	test('exposes a safe point that moves nothing without suspending the corrections', async () => {
		let suspensions = 0
		const state = harness(
			planOf(),
			undefined,
			guidingServices(() => (++suspensions, successfulOperationResult(undefined))),
		)
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(suspensions).toBe(0)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
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

	test('attends a pause at the boundary between two target actions', async () => {
		let paused = false
		const state: Harness = harness(planOf(), (context) => {
			if (context.frame === undefined && !paused) {
				paused = true
				state.desired = 'paused'
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.holds).toEqual(['target[m42].center'])
		expect(state.executed.map((it) => it.nodeId)).toEqual(['target[m42].slew'])
	})

	test('attends a pause between the triggers of a safe point and the exposure they prepared', async () => {
		const base = definition()
		const state: Harness = harness(planOf({ autofocus: { ...base.autofocus, enabled: true } }), (context) => {
			if (context.nodeId.endsWith('.autofocus')) state.desired = 'paused'
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.holds).toEqual(['target[m42].capture.frame[lum]'])
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
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

	test('attends a pause pending in front of the first startup action instead of commanding it', async () => {
		const base = definition()
		const startup = { ...base.startup, actions: [{ id: 'unpark', enabled: true, timeout: 30, retry: retry(), type: 'unparkMount' as const }], continueOnFailure: false }
		const state: Harness = harness(planOf({ startup }))

		state.desired = 'paused'

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.holds).toHaveLength(1)
		expect(state.executed).toBeEmpty()
	})

	test('runs the finalize pipeline after the plan and never reaches the target when startup refuses it', async () => {
		const base = definition()
		const startup = { ...base.startup, actions: [{ id: 'park', enabled: true, timeout: 30, retry: retry(), type: 'parkMount' as const, required: true }], continueOnFailure: false }
		const state = harness(planOf({ startup }), (context) => (context.nodeId.startsWith('startup.') ? Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the mount did not park' }) : Promise.resolve({ type: 'completed', value: undefined })))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('failed')
		expect(state.executed.map((it) => it.nodeId)).toEqual(['startup.action[park]'])
		expect(outcome.checkpoint.completed).not.toContain('startup.action[park]')
		expect(state.phases).toBeEmpty()
	})

	test('spends nothing on a safe point that moved nothing', async () => {
		const base = definition()
		const target = { ...base.target, goto: { ...base.target.goto, enabled: false }, center: { ...base.target.center, enabled: false }, tracking: { ...base.target.tracking, enabled: false } }
		const state = harness(planOf({ target }))
		const started = performance.now()
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
		expect(performance.now() - started).toBeLessThan(500)
	})

	test('never refocuses after a flip that refocused inside its own node', async () => {
		const base = definition()
		const autofocus = { ...base.autofocus, enabled: true, triggers: { ...base.autofocus.triggers, onStart: false, onFilterChange: false, afterMeridianFlip: true, everyFrames: 0, everyTime: 0, temperatureChange: 0, minimumTimeBetweenRuns: 0 } }
		const meridianFlip = { ...base.meridianFlip, enabled: true, autofocus: true }
		const state: Harness = harness(planOf({ autofocus, meridianFlip }), (context) => {
			if (context.nodeId.endsWith('.trigger.meridianFlip')) state.observation = { ...state.observation, pierSide: 'EAST' }
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.observation = { hourAngle: 0.05, pierSide: 'WEST', preFlipPierSide: 'WEST' }

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.meridianFlip'))).toHaveLength(1)
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.autofocus'))).toBeEmpty()
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('applies the terminal decision an autofocus trigger declares instead of the retry default', async () => {
		const base = definition()
		const autofocus = { ...base.autofocus, enabled: true, onFailure: 'continue' as const, retry: { ...retry(), maxAttempts: 1 } }
		const state = harness(planOf({ autofocus }), (context) => (context.nodeId.endsWith('.trigger.autofocus') ? Promise.resolve({ type: 'retryableFailure', reason: 'commandFailed', detail: 'the focuser did not move' }) : Promise.resolve({ type: 'completed', value: undefined })))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.autofocus'))).toHaveLength(2)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('applies the terminal decision the dither declares when the dither is what failed', async () => {
		const base = definition()
		const dither = { ...base.dither, enabled: true, onFailure: 'continue' as const, retry: { ...retry(), maxAttempts: 1 } }
		let dithers = 0
		const state = harness(
			planOf({ dither, guiding: { ...base.guiding, enabled: true }, startup: { ...base.startup, actions: [action('guide', { type: 'startGuiding', required: true })] } }),
			undefined,
			guidingServices(
				() => successfulOperationResult(undefined),
				() => {
					dithers++
					return failedOperationResult('commandFailed', 'the dither did not settle')
				},
			),
		)
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(dithers).toBeGreaterThan(0)
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('ends the capture loop once the accumulated integration reaches the declared target', async () => {
		const base = definition()
		const state = harness(planOf({ execution: { ...base.execution, end: { type: 'integrationTime', time: 60 } } }))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(1)
	})

	test('takes no frame when the declared end instant has already passed', async () => {
		const base = definition()
		const state = harness(planOf({ execution: { ...base.execution, end: { type: 'at', time: Date.now() - 1000 } } }))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('takes no frame when the declared end instant passes inside the safe point', async () => {
		const base = definition()
		const at = Date.now() + 100_000
		const state: Harness = harness(planOf({ autofocus: { ...base.autofocus, enabled: true }, execution: { ...base.execution, end: { type: 'at', time: at } } }), (context) => {
			if (context.nodeId.endsWith('.trigger.autofocus')) state.clock = () => at + 1000
			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.clock = () => at - 1000

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.executed.filter((it) => it.nodeId.endsWith('.trigger.autofocus'))).toHaveLength(1)
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('holds the whole session until the declared start instant', async () => {
		const base = definition()
		const startup = { ...base.startup, actions: [{ id: 'unpark', enabled: true, timeout: 30, retry: retry(), type: 'unparkMount' as const, required: true }] }
		const at = Date.now() + 200
		const state = harness(planOf({ startup, execution: { ...base.execution, start: { type: 'at', time: at } } }))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(Date.now()).toBeGreaterThanOrEqual(at)
		expect(state.executed.map((it) => it.nodeId)).toContain('startup.action[unpark]')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(2)
	})

	test('ends as stopped without entering the plan when the scheduled start is cancelled', async () => {
		const base = definition()
		const state = harness(planOf({ execution: { ...base.execution, start: { type: 'at', time: Date.now() + 3_600_000 } } }))

		setTimeout(() => state.controller.abort(), 20)

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(state.executed).toBeEmpty()
	})

	test('ends as stopped when a stop cancels the guider the walk was opening', async () => {
		const base = definition()
		const shutdown = { ...base.shutdown, actions: [{ id: 'park', enabled: true, timeout: 30, retry: retry(), type: 'parkMount' as const, required: true }] }
		const state: Harness = harness(planOf({ shutdown }), (context) => {
			state.phases.push(context.nodeId)

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.onOpen = () => {
			state.desired = 'stopped'
			return { reason: 'aborted' }
		}

		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('stopped')
		expect(outcome.terminal.failure).toBeUndefined()
		expect(state.phases).toEqual(['finalizing', 'finalize.action[park]'])
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
	})

	test('wakes the wait for the minimum spacing when a pause cancels the action', async () => {
		const base = definition()
		const state: Harness = harness(planOf({ capture: { ...base.capture, delay: 2 } }), (context) => {
			if (context.frame !== undefined && state.executed.filter((it) => it.slot !== undefined).length === 1) {
				setTimeout(() => {
					state.desired = 'paused'
					state.action.abort()
				}, 20)
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})
		const started = performance.now()
		const outcome = await runSequencerPlan(state.host)

		expect(state.holds).not.toBeEmpty()
		expect(performance.now() - started).toBeLessThan(1000)
		expect(outcome.terminal.state).toBe('stopped')
		expect(state.executed.filter((it) => it.slot !== undefined)).toHaveLength(1)
	})

	test('keeps the startup pipeline running when a pause cancels the action', async () => {
		const base = definition()
		const startup = {
			...base.startup,
			actions: [
				{ id: 'park', enabled: true, timeout: 30, retry: retry(), type: 'parkMount' as const, required: true },
				{ id: 'unpark', enabled: true, timeout: 30, retry: retry(), type: 'unparkMount' as const, required: true },
			],
			continueOnFailure: false,
		}
		const state: Harness = harness(planOf({ startup }), (context) => {
			if (context.nodeId === 'startup.action[park]') {
				state.action.abort()

				if (context.signal.aborted) return Promise.resolve({ type: 'retryableFailure', reason: 'aborted', detail: 'the pause cancelled the action' })
			}

			return Promise.resolve({ type: 'completed', value: undefined })
		})
		const outcome = await runSequencerPlan(state.host)

		expect(state.executed.map((it) => it.nodeId)).toContain('startup.action[unpark]')
		expect(outcome.checkpoint.completed).toContain('startup.action[park]')
		expect(outcome.checkpoint.completed).toContain('startup.action[unpark]')
	})

	test('holds the startup pipeline between two actions when the session is paused', async () => {
		const base = definition()
		const startup = {
			...base.startup,
			actions: [
				{ id: 'unpark', enabled: true, timeout: 30, retry: retry(), type: 'unparkMount' as const, required: true },
				{ id: 'track', enabled: true, timeout: 30, retry: retry(), type: 'startTracking' as const, required: true },
			],
		}
		const state: Harness = harness(planOf({ startup }), (context) => {
			if (context.nodeId === 'startup.action[unpark]') state.desired = 'paused'

			return Promise.resolve({ type: 'completed', value: undefined })
		})

		state.onHold = () => 'running'

		const outcome = await runSequencerPlan(state.host)

		expect(state.holds).toContain('startup.action[track]')
		expect(state.executed.map((it) => it.nodeId)).toContain('startup.action[track]')
		expect(outcome.terminal.state).toBe('completed')
	})

	test('commands no further startup action once the session is stopping', async () => {
		const base = definition()
		const startup = {
			...base.startup,
			actions: [
				{ id: 'unpark', enabled: true, timeout: 30, retry: retry(), type: 'unparkMount' as const, required: true },
				{ id: 'track', enabled: true, timeout: 30, retry: retry(), type: 'startTracking' as const, required: true },
			],
		}
		const state: Harness = harness(planOf({ startup }), (context) => {
			if (context.nodeId === 'startup.action[unpark]') state.desired = 'stopped'

			return Promise.resolve({ type: 'completed', value: undefined })
		})
		const outcome = await runSequencerPlan(state.host)

		expect(state.executed.map((it) => it.nodeId)).not.toContain('startup.action[track]')
		expect(state.executed.filter((it) => it.slot !== undefined)).toBeEmpty()
		expect(outcome.terminal.state).toBe('stopped')
	})

	test('publishes the finalizing phase before the first terminal action runs', async () => {
		const base = canonical()
		const shutdown = { ...base.shutdown, actions: [{ id: 'park', enabled: true, timeout: 30, retry: retry(), type: 'parkMount' as const, required: true }] }
		const state: Harness = harness(planOf({ shutdown }), (context) => {
			if (context.nodeId === 'finalize.action[park]') state.phases.push(context.nodeId)

			return Promise.resolve({ type: 'completed', value: undefined })
		})
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.phases).toEqual(['capturing', 'finalizing', 'finalize.action[park]'])
	})

	test('publishes no finalizing phase when no terminal pipeline runs', async () => {
		const base = canonical()
		const shutdown = { ...base.shutdown, enabled: false, actions: [] }
		const state = harness(planOf({ shutdown }))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(state.phases).toEqual(['capturing'])
	})

	test('records a lifecycle step as completed only when it ran', async () => {
		const base = definition()
		const startup = {
			...base.startup,
			actions: [
				{ id: 'park', enabled: true, timeout: 30, retry: retry(), type: 'parkMount' as const, required: false },
				{ id: 'unpark', enabled: true, timeout: 30, retry: retry(), type: 'unparkMount' as const, required: false },
			],
			continueOnFailure: true,
		}
		const state = harness(planOf({ startup }), (context) => (context.nodeId === 'startup.action[park]' ? Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'the mount did not park' }) : Promise.resolve({ type: 'completed', value: undefined })))
		const outcome = await runSequencerPlan(state.host)

		expect(outcome.terminal.state).toBe('completed')
		expect(outcome.checkpoint.completed).not.toContain('startup.action[park]')
		expect(outcome.checkpoint.completed).toContain('startup.action[unpark]')
	})
})
