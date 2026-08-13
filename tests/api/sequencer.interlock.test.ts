import { describe, expect, test } from 'bun:test'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import { runGuidingInterlock, sequencerFuseGuiderSettle } from 'src/api/sequencer.interlock'
import type { SequencerInterlockRequest } from 'src/api/sequencer.interlock'
import type { SequencerActionContext, SequencerActionResult } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationFailureReason } from '#/orchestration'
import type { SequencerDither, SequencerGuiderSettle } from '#/sequencer'

interface Command {
	readonly name: string
	readonly detail?: unknown
}

interface Failures {
	readonly loop?: OperationFailureReason
	readonly startGuiding?: OperationFailureReason
	readonly calibrate?: OperationFailureReason
	readonly dither?: OperationFailureReason
}

function settle(overrides?: Partial<SequencerGuiderSettle>): SequencerGuiderSettle {
	return { tolerance: 1.5, time: 10, timeout: 60, minimumFrames: 3, ...overrides }
}

function ditherTrigger(overrides?: Partial<Omit<SequencerDither, 'enabled'>>): Omit<SequencerDither, 'enabled'> {
	return {
		amount: 3,
		raOnly: false,
		beforeFirstFrame: false,
		afterMeridianFlip: true,
		afterFilterChange: false,
		everyFrames: 1,
		everyTime: 0,
		settle: settle(),
		retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' },
		onFailure: 'continue',
		...overrides,
	}
}

function interlockRequest(overrides?: Partial<SequencerInterlockRequest>): SequencerInterlockRequest {
	return { settle: settle(), recalibrateAfterMeridianFlip: false, ...overrides }
}

function actionContext(guider?: string): SequencerActionContext {
	return {
		sessionId: 'session-1',
		nodeId: 'target[m42].capture',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal: new AbortController().signal,
		now: () => 1_000_000,
		request: () => undefined,
		progress: () => {},
		artifact: () => {},
		auxiliary: () => undefined,
		guider,
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

function interlockServices(commands: Command[], running: boolean, failures: Failures = {}, looping = false): SequencerGuidingServices {
	function answer(name: keyof Failures, detail?: unknown) {
		commands.push({ name, detail })
		const reason = failures[name]
		return Promise.resolve(reason === undefined ? successfulOperationResult(undefined) : failedOperationResult(reason, 'boom'))
	}

	return {
		guiderCommander: {
			running: () => running,
			looping: () => looping,
			loop: (_id: string, request: unknown) => answer('loop', request),
			startGuiding: () => answer('startGuiding'),
			calibrate: () => answer('calibrate'),
			dither: (_id: string, request: unknown) => answer('dither', request),
		} as unknown as SequencerGuidingServices['guiderCommander'],
	}
}

const CENTERED: SequencerActionResult<string> = { type: 'completed', value: 'centered' }

function body(commands: Command[], result: SequencerActionResult<string> = CENTERED, flipped = false) {
	return async (state: { flipped: boolean }) => {
		commands.push({ name: 'body' })
		state.flipped = flipped
		return await Promise.resolve(result)
	}
}

describe('guiding interlock', () => {
	test('suspends once, runs the steps and resumes without recalibrating', async () => {
		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, true), actionContext('guider-1'), interlockRequest(), body(commands))

		expect(result).toEqual({ type: 'completed', value: { value: 'centered', suspended: true, recalibrated: false } })
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])
	})

	test('installs the strongest settle in play on the session that suspends', async () => {
		const commands: Command[] = []
		const dither = ditherTrigger({ settle: { tolerance: 0.8, time: 5, timeout: 120, minimumFrames: 8 } })

		await runGuidingInterlock(interlockServices(commands, true), actionContext('guider-1'), interlockRequest({ dither }), body(commands))

		expect(commands[0]).toEqual({ name: 'loop', detail: { settle: { pixels: 0.8, time: 10, timeout: 120 } } })
	})

	test('fuses two settles by taking the tightest error and the most patient waits', () => {
		const fused = sequencerFuseGuiderSettle(settle(), { tolerance: 0.8, time: 5, timeout: 120, minimumFrames: 8 })

		expect(fused).toEqual({ tolerance: 0.8, time: 10, timeout: 120, minimumFrames: 8 })
		expect(sequencerFuseGuiderSettle(settle())).toEqual(settle())
	})

	test('emits the dither with the resume and reports the displacement it took', async () => {
		const commands: Command[] = []
		const dither = ditherTrigger({ amount: 5, raOnly: true })
		const result = await runGuidingInterlock(interlockServices(commands, true), actionContext('guider-1'), interlockRequest({ dither }), body(commands))

		expect(result).toEqual({ type: 'completed', value: { value: 'centered', suspended: true, recalibrated: false, dither: { amount: 5, raOnly: true, guider: 'guider-1' } } })
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding', 'dither'])
		expect(commands[3].detail).toEqual({ amount: 5, raOnly: true })
	})

	test('dithers even when the bracketed steps moved the field themselves', async () => {
		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, true), actionContext('guider-1'), interlockRequest({ dither: ditherTrigger() }), body(commands, { type: 'completed', value: 'centered' }, true))

		expect(result.type).toBe('completed')
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding', 'dither'])
	})

	test('recalibrates on the resume only after a crossing and only when the definition asks for it', async () => {
		const asked: Command[] = []
		const recalibrating = await runGuidingInterlock(interlockServices(asked, true), actionContext('guider-1'), interlockRequest({ recalibrateAfterMeridianFlip: true }), body(asked, { type: 'completed', value: 'flipped' }, true))

		expect(recalibrating).toEqual({ type: 'completed', value: { value: 'flipped', suspended: true, recalibrated: true } })
		expect(asked.map((command) => command.name)).toEqual(['loop', 'body', 'calibrate'])

		const unasked: Command[] = []
		await runGuidingInterlock(interlockServices(unasked, true), actionContext('guider-1'), interlockRequest(), body(unasked, { type: 'completed', value: 'flipped' }, true))

		expect(unasked.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])

		const unflipped: Command[] = []
		await runGuidingInterlock(interlockServices(unflipped, true), actionContext('guider-1'), interlockRequest({ recalibrateAfterMeridianFlip: true }), body(unflipped))

		expect(unflipped.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])
	})

	test('runs the steps with no bracket at all when the session is not guiding', async () => {
		const commands: Command[] = []
		const withoutGuider = await runGuidingInterlock(interlockServices(commands, true), actionContext(), interlockRequest({ dither: ditherTrigger() }), body(commands))

		expect(withoutGuider).toEqual({ type: 'completed', value: { value: 'centered', suspended: false, recalibrated: false } })
		expect(commands.map((command) => command.name)).toEqual(['body'])

		const idle: Command[] = []
		const notRunning = await runGuidingInterlock(interlockServices(idle, false), actionContext('guider-1'), interlockRequest({ dither: ditherTrigger() }), body(idle))

		expect(notRunning).toEqual({ type: 'completed', value: { value: 'centered', suspended: false, recalibrated: false } })
		expect(idle.map((command) => command.name)).toEqual(['body'])
	})

	test('leaves a guider looping for someone else exactly as it is', async () => {
		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, false, {}, true), actionContext('guider-external'), interlockRequest(), body(commands))

		expect(result).toEqual({ type: 'completed', value: { value: 'centered', suspended: false, recalibrated: false } })
		expect(commands.map((command) => command.name)).toEqual(['body'])
	})

	test('resumes a guider left looping by a bracket that never resumed it', async () => {
		const stranded: Command[] = []
		const abandoned = await runGuidingInterlock(interlockServices(stranded, true, { startGuiding: 'timeout' }), actionContext('guider-stranded'), interlockRequest(), body(stranded))

		expect(abandoned).toMatchObject({ type: 'retryableFailure', reason: 'timeout' })

		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, false, {}, true), actionContext('guider-stranded'), interlockRequest(), body(commands))

		expect(result).toEqual({ type: 'completed', value: { value: 'centered', suspended: true, recalibrated: false } })
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])
	})

	test('stops treating a resumed guider as a suspension of its own', async () => {
		const bracketed: Command[] = []

		await runGuidingInterlock(interlockServices(bracketed, true), actionContext('guider-resumed'), interlockRequest(), body(bracketed))

		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, false, {}, true), actionContext('guider-resumed'), interlockRequest(), body(commands))

		expect(result).toEqual({ type: 'completed', value: { value: 'centered', suspended: false, recalibrated: false } })
		expect(commands.map((command) => command.name)).toEqual(['body'])
	})

	test('refuses to run the steps when the corrections could not be suspended', async () => {
		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, true, { loop: 'timeout' }), actionContext('guider-1'), interlockRequest(), body(commands))

		expect(result).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the guiding corrections could not be suspended: boom' })
		expect(commands.map((command) => command.name)).toEqual(['loop'])
	})

	test('resumes the corrections after a failed step and reports the failure of the step', async () => {
		const commands: Command[] = []
		const failure: SequencerActionResult<string> = { type: 'retryableFailure', reason: 'commandFailed', detail: 'the plate solver found nothing' }
		const result = await runGuidingInterlock(interlockServices(commands, true), actionContext('guider-1'), interlockRequest({ dither: ditherTrigger() }), body(commands, failure))

		expect(result).toEqual(failure)
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])
	})

	test('resumes the corrections when a bracketed step throws and lets the exception through', async () => {
		const commands: Command[] = []
		const thrower = async (state: { flipped: boolean }) => {
			commands.push({ name: 'body' })
			state.flipped = false
			await Promise.resolve()
			throw new Error('the camera handler exploded')
		}

		let thrown: unknown

		try {
			await runGuidingInterlock(interlockServices(commands, true), actionContext('guider-1'), interlockRequest({ dither: ditherTrigger() }), thrower)
		} catch (e) {
			thrown = e
		}

		expect(thrown).toBeInstanceOf(Error)
		expect((thrown as Error).message).toBe('the camera handler exploded')
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])
	})

	test('reports a resume that never settled', async () => {
		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, true, { startGuiding: 'timeout' }), actionContext('guider-1'), interlockRequest({ dither: ditherTrigger() }), body(commands))

		expect(result).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the guiding corrections could not be resumed: boom' })
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding'])
	})

	test('reports a dither that did not settle after the bracket already resumed', async () => {
		const commands: Command[] = []
		const result = await runGuidingInterlock(interlockServices(commands, true, { dither: 'aborted' }), actionContext('guider-1'), interlockRequest({ dither: ditherTrigger() }), body(commands))

		expect(result).toEqual({ type: 'fatalFailure', reason: 'aborted', detail: 'the dither did not settle: boom' })
		expect(commands.map((command) => command.name)).toEqual(['loop', 'body', 'startGuiding', 'dither'])
	})
})
