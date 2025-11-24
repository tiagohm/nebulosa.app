export function storageKey(index: number) {
	return localStorage.key(index)
}

export function storageClear() {
	localStorage.clear()
}

export function storageGet<T>(key: string, fallback: T | (() => T)) {
	const value = localStorage.getItem(key)
	if (value === null) return fallback instanceof Function ? fallback() : fallback
	return JSON.parse(value) as T
}

export function storageHas(key: string) {
	return localStorage.getItem(key) !== null
}

export function storageSet(key: string, data: unknown) {
	if (data === undefined || data === null) storageRemove(key)
	else localStorage.setItem(key, JSON.stringify(data))
}

export function storageRemove(key: string) {
	localStorage.removeItem(key)
}
