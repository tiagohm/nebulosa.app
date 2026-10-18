// Guard against stale responses: each request started through a guard supersedes the previous one,
// aborting it and making its late responses detectable, so selecting A and then B never lets A's answer
// replace B's.

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
