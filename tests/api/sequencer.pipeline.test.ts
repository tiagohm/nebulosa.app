import { describe, expect, test } from 'bun:test'
import type { SequencerLifecycle } from 'src/api/sequencer.compiler'
import type { SequencerPipelineExecutor, SequencerPipelineStep } from 'src/api/sequencer.pipeline'
import { runSequencerPipeline } from 'src/api/sequencer.pipeline'
import type { SequencerActionResult } from 'src/api/sequencer.registry'
import type { SequencerLifecycleAction, SequencerRetryPolicy } from '#/sequencer'
import { retry } from './sequencer.fixture'

type Answer = SequencerActionResult<unknown> | ((attempt: number, signal: AbortSignal) => SequencerActionResult<unknown> | Promise<SequencerActionResult<unknown>>)

function step(id: string, overrides?: Partial<SequencerLifecycle>, retryOverrides?: Partial<SequencerRetryPolicy>): SequencerPipelineStep {
	const action = { id, type: 'parkMount', enabled: true, timeout: 30, retry: retry() } as unknown as SequencerLifecycleAction
	const configuration: SequencerLifecycle = { action, required: false, timeout: 0, retry: { ...retry(), ...retryOverrides }, ...overrides }

	return { nodeId: `finalize.action[${id}]`, type: `sequencer.lifecycle.${configuration.action.type}`, configuration }
}

function executor(answers: Readonly<Record<string, Answer>>, log?: string[]): SequencerPipelineExecutor {
	return {
		async run(step, attempt, signal) {
			log?.push(`${step.nodeId}#${attempt}`)
			const answer = answers[step.nodeId] ?? { type: 'completed', value: undefined }
			return typeof answer === 'function' ? await answer(attempt, signal) : answer
		},
		delay(delay) {
			log?.push(`delay:${delay}`)
			return Promise.resolve()
		},
	}
}

const COMPLETED: SequencerActionResult<unknown> = { type: 'completed', value: undefined }
const TIMED_OUT: SequencerActionResult<unknown> = { type: 'retryableFailure', reason: 'timeout' }
const ABORTED: SequencerActionResult<unknown> = { type: 'retryableFailure', reason: 'aborted' }

function nodeId(id: string) {
	return `finalize.action[${id}]`
}

describe('ordered execution', () => {
	test('runs every action in declaration order and reports each one', async () => {
		const log: string[] = []
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a'), step('b')], executor({}, log), new AbortController().signal)

		expect(log).toEqual([nodeId('a') + '#1', nodeId('b') + '#1'])
		expect(report.results).toEqual([
			{ nodeId: nodeId('a'), type: 'sequencer.lifecycle.parkMount', required: false, outcome: 'succeeded', detail: undefined, attempts: 1 },
			{ nodeId: nodeId('b'), type: 'sequencer.lifecycle.parkMount', required: false, outcome: 'succeeded', detail: undefined, attempts: 1 },
		])
		expect(report.failure).toBeUndefined()
		expect(report.stopped).toBeFalse()
	})

	test('a handler that finds nothing to do is skipped and not a failure', async () => {
		const report = await runSequencerPipeline({ continueOnFailure: false }, [step('a', { required: true }), step('b')], executor({ [nodeId('a')]: { type: 'skipped', detail: 'already parked' } }), new AbortController().signal)

		expect(report.results[0]).toMatchObject({ outcome: 'skipped', detail: 'already parked' })
		expect(report.results[1]).toMatchObject({ outcome: 'succeeded' })
		expect(report.failure).toBeUndefined()
	})
})

describe('attempts', () => {
	test('retries under the policy of the action and waits the declared spacing', async () => {
		const log: string[] = []
		const answers = { [nodeId('a')]: (attempt: number) => (attempt < 3 ? TIMED_OUT : COMPLETED) }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a')], executor(answers, log), new AbortController().signal)

		expect(log).toEqual([nodeId('a') + '#1', 'delay:5000', nodeId('a') + '#2', 'delay:10000', nodeId('a') + '#3'])
		expect(report.results[0]).toMatchObject({ outcome: 'succeeded', attempts: 3 })
	})

	test('fails with the cause of the last attempt once the budget is spent', async () => {
		const answers = { [nodeId('a')]: { type: 'retryableFailure', reason: 'commandFailed', detail: 'park refused' } as SequencerActionResult<unknown> }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a')], executor(answers), new AbortController().signal)

		expect(report.results[0]).toMatchObject({ outcome: 'failed', reason: 'commandFailed', detail: 'park refused', attempts: 3 })
	})

	test('a fatal cause is never retried, whatever retryOn declares', async () => {
		const log: string[] = []
		const answers = { [nodeId('a')]: { type: 'fatalFailure', reason: 'removed', detail: 'mount' } as SequencerActionResult<unknown> }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a', undefined, { retryOn: ['removed', 'timeout'] })], executor(answers, log), new AbortController().signal)

		expect(log).toEqual([nodeId('a') + '#1'])
		expect(report.results[0]).toMatchObject({ outcome: 'failed', reason: 'removed', attempts: 1 })
	})

	test('an action asking for a pause is recorded as the failure it is', async () => {
		const answers = { [nodeId('a')]: { type: 'pause', detail: 'operator' } as SequencerActionResult<unknown> }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a')], executor(answers), new AbortController().signal)

		expect(report.results[0]).toMatchObject({ outcome: 'failed', reason: 'unexpectedState', detail: 'operator', attempts: 1 })
	})

	test('an attempt that outlives its timeout fails as a timeout and is retried', async () => {
		const log: string[] = []
		const answers = {
			[nodeId('a')]: async (attempt: number, signal: AbortSignal) => {
				if (attempt > 1) return COMPLETED
				await Bun.sleep(20)
				return signal.aborted ? ABORTED : COMPLETED
			},
		}
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a', { timeout: 0.005 })], executor(answers, log), new AbortController().signal)

		expect(report.results[0]).toMatchObject({ outcome: 'succeeded', attempts: 2 })
		expect(log).toEqual([nodeId('a') + '#1', 'delay:5000', nodeId('a') + '#2'])
	})

	test('an action that finished anyway is not turned into a timeout by its own deadline', async () => {
		const answers = {
			[nodeId('a')]: async () => {
				await Bun.sleep(20)
				return COMPLETED
			},
		}
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a', { required: true, timeout: 0.005 }, { maxAttempts: 1 })], executor(answers), new AbortController().signal)

		expect(report.results[0]).toMatchObject({ outcome: 'succeeded', attempts: 1 })
		expect(report.failure).toBeUndefined()
	})

	test('a deadline beyond the timer limit is reached in chunks instead of overflowing', async () => {
		const original = globalThis.setTimeout
		const delays: number[] = []

		globalThis.setTimeout = ((callback: () => void, delay: number) => {
			delays.push(delay)
			callback()
			return 0 as unknown as ReturnType<typeof setTimeout>
		}) as typeof globalThis.setTimeout

		try {
			const answers = { [nodeId('a')]: (_: number, signal: AbortSignal) => (signal.aborted ? ABORTED : COMPLETED) }
			const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a', { timeout: 5_000_000 }, { maxAttempts: 1 })], executor(answers), new AbortController().signal)

			expect(delays).toEqual([2_147_483_647, 2_147_483_647, 705_032_706])
			expect(report.results[0]).toMatchObject({ outcome: 'failed', reason: 'timeout' })
		} finally {
			globalThis.setTimeout = original
		}
	})

	test('the deadline aborts the attempt it belongs to', async () => {
		let aborted = false
		const answers = {
			[nodeId('a')]: async (_: number, signal: AbortSignal) => {
				await Bun.sleep(20)
				return signal.aborted ? ABORTED : COMPLETED
			},
		}
		const runner = executor(answers)
		const report = await runSequencerPipeline(
			{ continueOnFailure: true },
			[step('a', { timeout: 0.005 }, { maxAttempts: 1 })],
			{
				async run(step, attempt, signal) {
					signal.addEventListener('abort', () => (aborted = true), { once: true })
					return await runner.run(step, attempt, signal)
				},
				delay: (delay, signal) => runner.delay(delay, signal),
			},
			new AbortController().signal,
		)

		expect(aborted).toBeTrue()
		expect(report.results[0]).toMatchObject({ outcome: 'failed', reason: 'timeout' })
	})
})

describe('continuation', () => {
	test('continueOnFailure keeps the remaining optional actions running', async () => {
		const answers = { [nodeId('a')]: TIMED_OUT }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a'), step('b')], executor(answers), new AbortController().signal)

		expect(report.results[1]).toMatchObject({ outcome: 'succeeded' })
	})

	test('a failure with continueOnFailure false leaves the remaining optional actions notRun', async () => {
		const log: string[] = []
		const answers = { [nodeId('a')]: TIMED_OUT }
		const report = await runSequencerPipeline({ continueOnFailure: false }, [step('a'), step('b'), step('c')], executor(answers, log), new AbortController().signal)

		expect(report.results[1]).toMatchObject({ outcome: 'notRun', attempts: 0 })
		expect(report.results[2]).toMatchObject({ outcome: 'notRun', attempts: 0 })
		expect(log.some((entry) => entry.startsWith(nodeId('b')))).toBeFalse()
	})

	test('a required action is attempted even after an optional one interrupted the chain', async () => {
		const answers = { [nodeId('warm')]: TIMED_OUT }
		const steps = [step('warm'), step('cover'), step('park', { required: true })]
		const report = await runSequencerPipeline({ continueOnFailure: false }, steps, executor(answers), new AbortController().signal)

		expect(report.results.map((result) => result.outcome)).toEqual(['failed', 'notRun', 'succeeded'])
		expect(report.failure).toBeUndefined()
	})

	test('the first required failure becomes the failure of the pipeline and later ones do not overwrite it', async () => {
		const answers = { [nodeId('park')]: { type: 'retryableFailure', reason: 'alert', detail: 'park' } as SequencerActionResult<unknown>, [nodeId('cover')]: { type: 'retryableFailure', reason: 'busy', detail: 'cover' } as SequencerActionResult<unknown> }
		const steps = [step('park', { required: true }), step('cover', { required: true })]
		const report = await runSequencerPipeline({ continueOnFailure: true }, steps, executor(answers), new AbortController().signal)

		expect(report.failure).toEqual({ nodeId: nodeId('park'), reason: 'alert', detail: 'park' })
		expect(report.results[1]).toMatchObject({ outcome: 'failed', reason: 'busy' })
	})

	test('an optional failure never becomes the failure of the pipeline', async () => {
		const answers = { [nodeId('a')]: TIMED_OUT }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a')], executor(answers), new AbortController().signal)

		expect(report.failure).toBeUndefined()
	})
})

describe('commanded stop', () => {
	test('ends the pipeline and leaves the remaining actions notRun', async () => {
		const controller = new AbortController()
		const answers = {
			[nodeId('a')]: () => {
				controller.abort()
				return { type: 'fatalFailure', reason: 'aborted' } as SequencerActionResult<unknown>
			},
		}
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a'), step('b', { required: true })], executor(answers), controller.signal)

		expect(report.stopped).toBeTrue()
		expect(report.results.map((result) => result.outcome)).toEqual(['notRun', 'notRun'])
		expect(report.failure).toBeUndefined()
	})

	test('the wait between two attempts is handed the session signal', async () => {
		const controller = new AbortController()
		const seen: AbortSignal[] = []
		const runner = executor({ [nodeId('a')]: TIMED_OUT })
		const report = await runSequencerPipeline(
			{ continueOnFailure: true },
			[step('a', undefined, { maxAttempts: 2 })],
			{
				run(step, attempt, signal) {
					if (signal.aborted) return Promise.resolve<SequencerActionResult<unknown>>({ type: 'fatalFailure', reason: 'aborted' })
					return runner.run(step, attempt, signal)
				},
				delay(delay, signal) {
					seen.push(signal)
					controller.abort()
					return runner.delay(delay, signal)
				},
			},
			controller.signal,
		)

		expect(seen).toEqual([controller.signal])
		expect(report.stopped).toBeTrue()
	})

	test('a stop that landed before the attempt started is carried into it', async () => {
		const controller = new AbortController()
		const seen: boolean[] = []
		const runner = executor({ [nodeId('a')]: TIMED_OUT })
		const report = await runSequencerPipeline(
			{ continueOnFailure: true },
			[step('a', { timeout: 30 }), step('b')],
			{
				run(step, attempt, signal) {
					seen.push(signal.aborted)
					if (signal.aborted) return Promise.resolve<SequencerActionResult<unknown>>({ type: 'fatalFailure', reason: 'aborted' })
					return runner.run(step, attempt, signal)
				},
				delay(delay, signal) {
					controller.abort()
					return runner.delay(delay, signal)
				},
			},
			controller.signal,
		)

		expect(seen).toEqual([false, true])
		expect(report.results[1]).toMatchObject({ outcome: 'notRun' })
	})

	test('a declared stop gives up on the action without ending the pipeline', async () => {
		const answers = { [nodeId('park')]: { type: 'retryableFailure', reason: 'commandFailed', detail: 'park refused' } as SequencerActionResult<unknown> }
		const steps = [step('park', { required: true }, { onExhausted: 'stop' }), step('cover', { required: true })]
		const report = await runSequencerPipeline({ continueOnFailure: true }, steps, executor(answers), new AbortController().signal)

		expect(report.stopped).toBeFalse()
		expect(report.results.map((result) => result.outcome)).toEqual(['failed', 'succeeded'])
		expect(report.failure).toEqual({ nodeId: nodeId('park'), reason: 'commandFailed', detail: 'park refused' })
	})

	test('a failure that preceded the stop keeps its own cause', async () => {
		const controller = new AbortController()
		const answers = {
			[nodeId('a')]: () => {
				const answer = Promise.resolve<SequencerActionResult<unknown>>({ type: 'fatalFailure', reason: 'aborted', detail: 'camera' })

				void answer.then(() => void Promise.resolve().then(() => void Promise.resolve().then(() => controller.abort())))

				return answer
			},
		}
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a', { required: true })], executor(answers), controller.signal)

		expect(report.results[0]).toMatchObject({ outcome: 'failed', reason: 'aborted', detail: 'camera' })
		expect(report.failure).toEqual({ nodeId: nodeId('a'), reason: 'aborted', detail: 'camera' })
	})

	test('an abort with no command behind it is a failure of the action', async () => {
		const answers = { [nodeId('a')]: { type: 'fatalFailure', reason: 'aborted', detail: 'camera' } as SequencerActionResult<unknown> }
		const report = await runSequencerPipeline({ continueOnFailure: true }, [step('a', { required: true })], executor(answers), new AbortController().signal)

		expect(report.stopped).toBeFalse()
		expect(report.failure).toEqual({ nodeId: nodeId('a'), reason: 'aborted', detail: 'camera' })
	})
})
