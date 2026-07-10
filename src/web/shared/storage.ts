import { Api } from './api'

export function storageKey(index: number) {
	return sessionStorage.key(index)
}

export function storageClear() {
	sessionStorage.clear()
}

export function storageGet<T>(key: string, fallback: T | (() => T)) {
	const value = sessionStorage.getItem(key)
	if (value === null) return fallback instanceof Function ? fallback() : fallback
	return JSON.parse(value) as T
}

export function storageHas(key: string) {
	return sessionStorage.getItem(key) !== null
}

export function storageSet(key: string, data: unknown) {
	if (data === undefined || data === null) storageRemove(key)
	else sessionStorage.setItem(key, JSON.stringify(data))
}

export function storageRemove(key: string) {
	sessionStorage.removeItem(key)
}

const all = await Api.Storage.all()

if (all) {
	for (const [key, value] of Object.entries(all)) {
		sessionStorage.setItem(key, value)
	}
}

window.addEventListener('beforeunload', () => {
	const body: Record<string, string> = {}

	for (let i = 0; i < sessionStorage.length; i++) {
		const key = sessionStorage.key(i)
		const value = key && sessionStorage.getItem(key)
		if (value) body[key] = value
	}

	return Api.Storage.putAll(body)
})
