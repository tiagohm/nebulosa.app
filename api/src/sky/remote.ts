// Cached reads of the public observation sources of the Sun Inspector (NASA SDO images, NOAA SWPC
// active regions): a bounded download with a timeout, and a cache per key that is fresh for a time to
// live, shares one download among concurrent readers, and answers the last good value marked stale
// when a download fails. The sources are current observations, so nothing here depends on the Sky clock.

// How long after a failed download a cached value is answered as stale without downloading again, in
// milliseconds, so an offline server answers at once instead of waiting for every timeout.
const RETRY_AFTER_MS = 60_000

// Fetch of an upstream URL, injectable in tests.
export type UpstreamFetch = (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>

// Failure of an upstream source: unreachable, timed out, an error status, a wrong content type, a
// body too large, or a body that cannot be read.
export class UpstreamUnavailableError extends Error {}

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
		throw new UpstreamUnavailableError(`${url} answered ${response.status}`)
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
	// Download in progress.
	pending?: Promise<RemoteValue<T>>
}

// Cache of the values of a source by key.
export class RemoteCache<T> {
	readonly #entries = new Map<string, RemoteEntry<T>>()

	// Creates a cache whose values are fresh for `ttl` milliseconds, reading the time from `now`.
	constructor(
		private readonly ttl: number,
		private readonly now: () => number = Date.now,
	) {}

	// Returns the value of a key: the cached one while fresh, otherwise downloaded by `load`, which concurrent
	// readers share. When the download fails, answers the last good value as stale, or rejects with the failure
	// when there is none.
	get(key: string, load: () => Promise<T>): Promise<RemoteValue<T>> {
		let entry = this.#entries.get(key)

		if (!entry) {
			entry = {}
			this.#entries.set(key, entry)
		}

		const { value, failedAt } = entry
		const now = this.now()
		if (value && now - value.fetchedAt < this.ttl) return Promise.resolve({ ...value, stale: false })
		if (value && failedAt !== undefined && now - failedAt < RETRY_AFTER_MS) return Promise.resolve({ ...value, stale: true })
		if (entry.pending) return entry.pending

		const current = entry
		current.pending = load().then(
			(value) => {
				current.value = { value, fetchedAt: this.now() }
				current.failedAt = undefined
				current.pending = undefined
				return { ...current.value, stale: false }
			},
			(error: unknown) => {
				current.failedAt = this.now()
				current.pending = undefined
				if (current.value) return { ...current.value, stale: true }
				throw error
			},
		)

		return current.pending
	}
}
