// In-memory Web Storage for tests of the persisted stores. Never imported by the application.

// Storage backed by a Map. A storage built with failing = true rejects every write, like a full or
// disabled browser storage.
export class MemoryStorage implements Storage {
	// Stored values by key.
	readonly #items = new Map<string, string>()

	// Creates an empty storage; failing makes setItem throw.
	constructor(readonly failing = false) {}

	// Number of stored keys.
	get length() {
		return this.#items.size
	}

	// Removes every key.
	clear() {
		this.#items.clear()
	}

	// Returns the value of key, or null when it is missing.
	getItem(key: string) {
		return this.#items.get(key) ?? null
	}

	// Returns the key at index in insertion order, or null.
	key(index: number) {
		return Array.from(this.#items.keys())[index] ?? null
	}

	// Removes key.
	removeItem(key: string) {
		this.#items.delete(key)
	}

	// Stores value under key; throws a QuotaExceededError when failing.
	setItem(key: string, value: string) {
		if (this.failing) throw new DOMException('Storage is full', 'QuotaExceededError')
		this.#items.set(key, value)
	}
}
