// Acquisition jobs of the SPICE Kernel Library: curated downloads and Horizons small-body generations, run one at a time
// in submission order. A submission whose intent matches a queued or running job joins it instead of starting another.
// Jobs live in memory only: they survive the tabs that started them but never a restart of the server, whose staging
// files are cleared at the next start. Progress updates are published at most four times a second; state changes at
// once.

// Kind of an acquisition.
export type SpiceKernelJobKind = 'download' | 'generate'

// Lifecycle of a job: waiting its turn, transferring, inspecting the file, recording it, and the three ends.
export type SpiceKernelJobState = 'queued' | 'running' | 'validating' | 'publishing' | 'completed' | 'failed' | 'cancelled'

// What a finished task produced: the kernel, and whether an identical file was already installed.
export interface SpiceKernelJobOutcome {
	readonly kernelId: string
	readonly alreadyInstalled: boolean
}

// One acquisition job as tabs see it.
export interface SpiceKernelJob {
	readonly jobId: string
	readonly kind: SpiceKernelJobKind
	// Intent key: the same download, or the same body and interval, joins this job.
	readonly key: string
	// What is being acquired, for people.
	readonly label: string
	readonly state: SpiceKernelJobState
	// When it was submitted and last changed, Unix milliseconds (UTC).
	readonly createdAt: number
	readonly updatedAt: number
	// Bytes transferred so far, and in total when known.
	readonly bytes?: number
	readonly totalBytes?: number
	// Kernel it produced, when completed.
	readonly kernelId?: string
	readonly alreadyInstalled?: boolean
	// Why it failed, for people, and its stable code.
	readonly error?: string
	readonly code?: string
}

// What a running task can report.
export interface SpiceKernelJobContext {
	readonly signal: AbortSignal
	// Reports the bytes transferred so far, and in total when known.
	readonly progress: (bytes: number, totalBytes?: number) => void
	// Reports a later stage of the job.
	readonly stage: (state: 'validating' | 'publishing') => void
}

// Work of a job.
export type SpiceKernelJobTask = (context: SpiceKernelJobContext) => Promise<SpiceKernelJobOutcome>

// Raised by submit when the queue is full.
export class SpiceKernelQueueFullError extends Error {
	// Creates the error.
	constructor() {
		super('Too many kernel acquisitions are waiting. Try again when one has finished.')
	}
}

// Largest number of queued jobs, the running one aside.
export const MAX_QUEUED_SPICE_KERNEL_JOBS = 8

// Ended jobs kept for the tabs, newest first.
const MAX_ENDED_JOBS = 20

// Shortest interval between two progress updates of a job, in milliseconds.
const PROGRESS_INTERVAL_MS = 250

// A job and what runs it.
interface JobEntry {
	job: SpiceKernelJob
	readonly task: SpiceKernelJobTask
	readonly controller: AbortController
	// When its progress was last published, Unix milliseconds.
	published: number
}

// Queue of the acquisition jobs.
export class SpiceKernelJobs implements Disposable {
	readonly #entries = new Map<string, JobEntry>()
	readonly #queue: JobEntry[] = []
	#running?: JobEntry

	// Creates the queue: updated publishes every change of a job, failureOf describes an error as a message and a code,
	// and now is the clock.
	constructor(
		private readonly updated: (job: SpiceKernelJob) => void,
		private readonly failureOf: (error: unknown) => { readonly message: string; readonly code: string },
		private readonly now: () => number = Date.now,
	) {}

	// Every job, active ones first, then the ended ones, newest first.
	list(): SpiceKernelJob[] {
		const jobs = [...this.#entries.values()].map((e) => e.job)
		return jobs.sort((a, b) => Number(isEnded(a.state)) - Number(isEnded(b.state)) || b.createdAt - a.createdAt)
	}

	// Submits work under an intent key, or returns the queued or running job with the same key. Throws
	// SpiceKernelQueueFullError when MAX_QUEUED_SPICE_KERNEL_JOBS are waiting.
	submit(kind: SpiceKernelJobKind, key: string, label: string, task: SpiceKernelJobTask): SpiceKernelJob {
		for (const entry of this.#entries.values()) if (entry.job.key === key && !isEnded(entry.job.state)) return entry.job
		if (this.#queue.length >= MAX_QUEUED_SPICE_KERNEL_JOBS) throw new SpiceKernelQueueFullError()

		const now = this.now()
		const job: SpiceKernelJob = { jobId: Bun.randomUUIDv7(), kind, key, label, state: 'queued', createdAt: now, updatedAt: now }
		const entry: JobEntry = { job, task, controller: new AbortController(), published: 0 }
		this.#entries.set(job.jobId, entry)
		this.#queue.push(entry)
		this.updated(job)
		this.#trim()
		this.#pump()
		return job
	}

	// Cancels a queued or running job; returns it, or undefined when unknown.
	cancel(jobId: string): SpiceKernelJob | undefined {
		const entry = this.#entries.get(jobId)
		if (!entry || isEnded(entry.job.state)) return entry?.job

		const index = this.#queue.indexOf(entry)

		if (index >= 0) {
			this.#queue.splice(index, 1)
			this.#save(entry, { state: 'cancelled' })
		} else {
			entry.controller.abort(new DOMException('Cancelled', 'AbortError'))
		}

		return entry.job
	}

	// Aborts every job, for a server stopping in place.
	[Symbol.dispose]() {
		this.#queue.length = 0
		for (const entry of this.#entries.values()) entry.controller.abort(new DOMException('Stopped', 'AbortError'))
	}

	// Starts the next queued job when none runs.
	#pump() {
		if (this.#running) return
		const entry = this.#queue.shift()
		if (!entry) return
		this.#running = entry
		void this.#run(entry).finally(() => {
			this.#running = undefined
			this.#pump()
		})
	}

	// Runs a job to its end.
	async #run(entry: JobEntry) {
		const { signal } = entry.controller
		this.#save(entry, { state: 'running' })

		const context: SpiceKernelJobContext = {
			signal,
			progress: (bytes, totalBytes) => {
				const now = this.now()
				const silent = now - entry.published < PROGRESS_INTERVAL_MS
				this.#save(entry, { bytes, totalBytes }, silent)
			},
			stage: (state) => this.#save(entry, { state }),
		}

		try {
			const outcome = await entry.task(context)
			this.#save(entry, { state: 'completed', kernelId: outcome.kernelId, alreadyInstalled: outcome.alreadyInstalled })
		} catch (error) {
			if (signal.aborted) this.#save(entry, { state: 'cancelled' })
			else {
				const { message, code } = this.failureOf(error)
				this.#save(entry, { state: 'failed', error: message, code })
			}
		}
	}

	// Changes a job and publishes it unless silent.
	#save(entry: JobEntry, patch: Partial<SpiceKernelJob>, silent = false) {
		entry.job = { ...entry.job, ...patch, updatedAt: this.now() }
		if (silent) return
		entry.published = this.now()
		this.updated(entry.job)
	}

	// Forgets the oldest ended jobs beyond MAX_ENDED_JOBS.
	#trim() {
		const ended = [...this.#entries.values()].filter((e) => isEnded(e.job.state)).sort((a, b) => b.job.createdAt - a.job.createdAt)
		for (const entry of ended.slice(MAX_ENDED_JOBS)) this.#entries.delete(entry.job.jobId)
	}
}

// Whether a job state is final.
function isEnded(state: SpiceKernelJobState) {
	return state === 'completed' || state === 'failed' || state === 'cancelled'
}
