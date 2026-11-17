import { expect, test } from 'bun:test'
import { runWorkerJob } from './workerjob'

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
