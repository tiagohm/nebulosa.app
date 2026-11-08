// Runs one job on a worker of its own: the shared client loop of the workers that build calibration masters and analyze,
// integrate, and compose Image Stacking projects. Each job starts its worker and terminates it when it ends, so nothing a
// job allocated outlives it; a worker that stops reporting for the stall time is terminated instead.

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
		receive(data, { resolve, reject })
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
