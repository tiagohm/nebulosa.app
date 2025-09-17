export const storage = {
	get length() {
		return localStorage.length
	},
	key: (index: number) => {
		return localStorage.key(index)
	},
	clear: () => {
		localStorage.clear()
	},
	get: <T>(key: string, fallback: T | (() => T)) => {
		const value = localStorage.getItem(key)
		if (value === null) return fallback instanceof Function ? fallback() : fallback
		return JSON.parse(value) as T
	},
	has: (key: string) => {
		return localStorage.getItem(key) !== null
	},
	set: (key: string, data: unknown) => {
		if (data === undefined || data === null) localStorage.removeItem(key)
		else localStorage.setItem(key, JSON.stringify(data))
	},
	remove: (key: string) => {
		localStorage.removeItem(key)
	},
} as const

export default storage
