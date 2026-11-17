import { expect, test } from 'bun:test'
import { runPooledWorkerJob, runWorkerJob, WorkerPool } from './workerjob'

// Fake worker answering every request with one message of the job a few milliseconds later.
class FakeWorker extends EventTarget {
	terminated = false

	postMessage() {
		setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { jobId: 'job', value: 42 } })), 5)
	}

	terminate() {
		this.terminated = true
	}
}

function job(receive: (response: { readonly jobId: string; readonly value: number }, settle: { resolve: (value: number) => void; reject: (error: Error) => void }) => void) {
	const worker = new FakeWorker()
	const run = runWorkerJob({
		start: () => worker as unknown as Worker,
		request: {},
		jobId: 'job',
		signal: new AbortController().signal,
		stallTimeout: 10000,
		stalled: () => new Error('stalled'),
		crashed: () => new Error('crashed'),
		receive,
	})
	return { worker, run }
}

test('a job settles with what its receiver answers and terminates its worker', async () => {
	const { worker, run } = job((response, settle) => settle.resolve(response.value))
	expect(await run).toBe(42)
	expect(worker.terminated).toBeTrue()
})

test('a receiver that throws fails the job at once instead of leaving it to stall', async () => {
	const { worker, run } = job(() => {
		throw new Error('unreadable answer')
	})
	const started = performance.now()
	await expect(run).rejects.toThrow('unreadable answer')
	expect(performance.now() - started).toBeLessThan(1000)
	expect(worker.terminated).toBeTrue()
})

// Fake pooled worker answering each request with what answer returns, after a few milliseconds.
class FakePooledWorker extends EventTarget {
	terminated = false
	jobs = 0

	constructor(readonly answer: (request: { readonly jobId: string }) => { readonly jobId: string; readonly value: number } | undefined) {
		super()
	}

	postMessage(request: { readonly jobId: string }) {
		this.jobs++
		const response = this.answer(request)
		if (response) setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: response })), 5)
	}

	terminate() {
		this.terminated = true
	}
}

function pooled(answer: FakePooledWorker['answer'] = (request) => ({ jobId: request.jobId, value: 7 })) {
	const started: FakePooledWorker[] = []
	const pool = new WorkerPool(() => {
		const worker = new FakePooledWorker(answer)
		started.push(worker)
		return worker as unknown as Worker
	})
	const run = (jobId: string, timeout = 1000) =>
		runPooledWorkerJob<{ readonly jobId: string; readonly value: number }, number>({
			pool,
			request: { jobId },
			timeout,
			timedOut: () => new Error('timed out'),
			crashed: () => new Error('crashed'),
			receive: (response, settle) => {
				if (response.jobId === jobId) settle.resolve(response.value)
			},
		})
	return { pool, started, run }
}

test('a pooled worker that answered is kept for the next job', async () => {
	const { started, run } = pooled()
	expect(await run('a')).toBe(7)
	expect(await run('b')).toBe(7)
	expect(started).toHaveLength(1)
	expect(started[0].jobs).toBe(2)
	expect(started[0].terminated).toBeFalse()
})

test('a pooled worker that ran out of time is terminated and replaced', async () => {
	const { started, run } = pooled(() => undefined)
	await expect(run('a', 20)).rejects.toThrow('timed out')
	expect(started[0].terminated).toBeTrue()
	await expect(run('b', 20)).rejects.toThrow('timed out')
	expect(started).toHaveLength(2)
})

test('an idle worker that dies is dropped, and a disposed pool keeps none', async () => {
	const { pool, started, run } = pooled()
	await run('a')
	started[0].dispatchEvent(new Event('error'))
	expect(started[0].terminated).toBeTrue()
	await run('b')
	expect(started).toHaveLength(2)

	pool[Symbol.dispose]()
	expect(started[1].terminated).toBeTrue()
	await run('c')
	expect(started[2].terminated).toBeTrue()
})
