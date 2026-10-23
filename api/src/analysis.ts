import type { DocumentSize, ImageStore } from './images'

// Scheduling shared by the analyses of image documents (star detection, plate solving): an in-memory queue of
// jobs, each measuring one document of the image store, run in arrival order under a concurrency limit per provider.
// At most MAX_QUEUED jobs wait. A job retains its image until it ends, so closing the document never pulls the pixels from under
// it. Completed results are kept in memory, grouped by image, until their image is released or the bounded store
// evicts them; ended jobs are kept for the snapshot. What a job does, how its failures are named, and how its
// changes are published belong to the service that owns the scheduler.

// Jobs waiting at most; a job beyond it is refused as queueFull.
export const MAX_QUEUED = 16

// Results kept per image, the most recent ones.
const RESULTS_PER_IMAGE = 8

// Results kept at most, least recently used evicted first.
const MAX_RESULTS = 256

// Ended jobs kept for the snapshot.
const RECENT_JOBS = 64

// State of an analysis job.
export type AnalysisJobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

// Fields every analysis job has; a service adds its request, origin, outcome, and summary.
export interface AnalysisJob {
	// Unique id of the job.
	readonly jobId: string
	// Image document analyzed.
	readonly imageId: string
	// Current state.
	readonly state: AnalysisJobState
	// Instant it was queued, Unix milliseconds.
	readonly queuedAt: number
	// Instant it started running, Unix milliseconds.
	readonly startedAt?: number
	// Instant it ended, Unix milliseconds.
	readonly endedAt?: number
}

// Fields of a job that its service supplies when it is queued.
export type AnalysisJobFields<J extends AnalysisJob> = Omit<J, keyof AnalysisJob>

// A job the scheduler knows about while it waits or runs.
export interface AnalysisEntry<J extends AnalysisJob, P> {
	// Published state, replaced on every change.
	job: J
	// Request and resolved provider settings.
	readonly preparation: P
	// Key of equivalent jobs: the same image and the same effective request.
	readonly key: string
	// Size of the retained image, in pixels.
	readonly size: DocumentSize
	// Aborted to cancel the job.
	readonly controller: AbortController
	// Settles once the job ended, with its result when it completed.
	readonly done: PromiseWithResolvers<AnalysisStoredResult<J, unknown> | undefined>
	// Instant it started running, performance.now() milliseconds.
	started?: number
}

// A completed job, its result, and the key of equivalent jobs.
export interface AnalysisStoredResult<J extends AnalysisJob, R> {
	// The job as it completed.
	readonly job: J
	// Its full result.
	readonly result: R
	// Key of equivalent jobs.
	readonly key: string
}

// What a job produced when it completed: the fields of its final state (its summary) and its full result.
export interface AnalysisCompletion<J extends AnalysisJob, R> {
	// Fields merged into the completed job.
	readonly patch: Partial<J>
	// Full result, kept with the job.
	readonly result: R
}

// How the owning service runs, names, and publishes its jobs.
export interface AnalysisHandlers<J extends AnalysisJob, R, P, V extends string> {
	// Concurrency limit of each provider: jobs of a provider running at once.
	readonly limits: Readonly<Record<V, number>>
	// Provider that runs a job of a preparation.
	readonly provider: (preparation: P) => V
	// Runs a job to its completion; rejects when it did not complete (the entry's signal aborts on cancel).
	readonly execute: (entry: AnalysisEntry<J, P>) => Promise<AnalysisCompletion<J, R>>
	// Fields of the final state of a job whose execute rejected with error.
	readonly failed: (entry: AnalysisEntry<J, P>, error: unknown) => Partial<J>
	// Fields of the final state of a job cancelled while it waited.
	readonly cancelled: () => Partial<J>
	// Publishes a changed job.
	readonly publish: (job: J) => void
}

// The jobs of one analysis service, their scheduling, and their results. J is the published job, R the full
// result, P the preparation (request and resolved settings) a job runs with, and V the provider names.
export class AnalysisScheduler<J extends AnalysisJob, R, P, V extends string> {
	// Jobs waiting or running, by job id.
	readonly #entries = new Map<string, AnalysisEntry<J, P>>()
	// Jobs waiting, in arrival order.
	readonly #queue: AnalysisEntry<J, P>[] = []
	// Jobs running, by provider.
	readonly #running = new Map<V, number>()
	// Results, least recently used first, by job id.
	readonly #results = new Map<string, AnalysisStoredResult<J, R>>()
	// Job ids of the results of each image, oldest first.
	readonly #byImage = new Map<string, string[]>()
	// Latest ended jobs, oldest first, by job id.
	readonly #recent = new Map<string, J>()

	// Creates the scheduler of a service over the image store. The results of an image are dropped when the store
	// releases it.
	constructor(
		readonly images: ImageStore,
		readonly handlers: AnalysisHandlers<J, R, P, V>,
	) {
		images.onDiscard((id) => this.#dropResults(id))
	}

	// Whether the queue cannot take another job.
	full(): boolean {
		return this.#queue.length >= MAX_QUEUED
	}

	// Returns the kept result of a job of an image equivalent to key.
	cached(imageId: string, key: string): AnalysisStoredResult<J, R> | undefined {
		for (const jobId of this.#byImage.get(imageId) ?? []) {
			const stored = this.#results.get(jobId)!
			if (stored.key === key) return stored
		}

		return undefined
	}

	// Returns a job waiting or running that is equivalent to key.
	active(key: string): J | undefined {
		for (const entry of this.#entries.values()) if (entry.key === key) return entry.job
		return undefined
	}

	// Retains an image and queues a job of it. Returns undefined when the image is not open. The caller checks full()
	// first.
	enqueue(imageId: string, preparation: P, key: string, fields: AnalysisJobFields<J>): J | undefined {
		const size = this.images.retain(imageId)
		if (!size) return undefined

		const job = { ...fields, jobId: crypto.randomUUID(), imageId, state: 'queued', queuedAt: Date.now() } as J
		const entry: AnalysisEntry<J, P> = { job, preparation, key, size, controller: new AbortController(), done: Promise.withResolvers() }
		this.#entries.set(job.jobId, entry)
		this.#queue.push(entry)
		this.handlers.publish(job)
		this.#pump()
		return job
	}

	// Resolves to the result of a job waiting or running once it ended, undefined when it did not complete; returns
	// undefined at once for a job neither waiting nor running.
	settled(jobId: string): Promise<R | undefined> | undefined {
		const entry = this.#entries.get(jobId)
		return entry?.done.promise.then((stored) => stored?.result as R | undefined)
	}

	// Cancels a job: a waiting one ends at once, a running one has its signal aborted. Returns false when the job
	// is not waiting or running.
	cancel(jobId: string): boolean {
		const entry = this.#entries.get(jobId)
		if (!entry) return false
		if (entry.job.state === 'queued') this.#end(entry, { state: 'cancelled', ...this.handlers.cancelled() })
		else entry.controller.abort()
		return true
	}

	// Publishes a change of a job waiting or running, such as the stage it reached; ignored for any other job.
	update(jobId: string, patch: Partial<J>): void {
		const entry = this.#entries.get(jobId)
		if (entry) this.#update(entry, patch)
	}

	// Returns a job waiting, running, recently ended, or completed with its result kept.
	job(jobId: string): J | undefined {
		return this.#entries.get(jobId)?.job ?? this.#results.get(jobId)?.job ?? this.#recent.get(jobId)
	}

	// Returns a job waiting or running, with its scheduling state.
	entry(jobId: string): AnalysisEntry<J, P> | undefined {
		return this.#entries.get(jobId)
	}

	// Returns the stored result of a completed job while it is kept, without making it the most recently used.
	stored(jobId: string): AnalysisStoredResult<J, R> | undefined {
		return this.#results.get(jobId)
	}

	// Returns the result of a completed job while it is kept; reading it makes it the most recently used.
	result(jobId: string): R | undefined {
		const stored = this.#results.get(jobId)
		if (!stored) return undefined
		this.#results.delete(jobId)
		this.#results.set(jobId, stored)
		return stored.result
	}

	// Returns the completed jobs of an image whose results are kept, oldest first.
	results(imageId: string): J[] {
		return (this.#byImage.get(imageId) ?? []).map((jobId) => this.#results.get(jobId)!.job)
	}

	// Returns the jobs waiting or running and the latest ended ones, oldest first.
	snapshot(): J[] {
		const jobs = [...this.#recent.values(), ...[...this.#entries.values()].map((entry) => entry.job)]
		return jobs.sort((a, b) => a.queuedAt - b.queuedAt)
	}

	// Starts the waiting jobs each provider has room for.
	#pump(): void {
		for (const provider of Object.keys(this.handlers.limits) as V[]) {
			const limit = this.handlers.limits[provider]

			while ((this.#running.get(provider) ?? 0) < limit) {
				const entry = this.#next(provider)
				if (!entry) break
				this.#queue.splice(this.#queue.indexOf(entry), 1)
				void this.#run(entry, provider)
			}
		}
	}

	// Returns the oldest waiting job of a provider.
	#next(provider: V): AnalysisEntry<J, P> | undefined {
		return this.#queue.find((entry) => this.handlers.provider(entry.preparation) === provider)
	}

	// Runs a job to its end. Never rejects.
	async #run(entry: AnalysisEntry<J, P>, provider: V): Promise<void> {
		this.#running.set(provider, (this.#running.get(provider) ?? 0) + 1)
		entry.started = performance.now()
		this.#update(entry, { state: 'running', startedAt: Date.now() } as Partial<J>)

		try {
			const { patch, result } = await this.handlers.execute(entry)
			const endedAt = Date.now()
			const stored: AnalysisStoredResult<J, R> = { job: { ...entry.job, state: 'completed', endedAt, ...patch }, result, key: entry.key }
			this.#store(stored)
			this.#end(entry, { state: 'completed', endedAt, ...patch }, stored)
		} catch (error) {
			this.#end(entry, this.handlers.failed(entry, error))
		} finally {
			this.#running.set(provider, this.#running.get(provider)! - 1)
			this.#pump()
		}
	}

	// Keeps a result, evicting the oldest of its image beyond RESULTS_PER_IMAGE and the least recently used beyond
	// MAX_RESULTS.
	#store(stored: AnalysisStoredResult<J, R>): void {
		const { jobId, imageId } = stored.job
		this.#results.set(jobId, stored)
		const ids = this.#byImage.get(imageId) ?? []
		ids.push(jobId)
		this.#byImage.set(imageId, ids)

		while (ids.length > RESULTS_PER_IMAGE) this.#results.delete(ids.shift()!)

		while (this.#results.size > MAX_RESULTS) {
			const oldest = this.#results.keys().next().value!
			const oldestImageId = this.#results.get(oldest)!.job.imageId
			const imageIds = this.#byImage.get(oldestImageId)!
			imageIds.splice(imageIds.indexOf(oldest), 1)
			if (imageIds.length === 0) this.#byImage.delete(oldestImageId)
			this.#results.delete(oldest)
		}
	}

	// Drops the results of a released image.
	#dropResults(imageId: string): void {
		for (const jobId of this.#byImage.get(imageId) ?? []) this.#results.delete(jobId)
		this.#byImage.delete(imageId)
	}

	// Ends a job: publishes its final state, releases its image, and settles its waiters.
	#end(entry: AnalysisEntry<J, P>, patch: Partial<J>, stored?: AnalysisStoredResult<J, R>): void {
		const index = this.#queue.indexOf(entry)
		if (index >= 0) this.#queue.splice(index, 1)
		this.#entries.delete(entry.job.jobId)
		this.#update(entry, { endedAt: Date.now(), ...patch })

		this.#recent.set(entry.job.jobId, entry.job)
		if (this.#recent.size > RECENT_JOBS) this.#recent.delete(this.#recent.keys().next().value!)

		entry.done.resolve(stored)
		this.images.release(entry.job.imageId)
	}

	// Publishes a changed job.
	#update(entry: AnalysisEntry<J, P>, patch: Partial<J>): void {
		entry.job = { ...entry.job, ...patch }
		this.handlers.publish(entry.job)
	}
}
