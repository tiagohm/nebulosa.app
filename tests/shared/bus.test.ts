import { expect, test } from 'bun:test'
import { EventBus } from 'src/shared/bus'

test('emits only once for duplicate subscriptions', () => {
	const bus = new EventBus()
	const values: number[] = []
	const callback = (value: number) => values.push(value)

	const unsubscribe = bus.subscribe('topic', callback)
	bus.subscribe('topic', callback)

	bus.emitSync('topic', 1)
	unsubscribe()
	bus.emitSync('topic', 2)

	expect(values).toEqual([1])
	expect(bus.hasSubscribersForTopic('topic')).toBe(false)
})

test('removes one-time subscriptions before invoking the callback', () => {
	const bus = new EventBus()
	let calls = 0

	bus.subscribeOnce('topic', () => {
		calls++
		bus.emitSync('topic', undefined)
	})

	bus.emitSync('topic', undefined)

	expect(calls).toBe(1)
	expect(bus.hasSubscribersForTopic('topic')).toBe(false)
})

test('skips async scheduling for empty topics', async () => {
	const bus = new EventBus()
	const runtime = globalThis as typeof globalThis & { queueMicrotask: typeof queueMicrotask }
	const queueMicrotaskOriginal = runtime.queueMicrotask
	const values: number[] = []
	let schedules = 0

	runtime.queueMicrotask = (callback) => {
		schedules++
		queueMicrotaskOriginal(callback)
	}

	try {
		bus.emit('empty', 0)
		expect(schedules).toBe(0)

		bus.subscribe<number>('topic', (value) => values.push(value))
		bus.emit('topic', 1)
		bus.emitAll('topic', [2, 3])

		expect(schedules).toBe(2)

		await Promise.resolve()

		expect(values).toEqual([1, 2, 3])
	} finally {
		runtime.queueMicrotask = queueMicrotaskOriginal
	}
})
