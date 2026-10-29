// Ordering of the snapshot refreshes of a store that mirrors server state against the events it applies meanwhile. A
// snapshot is fetched over HTTP while events keep arriving over the event socket, so an event may be applied before
// the response of a snapshot taken earlier on the server. The store records the keys its events change while a refresh
// is in flight, and the snapshot never replaces or drops them: the event is at least as new as the snapshot for that
// key. A refresh started later supersedes an earlier one, whose response is then ignored.

// Refreshes of one store, at most one applied at a time.
export class SnapshotRefreshes {
	// Number of the latest refresh started.
	#generation = 0
	// Whether the latest refresh is still waiting for its response.
	#inFlight = false
	// Keys changed by events since the latest refresh started.
	readonly #updated = new Set<string>()

	// Starts a refresh, superseding any earlier one. Returns its token.
	start(): number {
		this.#inFlight = true
		this.#updated.clear()
		return ++this.#generation
	}

	// Whether the refresh of token is the latest one, so its response may be applied.
	current(token: number): boolean {
		return token === this.#generation
	}

	// Ends the refresh of token, applied or not; an earlier refresh ending changes nothing.
	end(token: number): void {
		if (!this.current(token)) return
		this.#inFlight = false
		this.#updated.clear()
	}

	// Records that an event changed key; kept only while a refresh is in flight.
	updated(key: string): void {
		if (this.#inFlight) this.#updated.add(key)
	}

	// Whether an event changed key since the latest refresh started, so its snapshot must leave key as it is.
	changed(key: string): boolean {
		return this.#updated.has(key)
	}
}
