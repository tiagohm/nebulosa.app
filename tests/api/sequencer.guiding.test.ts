import { describe, expect, test } from 'bun:test'
import { sequencerDitherHandler } from 'src/api/sequencer.guiding'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationFailureReason } from '#/orchestration'
import type { SequencerDevices, SequencerDither } from '#/sequencer'

type DitherConfiguration = Omit<SequencerDither, 'enabled'>

interface Command {
	readonly name: string
	readonly detail?: unknown
}

function ditherConfiguration(overrides?: Partial<DitherConfiguration>): DitherConfiguration {
	return {
		amount: 3,
		raOnly: false,
		beforeFirstFrame: false,
		afterMeridianFlip: true,
		afterFilterChange: false,
		everyFrames: 1,
		everyTime: 0,
		settle: { tolerance: 1.5, time: 10, timeout: 60, minimumFrames: 3 },
		retry: { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' },
		onFailure: 'continue',
		...overrides,
	}
}

function actionContext(guider?: string): SequencerActionContext {
	return {
		sessionId: 'session-1',
		nodeId: 'target[m42].dither',
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

function guidingServices(commands: Command[], running: boolean, failure?: OperationFailureReason): SequencerGuidingServices {
	return {
		guiderCommander: {
			running: (id: string) => {
				commands.push({ name: 'running', detail: id })
				return running
			},
			dither: (id: string, request: unknown, options: { timeout: number; onPhase: (phase: string) => void }) => {
				commands.push({ name: 'dither', detail: { id, request, timeout: options.timeout } })
				options.onPhase('settling')
				return Promise.resolve(failure === undefined ? successfulOperationResult(undefined) : failedOperationResult(failure, 'boom'))
			},
		} as unknown as SequencerGuidingServices['guiderCommander'],
	}
}

describe('dither block', () => {
	test('holds no lease and accepts a definition with no guiding role of its own', () => {
		const handler = sequencerDitherHandler({} as never)

		expect(handler.resources(ditherConfiguration())).toEqual([])
		expect(handler.validate(ditherConfiguration(), { nodeId: 'target[m42].dither', devices: {} as SequencerDevices })).toEqual({ ok: true, configuration: ditherConfiguration() })
	})

	test('displaces the guide star with the declared request and the settle it is willing to wait for', async () => {
		const commands: Command[] = []
		const handler = sequencerDitherHandler(guidingServices(commands, true))
		const result = await handler.execute(actionContext('guider-1'), ditherConfiguration({ amount: 5, raOnly: true }))

		expect(result).toEqual({ type: 'completed', value: { amount: 5, raOnly: true, guider: 'guider-1' } })
		expect(commands).toEqual([
			{ name: 'running', detail: 'guider-1' },
			{ name: 'dither', detail: { id: 'guider-1', request: { amount: 5, raOnly: true }, timeout: 60000 } },
		])
	})

	test('skips a session that guides through nothing without touching the commander', async () => {
		const commands: Command[] = []
		const handler = sequencerDitherHandler(guidingServices(commands, true))

		expect(await handler.execute(actionContext(), ditherConfiguration())).toEqual({ type: 'skipped', detail: 'the session guides through no guider' })
		expect(commands).toEqual([])
	})

	test('skips a guider that has no lock to displace', async () => {
		const commands: Command[] = []
		const handler = sequencerDitherHandler(guidingServices(commands, false))

		expect(await handler.execute(actionContext('guider-1'), ditherConfiguration())).toEqual({ type: 'skipped', detail: 'the guider is not guiding' })
		expect(commands.map((command) => command.name)).toEqual(['running'])
	})

	test('maps a dither that did not settle to a retry and a stopped session to a terminal failure', async () => {
		const failing = (reason: OperationFailureReason) => sequencerDitherHandler(guidingServices([], true, reason))

		expect(await failing('timeout').execute(actionContext('guider-1'), ditherConfiguration())).toEqual({ type: 'retryableFailure', reason: 'timeout', detail: 'the dither did not settle: boom' })
		expect(await failing('aborted').execute(actionContext('guider-1'), ditherConfiguration())).toEqual({ type: 'fatalFailure', reason: 'aborted', detail: 'the dither did not settle: boom' })
	})
})
