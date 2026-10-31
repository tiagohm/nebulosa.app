import { expect, test } from 'bun:test'
import { SsdBusyError, SsdRequestQueue, SsdThrottledError, SsdTimeoutError } from './ssd'

// A task that ends when told to, and records whether it started and how it ended.
function deferred<T>() {
	const { promise, resolve, reject } = Promise.withResolvers<T>()
	const state = { started: false, aborted: false }
	const task = (signal: AbortSignal) => {
		state.started = true
		signal.addEventListener('abort', () => {
			state.aborted = true
		})
		return promise
	}
	return { task, resolve, reject, state }
}

// Lets the queue run what it scheduled.
const tick = () => Bun.sleep(0)

test('tasks run one at a time, in order', async () => {
	const queue = new SsdRequestQueue()
	const first = deferred<number>()
	const second = deferred<number>()
	const third = deferred<number>()
	const answers = Promise.allSettled([queue.run(first.task, { timeoutMs: 1000 }), queue.run(second.task, { timeoutMs: 1000 }), queue.run(third.task, { timeoutMs: 1000 })])

	await tick()
	expect(first.state.started).toBeTrue()
	expect(second.state.started).toBeFalse()

	first.resolve(1)
	await tick()
	expect(second.state.started).toBeTrue()
	expect(third.state.started).toBeFalse()

	second.reject(new Error('failed'))
	await tick()
	expect(third.state.started).toBeTrue()
	third.resolve(3)

	expect(await answers).toEqual([
		{ status: 'fulfilled', value: 1 },
		{ status: 'rejected', reason: new Error('failed') },
		{ status: 'fulfilled', value: 3 },
	])
})

test('the budget starts with the task, not with the wait', async () => {
	const queue = new SsdRequestQueue()
	const first = deferred<number>()
	const answer = queue.run(first.task, { timeoutMs: 1000 })
	const queued = queue.run(() => Promise.resolve(2), { timeoutMs: 10 })

	await Bun.sleep(30)
	first.resolve(1)
	expect(await answer).toBe(1)
	expect(await queued).toBe(2)
})

test('a task over its budget is stopped and frees the queue', async () => {
	const queue = new SsdRequestQueue()
	const slow = deferred<number>()
	const answer = queue.run(slow.task, { timeoutMs: 10 }).catch((e: unknown) => e)
	const next = queue.run(() => Promise.resolve(2), { timeoutMs: 1000 })

	expect(await answer).toBeInstanceOf(SsdTimeoutError)
	expect((await answer) as Error).toHaveProperty('name', 'TimeoutError')
	expect(slow.state.aborted).toBeTrue()
	expect(await next).toBe(2)
})

test('a turn that takes too long is refused', async () => {
	const queue = new SsdRequestQueue({ waitMs: 10 })
	const running = deferred<number>()
	const waiting = deferred<number>()
	void queue.run(running.task, { timeoutMs: 1000 })
	const answer = await queue.run(waiting.task, { timeoutMs: 1000 }).catch((e: unknown) => e)

	expect(answer).toBeInstanceOf(SsdBusyError)
	expect(waiting.state.started).toBeFalse()
	running.resolve(1)
})

test('callers of the same key share one task, which only stops with the last one', async () => {
	const queue = new SsdRequestQueue()
	const shared = deferred<number>()
	const unused = deferred<number>()
	const first = new AbortController()
	const second = new AbortController()
	const left = queue.run(shared.task, { timeoutMs: 1000, key: 'page', signal: first.signal }).catch((e: unknown) => e)
	const stayed = queue.run(unused.task, { timeoutMs: 1000, key: 'page', signal: second.signal })

	await tick()
	expect(shared.state.started).toBeTrue()
	expect(unused.state.started).toBeFalse()

	first.abort(new Error('left'))
	expect(await left).toEqual(new Error('left'))
	expect(shared.state.aborted).toBeFalse()

	shared.resolve(1)
	expect(await stayed).toBe(1)

	// The key is free again once the task ended.
	expect(await queue.run(() => Promise.resolve(2), { timeoutMs: 1000, key: 'page' })).toBe(2)
})

test('the last caller to leave stops a running task and removes a queued one', async () => {
	const queue = new SsdRequestQueue()
	const running = deferred<number>()
	const queued = deferred<number>()
	const stop = new AbortController()
	const cancel = new AbortController()
	const answers = [queue.run(running.task, { timeoutMs: 1000, signal: stop.signal }), queue.run(queued.task, { timeoutMs: 1000, signal: cancel.signal })].map((e) => e.catch((e: unknown) => e))

	await tick()
	cancel.abort(new Error('cancelled'))
	expect(await answers[1]).toEqual(new Error('cancelled'))

	stop.abort(new Error('stopped'))
	expect(await answers[0]).toEqual(new Error('stopped'))
	expect(running.state.aborted).toBeTrue()
	await tick()
	expect(queued.state.started).toBeFalse()

	expect(await queue.run(() => Promise.resolve(3), { timeoutMs: 1000 })).toBe(3)
})

test('an aborted signal never queues', async () => {
	const queue = new SsdRequestQueue()
	const task = deferred<number>()
	const answer = await queue.run(task.task, { timeoutMs: 1000, signal: AbortSignal.abort(new Error('gone')) }).catch((e: unknown) => e)

	expect(answer).toEqual(new Error('gone'))
	await tick()
	expect(task.state.started).toBeFalse()
})

test('requests carry the identity of the client', async () => {
	const seen: (string | null)[] = []
	const queue = new SsdRequestQueue({
		fetch: ((_: string, init: RequestInit) => {
			seen.push(new Headers(init.headers).get('User-Agent'))
			return Promise.resolve(Response.json({}))
		}) as unknown as typeof fetch,
	})

	await queue.run((signal) => queue.fetch('https://ssd-api.jpl.nasa.gov/', signal), { timeoutMs: 1000 })
	queue.identify('1.2.3')
	await queue.run((signal) => queue.fetch('https://ssd-api.jpl.nasa.gov/', signal), { timeoutMs: 1000 })

	expect(seen).toEqual(['Nebulosa (+https://github.com/tiagohm/nebulosa.app)', 'Nebulosa/1.2.3 (+https://github.com/tiagohm/nebulosa.app)'])
})

test('a throttling answer pauses the queue instead of being retried', async () => {
	let now = 1_000
	let calls = 0
	const queue = new SsdRequestQueue({
		now: () => now,
		fetch: (() => {
			calls++
			return Promise.resolve(new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
		}) as unknown as typeof fetch,
	})
	const request = () => queue.run((signal) => queue.fetch('https://ssd-api.jpl.nasa.gov/', signal), { timeoutMs: 1000 })

	const blocker = request().catch((e: unknown) => e)
	const waiting = queue.run(() => Promise.resolve(1), { timeoutMs: 1000 }).catch((e: unknown) => e)
	expect(await blocker).toBeInstanceOf(SsdThrottledError)
	expect(((await blocker) as SsdThrottledError).retryAfter).toBe(60_000)
	expect(await waiting).toBeInstanceOf(SsdThrottledError)

	now += 30_000
	const refused = (await request().catch((e: unknown) => e)) as SsdThrottledError
	expect(refused).toBeInstanceOf(SsdThrottledError)
	expect(refused.retryAfter).toBe(30_000)
	expect(calls).toBe(1)

	now += 30_000
	await request().catch((e: unknown) => e)
	expect(calls).toBe(2)
})

test('a 503 without a usable Retry-After pauses for the default time', async () => {
	const queue = new SsdRequestQueue({ fetch: (() => Promise.resolve(new Response('', { status: 503 }))) as unknown as typeof fetch })
	const answer = (await queue.run((signal) => queue.fetch('https://ssd-api.jpl.nasa.gov/', signal), { timeoutMs: 1000 }).catch((e: unknown) => e)) as SsdThrottledError

	expect(answer).toBeInstanceOf(SsdThrottledError)
	expect(answer.retryAfter).toBe(30_000)
})
