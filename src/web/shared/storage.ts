export class SimpleStorage {
	constructor(private readonly store: Storage) {}

	get length() {
		return this.store.length
	}

	key(index: number) {
		return this.store.key(index)
	}

	clear() {
		this.store.clear()
	}

	get<T>(key: string, defaultValue: T | (() => T)) {
		const value = this.store.getItem(key)
		if (value === null) return defaultValue instanceof Function ? defaultValue() : defaultValue
		return JSON.parse(value) as T
	}

	has(key: string) {
		return this.store.getItem(key) !== null
	}

	set(key: string, data: unknown) {
		if (data === undefined || data === null) this.remove(key)
		else this.store.setItem(key, JSON.stringify(data))
	}

	remove(key: string) {
		this.store.removeItem(key)
	}
}

export const simpleLocalStorage = new SimpleStorage(localStorage)
export const simpleSessionStorage = new SimpleStorage(sessionStorage)
