// Outbound requests of the server to the JPL Solar System Dynamics APIs (Horizons, SBDB, CAD), which allow one request at
// a time and ask automated clients to name themselves and to slow down when told to. Every consumer shares one queue:
// tasks run in order, one at a time, each identical request is made once for all who wait on it, and a throttling answer
// pauses the queue instead of being retried. The budget of a task starts when it starts, so the wait behind another
// request never spends it; the wait has a limit of its own.

// Longest a task waits for its turn, in milliseconds.
export const SSD_QUEUE_WAIT_MS = 15_000

// Pause after a throttling answer without a usable Retry-After, in milliseconds.
const DEFAULT_PAUSE_MS = 30_000

// Longest pause in milliseconds, whatever a Retry-After asks, since it also holds the positions of the Sky back.
const MAXIMUM_PAUSE_MS = 300_000

// Public page of the project, the contact JPL asks of a client.
const CLIENT_CONTACT = 'https://github.com/tiagohm/nebulosa.app'

// A task ran out of its budget.
export class SsdTimeoutError extends Error {
	// Creates the error.
	constructor() {
		super('JPL did not answer in time')
		this.name = 'TimeoutError'
	}
}

// A task waited for its turn longer than SSD_QUEUE_WAIT_MS.
export class SsdBusyError extends Error {
	// Creates the error.
	constructor() {
		super('Too many JPL requests are waiting')
		this.name = 'SsdBusyError'
	}
}

// JPL asked the server to slow down, so the queue refuses tasks for a while.
export class SsdThrottledError extends Error {
	// Creates the error; `retryAfter` is the rest of the pause in milliseconds.
	constructor(readonly retryAfter: number) {
		super('JPL asked to wait before the next request')
		this.name = 'SsdThrottledError'
	}
}

// How a task runs.
export interface SsdTaskOptions {
	// Budget of the task in milliseconds, from the moment it starts.
	readonly timeoutMs: number
	// Ends the wait of this caller; the task itself stops when no caller is left.
	readonly signal?: AbortSignal
	// Identity of the request: callers with the same key while it is pending share it.
	readonly key?: string
}

// Construction options of SsdRequestQueue.
export interface SsdRequestQueueOptions {
	// HTTP client; the global fetch by default.
	readonly fetch?: typeof fetch
	// Longest wait for a turn in milliseconds; SSD_QUEUE_WAIT_MS by default.
	readonly waitMs?: number
	// Clock of the pause; Date.now by default.
	readonly now?: () => number
}

// One task, queued or running.
interface SsdJob<T> {
	// Work of the job, told to stop through its signal.
	readonly task: (signal: AbortSignal) => Promise<T>
	// Budget in milliseconds.
	readonly timeoutMs: number
	// Identity of the job, when it can be shared.
	readonly key?: string
	// Stops the running task.
	readonly controller: AbortController
	// Outcome every caller waits on.
	readonly promise: Promise<T>
	// Settles the outcome with a value.
	readonly resolve: (value: T) => void
	// Settles the outcome with a failure.
	readonly reject: (reason: unknown) => void
	// Callers still waiting.
	consumers: number
	// Limit of the wait while queued, then budget while running.
	timer?: Timer
	// Whether the outcome was settled.
	settled: boolean
}

// Reads a Retry-After in seconds as milliseconds, within the longest pause; the default for a date or nothing.
function pauseOf(retryAfter: string | null) {
	const seconds = retryAfter ? Number(retryAfter) : Number.NaN
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAXIMUM_PAUSE_MS) : DEFAULT_PAUSE_MS
}

// Queue of the requests of one process to JPL.
export class SsdRequestQueue {
	readonly #fetch: typeof fetch
	readonly #waitMs: number
	readonly #now: () => number
	readonly #queued: SsdJob<unknown>[] = []
	readonly #shared = new Map<string, SsdJob<unknown>>()
	#running?: SsdJob<unknown>
	#pausedUntil = 0
	#userAgent = `Nebulosa (+${CLIENT_CONTACT})`

	// Creates the queue; options replace the HTTP client, the limit of the wait, and the clock.
	constructor(options: SsdRequestQueueOptions = {}) {
		this.#fetch = options.fetch ?? fetch
		this.#waitMs = options.waitMs ?? SSD_QUEUE_WAIT_MS
		this.#now = options.now ?? Date.now
	}

	// Names the running version in the User-Agent of the next requests.
	identify(version: string) {
		this.#userAgent = `Nebulosa/${version} (+${CLIENT_CONTACT})`
	}

	// HTTP headers of every request to JPL.
	get headers(): Readonly<Record<string, string>> {
		return { 'User-Agent': this.#userAgent }
	}

	// Runs a task in its turn and answers its outcome. Rejects with SsdThrottledError during a pause, SsdBusyError when
	// the turn takes too long, SsdTimeoutError when the task exceeds its budget, and the abort reason when `signal` aborts.
	// The task must read the whole response, so that the next request only starts after it.
	async run<T>(task: (signal: AbortSignal) => Promise<T>, options: SsdTaskOptions): Promise<T> {
		const { signal, key } = options
		signal?.throwIfAborted()

		const retryAfter = this.#pausedUntil - this.#now()
		if (retryAfter > 0) throw new SsdThrottledError(retryAfter)

		const job = ((key !== undefined && this.#shared.get(key)) || this.#enqueue(task, options)) as SsdJob<T>
		job.consumers++
		if (!signal) return await job.promise

		let onAbort: (() => void) | undefined
		const aborted = new Promise<never>((_, reject) => {
			onAbort = () => {
				reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
				this.#release(job)
			}
			signal.addEventListener('abort', onAbort, { once: true })
		})

		try {
			return await Promise.race([job.promise, aborted])
		} finally {
			signal.removeEventListener('abort', onAbort!)
		}
	}

	// Fetches a URL with the identity of the client, inside a task. Pauses the queue and rejects with SsdThrottledError
	// when JPL answers 429 or 503; any other answer is returned for the caller to read.
	async fetch(url: string, signal: AbortSignal): Promise<Response> {
		const response = await this.#fetch(url, { signal, headers: this.headers })
		if (response.status !== 429 && response.status !== 503) return response

		const pause = pauseOf(response.headers.get('Retry-After'))
		await response.body?.cancel()
		this.pause(pause)
		throw new SsdThrottledError(pause)
	}

	// Refuses tasks for `ms` milliseconds, those waiting for their turn included; the one running goes on.
	pause(ms: number) {
		this.#pausedUntil = Math.max(this.#pausedUntil, this.#now() + ms)
		for (const job of this.#queued.splice(0)) this.#settle(job, () => job.reject(new SsdThrottledError(ms)))
	}

	// Queues a new job and starts it if the queue is idle.
	#enqueue<T>(task: (signal: AbortSignal) => Promise<T>, { timeoutMs, key }: SsdTaskOptions) {
		const { promise, resolve, reject } = Promise.withResolvers<T>()
		const job: SsdJob<T> = { task, timeoutMs, key, controller: new AbortController(), promise, resolve, reject, consumers: 0, settled: false }

		// Nobody may be left to observe the failure of a job its callers abandoned.
		promise.catch(() => undefined)

		job.timer = setTimeout(() => {
			this.#queued.splice(this.#queued.indexOf(job as SsdJob<unknown>), 1)
			this.#settle(job, () => reject(new SsdBusyError()))
		}, this.#waitMs)

		this.#queued.push(job as SsdJob<unknown>)
		if (key !== undefined) this.#shared.set(key, job as SsdJob<unknown>)
		queueMicrotask(() => this.#next())
		return job
	}

	// Drops a caller of a job: the last one to leave stops the job, whether queued or running.
	#release<T>(job: SsdJob<T>) {
		if (--job.consumers > 0 || job.settled) return

		const index = this.#queued.indexOf(job as SsdJob<unknown>)
		if (index >= 0) this.#queued.splice(index, 1)
		this.#settle(job, () => job.reject(new Error('Aborted')))
		job.controller.abort()
	}

	// Starts the next job when none is running.
	#next() {
		if (this.#running) return

		const job = this.#queued.shift()
		if (!job) return

		this.#running = job
		clearTimeout(job.timer)

		job.timer = setTimeout(() => {
			this.#settle(job, () => job.reject(new SsdTimeoutError()))
			job.controller.abort()
		}, job.timeoutMs)

		Promise.try(job.task, job.controller.signal).then(
			(value) => this.#settle(job, () => job.resolve(value)),
			(error: unknown) => this.#settle(job, () => job.reject(error)),
		)
	}

	// Settles a job once, frees what it holds, and moves to the next.
	#settle<T>(job: SsdJob<T>, settle: () => void) {
		if (job.settled) return

		job.settled = true
		clearTimeout(job.timer)
		if (job.key !== undefined && (this.#shared.get(job.key) as unknown) === job) this.#shared.delete(job.key)
		if ((this.#running as unknown) === job) this.#running = undefined
		settle()
		this.#next()
	}
}
