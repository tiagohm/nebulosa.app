import { type CloseApproachBody, type CloseApproachCatalogQuery, type CloseApproachObjectQuery, type CloseApproachPage, type CloseApproachQuery, type CloseApproachRow, type CloseApproachSort, closeApproachesUrl, parseCloseApproaches, SmallBodyResponseError } from 'nebulosa/src/adapters/orbits/sbd'
import { time, Timescale, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { type EphemerisKernels, NO_EPHEMERIS_KERNELS } from './ephemeris.chain'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import { type MinorBodies, SbdbUnavailableError } from './sky/minorbodies'
import { SsdBusyError, type SsdRequestQueue, SsdThrottledError, SsdTimeoutError } from './ssd'

// Close Approaches: stateless, read-only queries of the JPL close-approach data (CAD), never operations or events. Each
// row is one encounter of a small body with a target body, not a unique object, and CAD filters, sorts, and pages them
// itself. Identity and details of an object come from SBDB through MinorBodies, by its exact designation, since a CAD row
// has no SPK-ID. Every request goes through the JPL queue; while the ephemeris sources are offline, nothing asks JPL and
// only the pages and objects already read are answered. Close approach is not a measure of risk: nothing here infers
// an impact probability or estimates a diameter. Distances are AU, velocities km/s, and times Unix milliseconds (UTC).

// Budget of one CAD request in milliseconds.
export const CAD_TIMEOUT_MS = 12_000

// How long a page of CAD stays fresh in milliseconds.
const PAGE_TTL_MS = 300_000

// Pages of CAD kept in memory.
const PAGE_CACHE_LIMIT = 64

// Distance limit of the approaches of one object, in AU: far beyond any close approach CAD publishes, since CAD applies
// 0.05 au to one object too when told nothing.
const OBJECT_DISTANCE_LIMIT_AU = 100

// Stable codes of the close approach errors.
export type CloseApproachErrorCode = 'serviceUnavailable' | 'rateLimited' | 'rejected' | 'upstreamSchemaChanged' | 'invalidResponse' | 'offline'

// A page or an object not read before while the ephemeris sources are offline, which forbids asking JPL.
export class CloseApproachesOfflineError extends Error {
	// Creates the error.
	constructor() {
		super('The ephemeris sources are offline, and this was not read from JPL before')
		this.name = 'CloseApproachesOfflineError'
	}
}

// One encounter of a small body with a target body.
export interface CloseApproach extends Omit<CloseApproachRow, 'body'> {
	// Stable within one orbit solution: target, designation, solution, and time. A new solution of the object changes it.
	readonly id: string
	// Target body as CAD names it, such as Earth or Juptr.
	readonly body: string
	// Instant of the approach, Unix milliseconds (UTC), converted from the TDB of `jd` with leap seconds.
	readonly time: number
}

// Filters of the close approaches of every object.
export interface CloseApproachFilters {
	// First day, YYYY-MM-DD in TDB.
	readonly dateMin: string
	// Last day, YYYY-MM-DD in TDB, included whole.
	readonly dateMax: string
	// Target body.
	readonly body: CloseApproachBody
	// Largest nominal distance, in `distanceUnit`.
	readonly distanceMax: number
	// Unit of `distanceMax`.
	readonly distanceUnit: 'au' | 'LD'
	// Only near-Earth objects.
	readonly neoOnly: boolean
	// Only potentially hazardous asteroids.
	readonly phaOnly: boolean
	// Only asteroids (a) or comets (c); every object when absent.
	readonly kind?: 'a' | 'c'
	// Smallest absolute magnitude H.
	readonly hMin?: number
	// Largest absolute magnitude H.
	readonly hMax?: number
	// Order of the rows.
	readonly sort: CloseApproachSort
}

// Filters of the close approaches of one object.
export interface CloseApproachHistoryFilters {
	// First day, YYYY-MM-DD in TDB.
	readonly dateMin: string
	// Last day, YYYY-MM-DD in TDB, included whole.
	readonly dateMax: string
	// Target body.
	readonly body: CloseApproachBody
	// Order of the rows.
	readonly sort: CloseApproachSort
}

// One page of close approaches.
export interface CloseApproachPageResponse<Q> {
	// Filters of the page, whose dates are TDB.
	readonly query: Q
	// 1-based page.
	readonly page: number
	// Rows per page.
	readonly pageSize: number
	// Encounters matching the filters, beyond this page.
	readonly total: number
	// Encounters of the page; empty past the last page.
	readonly rows: readonly CloseApproach[]
	// When the page was read from CAD, Unix milliseconds.
	readonly fetchedAt: number
	// Source of the data.
	readonly source: string
	// Format version of the source.
	readonly sourceVersion: string
}

// CAD answered with an error status other than a throttling one.
class CadAnswerError extends Error {
	// Creates the error with the status of the answer.
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message)
		this.name = 'CadAnswerError'
	}
}

// Page of CAD with when it was read.
interface CachedPage {
	// Page read.
	readonly page: CloseApproachPage
	// When it was read, Unix milliseconds.
	readonly fetchedAt: number
}

// Instant of a CAD Julian date TDB as Unix milliseconds (UTC). The text is split at the point, since one double cannot
// hold its digits, and the timescale conversion of the toolkit gives the true TDB - UTC with leap seconds, and before
// 1960, when UTC did not exist, the UT of the instant (TDB less the best-estimate Delta T).
export function approachTime(jd: string) {
	const [day, fraction = '0'] = jd.split('.')
	return timeToUnixMillis(time(+day, +`0.${fraction}`, Timescale.TDB))
}

// Encounter of a CAD row of a query for `body`; CAD names the target of a row only when asked for every body.
function encounter(row: CloseApproachRow, body: CloseApproachBody): CloseApproach {
	const target = row.body ?? body
	return { ...row, body: target, id: `${target}|${row.designation}|${row.orbitId}|${row.jd}`, time: approachTime(row.jd) }
}

// Close approach queries with their cache of CAD pages, over the minor bodies and the JPL queue of the server.
export class CloseApproachesService {
	readonly #minorBodies: MinorBodies
	readonly #queue: SsdRequestQueue
	readonly #timeoutMs: number
	readonly #now: () => number
	readonly #pages = new LruCache<CachedPage>(PAGE_CACHE_LIMIT)
	readonly #kernels: EphemerisKernels

	// Creates the service; options replace the CAD budget and the clock, and give the offline switch of the ephemeris
	// sources (the SPICE Kernel Library's; online by default).
	constructor(minorBodies: MinorBodies, queue: SsdRequestQueue, options: { readonly timeoutMs?: number; readonly now?: () => number; readonly kernels?: EphemerisKernels } = {}) {
		this.#minorBodies = minorBodies
		this.#queue = queue
		this.#timeoutMs = options.timeoutMs ?? CAD_TIMEOUT_MS
		this.#now = options.now ?? Date.now
		this.#kernels = options.kernels ?? NO_EPHEMERIS_KERNELS
	}

	// Page of the close approaches of every object.
	async catalog(filters: CloseApproachFilters, page: number, pageSize: number, refresh: boolean, signal?: AbortSignal): Promise<CloseApproachPageResponse<CloseApproachFilters>> {
		const query: CloseApproachCatalogQuery = { selector: 'catalog', ...filters, limit: pageSize, offset: (page - 1) * pageSize }
		return await this.#page(query, filters, page, pageSize, refresh, signal)
	}

	// Page of the close approaches of the object of an SPK-ID, to any distance.
	async history(spkId: string, filters: CloseApproachHistoryFilters, page: number, pageSize: number, refresh: boolean, signal?: AbortSignal): Promise<CloseApproachPageResponse<CloseApproachHistoryFilters>> {
		const query: CloseApproachObjectQuery = { selector: 'spk', spkId, ...filters, distanceMax: OBJECT_DISTANCE_LIMIT_AU, distanceUnit: 'au', limit: pageSize, offset: (page - 1) * pageSize }
		return await this.#page(query, filters, page, pageSize, refresh, signal)
	}

	// Identity and details of the object of a designation; offline, only those already read, or CloseApproachesOfflineError.
	async object(designation: string, signal?: AbortSignal) {
		if (!this.#kernels.current().offline) return await this.#minorBodies.details(designation, signal)
		const cached = this.#minorBodies.cachedDetails(designation)
		if (!cached) throw new CloseApproachesOfflineError()
		return cached
	}

	// Answers a page from the cache or CAD; `refresh` reads it again whatever its age.
	async #page<Q>(query: CloseApproachQuery, filters: Q, page: number, pageSize: number, refresh: boolean, signal?: AbortSignal): Promise<CloseApproachPageResponse<Q>> {
		const { page: read, fetchedAt } = await this.#read(closeApproachesUrl(query), refresh, signal)
		return { query: filters, page, pageSize, total: read.total, rows: read.rows.map((row) => encounter(row, query.body)), fetchedAt, source: read.signature.source, sourceVersion: read.signature.version }
	}

	// Reads a page of CAD in a turn of the JPL queue, keeping only successes; offline, the page already read whatever its
	// age, or CloseApproachesOfflineError.
	async #read(url: string, refresh: boolean, signal?: AbortSignal): Promise<CachedPage> {
		const cached = this.#pages.get(url)

		if (this.#kernels.current().offline) {
			if (!cached) throw new CloseApproachesOfflineError()
			return cached
		}

		if (cached && !refresh && this.#now() - cached.fetchedAt < PAGE_TTL_MS) return cached

		const page = await this.#queue.run((taskSignal) => this.#download(url, taskSignal), { timeoutMs: this.#timeoutMs, signal, key: `cad:${url}` })
		const entry = { page, fetchedAt: this.#now() }
		this.#pages.set(url, entry)
		return entry
	}

	// Downloads and parses a page of CAD.
	async #download(url: string, signal: AbortSignal) {
		const response = await this.#queue.fetch(url, signal)

		if (!response.ok) {
			const { message } = (await response.json().catch(() => ({}))) as { readonly message?: string }
			throw new CadAnswerError(response.status, message ?? `CAD answered ${response.status}`)
		}

		return parseCloseApproaches((await response.json()) as Parameters<typeof parseCloseApproaches>[0])
	}
}

// Answers a failure of JPL with a stable code, or rethrows what is not one, such as the abort of the request.
function failure(error: unknown): Response {
	if (error instanceof CloseApproachesOfflineError) return errorResponse(error.message, 503, 'offline' satisfies CloseApproachErrorCode)
	const cause = error instanceof SbdbUnavailableError ? error.cause : error
	if (cause instanceof SsdThrottledError) return errorResponse(cause.message, 503, 'rateLimited' satisfies CloseApproachErrorCode, { retryAfter: cause.retryAfter })
	if (error instanceof SbdbUnavailableError || error instanceof SsdBusyError || error instanceof SsdTimeoutError) return errorResponse(error.message, 503, 'serviceUnavailable' satisfies CloseApproachErrorCode)
	if (error instanceof CadAnswerError) return error.status === 400 ? errorResponse(error.message, 502, 'rejected' satisfies CloseApproachErrorCode) : errorResponse(error.message, 503, 'serviceUnavailable' satisfies CloseApproachErrorCode)
	if (error instanceof SmallBodyResponseError)
		return error.kind === 'unsupportedVersion'
			? errorResponse(`JPL changed its format: ${error.message}`, 502, 'upstreamSchemaChanged' satisfies CloseApproachErrorCode, { version: error.version })
			: errorResponse(`JPL answered an unreadable table: ${error.message}`, 502, 'invalidResponse' satisfies CloseApproachErrorCode)
	if (error instanceof SyntaxError) return errorResponse('JPL answered something other than JSON', 502, 'invalidResponse' satisfies CloseApproachErrorCode)
	if (error instanceof TypeError) return errorResponse('JPL cannot be reached', 503, 'serviceUnavailable' satisfies CloseApproachErrorCode)
	throw error
}

// Runs a query of a route, answering a failure of JPL with its code; the abort of a request that left is not answered.
async function answer(req: Request, query: () => Promise<unknown>) {
	try {
		return Response.json(await query())
	} catch (error) {
		if (req.signal.aborted) throw error
		return failure(error)
	}
}

// Reads the optional number of a query parameter.
function numberParam(params: URLSearchParams, name: string) {
	const value = params.get(name)
	return value ? +value : undefined
}

// Reads the filters of a catalog page.
function catalogFilters(params: URLSearchParams): CloseApproachFilters {
	return {
		dateMin: params.get('dateMin')!,
		dateMax: params.get('dateMax')!,
		body: params.get('body') as CloseApproachBody,
		distanceMax: +params.get('distanceMax')!,
		distanceUnit: params.get('distanceUnit') as CloseApproachFilters['distanceUnit'],
		neoOnly: params.get('neoOnly') === 'true',
		phaOnly: params.get('phaOnly') === 'true',
		kind: (params.get('kind') as CloseApproachFilters['kind'] | null) ?? undefined,
		hMin: numberParam(params, 'hMin'),
		hMax: numberParam(params, 'hMax'),
		sort: params.get('sort') as CloseApproachSort,
	}
}

// Reads the filters of a page of one object.
function historyFilters(params: URLSearchParams): CloseApproachHistoryFilters {
	return { dateMin: params.get('dateMin')!, dateMax: params.get('dateMax')!, body: params.get('body') as CloseApproachBody, sort: params.get('sort') as CloseApproachSort }
}

// Creates the routes of the Close Approaches tool. The tool checks the filters, so they are taken as valid.
export function createCloseApproachRoutes(service: CloseApproachesService) {
	return {
		'/api/close-approaches': {
			// A page of the close approaches of every object; `refresh=true` reads CAD again.
			GET: (req: Request) => {
				const params = new URL(req.url).searchParams
				return answer(req, () => service.catalog(catalogFilters(params), +params.get('page')!, +params.get('pageSize')!, params.get('refresh') === 'true', req.signal))
			},
		},
		'/api/close-approaches/objects': {
			// Identity and details of an object by its exact designation: found, ambiguous, or notFound, all answered 200.
			GET: (req: Request) => answer(req, () => service.object(new URL(req.url).searchParams.get('designation')!, req.signal)),
		},
		'/api/close-approaches/objects/:spkId/approaches': {
			// A page of the close approaches of one object, to any distance.
			GET: (req) => {
				const params = new URL(req.url).searchParams
				return answer(req, () => service.history(req.params.spkId, historyFilters(params), +params.get('page')!, +params.get('pageSize')!, params.get('refresh') === 'true', req.signal))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
