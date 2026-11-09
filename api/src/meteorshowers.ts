import { IAU_METEOR_SHOWER_CATALOG_URL } from 'nebulosa/src/adapters/catalogs/iau.meteor.showers'
import { meteorSolarLongitude } from 'nebulosa/src/astronomy/meteors/solar'
import type { MeteorShowerActivity, MeteorShowerSolution, MeteorShowerStatus } from 'nebulosa/src/astronomy/meteors/types'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import bundledCatalogPath from '../data/meteor.showers.json.gz' with { type: 'file' }
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import {
	activityAt,
	MAX_STATE_IDS,
	type MeteorActivityState,
	type MeteorObservingNight,
	type MeteorObservingRequest,
	type MeteorShowerOccurrence,
	type MeteorShowerStates,
	type MeteorShowerStatesRequest,
	type MeteorSkyRadiants,
	meteorShowerStatesAt,
	observingNight,
	occurrenceInstant,
	occurrencesOverlapping,
	skyRadiantsAt,
} from './meteorshowers.astronomy'
import { activityKindOf, filterMeteorShowers, indexMeteorCatalog, type MeteorCatalogIndex, MeteorCatalogInvalidError, type MeteorShowerFilter, type MeteorShowerGap, type MeteorShowerIdentity, type MeteorShowerRecord, type MeteorSolutionSelection, preferredSolution } from './meteorshowers.catalog'
import { MeteorSolarLongitudeTable } from './meteorshowers.solar'
import type { MeteorCatalogFailureCode, MeteorShowerStore } from './meteorshowers.store'
import { METEOR_ANNUAL_PREDICTION_YEARS, METEOR_VISUAL_REVISION, METEOR_VISUAL_SOURCES, type MeteorDataBasis, type MeteorVisualEntry, type MeteorVisualSource } from './meteorshowers.visual'
import { fetchUpstream, type UpstreamFetch, UpstreamTooLargeError, UpstreamUnavailableError } from './sky/remote'

// Meteor Showers service: the IAU Meteor Data Center stream catalog with its curated visual subset, listed, searched,
// dated, and located for the Meteor Showers tool and the Sky, and the geometric observing night of a shower from a site.
// The catalog in use is the snapshot the operator last downloaded, kept in the operational database, or the one bundled
// with the application (bun make:meteors) when none is or when the bundled one is newer; a fresh installation works
// offline at once. A refresh is explicit, downloads only the official URL with a timeout and a size limit, validates the
// document before writing it, and activates it in one transaction, so a failure keeps the catalog in use; it publishes
// meteorShowers:changed. Nothing here moves a device, changes the Sky clock, a site, or a profile, or starts an operation.

// Stable codes of the error responses: 404 notFound for an unknown shower; 502 upstreamUnavailable, invalidCatalog, or
// catalogTooLarge for a refresh the Data Center did not answer usably; 500 persistenceFailure when it could not be saved.
export type MeteorShowersErrorCode = 'notFound' | MeteorCatalogFailureCode

// A failed request with its code and status.
export class MeteorShowersError extends Error {
	constructor(
		message: string,
		readonly code: MeteorShowersErrorCode,
		readonly status: number,
	) {
		super(message)
	}
}

// Where the catalog in use comes from: bundled with the application, or downloaded by the operator.
export type MeteorCatalogOrigin = 'bundled' | 'refreshed'

// The IAU catalog in use and the state of its source.
export interface MeteorCatalogSourceSummary {
	// Where the catalog in use comes from.
	readonly origin: MeteorCatalogOrigin
	// Source label the document names itself with.
	readonly source: string
	// Version the document names itself with; empty for the placeholder of bun make:meteors --empty.
	readonly version: string
	// SHA-256 of the document's bytes.
	readonly sha256: string
	// URL it was downloaded from; for the bundled one, the official URL.
	readonly url: string
	// When it was downloaded, Unix milliseconds; absent for the bundled one.
	readonly retrievedAt?: number
	// Shower records.
	readonly recordCount: number
	// Solutions of all records.
	readonly solutionCount: number
	// Revision of the catalog in use; answers computed from another revision are out of date.
	readonly revision: number
	// Whether a refresh is running.
	readonly refreshing: boolean
	// When the last refresh started, Unix milliseconds; absent before the first one.
	readonly lastAttemptAt?: number
	// When the last refresh failed, Unix milliseconds; absent when it succeeded or none failed.
	readonly lastFailureAt?: number
	// Code of the last failure; absent when the last refresh succeeded or none failed.
	readonly lastErrorCode?: MeteorCatalogFailureCode
}

// The curated visual data in use.
export interface MeteorVisualSummary {
	// Revision of the curated data, raised by every release that changes it.
	readonly revision: number
	// Number of showers it covers.
	readonly showerCount: number
	// Its sources.
	readonly sources: readonly MeteorVisualSource[]
	// Civil years whose year-specific notes were curated.
	readonly annualPredictionYears: readonly number[]
}

// Answer of GET /api/meteor-showers/sources and of a refresh.
export interface MeteorShowersSources {
	readonly iau: MeteorCatalogSourceSummary
	readonly visual: MeteorVisualSummary
}

// Pushed to every tab once a refreshed catalog is active.
export interface MeteorShowersChangedEvent {
	readonly type: 'meteorShowers:changed'
	// Revision of the new catalog.
	readonly revision: number
	// The new catalog and its source.
	readonly sources: MeteorShowersSources
}

// The activity of a shower now, and which source decided it.
export interface MeteorShowerActivityNow {
	// Activity at the instant of the answer.
	readonly state: MeteorActivityState
	// Source that decided it.
	readonly basis: MeteorDataBasis
}

// One shower of a listing.
export interface MeteorShowerSummary {
	// Id of the shower.
	readonly id: string
	// How long the id lasts.
	readonly identity: MeteorShowerIdentity
	// IAU number; absent when the record has none.
	readonly number?: number
	// IAU code; absent when the record has none.
	readonly code?: string
	// Name shown.
	readonly name: string
	// Name as the IAU catalog writes it.
	readonly iauName: string
	// Status of the shower record.
	readonly status: MeteorShowerStatus
	// Kind of activity of the preferred solution; unknown without one.
	readonly activityKind: MeteorShowerActivity['kind']
	// Curated visual entry; absent without visual data.
	readonly visual?: MeteorVisualEntry
	// Radiant of the preferred solution at its reference longitude, radians, geocentric J2000; absent without one.
	readonly radiant?: { readonly rightAscension: number; readonly declination: number }
	// What the preferred solution leaves unknown.
	readonly gaps: readonly MeteorShowerGap[]
	// Activity at the instant of the answer.
	readonly activityNow: MeteorShowerActivityNow
	// The occurrence the listing is about (the next one, or the year's); absent when no source dates it.
	readonly occurrence?: MeteorShowerOccurrence
}

// Order of a listing: next occurrence first (by its visual maximum, else its IAU reference), name, or IAU number.
export type MeteorShowerSort = 'nextPeak' | 'name' | 'number'

// Query of GET /api/meteor-showers.
export interface MeteorShowerListRequest extends MeteorShowerFilter {
	// Whether to keep only the showers active now (true) or only those not active (false).
	readonly active?: boolean
	// Civil UTC year whose occurrence each row gives; absent for the next occurrence from now.
	readonly year?: number
	// Order of the rows.
	readonly sort?: MeteorShowerSort
	// Rows skipped.
	readonly offset?: number
	// Rows answered, at most MAX_LIST_LIMIT.
	readonly limit?: number
}

// A page of a listing.
export interface MeteorShowerListPage {
	// Revision of the catalog the page comes from.
	readonly revision: number
	// Instant the activity and the next occurrences refer to, Unix milliseconds.
	readonly time: number
	// Rows matching the filter.
	readonly total: number
	// Rows skipped.
	readonly offset: number
	// The rows.
	readonly showers: readonly MeteorShowerSummary[]
}

// Answer of GET /api/meteor-showers/:id.
export interface MeteorShowerDetail extends MeteorShowerSummary {
	// Revision of the catalog the answer comes from.
	readonly revision: number
	// Provisional name; absent when the record has none.
	readonly provisionalName?: string
	// Status integer as published; absent when the record has none.
	readonly sourceStatus?: number
	// Every published solution, in source order, never merged.
	readonly solutions: readonly MeteorShowerSolution[]
	// Index of the preferred solution; absent when none is eligible.
	readonly selected?: number
	// How the preferred solution was chosen.
	readonly selectedBy: MeteorSolutionSelection
	// Source of the visual entry; absent without one.
	readonly visualSource?: MeteorVisualSource
	// The occurrences of the previous, current, and next civil year, chronologically.
	readonly occurrences: readonly MeteorShowerOccurrence[]
	// Whether year-specific notes were curated for the year of the instant of the answer.
	readonly annualPredictionAvailable: boolean
}

// Request of POST /api/meteor-showers/calendar.
export interface MeteorShowersCalendarRequest {
	// Civil UTC year.
	readonly year: number
	// First month, 1 to 12; 1 by default.
	readonly fromMonth?: number
	// Last month, inclusive, 1 to 12; 12 by default.
	readonly toMonth?: number
	// Filter of the showers listed.
	readonly filter?: MeteorShowerFilter
}

// One shower of the calendar with one of its occurrences.
export interface MeteorShowersCalendarEntry {
	readonly id: string
	readonly name: string
	readonly code?: string
	readonly status: MeteorShowerStatus
	// Whether the shower has curated visual data.
	readonly visual: boolean
	// The occurrence, overlapping the span.
	readonly occurrence: MeteorShowerOccurrence
}

// Answer of POST /api/meteor-showers/calendar.
export interface MeteorShowersCalendar {
	// Revision of the catalog the answer comes from.
	readonly revision: number
	// First instant of the span, Unix milliseconds (UTC).
	readonly start: number
	// End of the span, exclusive, Unix milliseconds (UTC).
	readonly end: number
	// Occurrences overlapping the span, by the instant that stands for each.
	readonly entries: readonly MeteorShowersCalendarEntry[]
}

// Request of POST /api/meteor-showers/radiants.
export interface MeteorSkyRadiantsRequest {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
}

// Dependencies of the service.
export interface MeteorShowersOptions {
	// Snapshots and source state in the operational database.
	readonly store: MeteorShowerStore
	// Nights of a site (AstroWeatherService.night), called in process.
	readonly night: (request: AstroWeatherNightRequest) => AstroWeatherNight
	// Pushes an event to every tab.
	readonly publish: (event: MeteorShowersChangedEvent) => void
	// Fetch of the Data Center, injectable in tests.
	readonly fetch?: UpstreamFetch
	// Wall clock, Unix milliseconds, injectable in tests.
	readonly now?: () => number
	// Reads the bundled document's text, injectable in tests.
	readonly bundled?: () => Promise<string>
}

// Most rows a listing answers.
export const MAX_LIST_LIMIT = 100

// Most time a refresh waits for the Data Center, milliseconds.
const REFRESH_TIMEOUT_MS = 60_000

// Largest document a refresh accepts, bytes: about ten times the 2026 one (3.2 MB).
const REFRESH_MAX_BYTES = 32 * 1024 * 1024

// Smallest share of the catalog in use a refreshed document must keep, below which it is taken for a truncated one.
const MINIMUM_RECORD_SHARE = 0.5

// Observing nights kept: a few showers for a few sites and evenings.
const NIGHT_CACHE_LIMIT = 64

// One day, milliseconds.
const DAY_MS = 86400000

// The catalog in use.
interface ActiveCatalog {
	readonly index: MeteorCatalogIndex
	readonly origin: MeteorCatalogOrigin
	readonly sha256: string
	readonly url: string
	readonly retrievedAt?: number
}

// Reads the bundled document, gzipped JSON written by bun make:meteors.
async function readBundled() {
	return new TextDecoder().decode(Bun.gunzipSync(await Bun.file(bundledCatalogPath).bytes()))
}

// SHA-256 of a text's UTF-8 bytes, lowercase hexadecimal.
function sha256(text: string) {
	return new Bun.CryptoHasher('sha256').update(text).digest('hex')
}

// Whether a version is an ISO calendar date, which the Data Center names its documents with.
function isIsoDate(version: string) {
	return /^\d{4}-\d{2}-\d{2}$/.test(version)
}

// Meteor shower catalog, dates, positions, and observing nights.
export class MeteorShowersService {
	readonly #table = new MeteorSolarLongitudeTable()
	readonly #nights = new LruCache<MeteorObservingNight>(NIGHT_CACHE_LIMIT)
	readonly #fetch: UpstreamFetch
	readonly #now: () => number
	readonly #bundled: () => Promise<string>
	#active?: Promise<ActiveCatalog>
	#refreshing?: Promise<MeteorShowersSources>

	constructor(readonly options: MeteorShowersOptions) {
		this.#fetch = options.fetch ?? ((url, init) => fetch(url, init))
		this.#now = options.now ?? Date.now
		this.#bundled = options.bundled ?? readBundled
	}

	// The catalog in use, loaded on first use: the active snapshot of the database, unless the bundled document has a later
	// ISO date as its version (an application upgraded past an older download); the bundled one when none is active.
	#catalog(): Promise<ActiveCatalog> {
		this.#active ??= this.#load()
		return this.#active
	}

	async #load(): Promise<ActiveCatalog> {
		const snapshot = this.options.store.active()
		const bundledText = await this.#bundled()
		const bundled = indexMeteorCatalog(bundledText)

		if (snapshot !== undefined && !(isIsoDate(bundled.version) && isIsoDate(snapshot.version) && bundled.version > snapshot.version)) {
			return { index: indexMeteorCatalog(snapshot.payload), origin: 'refreshed', sha256: snapshot.sha256, url: snapshot.url, retrievedAt: snapshot.retrievedAt }
		}

		return { index: bundled, origin: 'bundled', sha256: sha256(bundledText), url: IAU_METEOR_SHOWER_CATALOG_URL }
	}

	// The catalog in use and the state of its source.
	async sources(): Promise<MeteorShowersSources> {
		const catalog = await this.#catalog()
		const state = this.options.store.state()
		return {
			iau: {
				origin: catalog.origin,
				source: catalog.index.source,
				version: catalog.index.version,
				sha256: catalog.sha256,
				url: catalog.url,
				...(catalog.retrievedAt !== undefined && { retrievedAt: catalog.retrievedAt }),
				recordCount: catalog.index.recordCount,
				solutionCount: catalog.index.solutionCount,
				revision: state.revision,
				refreshing: this.#refreshing !== undefined,
				...(state.lastAttemptAt !== undefined && { lastAttemptAt: state.lastAttemptAt }),
				...(state.lastFailureAt !== undefined && { lastFailureAt: state.lastFailureAt }),
				...(state.lastErrorCode !== undefined && { lastErrorCode: state.lastErrorCode }),
			},
			visual: { revision: METEOR_VISUAL_REVISION, showerCount: catalog.index.showers.filter((record) => record.visual !== undefined).length, sources: Object.values(METEOR_VISUAL_SOURCES), annualPredictionYears: METEOR_ANNUAL_PREDICTION_YEARS },
		}
	}

	// Downloads the official catalog again and activates it when it is valid and differs from the one in use. Concurrent
	// calls share one download. Throws MeteorShowersError, keeping the catalog in use, when the Data Center does not answer,
	// answers with something too large or that is not a plausible stream catalog, or the snapshot cannot be saved.
	refresh(): Promise<MeteorShowersSources> {
		this.#refreshing ??= this.#refresh().finally(() => {
			this.#refreshing = undefined
		})
		return this.#refreshing
	}

	async #refresh(): Promise<MeteorShowersSources> {
		const current = await this.#catalog()
		const startedAt = this.#now()
		this.#persist(() => this.options.store.recordAttempt(startedAt))

		try {
			let text: string

			try {
				const body = await fetchUpstream(this.#fetch, IAU_METEOR_SHOWER_CATALOG_URL, '', REFRESH_TIMEOUT_MS, REFRESH_MAX_BYTES)
				text = new TextDecoder().decode(body.bytes)
			} catch (error) {
				if (error instanceof UpstreamTooLargeError) throw new MeteorShowersError(error.message, 'catalogTooLarge', 502)
				if (error instanceof UpstreamUnavailableError) throw new MeteorShowersError(error.message, 'upstreamUnavailable', 502)
				throw error
			}

			let index: MeteorCatalogIndex

			try {
				index = indexMeteorCatalog(text)
			} catch (error) {
				if (error instanceof MeteorCatalogInvalidError) throw new MeteorShowersError(`The IAU catalog is not valid: ${error.message}`, 'invalidCatalog', 502)
				throw error
			}

			if (index.recordCount === 0 || index.recordCount < current.index.recordCount * MINIMUM_RECORD_SHARE) {
				throw new MeteorShowersError(`The IAU catalog has ${index.recordCount} records, too few beside the ${current.index.recordCount} in use`, 'invalidCatalog', 502)
			}

			const hash = sha256(text)
			if (hash === current.sha256) return await this.sources()

			const retrievedAt = this.#now()
			const revision = this.#persist(() => this.options.store.install({ version: index.version, sha256: hash, url: IAU_METEOR_SHOWER_CATALOG_URL, retrievedAt, recordCount: index.recordCount, solutionCount: index.solutionCount, payload: text }))
			this.#active = Promise.resolve({ index, origin: 'refreshed', sha256: hash, url: IAU_METEOR_SHOWER_CATALOG_URL, retrievedAt })
			this.#refreshing = undefined
			const sources = await this.sources()
			this.options.publish({ type: 'meteorShowers:changed', revision, sources })
			return sources
		} catch (error) {
			if (error instanceof MeteorShowersError && error.code !== 'persistenceFailure') this.#persist(() => this.options.store.recordFailure(this.#now(), error.code as MeteorCatalogFailureCode))
			throw error
		}
	}

	// Runs a write of the store, turning a database failure into persistenceFailure.
	#persist<T>(write: () => T): T {
		try {
			return write()
		} catch (error) {
			throw new MeteorShowersError(`The meteor shower catalog could not be saved: ${error instanceof Error ? error.message : String(error)}`, 'persistenceFailure', 500)
		}
	}

	// A page of the showers the filter keeps, each with its activity now and its next occurrence (or the year's).
	async list(request: MeteorShowerListRequest): Promise<MeteorShowerListPage> {
		const { index } = await this.#catalog()
		const time = this.#now()
		const revision = this.options.store.state().revision
		const solarLongitude = meteorSolarLongitude(timeUnix(time / 1000, true))
		let rows = filterMeteorShowers(index, request).map((record) => this.#summary(record, time, solarLongitude, request.year))
		if (request.active !== undefined) rows = rows.filter((row) => (row.activityNow.state === 'active') === request.active)

		const sort = request.sort ?? 'nextPeak'
		const key = (row: MeteorShowerSummary) => (row.occurrence === undefined ? Number.POSITIVE_INFINITY : (occurrenceInstant(row.occurrence) ?? Number.POSITIVE_INFINITY))
		rows.sort((a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'number' ? (a.number ?? Number.POSITIVE_INFINITY) - (b.number ?? Number.POSITIVE_INFINITY) : key(a) - key(b)) || a.id.localeCompare(b.id))

		const offset = request.offset ?? 0
		const limit = Math.min(request.limit ?? 50, MAX_LIST_LIMIT)
		return { revision, time, total: rows.length, offset, showers: rows.slice(offset, offset + limit) }
	}

	// Detail of one shower. Throws MeteorShowersError notFound for an id the catalog does not know.
	async detail(id: string): Promise<MeteorShowerDetail> {
		const record = await this.#record(id)
		const time = this.#now()
		const solarLongitude = meteorSolarLongitude(timeUnix(time / 1000, true))
		const year = new Date(time).getUTCFullYear()
		const occurrences = occurrencesOverlapping(record, Date.UTC(year - 1, 0, 1), Date.UTC(year + 2, 0, 1), this.#table)
		return {
			...this.#summary(record, time, solarLongitude, undefined),
			revision: this.options.store.state().revision,
			provisionalName: record.provisionalName,
			sourceStatus: record.sourceStatus,
			solutions: record.solutions,
			selected: record.selected,
			selectedBy: record.selectedBy,
			...(record.visual && { visualSource: METEOR_VISUAL_SOURCES[record.visual.sourceId] }),
			occurrences,
			annualPredictionAvailable: METEOR_ANNUAL_PREDICTION_YEARS.includes(year),
		}
	}

	// The occurrences of the filtered showers overlapping months of a civil year, by the instant that stands for each.
	async calendar(request: MeteorShowersCalendarRequest): Promise<MeteorShowersCalendar> {
		const { index } = await this.#catalog()
		const start = Date.UTC(request.year, (request.fromMonth ?? 1) - 1, 1)
		const end = Date.UTC(request.year, request.toMonth ?? 12, 1)
		const entries: MeteorShowersCalendarEntry[] = []

		for (const record of filterMeteorShowers(index, request.filter ?? {})) {
			for (const occurrence of occurrencesOverlapping(record, start, end, this.#table)) {
				entries.push({ id: record.id, name: record.name, ...(record.code && { code: record.code }), status: record.status, visual: record.visual !== undefined, occurrence })
			}
		}

		entries.sort((a, b) => (occurrenceInstant(a.occurrence) ?? 0) - (occurrenceInstant(b.occurrence) ?? 0) || a.id.localeCompare(b.id))
		return { revision: this.options.store.state().revision, start, end, entries }
	}

	// State of a batch of showers at an instant; ids the catalog does not know are left out.
	async states(request: MeteorShowerStatesRequest): Promise<MeteorShowerStates> {
		const { index } = await this.#catalog()
		const records = request.ids
			.slice(0, MAX_STATE_IDS)
			.map((id) => index.byId.get(id))
			.filter((record) => record !== undefined)
		return meteorShowerStatesAt(records, request, this.#table)
	}

	// Radiants the Sky draws at an instant.
	async radiants(request: MeteorSkyRadiantsRequest): Promise<MeteorSkyRadiants> {
		const { index } = await this.#catalog()
		return skyRadiantsAt(index.showers, request.time, this.#table)
	}

	// Geometric observing night of a shower, cached by the catalog revision, the shower, the site's place, the evening, and
	// the constraints; the site's zone names the evening, so it is part of the key. Throws MeteorShowersError notFound.
	async observing(id: string, request: MeteorObservingRequest): Promise<MeteorObservingNight> {
		const record = await this.#record(id)
		const { site } = request
		const key = JSON.stringify([this.options.store.state().revision, id, site.latitude, site.longitude, site.elevation, site.timeZone, request.eveningDate, request.maximumSolarAltitude, request.minimumRadiantAltitude, request.minimumMoonSeparation, request.maximumMoonIllumination])
		const cached = this.#nights.get(key)
		if (cached) return cached
		const night = observingNight(record, request, this.options.night, this.#table)
		this.#nights.set(key, night)
		return night
	}

	// Shower of an id, or MeteorShowersError notFound.
	async #record(id: string): Promise<MeteorShowerRecord> {
		const { index } = await this.#catalog()
		const record = index.byId.get(id)
		if (record === undefined) throw new MeteorShowersError(`No meteor shower ${id}`, 'notFound', 404)
		return record
	}

	// Row of a shower: its activity at the instant and its next occurrence after it, or the occurrence of a civil year.
	#summary(record: MeteorShowerRecord, time: number, solarLongitude: number, year: number | undefined): MeteorShowerSummary {
		const solution = preferredSolution(record)
		const from = year === undefined ? time : Date.UTC(year, 0, 1)
		const to = year === undefined ? time + 400 * DAY_MS : Date.UTC(year + 1, 0, 1)
		const occurrences = occurrencesOverlapping(record, from, to, this.#table)
		const occurrence = year === undefined ? occurrences.find((candidate) => (occurrenceInstant(candidate) ?? Number.NEGATIVE_INFINITY) >= time || (candidate.visual?.end ?? candidate.iau?.end ?? 0) >= time) : occurrences[0]
		const { state, basis } = activityAt(record, time, solarLongitude, this.#table)

		return {
			id: record.id,
			identity: record.identity,
			...(record.number !== undefined && { number: record.number }),
			...(record.code && { code: record.code }),
			name: record.name,
			iauName: record.iauName,
			status: record.status,
			activityKind: activityKindOf(record),
			...(record.visual && { visual: record.visual }),
			...(solution?.rightAscension !== undefined && solution.declination !== undefined && { radiant: { rightAscension: solution.rightAscension, declination: solution.declination } }),
			gaps: record.gaps,
			activityNow: { state, basis },
			...(occurrence && { occurrence }),
		}
	}
}

// Answers a computation, turning a MeteorShowersError into its status and code.
async function answer(compute: () => Promise<unknown>): Promise<Response> {
	try {
		return Response.json(await compute())
	} catch (error) {
		if (!(error instanceof MeteorShowersError)) throw error
		return errorResponse(error.message, error.status, error.code)
	}
}

// Reads a list of a query parameter separated by commas; absent when the parameter is.
function listParam(params: URLSearchParams, name: string): readonly string[] | undefined {
	const value = params.get(name)
	return value === null || value === '' ? undefined : value.split(',')
}

// Reads a boolean query parameter; absent when the parameter is.
function booleanParam(params: URLSearchParams, name: string): boolean | undefined {
	const value = params.get(name)
	return value === null || value === '' ? undefined : value === 'true'
}

// Reads a number query parameter; absent when the parameter is.
function numberParam(params: URLSearchParams, name: string): number | undefined {
	const value = params.get(name)
	return value === null || value === '' ? undefined : Number(value)
}

// Routes of the Meteor Showers service.
export function createMeteorShowersRoutes(service: MeteorShowersService) {
	return {
		'/api/meteor-showers': {
			// A page of the catalog (query, status, activity, visual, missing, latitude, minimumAltitude, active, year, sort,
			// offset, limit → MeteorShowerListPage).
			GET: (req) => {
				const params = new URL(req.url).searchParams
				const request: MeteorShowerListRequest = {
					query: params.get('query') ?? undefined,
					status: listParam(params, 'status') as readonly MeteorShowerStatus[] | undefined,
					activity: listParam(params, 'activity') as readonly MeteorShowerActivity['kind'][] | undefined,
					visual: booleanParam(params, 'visual'),
					missing: booleanParam(params, 'missing'),
					latitude: numberParam(params, 'latitude'),
					minimumAltitude: numberParam(params, 'minimumAltitude'),
					active: booleanParam(params, 'active'),
					year: numberParam(params, 'year'),
					sort: (params.get('sort') as MeteorShowerSort | null) ?? undefined,
					offset: numberParam(params, 'offset'),
					limit: numberParam(params, 'limit'),
				}
				return answer(() => service.list(request))
			},
		},
		'/api/meteor-showers/sources': {
			// The catalog in use and the state of its source (→ MeteorShowersSources).
			GET: () => answer(() => service.sources()),
		},
		'/api/meteor-showers/sources/iau/refresh': {
			// Downloads the official catalog again (→ MeteorShowersSources); 502 or 500 keeps the catalog in use.
			POST: () => answer(() => service.refresh()),
		},
		'/api/meteor-showers/calendar': {
			// Occurrences overlapping months of a year (MeteorShowersCalendarRequest → MeteorShowersCalendar).
			POST: async (req) => {
				const request = (await req.json()) as MeteorShowersCalendarRequest
				return answer(() => service.calendar(request))
			},
		},
		'/api/meteor-showers/states': {
			// State of a batch of showers at an instant (MeteorShowerStatesRequest → MeteorShowerStates).
			POST: async (req) => {
				const request = (await req.json()) as MeteorShowerStatesRequest
				return answer(() => service.states(request))
			},
		},
		'/api/meteor-showers/radiants': {
			// Radiants the Sky draws at an instant (MeteorSkyRadiantsRequest → MeteorSkyRadiants).
			POST: async (req) => {
				const request = (await req.json()) as MeteorSkyRadiantsRequest
				return answer(() => service.radiants(request))
			},
		},
		'/api/meteor-showers/:id': {
			// Detail of one shower (→ MeteorShowerDetail); 404 notFound.
			GET: (req) => answer(() => service.detail(decodeURIComponent(req.params.id))),
		},
		'/api/meteor-showers/:id/observing': {
			// Geometric observing night of one shower (MeteorObservingRequest → MeteorObservingNight); 404 notFound.
			POST: async (req) => {
				const request = (await req.json()) as MeteorObservingRequest
				return answer(() => service.observing(decodeURIComponent(req.params.id), request))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
