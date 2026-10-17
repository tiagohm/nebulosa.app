// Access to the browser's Web Storage for the stores that persist state. Every read and write is guarded,
// because storage can be disabled, full, or hold values written by another version of the application.

// Storage areas a persisted store uses: localStorage shared by every tab of the browser, and the
// sessionStorage of the current tab.
export interface Stores {
	// Shared by every tab of this browser; holds the persisted collections.
	readonly local: Storage
	// Private to the current tab and kept across its reloads.
	readonly session: Storage
}

// Returns the browser's storage areas.
export function browserStores(): Stores {
	return { local: localStorage, session: sessionStorage }
}

// Returns the text stored under key, or undefined when it is missing or storage cannot be read.
export function readText(storage: Storage, key: string): string | undefined {
	try {
		return storage.getItem(key) ?? undefined
	} catch {
		return undefined
	}
}

// Stores text under key. Returns false when storage rejects the write (disabled or over quota).
export function writeText(storage: Storage, key: string, value: string): boolean {
	try {
		storage.setItem(key, value)
		return true
	} catch {
		return false
	}
}

// Parses JSON text, returning undefined when it is not valid JSON.
export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown
	} catch {
		return undefined
	}
}

// Whether value is a non-null, non-array object, so its properties can be read.
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
