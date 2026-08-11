import { describe, expect, test } from 'bun:test'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { SequencerActionHandler } from 'src/api/sequencer.registry'

interface WaitConfiguration {
	readonly duration: number
}

function waitHandler(version: number = 1): SequencerActionHandler<WaitConfiguration, number> {
	return {
		type: 'wait',
		version,
		validate: (configuration) => {
			const duration = (configuration as Partial<WaitConfiguration>).duration
			return typeof duration === 'number' && duration >= 0 ? { ok: true, configuration: { duration } } : { ok: false, issues: [{ path: 'duration', message: 'duration must be a non-negative number of seconds' }] }
		},
		resources: () => [],
		execute: (_, configuration) => Promise.resolve({ type: 'completed', value: configuration.duration }),
	}
}

function captureHandler(): SequencerActionHandler<Record<string, never>, void> {
	return {
		type: 'capture',
		version: 4,
		validate: () => ({ ok: true, configuration: {} }),
		resources: () => [{ role: 'camera' }, { role: 'wheel' }],
		execute: () => Promise.resolve({ type: 'completed', value: undefined }),
	}
}

describe('sequencer block registry', () => {
	test('registers handlers of unrelated configuration types and looks them up', () => {
		const registry = new SequencerBlockRegistry()

		registry.register(waitHandler())
		registry.register(captureHandler())

		expect(registry.types()).toEqual(['capture', 'wait'])
		expect(registry.handler('wait')?.version).toBe(1)
		expect(registry.handler('capture')?.resources({})).toEqual([{ role: 'camera' }, { role: 'wheel' }])
		expect(registry.handler('dither')).toBeUndefined()
	})

	test('refuses a second handler for the same block type', () => {
		const registry = new SequencerBlockRegistry()

		registry.register(waitHandler())

		expect(() => registry.register(waitHandler(2))).toThrowError('block type already registered: wait (version 1)')
		expect(registry.handler('wait')?.version).toBe(1)
	})

	test('resolves versions when the caller has none, as the compiler does', () => {
		const registry = new SequencerBlockRegistry()

		registry.register(waitHandler(3))
		registry.register(captureHandler())

		expect(registry.resolve([{ type: 'wait' }, { type: 'capture' }])).toEqual({ ok: true, versions: { wait: 3, capture: 4 } })
	})

	test('resolves recorded versions when they still match, as a session start does', () => {
		const registry = new SequencerBlockRegistry()

		registry.register(waitHandler(3))

		expect(registry.resolve([{ type: 'wait', version: 3 }])).toEqual({ ok: true, versions: { wait: 3 } })
	})

	test('reports every unresolvable type instead of the first one', () => {
		const registry = new SequencerBlockRegistry()

		registry.register(waitHandler(3))

		const resolution = registry.resolve([{ type: 'wait', version: 2 }, { type: 'dither', version: 1 }, { type: 'capture' }])

		expect(resolution.ok).toBeFalse()

		if (resolution.ok) return

		expect(resolution.issues).toEqual([
			{ type: 'wait', kind: 'versionMismatch', expected: 2, actual: 3 },
			{ type: 'dither', kind: 'missing', expected: 1 },
			{ type: 'capture', kind: 'missing', expected: undefined },
		])
	})

	test('resolves nothing for an empty plan', () => {
		expect(new SequencerBlockRegistry().resolve([])).toEqual({ ok: true, versions: {} })
	})

	test('narrows a valid configuration and rejects an invalid one with a path', () => {
		const handler = waitHandler()
		const context = { nodeId: 'node-1', devices: { camera: 'camera-1' } }

		expect(handler.validate({ duration: 5 }, context)).toEqual({ ok: true, configuration: { duration: 5 } })
		expect(handler.validate({ duration: -1 }, context)).toEqual({ ok: false, issues: [{ path: 'duration', message: 'duration must be a non-negative number of seconds' }] })
	})
})
