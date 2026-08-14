import { afterEach, describe, expect, test } from 'bun:test'
import { WebSocketMessageHandler } from 'src/api/message'
import type { Messager } from 'src/api/message'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter } from 'src/api/resource'
import { SequencerHandler } from 'src/api/sequencer'
import { SequencerChannel } from 'src/api/sequencer.channel'
import { compile, sequencerPlanNodes } from 'src/api/sequencer.compiler'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { AnySequencerActionHandler } from 'src/api/sequencer.registry'
import { SequencerRuntime } from 'src/api/sequencer.runtime'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import { canonical, services } from './sequencer.fixture'

interface Received {
	readonly type: string
	readonly payload: unknown
}

function socket(received: Received[]): Messager {
	return {
		sendText: (data: string) => {
			const separator = data.indexOf('@')
			received.push({ type: data.slice(0, separator), payload: data.length > separator + 1 ? (JSON.parse(data.slice(separator + 1)) as unknown) : undefined })
		},
	}
}

function types(received: readonly Received[], type: string) {
	return received.filter((it) => it.type === type)
}

function blockTypes() {
	const compilation = compile(canonical())
	const types = new Set<string>()

	if (compilation.ok) {
		for (const node of sequencerPlanNodes(compilation.plan.root)) {
			if (node.kind === 'action') types.add(node.type)
		}
	}

	return types
}

const channels: SequencerChannel[] = []

function environment(execute: AnySequencerActionHandler['execute']) {
	const received: Received[] = []
	const wsm = new WebSocketMessageHandler()
	const registry = new SequencerBlockRegistry()
	const store = new InMemorySequencerStore()
	const coordinator = new OperationCoordinator(new ResourceArbiter())
	const runtime = new SequencerRuntime({ store, registry, coordinator, ...services(), resolve: (_, deviceId) => ({ key: `logical:${deviceId}` }), observe: (change) => channel.changed(change) })
	const handler = new SequencerHandler({ store, runtime, registry, observe: (sessionId) => runtime.observation(sessionId) })
	const channel = new SequencerChannel({ wsm, snapshot: (sessionId) => handler.snapshot(sessionId), sessions: () => store.sessions(), interval: 20 })

	for (const type of blockTypes()) registry.register({ type, version: 1, validate: (configuration) => ({ ok: true, configuration }), resources: () => [{ role: 'camera' }], execute })

	channels.push(channel)

	return { received, wsm, store, runtime, handler, channel, client: socket(received) }
}

afterEach(() => {
	for (const channel of channels) channel.close()
	channels.length = 0
})

describe('fanout', () => {
	test('publishes the consolidated state and the cadence of a running session', async () => {
		const running = Promise.withResolvers<void>()
		const { received, wsm, handler, client } = environment(async (context) => {
			context.progress({ fraction: 0.5, detail: 'connecting' })
			await running.promise
			return { type: 'completed', value: undefined }
		})

		wsm.open(client)

		const created = handler.createSession(handler.create(canonical())!.id)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const id = created.session.id

		const announced = types(received, 'sequencer:session')

		expect(announced).toHaveLength(1)
		expect(types(received, 'sequencer:progress')).toBeEmpty()
		// The announcement of a creation is derived through the same plan the answer of that same call carries, so
		// it names the target and the work of the session instead of describing a session with no plan behind it.
		expect(created.session.target).toBeDefined()
		expect(created.session.capture.requiredSlots).toBeGreaterThan(0)
		expect(announced[0].payload).toMatchObject({ id, target: created.session.target, capture: { requiredSlots: created.session.capture.requiredSlots } })

		handler.start(id)

		await Bun.sleep(50)

		const progress = types(received, 'sequencer:progress')

		expect(progress.length).toBeGreaterThan(1)
		expect((progress.at(-1)!.payload as { foreground?: { detail?: string } }).foreground?.detail).toBe('connecting')
		expect(types(received, 'sequencer:event')).not.toBeEmpty()

		running.resolve()

		await handler.stop(id)
		await Bun.sleep(50)

		const emitted = types(received, 'sequencer:progress').length
		const session = types(received, 'sequencer:session')
		const last = session.at(-1)!.payload as { state: string; foreground?: unknown }

		expect(last.state).toBe('stopped')
		// Nothing is in the foreground of a session that ended, and this is the last message published for it.
		expect(last.foreground).toBeUndefined()
		expect((session.at(-2)!.payload as { state: string; foreground?: { state: string } }).foreground?.state).toBe('cancelling')

		await Bun.sleep(60)

		expect(types(received, 'sequencer:progress')).toHaveLength(emitted)
	})

	test('greets a socket with the sessions that have not ended and never replays progress', async () => {
		const { received, wsm, handler, channel, client } = environment(() => Promise.resolve({ type: 'completed', value: undefined }))
		const first = handler.createSession(handler.create(canonical())!.id)
		const second = handler.createSession(handler.create({ ...canonical(), id: 'definition-2' })!.id)

		expect(first.ok).toBeTrue()
		expect(second.ok).toBeTrue()

		if (!first.ok || !second.ok) return

		handler.start(first.session.id)

		await handler.stop(first.session.id)

		received.length = 0

		wsm.open(client)

		await Bun.sleep(10)

		const greeting = types(received, 'sequencer:session')

		expect(greeting).toHaveLength(1)
		expect((greeting[0].payload as { id: string; lastEventSequence: number }).id).toBe(second.session.id)
		expect(types(received, 'sequencer:progress')).toBeEmpty()

		channel.close()

		expect(handler.snapshot(first.session.id)?.state).toBe('stopped')
	})
})
