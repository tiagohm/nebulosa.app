// Bounded in-memory cache shared by the services of the server, evicting what was used least recently.

// Least-recently-used map with a fixed number of entries.
export class LruCache<T> {
	readonly #entries = new Map<string, T>()

	// Creates the cache holding at most `limit` entries.
	constructor(private readonly limit: number) {}

	// Returns an entry and marks it most recently used.
	get(key: string): T | undefined {
		const value = this.#entries.get(key)
		if (value === undefined) return undefined
		this.#entries.delete(key)
		this.#entries.set(key, value)
		return value
	}

	// Stores an entry, evicting the least recently used ones beyond the limit.
	set(key: string, value: T) {
		this.#entries.delete(key)
		this.#entries.set(key, value)

		while (this.#entries.size > this.limit) {
			const oldest = this.#entries.keys().next().value
			if (oldest === undefined) break
			this.#entries.delete(oldest)
		}
	}

	// Removes an entry.
	delete(key: string) {
		this.#entries.delete(key)
	}
}
