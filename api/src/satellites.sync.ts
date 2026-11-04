import { type CelestrakFetch, type CelestrakQuery, celestrakUserAgent, fetchCelestrak, parseCelestrakSourceKey } from './satellites.celestrak'
import { normalizeOmmRecords, normalizeSatcatRecords } from './satellites.elements'
import type { SatelliteSourceState, SatelliteStore } from './satellites.store'

// Downloads of the satellite catalog from CelesTrak under its usage policy (https://celestrak.org/usage-policy.php):
// a source is downloaded only when an operator asks for it, at most once per GP update (2 hours) or per SATCAT interval,
// one request at a time for the whole process, one shared download per source, and never again after an answer other
// than 200 until its block ends. The interval and the blocks are kept in the database, so a restart never repeats a
// download. A download is parsed and validated in memory and published in one transaction; a failure keeps the previous
// data of the source.

// Least time between two downloads of a GP source, in milliseconds: CelesTrak checks for new GP data every 2 hours and
// answers a repeated download with 403.
export const GP_INTERVAL_MS = 2 * 3_600_000

// Least time between two downloads of a SATCAT source, in milliseconds: the catalog is updated by hand once or twice a
// day.
export const SATCAT_INTERVAL_MS = 24 * 3_600_000

// Longest block after repeated failures, in milliseconds.
export const MAX_BLOCK_MS = 24 * 3_600_000

// Statuses that concern the client or CelesTrak as a whole rather than one query: limits (403, 429), a redirect (301,
// a wrong host or a legacy query), and overload (5xx). Each blocks every source, since another request could only add
// to the errors that send an address to CelesTrak's firewall.
const GLOBAL_STATUSES = new Set([301, 403, 429])

// Outcome of a download.
export interface SatelliteRefreshResult {
	// State of the source after the download.
	readonly source: SatelliteSourceState
	// Objects published.
	readonly records: number
	// Records left out because they failed validation.
	readonly rejected: number
}

// Why a download was not made, or failed.
export type SatelliteRefreshErrorCode = 'notFound' | 'sourceCooldown' | 'sourceBlocked' | 'upstreamUnavailable' | 'invalidResponse'

// Refusal or failure of a download, with the state of its source when it has one.
export class SatelliteRefreshError extends Error {
	// Creates the error.
	constructor(
		message: string,
		readonly code: SatelliteRefreshErrorCode,
		readonly source?: SatelliteSourceState,
	) {
		super(message)
	}
}

// Collaborators of the downloads, injectable in tests.
export interface SatelliteSyncOptions {
	// HTTP client.
	readonly fetch?: CelestrakFetch
	// Wall clock, Unix milliseconds.
	readonly now?: () => number
}

// Interval of a provider, in milliseconds.
function intervalOf(query: CelestrakQuery) {
	return query.provider === 'gp' ? GP_INTERVAL_MS : SATCAT_INTERVAL_MS
}

// True when a status blocks every source.
function blocksEverySource(status: number | undefined) {
	return status !== undefined && (GLOBAL_STATUSES.has(status) || status >= 500)
}

// Downloads of the CelesTrak sources, one at a time for the process.
export class SatelliteSync {
	readonly #fetch: CelestrakFetch
	readonly #now: () => number
	readonly #flights = new Map<string, Promise<SatelliteRefreshResult>>()
	#queue: Promise<unknown> = Promise.resolve()
	#userAgent = celestrakUserAgent()

	// Creates the downloads of store; `changed` is called after each successful publication.
	constructor(
		readonly store: SatelliteStore,
		private readonly changed: () => void,
		options: SatelliteSyncOptions = {},
	) {
		this.#fetch = options.fetch ?? fetch
		this.#now = options.now ?? Date.now
	}

	// Names the running version in the User-Agent of the next requests.
	identify(version: string) {
		this.#userAgent = celestrakUserAgent(version)
	}

	// Earliest instant a source may be downloaded, Unix milliseconds: its own next allowed instant, or a later block of
	// every source after a status that concerns CelesTrak as a whole.
	nextAllowedAt(sourceKey: string) {
		let next = this.store.source(sourceKey)?.nextAllowedAt ?? 0

		for (const source of this.store.sources()) {
			if (blocksEverySource(source.lastStatus) && source.nextAllowedAt > next) next = source.nextAllowedAt
		}

		return next
	}

	// Downloads a source now, or joins the download of it in progress. Rejects with SatelliteRefreshError: notFound for
	// a key outside the allowlist, sourceCooldown inside its interval, sourceBlocked after a failure, and
	// upstreamUnavailable or invalidResponse when this download fails. A caller that stops waiting never stops the
	// download, which other callers may share.
	refresh(sourceKey: string): Promise<SatelliteRefreshResult> {
		const query = parseCelestrakSourceKey(sourceKey)
		if (!query) return Promise.reject(new SatelliteRefreshError(`${sourceKey} is not a CelesTrak query this server makes`, 'notFound'))

		const flight = this.#flights.get(query.sourceKey)
		if (flight) return flight

		const state = this.store.source(query.sourceKey)
		const next = this.nextAllowedAt(query.sourceKey)

		if (this.#now() < next) {
			const blocked = (state?.failures ?? 0) > 0 || next !== state?.nextAllowedAt
			const message = blocked ? `CelesTrak is not queried until ${new Date(next).toISOString()} after a failed download` : `${query.sourceKey} was downloaded at ${new Date(state?.lastSuccessAt ?? 0).toISOString()}; CelesTrak updates it no sooner than every ${intervalOf(query) / 3_600_000} hours`
			return Promise.reject(new SatelliteRefreshError(message, blocked ? 'sourceBlocked' : 'sourceCooldown', state ? { ...state, nextAllowedAt: next } : undefined))
		}

		const download = this.#queue.then(() => this.#download(query, state))
		this.#queue = download.catch(() => undefined)
		const shared = download.finally(() => this.#flights.delete(query.sourceKey))
		this.#flights.set(query.sourceKey, shared)
		return shared
	}

	// Downloads and publishes one source. The attempt is recorded before the request, with the next download pushed past
	// the interval, so neither a failure nor a crash during the request can lead to a repeated download.
	async #download(query: CelestrakQuery, previous: SatelliteSourceState | undefined): Promise<SatelliteRefreshResult> {
		const attemptAt = this.#now()
		const interval = intervalOf(query)
		const base: SatelliteSourceState = previous ?? { sourceKey: query.sourceKey, provider: query.provider, query: `${query.type}=${query.value}`, nextAllowedAt: 0, failures: 0, revision: 0 }
		this.store.saveSource({ ...base, lastAttemptAt: attemptAt, nextAllowedAt: attemptAt + interval })

		const answer = await fetchCelestrak(this.#fetch, query, this.#userAgent, attemptAt)

		if (answer.status !== 'ok') {
			if (answer.status === 'refused') this.#fail(base, attemptAt, interval, answer.message, 'upstreamUnavailable', answer.httpStatus, answer.retryAfter)
			this.#fail(base, attemptAt, interval, answer.message, answer.status === 'invalid' ? 'invalidResponse' : 'upstreamUnavailable')
		}

		const at = this.#now()
		const members = query.type === 'GROUP' ? this.store.members(query.sourceKey) : []

		if (query.type === 'GROUP' && answer.records.length === 0 && members.length > 0) {
			this.#fail(base, attemptAt, interval, `${query.sourceKey} answered no record, though it listed ${members.length}`, 'invalidResponse')
		}

		const success = (records: number, rejected: number): SatelliteSourceState => ({ ...base, lastAttemptAt: attemptAt, lastSuccessAt: at, nextAllowedAt: attemptAt + interval, failures: 0, lastStatus: undefined, lastError: undefined, recordCount: records, rejectedCount: rejected, revision: base.revision + 1 })

		if (query.provider === 'gp') {
			const { records, rejected } = normalizeOmmRecords(answer.records)

			if (records.length === 0 && rejected.length > 0) {
				this.#fail(base, attemptAt, interval, `every record of ${query.sourceKey} failed validation`, 'invalidResponse')
			}

			const source = success(records.length, rejected.length)
			this.store.publish({
				sourceKey: query.sourceKey,
				objects: records.map(({ noradId, name, cosparId }) => ({ noradId, name, cosparId })),
				elements: records.map(({ noradId, epoch, omm, digest }) => ({ noradId, kind: 'gp', sourceKey: query.sourceKey, epoch, omm, digest, fetchedAt: at })),
				members: records.map((record) => record.noradId),
				source,
				at,
			})
			this.changed()
			return { source, records: records.length, rejected: rejected.length }
		}

		const { records, rejected } = normalizeSatcatRecords(answer.records)
		const source = success(records.length, rejected.length)
		this.store.publish({ sourceKey: query.sourceKey, objects: records, elements: [], members: records.map((record) => record.noradId), source, at })
		this.changed()
		return { source, records: records.length, rejected: rejected.length }
	}

	// Records a failed download and throws its error. The source is blocked for its interval, doubled by each failure
	// since the last success up to MAX_BLOCK_MS, and at least for the Retry-After CelesTrak asked for. The data of the
	// source is unchanged.
	#fail(base: SatelliteSourceState, attemptAt: number, interval: number, message: string, code: SatelliteRefreshErrorCode, status?: number, retryAfter = 0): never {
		const failures = base.failures + 1
		const block = Math.max(retryAfter, Math.min(MAX_BLOCK_MS, interval * 2 ** (failures - 1)))
		const source: SatelliteSourceState = { ...base, lastAttemptAt: attemptAt, nextAllowedAt: attemptAt + block, failures, lastStatus: status, lastError: message }
		this.store.saveSource(source)
		throw new SatelliteRefreshError(message, code, source)
	}
}
