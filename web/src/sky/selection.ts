// Request pacing of the Sky: a guard against stale responses, where each request started through it supersedes the
// previous one, aborting it and making its late responses detectable, so selecting A and then B never lets A's answer
// replace B's; and a runner that keeps one request in flight for the latest instant asked.

// One request started through a guard.
export interface GuardedRequest {
	// Aborted when a newer request starts or the guard is cancelled.
	readonly signal: AbortSignal
	// Whether this is still the latest request and was not cancelled.
	readonly current: () => boolean
}

// Sequence of requests where only the latest counts.
export interface RequestGuard {
	// Starts a request, aborting the previous one.
	readonly begin: () => GuardedRequest
	// Aborts the latest request without starting another.
	readonly cancel: () => void
}

// Creates a request guard.
export function createRequestGuard(): RequestGuard {
	let generation = 0
	let controller: AbortController | undefined

	return {
		begin() {
			controller?.abort()
			const own = ++generation
			const next = new AbortController()
			controller = next
			return { signal: next.signal, current: () => own === generation && !next.signal.aborted }
		},
		cancel() {
			generation++
			controller?.abort()
			controller = undefined
		},
	}
}

// Runs an asynchronous task for one instant at a time: an instant asked while a run is in flight waits, replacing any
// other waiting one, and runs when the flight ends while `alive` holds, so a fast clock never aborts runs before they
// finish nor queues more than one. A run that fails is its task's to report; the next instant still runs.
export function createLatestRunner(run: (time: number) => Promise<void>, alive: () => boolean = () => true): (time: number) => void {
	let busy = false
	let pending: number | undefined

	const request = (time: number) => {
		if (busy) {
			pending = time
			return
		}

		busy = true

		void run(time)
			.catch(() => undefined)
			.finally(() => {
				busy = false
				const next = pending
				pending = undefined
				if (next !== undefined && alive()) request(next)
			})
	}

	return request
}
