import { LruCache } from '../lrucache'

// Cached reads of public sources (NASA SDO images and NOAA SWPC active regions of the Sun Inspector, the forecasts of
// Astro Weather): a bounded download with a timeout, and a cache per key that is fresh for a time to live, shares one
// download among concurrent readers, and answers the last good value marked stale when a download fails. The sources are
// current data, so nothing here depends on the Sky clock.

// How long after a failed download a cached value is answered as stale without downloading again, in
// milliseconds, so an offline server answers at once instead of waiting for every timeout.
const RETRY_AFTER_MS = 60_000

// Fetch of an upstream URL, injectable in tests.
export type UpstreamFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>

// Failure of an upstream source: unreachable, timed out, an error status, a wrong content type, a
// body too large, or a body that cannot be read.
export class UpstreamUnavailableError extends Error {
	// HTTP status the source answered; absent when it gave none.
	status?: number
}

// Body of an upstream response.
export interface UpstreamBody {
	// Bytes of the body.
	readonly bytes: Uint8Array<ArrayBuffer>
	// Last-Modified of the response, Unix milliseconds; absent when the source does not send it.
	readonly lastModified?: number
}

// Downloads a URL within `timeout` milliseconds, accepting only a 2xx answer whose content type starts
// with `contentType` and whose body has at most `maxBytes` bytes. Rejects with UpstreamUnavailableError.
export async function fetchUpstream(fetch: UpstreamFetch, url: string, contentType: string, timeout: number, maxBytes: number): Promise<UpstreamBody> {
	const signal = AbortSignal.timeout(timeout)
	let response: Response

	try {
		response = await fetch(url, { signal })
	} catch (error) {
		throw new UpstreamUnavailableError(signal.aborted ? `${url} timed out` : `${url} is unreachable`, { cause: error })
	}

	if (!response.ok) {
		await response.body?.cancel()
		const error = new UpstreamUnavailableError(`${url} answered ${response.status}`)
		error.status = response.status
		throw error
	}

	if (!response.headers.get('Content-Type')?.startsWith(contentType)) {
		await response.body?.cancel()
		throw new UpstreamUnavailableError(`${url} did not answer ${contentType}`)
	}

	const chunks: Uint8Array[] = []
	let length = 0

	try {
		const reader = (response.body ?? new Blob().stream()).getReader()
		let result = await reader.read()

		while (!result.done) {
			length += result.value.length

			if (length > maxBytes) {
				await reader.cancel()
				throw new UpstreamUnavailableError(`${url} is larger than ${maxBytes} bytes`)
			}

			chunks.push(result.value)
			result = await reader.read()
		}
	} catch (error) {
		if (error instanceof UpstreamUnavailableError) throw error
		throw new UpstreamUnavailableError(`${url} could not be read`, { cause: error })
	}

	const bytes = new Uint8Array(length)
	let offset = 0

	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.length
	}

	const lastModified = Date.parse(response.headers.get('Last-Modified') ?? '')
	return { bytes, lastModified: Number.isFinite(lastModified) ? lastModified : undefined }
}

// Value read from a source with when it was downloaded.
export interface RemoteValue<T> {
	// Value.
	readonly value: T
	// When the value was downloaded, Unix milliseconds.
	readonly fetchedAt: number
	// True when the latest download failed and this is the last good value.
	readonly stale: boolean
}

// Cache entry of a key.
interface RemoteEntry<T> {
	// Last good value and when it was downloaded.
	value?: { readonly value: T; readonly fetchedAt: number }
	// When the latest download failed, Unix milliseconds.
	failedAt?: number
	// Why the latest download failed, kept only when the cache remembers failures.
	failure?: Error
	// Download in progress.
	pending?: Promise<RemoteValue<T>>
}

// Limits of a cache whose keys come from its clients, such as the places of a forecast, rather than from a fixed list.
export interface RemoteCacheOptions {
	// Keys kept in memory, the least recently used dropped first; every key when absent.
	readonly limit?: number
	// Age in milliseconds, since the download, from which a value is no longer answered as stale; any age when absent.
	readonly maxStaleMs?: number
	// Whether a failed download without a value to answer is rejected again for RETRY_AFTER_MS without downloading.
	readonly rememberFailure?: boolean
}

// Cache of the values of a source by key.
export class RemoteCache<T> {
	readonly #entries: LruCache<RemoteEntry<T>>
	readonly #maxStaleMs: number
	readonly #rememberFailure: boolean

	// Creates a cache whose values are fresh for `ttl` milliseconds, reading the time from `now`.
	constructor(
		private readonly ttl: number,
		private readonly now: () => number = Date.now,
		{ limit = Number.POSITIVE_INFINITY, maxStaleMs = Number.POSITIVE_INFINITY, rememberFailure = false }: RemoteCacheOptions = {},
	) {
		this.#entries = new LruCache(limit)
		this.#maxStaleMs = maxStaleMs
		this.#rememberFailure = rememberFailure
	}

	// Returns the value of a key: the cached one while fresh, otherwise downloaded by `load`, which concurrent
	// readers share. When the download fails, answers the last good value as stale, or rejects with the failure
	// when there is none or it is too old.
	get(key: string, load: () => Promise<T>): Promise<RemoteValue<T>> {
		let entry = this.#entries.get(key)

		if (!entry) {
			entry = {}
			this.#entries.set(key, entry)
		}

		const { value, failedAt, failure } = entry
		const now = this.now()
		if (value && now - value.fetchedAt < this.ttl) return Promise.resolve({ ...value, stale: false })

		if (failedAt !== undefined && now - failedAt < RETRY_AFTER_MS) {
			if (value && now - value.fetchedAt < this.#maxStaleMs) return Promise.resolve({ ...value, stale: true })
			if (failure) return Promise.reject(failure)
		}

		if (entry.pending) return entry.pending

		const current = entry
		current.pending = load().then(
			(value) => {
				current.value = { value, fetchedAt: this.now() }
				current.failedAt = undefined
				current.failure = undefined
				current.pending = undefined
				return { ...current.value, stale: false }
			},
			(error: unknown) => {
				const now = this.now()
				current.failedAt = now
				if (this.#rememberFailure) current.failure = error instanceof Error ? error : new UpstreamUnavailableError('The download failed', { cause: error })
				current.pending = undefined
				if (current.value && now - current.value.fetchedAt < this.#maxStaleMs) return { ...current.value, stale: true }
				throw error
			},
		)

		return current.pending
	}
}
