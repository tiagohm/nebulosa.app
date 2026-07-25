import { describe, expect, test } from 'bun:test'
import { abortableDelay, waitForDeviceState } from 'src/api/operation.wait'

function rejectUnknown(value: unknown): Promise<never> {
	const rejected = Promise.withResolvers<never>()
	rejected.reject(value)
	return rejected.promise
}

describe('operation waits', () => {
	test('aborts a delay with the signal reason', async () => {
		const controller = new AbortController()
		const delayed = abortableDelay(1000, controller.signal)

		controller.abort('disconnected')

		expect(await delayed).toEqual({ ok: false, reason: 'disconnected' })
	})

	test('subscribes before sending a command and resolves from observed state', async () => {
		const controller = new AbortController()
		const listeners = new Set<(state: string) => void>()
		let state = 'idle'
		const result = waitForDeviceState({
			device: {},
			signal: controller.signal,
			timeout: 1000,
			subscribe: (listener) => {
				listeners.add(listener)
				return () => listeners.delete(listener)
			},
			current: () => state,
			evaluate: (update) => (update === 'ready' ? 'success' : 'pending'),
			command: () => {
				expect(listeners.size).toBe(1)
				state = 'ready'
				for (const listener of listeners) listener(state)
			},
		})

		expect(await result).toEqual({ ok: true, value: 'ready' })
		expect(listeners.size).toBe(0)
	})

	test('lets command failure win over a synchronous terminal event', async () => {
		const listeners = new Set<(state: string) => void>()
		const result = waitForDeviceState({
			device: {},
			signal: new AbortController().signal,
			timeout: 1000,
			subscribe: (listener) => {
				listeners.add(listener)
				return () => listeners.delete(listener)
			},
			current: () => 'ready',
			evaluate: (update) => (update === 'ready' ? 'success' : 'pending'),
			command: () => {
				for (const listener of listeners) listener('ready')
				throw new Error('send failed')
			},
		})

		expect(await result).toEqual({ ok: false, reason: 'commandFailed', error: 'send failed' })
		expect(listeners.size).toBe(0)
	})

	test('normalizes a symbol rejected by the command', async () => {
		const result = waitForDeviceState({
			device: {},
			signal: new AbortController().signal,
			timeout: 1000,
			subscribe: () => () => {},
			current: () => 'idle',
			evaluate: () => 'pending',
			command: () => rejectUnknown(Symbol('send failed')),
		})

		expect(await result).toEqual({ ok: false, reason: 'commandFailed', error: 'Symbol(send failed)' })
	})

	test('falls back when a rejected value cannot be converted to text', async () => {
		const failure = {
			[Symbol.toPrimitive]: () => {
				throw new Error('conversion failed')
			},
		}
		const result = waitForDeviceState({
			device: {},
			signal: new AbortController().signal,
			timeout: 1000,
			subscribe: () => () => {},
			current: () => 'idle',
			evaluate: () => 'pending',
			command: () => rejectUnknown(failure),
		})

		expect(await result).toEqual({ ok: false, reason: 'commandFailed', error: 'Unknown error' })
	})

	test('runs abort cleanup on timeout and removes every listener', async () => {
		const controller = new AbortController()
		const listeners = new Set<(state: string) => void>()
		let aborts = 0
		const result = waitForDeviceState({
			device: {},
			signal: controller.signal,
			timeout: 5,
			subscribe: (listener) => {
				listeners.add(listener)
				return () => listeners.delete(listener)
			},
			current: () => 'busy',
			evaluate: () => 'pending',
			command: () => {},
			abort: () => {
				aborts++
			},
		})

		expect(await result).toEqual({ ok: false, reason: 'timeout' })
		expect(aborts).toBe(1)
		expect(listeners.size).toBe(0)
	})
})
