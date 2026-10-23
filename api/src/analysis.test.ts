import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type AnalysisEntry, type AnalysisJob, AnalysisScheduler, MAX_QUEUED, SESSION_CAPACITY } from './analysis'
import { ImageStore } from './images'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-analysis-test-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

let files = 0

// Writes an 8×8 8-bit FITS file and returns its path.
function writeImage() {
	const cards = ['SIMPLE  =                    T', 'BITPIX  =                    8', 'NAXIS   =                    2', 'NAXIS1  =                    8', 'NAXIS2  =                    8', 'END']
	const header = Buffer.alloc(2880, ' ')
	for (const [i, card] of cards.entries()) header.write(card.padEnd(80), i * 80, 'latin1')
	const path = join(root, `image-${files++}.fits`)
	writeFileSync(path, Buffer.concat([header, Buffer.alloc(2880)]))
	return path
}

type Provider = 'fast' | 'slow'

interface Job extends AnalysisJob {
	readonly provider: Provider
	readonly label: string
	readonly error?: string
}

interface Preparation {
	readonly provider: Provider
}

// Creates a scheduler whose jobs run until the test settles them, one fast and one slow job at a time.
function setup() {
	const images = new ImageStore()
	const published: Job[] = []
	const running = new Map<string, { readonly entry: AnalysisEntry<Job, Preparation>; readonly finish: (result: string) => void; readonly fail: (error: Error) => void }>()

	const scheduler = new AnalysisScheduler<Job, string, Preparation, Provider>(images, {
		limits: { fast: 1, slow: 1 },
		provider: (preparation) => preparation.provider,
		execute: (entry) => {
			const { promise, resolve, reject } = Promise.withResolvers<string>()
			entry.controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
			running.set(entry.job.label, { entry, finish: resolve, fail: reject })
			return promise.then((result) => ({ patch: {}, result }))
		},
		failed: (entry, error) => ({ state: entry.controller.signal.aborted ? 'cancelled' : 'failed', error: (error as Error).message }),
		cancelled: () => ({ error: 'cancelled while waiting' }),
		publish: (job) => published.push(job),
	})

	// Queues a job labelled label of a provider, in a group (manual by default).
	const enqueue = (imageId: string, label: string, provider: Provider = 'fast', group = 'manual', key = label) => scheduler.enqueue(imageId, { provider }, key, { provider, label }, group === 'manual' ? 'manual' : 'capture', group)!

	return { images, scheduler, published, running, enqueue }
}

// Lets the scheduler react to settled promises.
const tick = () => Bun.sleep(0)

describe('scheduling', () => {
	test('runs one job per provider at a time, manual jobs first', async () => {
		const { images, scheduler, running, enqueue } = setup()
		const { id } = await images.open(writeImage())

		enqueue(id, 'f1')
		enqueue(id, 'c1', 'fast', 'session')
		enqueue(id, 'f2')
		enqueue(id, 's1', 'slow')

		expect([...running.keys()]).toEqual(['f1', 's1'])

		running.get('f1')!.finish('done')
		await tick()

		expect([...running.keys()]).toContain('f2')
		expect([...running.keys()]).not.toContain('c1')
		expect(scheduler.job(running.get('f1')!.entry.job.jobId)!.state).toBe('completed')
	})

	test('serves the capture groups in turn', async () => {
		const { images, running, enqueue } = setup()
		const { id } = await images.open(writeImage())

		enqueue(id, 'a1', 'fast', 'a')
		enqueue(id, 'a2', 'fast', 'a')
		enqueue(id, 'b1', 'fast', 'b')

		running.get('a1')!.finish('done')
		await tick()

		expect(running.has('b1')).toBeTrue()
		expect(running.has('a2')).toBeFalse()
	})

	test('refuses a job beyond MAX_QUEUED waiting ones', async () => {
		const { images, scheduler, enqueue } = setup()
		const { id } = await images.open(writeImage())

		// The first job runs, so MAX_QUEUED more wait.
		for (let i = 0; i <= MAX_QUEUED; i++) {
			expect(scheduler.full()).toBeFalse()
			enqueue(id, `j${i}`)
		}

		expect(scheduler.full()).toBeTrue()
	})
})

describe('results', () => {
	test('answers an equivalent job from its key', async () => {
		const { images, scheduler, running, enqueue } = setup()
		const { id } = await images.open(writeImage())

		const job = enqueue(id, 'f1', 'fast', 'manual', 'same')
		expect(scheduler.active('same')?.jobId).toBe(job.jobId)
		expect(scheduler.cached(id, 'same')).toBeUndefined()

		running.get('f1')!.finish('result')
		await tick()

		expect(scheduler.active('same')).toBeUndefined()
		expect(scheduler.cached(id, 'same')?.result).toBe('result')
		expect(scheduler.cached(id, 'other')).toBeUndefined()
		expect(scheduler.result(job.jobId)).toBe('result')
	})

	test('keeps the 8 latest results of an image and drops them when the image is released', async () => {
		const { images, scheduler, running, enqueue } = setup()
		const { id } = await images.open(writeImage())
		const jobs: Job[] = []

		for (let i = 0; i < 10; i++) {
			jobs.push(enqueue(id, `f${i}`))
			running.get(`f${i}`)!.finish(`r${i}`)
			await tick()
		}

		expect(scheduler.results(id).map((job) => job.label)).toEqual(['f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9'])
		expect(scheduler.result(jobs[0].jobId)).toBeUndefined()

		images.close(id)

		expect(scheduler.results(id)).toEqual([])
		expect(scheduler.result(jobs[9].jobId)).toBeUndefined()
	})

	test('retains the image of a running job until it ends', async () => {
		const { images, scheduler, running, enqueue } = setup()
		const { id } = await images.open(writeImage())

		const job = enqueue(id, 'f1')
		images.close(id)

		expect(images.name(id)).toBeUndefined()
		expect(await images.detectionFile(id)).toBeDefined()

		running.get('f1')!.finish('result')
		await tick()

		expect(await images.detectionFile(id)).toBeUndefined()
		expect(scheduler.result(job.jobId)).toBeUndefined()
	})
})

describe('cancellation', () => {
	test('ends a waiting job at once and aborts a running one', async () => {
		const { images, scheduler, enqueue } = setup()
		const { id } = await images.open(writeImage())

		const first = enqueue(id, 'f1')
		const second = enqueue(id, 'f2')

		expect(scheduler.cancel(second.jobId)).toBeTrue()
		expect(scheduler.job(second.jobId)).toMatchObject({ state: 'cancelled', error: 'cancelled while waiting' })

		const ended = scheduler.ended(first.jobId)
		expect(scheduler.cancel(first.jobId)).toBeTrue()
		expect(await ended).toMatchObject({ state: 'cancelled', error: 'aborted' })
		expect(scheduler.cancel(first.jobId)).toBeFalse()
	})

	test('records the failure of a job', async () => {
		const { images, scheduler, running, enqueue } = setup()
		const { id } = await images.open(writeImage())

		const job = enqueue(id, 'f1')
		const settled = scheduler.settled(job.jobId)!
		running.get('f1')!.fail(new Error('broken'))

		expect(await settled).toBeUndefined()
		expect(scheduler.job(job.jobId)).toMatchObject({ state: 'failed', error: 'broken' })
	})
})

describe('capture sessions', () => {
	test('replaces the waiting job of a group with the latest one', async () => {
		const { images, scheduler, enqueue } = setup()
		const { id } = await images.open(writeImage())

		enqueue(id, 'busy')
		const older = scheduler.submitLatest(id, { provider: 'fast' }, 'k1', { provider: 'fast', label: 'older' }, 'session')
		const newer = scheduler.submitLatest(id, { provider: 'fast' }, 'k2', { provider: 'fast', label: 'newer' }, 'session')

		expect(older.skipped).toBe(0)
		expect(newer.skipped).toBe(1)
		expect(scheduler.job(older.job!.jobId)!.state).toBe('skipped')
		expect(scheduler.job(newer.job!.jobId)!.state).toBe('queued')
	})

	test('holds at most SESSION_CAPACITY frames of a session in flight', async () => {
		const { images, scheduler, running } = setup()
		const { id } = await images.open(writeImage())
		const signal = new AbortController().signal

		const held = Array.from({ length: SESSION_CAPACITY }, () => scheduler.tryReserve('session')!)
		expect(scheduler.tryReserve('session')).toBeUndefined()
		expect(scheduler.tryReserve('other')).toBeDefined()

		let granted = false
		const next = scheduler.reserve('session', signal).then((reservation) => {
			granted = true
			return reservation
		})

		const job = held[0].submit(id, { provider: 'fast' }, 'k', { provider: 'fast', label: 'frame' })!
		expect(scheduler.job(job.jobId)!.state).toBe('running')
		expect(held[0].submit(id, { provider: 'fast' }, 'k', { provider: 'fast', label: 'again' })).toBeUndefined()

		await tick()
		expect(granted).toBeFalse()

		running.get('frame')!.finish('result')
		expect(await next).toBeDefined()
	})

	test('gives up waiting for capacity when its signal aborts', async () => {
		const { scheduler } = setup()
		const controller = new AbortController()

		for (let i = 0; i < SESSION_CAPACITY; i++) scheduler.tryReserve('session')
		const waiting = scheduler.reserve('session', controller.signal)
		controller.abort()

		expect(await waiting).toBeUndefined()
	})
})
