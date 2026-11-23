// Client loops of the workers of the server. runWorkerJob runs one job on a worker of its own, for the workers that build
// calibration masters and analyze, integrate, and compose Image Stacking projects: each job starts its worker and
// terminates it when it ends, so nothing a job allocated outlives it, and a worker that stops reporting for the stall
// time is terminated instead. runPooledWorkerJob runs a job on a worker of a WorkerPool, for the short analyses that
// keep their workers between jobs (star and streak detection, star profiles, solar eclipse maps).

// Settles the job a worker answers.
export interface WorkerJobSettlement<T> {
	// Ends the job with its value.
	readonly resolve: (value: T) => void
	// Ends the job with a failure.
	readonly reject: (error: Error) => void
}

// One job run on a worker.
export interface WorkerJob<R extends { readonly jobId: string }, T> {
	// Starts the worker of the job.
	readonly start: () => Worker
	// Message that starts the job, posted to the worker.
	readonly request: unknown
	// Id of the job; the answers of another job are ignored.
	readonly jobId: string
	// Aborting it terminates the worker at once and rejects with its reason.
	readonly signal: AbortSignal
	// Time the worker may stay silent, in milliseconds, before the job fails with stalled.
	readonly stallTimeout: number
	// Failure of a worker that stopped reporting.
	readonly stalled: () => Error
	// Failure of a worker that crashed, from the error event of the worker.
	readonly crashed: (event: ErrorEvent) => Error
	// Whether an answer proves the worker alive and restarts the stall time; every answer when absent.
	readonly resets?: (response: R) => boolean
	// Receives every answer of the job, and ends it through settle.
	readonly receive: (response: R, settle: WorkerJobSettlement<T>) => void
}

// Runs job until it settles, then terminates its worker. Rejects with the failure the job settled with, stalled, crashed,
// or the reason of its signal.
export async function runWorkerJob<R extends { readonly jobId: string }, T>({ start, request, jobId, signal, stallTimeout, stalled, crashed, resets = () => true, receive }: WorkerJob<R, T>): Promise<T> {
	signal.throwIfAborted()
	const worker = start()
	const { promise, resolve, reject } = Promise.withResolvers<T>()
	let timer: Timer | undefined

	const watch = () => {
		clearTimeout(timer)
		timer = setTimeout(() => reject(stalled()), stallTimeout)
		timer.unref()
	}

	const onMessage = ({ data }: MessageEvent<R>) => {
		if (data.jobId !== jobId) return
		if (resets(data)) watch()

		// A receiver that throws fails the job at once, instead of leaving it to end as stalled.
		try {
			receive(data, { resolve, reject })
		} catch (error) {
			reject(Error.isError(error) ? error : new Error(String(error)))
		}
	}

	const onError = (event: ErrorEvent) => reject(crashed(event))
	const onAbort = () => reject(signal.reason)

	worker.addEventListener('message', onMessage)
	worker.addEventListener('error', onError)
	signal.addEventListener('abort', onAbort, { once: true })
	watch()

	try {
		worker.postMessage(request, [])
		return await promise
	} finally {
		clearTimeout(timer)
		signal.removeEventListener('abort', onAbort)
		worker.removeEventListener('message', onMessage)
		worker.removeEventListener('error', onError)
		worker.terminate()
	}
}

// Workers of one kind kept between jobs. A job takes an idle worker or starts one, and gives it back once it answered,
// even with a failure; a worker that crashed, ran out of time, or was cancelled is terminated instead, since its
// computation cannot be interrupted. An idle worker that dies is dropped, so no job waits out its time on it.
export class WorkerPool implements Disposable {
	// Idle workers, with the listener that drops each one if it dies while idle.
	readonly #idle = new Map<Worker, (event: ErrorEvent) => void>()
	// Whether the pool was disposed, after which no worker is kept.
	#disposed = false

	// Creates the pool; start starts a worker, which must not keep the process alive on its own.
	constructor(readonly start: () => Worker) {}

	// Takes an idle worker, or starts one.
	acquire(): Worker {
		for (const [worker, dropped] of this.#idle) {
			this.#idle.delete(worker)
			worker.removeEventListener('error', dropped)
			return worker
		}

		return this.start()
	}

	// Gives a worker back: kept when reusable and the pool is still in use, terminated otherwise.
	release(worker: Worker, reusable: boolean) {
		if (!reusable || this.#disposed) {
			worker.terminate()
			return
		}

		const dropped = () => {
			this.#idle.delete(worker)
			worker.terminate()
		}

		worker.addEventListener('error', dropped, { once: true })
		this.#idle.set(worker, dropped)
	}

	// Terminates the idle workers; a worker still running a job is terminated once the job gives it back.
	[Symbol.dispose]() {
		this.#disposed = true
		for (const worker of this.#idle.keys()) worker.terminate()
		this.#idle.clear()
	}
}

// One job run on a worker of a pool.
export interface PooledWorkerJob<R, T> {
	// Pool the worker is taken from and given back to.
	readonly pool: WorkerPool
	// Message that starts the job, posted to the worker.
	readonly request: unknown
	// Buffers the request transfers to the worker.
	readonly transfer?: readonly Transferable[]
	// Aborting it fails the job with cancelled and terminates the worker; absent for a job that cannot be cancelled.
	readonly signal?: AbortSignal
	// Time the job may take, in milliseconds, before it fails with timedOut and its worker is terminated.
	readonly timeout: number
	// Failure of a job that ran out of time.
	readonly timedOut: () => Error
	// Failure of a worker that crashed, from its error event.
	readonly crashed: (event: ErrorEvent) => Error
	// Failure of a job whose signal aborted.
	readonly cancelled?: () => Error
	// Receives every message of the worker, ignoring those of another job, and ends the job through settle; a job it
	// settled leaves the worker reusable. A receiver that throws fails the job and the worker is terminated.
	readonly receive: (response: R, settle: WorkerJobSettlement<T>) => void
}

// Runs a job on a worker of a pool until it settles, then gives the worker back (see WorkerPool). Rejects with the
// failure the job settled with, timedOut, crashed, or cancelled.
export async function runPooledWorkerJob<R, T>({ pool, request, transfer = [], signal, timeout, timedOut, crashed, cancelled, receive }: PooledWorkerJob<R, T>): Promise<T> {
	const worker = pool.acquire()
	const { promise, resolve, reject } = Promise.withResolvers<T>()
	let reusable = false

	const settle: WorkerJobSettlement<T> = {
		resolve: (value) => {
			reusable = true
			resolve(value)
		},
		reject: (error) => {
			reusable = true
			reject(error)
		},
	}

	const onMessage = ({ data }: MessageEvent<R>) => {
		try {
			receive(data, settle)
		} catch (error) {
			reject(Error.isError(error) ? error : new Error(String(error)))
		}
	}

	const onError = (event: ErrorEvent) => reject(crashed(event))
	const onAbort = () => reject(cancelled?.() ?? new Error('The job was cancelled'))
	const timer = setTimeout(() => reject(timedOut()), timeout)

	worker.addEventListener('message', onMessage)
	worker.addEventListener('error', onError)
	signal?.addEventListener('abort', onAbort, { once: true })

	try {
		if (signal?.aborted) onAbort()
		else worker.postMessage(request, [...transfer])
		return await promise
	} finally {
		clearTimeout(timer)
		worker.removeEventListener('message', onMessage)
		worker.removeEventListener('error', onError)
		signal?.removeEventListener('abort', onAbort)
		pool.release(worker, reusable)
	}
}
