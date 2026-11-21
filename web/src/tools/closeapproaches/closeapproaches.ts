import type { CloseApproach, CloseApproachBody, CloseApproachErrorCode, CloseApproachFilters, CloseApproachHistoryFilters, CloseApproachPageResponse, CloseApproachSort, CloseApproachSortField, MinorBody, MinorBodyDetailsResponse, SkyPositionResponse } from 'api'
import { AU_KM } from 'nebulosa/src/core/constants'
import { proxy } from 'valtio'
import { formatSpeed } from '../../format'
import { type ApiFetch, ApiResponseError, browserFetch, fetchJson } from '../../http'
import { type GeographicLocation, locationKey, siteObserver } from '../../location/site'
import { type CloseApproachDistanceDisplay, type CloseApproachPreferences, DEFAULT_CLOSE_APPROACH_PREFERENCES } from '../../profile/schema'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { setSkyTime, type SkyClock, skyClock, skyTime } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { browserSkyIo, fetchSkyPosition, type SkyIo, type SkyState, selectSkyObject, skyState } from '../../sky/sky'

// State of the Close Approaches tool, tab-lived and never sent anywhere: the filters being edited, those of the page
// shown, the encounter selected, and the object behind it. The server reads JPL, which filters, sorts, and pages the
// encounters itself, so nothing here sorts or slices rows; a new order or filter asks for page 1 again. List, object,
// and object history are independent requests, each behind a guard of its own, so an old answer never replaces a newer
// one. Distances are AU and times Unix milliseconds (UTC) until they are formatted; the dates of the filters are TDB
// calendar days, as CAD reads them. The tool hands an object to the Sky only through explicit actions, and how its values
// are shown belongs to the profile: the zone of its times (resolveDisplayZone against the active observing site) only
// formats them, and never changes a request. Observability observes from the active site.

// Kilometers per lunar distance, the JPL convention: a mean scale, not the Earth-Moon separation of any instant.
const LUNAR_DISTANCE_KM = 384_400

// Largest window of the catalog in days, the budget of one search; a longer span is explored in steps.
export const MAXIMUM_WINDOW_DAYS = 366

// Rows of a page of the catalog, by default.
const DEFAULT_PAGE_SIZE = 50

// Rows of a page of the history of an object, which fits a narrow panel.
const HISTORY_PAGE_SIZE = 10

// Milliseconds per day.
const DAY_MS = 86_400_000

// Characters shown for each number of a distance range, enough to tell its two ends apart.
const RANGE_DIGITS = 6

// Time spans of the catalog.
export const CLOSE_APPROACH_PERIODS = ['next7', 'next30', 'next90', 'past30', 'custom'] as const

// Time span of the catalog.
export type CloseApproachPeriod = (typeof CLOSE_APPROACH_PERIODS)[number]

// Name of each time span.
export const PERIOD_LABELS: Readonly<Record<CloseApproachPeriod, string>> = { next7: 'Next 7 Days', next30: 'Next 30 Days', next90: 'Next 90 Days', past30: 'Past 30 Days', custom: 'Custom' }

// First and last day of each span relative to today, in days; none for a custom span.
const PERIOD_DAYS: Readonly<Record<Exclude<CloseApproachPeriod, 'custom'>, readonly [number, number]>> = { next7: [0, 7], next30: [0, 30], next90: [0, 90], past30: [-30, 0] }

// Time spans of the history of an object, around today.
export const HISTORY_WINDOWS = ['5y', '25y', 'all'] as const

// Time span of the history of an object.
export type HistoryWindow = (typeof HISTORY_WINDOWS)[number]

// Name of each span of the history.
export const HISTORY_WINDOW_LABELS: Readonly<Record<HistoryWindow, string>> = { '5y': '± 5 Years', '25y': '± 25 Years', all: '1900 to 2200' }

// Name of each target body, by the code of CAD.
export const BODY_NAMES: Readonly<Record<CloseApproachBody, string>> = { Earth: 'Earth', Moon: 'Moon', Merc: 'Mercury', Venus: 'Venus', Mars: 'Mars', Juptr: 'Jupiter', Satrn: 'Saturn', Urnus: 'Uranus', Neptn: 'Neptune', Pluto: 'Pluto', ALL: 'All Bodies' }

// Instants the Observability section can evaluate.
export const OBSERVABILITY_INSTANTS = ['approach', 'now', 'sky'] as const

// Instant the Observability section evaluates: the encounter, the real current time, or the instant the Sky shows.
export type ObservabilityInstant = (typeof OBSERVABILITY_INSTANTS)[number]

// Objects a search takes.
export const OBJECT_KINDS = ['all', 'a', 'c'] as const

// Objects a search takes: every one, asteroids, or comets.
export type ObjectKind = (typeof OBJECT_KINDS)[number]

// Name of each option of the objects a search takes.
export const OBJECT_KIND_LABELS: Readonly<Record<ObjectKind, string>> = { all: 'All', a: 'Asteroids', c: 'Comets' }

// Failure of a read of JPL through the server: its message, the code the server answered it with, and how long JPL asked
// to wait.
export interface CloseApproachFailure {
	// Message of the server, or of the request that could not reach it.
	readonly message: string
	// Code of the server; absent when the server named none, such as when it could not be reached.
	readonly code?: CloseApproachErrorCode
	// Rest of the pause JPL asked for, milliseconds; only with `rateLimited`.
	readonly retryAfter?: number
}

// How a failure is shown: a title naming what happened, what to do, and whether repeating the read can help.
export interface CloseApproachFailureNotice {
	// Title naming what happened.
	readonly title: string
	// The message of the server, with what to do about it.
	readonly description: string
	// Whether reading again can succeed: never offline, where only what was read before is answered, nor for a search JPL
	// refused, which only new filters change.
	readonly retry: boolean
	// Whether the failure comes from the offline switch of the ephemeris sources, kept in Settings, Ephemeris Sources.
	readonly offline: boolean
}

// Filters being edited, which only reach the server through an explicit search. Text fields keep what was typed.
export interface CloseApproachDraft {
	// Time span.
	period: CloseApproachPeriod
	// First day, YYYY-MM-DD in TDB.
	dateMin: string
	// Last day, YYYY-MM-DD in TDB, included whole.
	dateMax: string
	// Target body.
	body: CloseApproachBody
	// Largest nominal distance, in `distanceUnit`.
	distanceMax: number
	// Unit of `distanceMax`.
	distanceUnit: CloseApproachFilters['distanceUnit']
	// Objects taken.
	kind: ObjectKind
	// Only near-Earth objects.
	neoOnly: boolean
	// Only potentially hazardous asteroids.
	phaOnly: boolean
	// Smallest absolute magnitude, as typed; empty for no limit.
	hMin: string
	// Largest absolute magnitude, as typed; empty for no limit.
	hMax: string
}

// Close Approaches state of the tab.
export interface CloseApproachesState {
	// Filters being edited.
	draft: CloseApproachDraft
	// Why the filters being edited cannot be searched.
	inputError?: string
	// Filters of the page shown; absent before the first search.
	filters?: CloseApproachFilters
	// 1-based page.
	page: number
	// Rows per page.
	pageSize: number
	// Latest page received; a failure keeps it, so `page` and `pageSize` may name a page that could not be read.
	result?: CloseApproachPageResponse<CloseApproachFilters>
	// Whether a page is being read.
	loading: boolean
	// Why the latest page could not be read.
	error?: CloseApproachFailure
	// Encounter selected; it stays selected on the other pages of the same search.
	selected?: CloseApproach
	// Designation of the object loaded or being loaded.
	designation?: string
	// Outcome of the lookup of the object.
	object?: MinorBodyDetailsResponse
	// Whether the object is being read.
	objectLoading: boolean
	// Why the object could not be read.
	objectError?: CloseApproachFailure
	// Target body of the history.
	historyBody: CloseApproachBody
	// Time span of the history.
	historyWindow: HistoryWindow
	// 1-based page of the history.
	historyPage: number
	// Latest page of the history received.
	history?: CloseApproachPageResponse<CloseApproachHistoryFilters>
	// Whether the history is being read.
	historyLoading: boolean
	// Why the history could not be read.
	historyError?: string
	// Instant the Observability section evaluates.
	observabilityInstant: ObservabilityInstant
	// Latest position of the object received.
	observability?: SkyPositionResponse
	// Whether the position is being read.
	observabilityLoading: boolean
	// Why the position could not be read.
	observabilityError?: string
}

// Side effects of the tool, replaced in tests.
export interface CloseApproachesIo {
	// Fetch of the API.
	readonly fetch: ApiFetch
	// Real current time, Unix milliseconds.
	readonly now: () => number
	// Instant the Sky shows, Unix milliseconds (UTC).
	readonly skyTime: () => number
}

// Browser implementation of the side effects.
const browserIo: CloseApproachesIo = { fetch: browserFetch, now: () => Date.now(), skyTime: () => skyTime(skyClock, Date.now()) }

// Requests of the page shown; a new search or page supersedes them.
const listGuard = createRequestGuard()

// Request of the object selected; another object supersedes it.
const objectGuard = createRequestGuard()

// Requests of the history of the object selected.
const historyGuard = createRequestGuard()

// Request of the position of the object selected.
const observabilityGuard = createRequestGuard()

// Returns the failure of a read from what it threw: the code and pause the server answered, or only the message of a
// request that never reached it.
export function closeApproachFailure(error: unknown): CloseApproachFailure {
	if (!(error instanceof ApiResponseError)) return { message: error instanceof Error ? error.message : String(error) }
	const { retryAfter } = error.details
	return { message: error.message, code: error.code as CloseApproachErrorCode | undefined, retryAfter: typeof retryAfter === 'number' ? retryAfter : undefined }
}

// Returns how a failure is shown, by its code; a failure without one is a JPL that did not answer.
export function closeApproachFailureNotice({ message, code, retryAfter }: CloseApproachFailure): CloseApproachFailureNotice {
	const said = /[.!?]$/.test(message) ? message : `${message}.`

	switch (code) {
		case 'offline':
			return { title: 'Offline', description: `${said} Turn Offline off in Settings, Ephemeris Sources, to ask JPL.`, retry: false, offline: true }
		case 'rateLimited':
			return { title: 'JPL asked to wait', description: retryAfter === undefined ? said : `${said} Try again in ${Math.max(1, Math.ceil(retryAfter / 1000))} s.`, retry: true, offline: false }
		case 'rejected':
			return { title: 'JPL refused the search', description: `${said} Change the filters and search again.`, retry: false, offline: false }
		case 'upstreamSchemaChanged':
		case 'invalidResponse':
			return { title: 'JPL answered something unreadable', description: said, retry: true, offline: false }
		default:
			return { title: 'JPL did not answer', description: said, retry: true, offline: false }
	}
}

// Returns a day as YYYY-MM-DD from Unix milliseconds. The dates of the filters are TDB, about a minute from the UTC used
// for the presets, which only name a span.
function dayOf(time: number) {
	return new Date(time).toISOString().slice(0, 10)
}

// Returns the first and last day of a preset span around `now` (Unix milliseconds).
export function periodDates(period: Exclude<CloseApproachPeriod, 'custom'>, now: number): readonly [string, string] {
	const [first, last] = PERIOD_DAYS[period]
	return [dayOf(now + first * DAY_MS), dayOf(now + last * DAY_MS)]
}

// Filters a new tool starts with at `now` (Unix milliseconds): the next 30 days around the target and distance of the
// profile, without the NEO filter, so comets are not left out.
export function initialDraft(now: number, preferences: CloseApproachPreferences = DEFAULT_CLOSE_APPROACH_PREFERENCES): CloseApproachDraft {
	const [dateMin, dateMax] = periodDates('next30', now)
	const { body, distanceMax, distanceUnit } = preferences
	return { period: 'next30', dateMin, dateMax, body, distanceMax, distanceUnit, kind: 'all', neoOnly: false, phaOnly: false, hMin: '', hMax: '' }
}

// Initial state of the tool at `now` (Unix milliseconds).
export function initialCloseApproachesState(now: number): CloseApproachesState {
	return { draft: initialDraft(now), page: 1, pageSize: DEFAULT_PAGE_SIZE, loading: false, objectLoading: false, historyBody: 'ALL', historyWindow: '5y', historyPage: 1, historyLoading: false, observabilityInstant: 'approach', observabilityLoading: false }
}

// Close Approaches state of the tab.
export const closeApproachesState = proxy<CloseApproachesState>(initialCloseApproachesState(Date.now()))

// Reads an optional magnitude as typed: undefined when empty, NaN when it is not a number.
function magnitudeOf(text: string) {
	const value = text.trim()
	return value ? Number(value) : undefined
}

// Returns the filters of a draft with an order, or why they cannot be searched. The server takes the filters as valid,
// so this is where the budget of a search is held.
export function draftFilters(draft: CloseApproachDraft, sort: CloseApproachSort): CloseApproachFilters | string {
	const first = Date.parse(draft.dateMin)
	const last = Date.parse(draft.dateMax)
	if (!Number.isFinite(first) || !Number.isFinite(last)) return 'Enter the first and last days.'
	if (last < first) return 'The last day is before the first.'
	if ((last - first) / DAY_MS + 1 > MAXIMUM_WINDOW_DAYS) return `A search spans at most ${MAXIMUM_WINDOW_DAYS} days. Explore a longer time in steps.`
	if (!(draft.distanceMax > 0)) return 'Enter a distance above 0.'

	const hMin = magnitudeOf(draft.hMin)
	const hMax = magnitudeOf(draft.hMax)
	if (Number.isNaN(hMin) || Number.isNaN(hMax)) return 'The absolute magnitude must be a number.'
	if (hMin !== undefined && hMax !== undefined && hMax < hMin) return 'The largest absolute magnitude is below the smallest.'

	return { dateMin: draft.dateMin, dateMax: draft.dateMax, body: draft.body, distanceMax: draft.distanceMax, distanceUnit: draft.distanceUnit, neoOnly: draft.neoOnly, phaOnly: draft.phaOnly, kind: draft.kind === 'all' ? undefined : draft.kind, hMin, hMax, sort }
}

// Returns the URL of a page of the catalog.
export function catalogUrl(filters: CloseApproachFilters, page: number, pageSize: number, refresh: boolean) {
	const { kind, hMin, hMax, ...required } = filters
	const params = new URLSearchParams({ ...required, distanceMax: `${required.distanceMax}`, neoOnly: `${required.neoOnly}`, phaOnly: `${required.phaOnly}`, page: `${page}`, pageSize: `${pageSize}` })
	if (kind) params.set('kind', kind)
	if (hMin !== undefined) params.set('hMin', `${hMin}`)
	if (hMax !== undefined) params.set('hMax', `${hMax}`)
	if (refresh) params.set('refresh', 'true')
	return `/api/close-approaches?${params}`
}

// Returns the first and last day of a span of the history around `now` (Unix milliseconds).
export function historyDates(window: HistoryWindow, now: number): readonly [string, string] {
	if (window === 'all') return ['1900-01-01', '2200-12-31']
	const years = window === '5y' ? 5 : 25
	const year = new Date(now).getUTCFullYear()
	return [`${year - years}-01-01`, `${year + years}-12-31`]
}

// Returns the URL of a page of the history of an object.
export function historyUrl(spkId: string, filters: CloseApproachHistoryFilters, page: number) {
	const params = new URLSearchParams({ ...filters, page: `${page}`, pageSize: `${HISTORY_PAGE_SIZE}` })
	return `/api/close-approaches/objects/${encodeURIComponent(spkId)}/approaches?${params}`
}

// Reads the page of the current filters. The rows shown stay until the answer, which `refresh` asks JPL for again, and
// a failure keeps them too: the page shown is then the one of `result`, and Retry reads `page` again.
export async function loadCloseApproaches(state: CloseApproachesState, refresh = false, io: CloseApproachesIo = browserIo) {
	const { filters } = state
	if (!filters) return

	const request = listGuard.begin()
	state.loading = true
	state.error = undefined

	try {
		const result = await fetchJson<CloseApproachPageResponse<CloseApproachFilters>>(io, catalogUrl(filters, state.page, state.pageSize, refresh), { signal: request.signal })
		if (!request.current()) return
		state.result = result
	} catch (error) {
		if (!request.current()) return
		state.error = closeApproachFailure(error)
	}

	state.loading = false
}

// Whether the filters being edited differ from those of the page shown, or cannot be searched: what is shown is then not
// what the form says until Search.
export function closeApproachDraftPending(state: Pick<CloseApproachesState, 'draft' | 'filters'>) {
	const { filters } = state
	if (!filters) return false
	const draft = draftFilters(state.draft, filters.sort)
	if (typeof draft === 'string') return true
	return (Object.keys(draft) as (keyof CloseApproachFilters)[]).some((key) => draft[key] !== filters[key])
}

// Returns the filters of a search in one line, such as "Earth · 2026-10-31 to 2026-11-30 · ≤ 10 LD · Comets · NEOs".
export function describeCloseApproachFilters(filters: CloseApproachFilters) {
	const kind = filters.kind && OBJECT_KIND_LABELS[filters.kind]
	const h = filters.hMin === undefined ? (filters.hMax === undefined ? undefined : `H ≤ ${filters.hMax}`) : filters.hMax === undefined ? `H ≥ ${filters.hMin}` : `H ${filters.hMin} to ${filters.hMax}`
	return [bodyName(filters.body), `${filters.dateMin} to ${filters.dateMax}`, `≤ ${filters.distanceMax} ${filters.distanceUnit === 'au' ? 'AU' : filters.distanceUnit}`, kind, filters.neoOnly && 'NEOs', filters.phaOnly && 'PHAs', h].filter(Boolean).join(' · ')
}

// Returns the step of the largest distance of a search in a unit: whole lunar distances, hundredths of an AU.
export function distanceStep(unit: CloseApproachFilters['distanceUnit']) {
	return unit === 'au' ? 0.01 : 1
}

// Forgets the encounter selected and the object behind it, abandoning their requests.
export function clearCloseApproachSelection(state: CloseApproachesState) {
	objectGuard.cancel()
	historyGuard.cancel()
	observabilityGuard.cancel()
	state.observability = undefined
	state.observabilityLoading = false
	state.observabilityError = undefined
	state.selected = undefined
	state.designation = undefined
	state.object = undefined
	state.objectLoading = false
	state.objectError = undefined
	state.history = undefined
	state.historyLoading = false
	state.historyError = undefined
	state.historyPage = 1
}

// Searches the filters being edited from page 1; a search forgets the selection, and filters it cannot read change
// nothing but the reason shown.
export async function searchCloseApproaches(state: CloseApproachesState, io: CloseApproachesIo = browserIo) {
	const filters = draftFilters(state.draft, state.filters?.sort ?? 'date')

	if (typeof filters === 'string') {
		state.inputError = filters
		return
	}

	state.inputError = undefined
	state.filters = filters
	state.page = 1
	state.result = undefined
	clearCloseApproachSelection(state)
	await loadCloseApproaches(state, false, io)
}

// Runs the first search of the tab with the target and distance of the profile; a tab that returns to the tool keeps
// what it had.
export async function openCloseApproaches(state: CloseApproachesState, preferences: CloseApproachPreferences, io: CloseApproachesIo = browserIo) {
	if (state.filters) return
	state.draft = initialDraft(io.now(), preferences)
	await searchCloseApproaches(state, io)
}

// Returns the order after choosing a column: its first direction, or the other one when it is the current column.
export function nextSort(sort: CloseApproachSort, field: CloseApproachSortField): CloseApproachSort {
	return sort === field ? `-${field}` : field
}

// Orders by a column, which CAD does over every match, so it restarts from page 1 and never shows rows of another order.
export async function sortCloseApproaches(state: CloseApproachesState, field: CloseApproachSortField, io: CloseApproachesIo = browserIo) {
	if (!state.filters) return
	state.filters = { ...state.filters, sort: nextSort(state.filters.sort, field) }
	state.page = 1
	state.result = undefined
	await loadCloseApproaches(state, false, io)
}

// Moves to a page of the same search.
export async function pageCloseApproaches(state: CloseApproachesState, page: number, io: CloseApproachesIo = browserIo) {
	state.page = page
	await loadCloseApproaches(state, false, io)
}

// Changes the rows per page, restarting from page 1, since the rows of a page change.
export async function resizeCloseApproachPages(state: CloseApproachesState, pageSize: number, io: CloseApproachesIo = browserIo) {
	state.pageSize = pageSize
	state.page = 1
	await loadCloseApproaches(state, false, io)
}

// Sets the time span being edited, filling the days of a preset.
export function setCloseApproachPeriod(state: CloseApproachesState, period: CloseApproachPeriod, io: CloseApproachesIo = browserIo) {
	state.draft.period = period
	if (period === 'custom') return
	const [dateMin, dateMax] = periodDates(period, io.now())
	state.draft.dateMin = dateMin
	state.draft.dateMax = dateMax
}

// Sets a day being edited, which makes the span a custom one.
export function setCloseApproachDate(state: CloseApproachesState, bound: 'dateMin' | 'dateMax', date: string) {
	state.draft[bound] = date
	state.draft.period = 'custom'
}

// Reads the page of the history of the object loaded.
export async function loadCloseApproachHistory(state: CloseApproachesState, io: CloseApproachesIo = browserIo) {
	if (state.object?.kind !== 'found') return

	const request = historyGuard.begin()
	const [dateMin, dateMax] = historyDates(state.historyWindow, io.now())
	state.historyLoading = true
	state.historyError = undefined

	try {
		const url = historyUrl(state.object.body.spkId, { dateMin, dateMax, body: state.historyBody, sort: 'date' }, state.historyPage)
		const history = await fetchJson<CloseApproachPageResponse<CloseApproachHistoryFilters>>(io, url, { signal: request.signal })
		if (!request.current()) return
		state.history = history
	} catch (error) {
		if (!request.current()) return
		state.history = undefined
		state.historyError = error instanceof Error ? error.message : String(error)
	}

	state.historyLoading = false
}

// Moves to a page of the history.
export async function pageCloseApproachHistory(state: CloseApproachesState, page: number, io: CloseApproachesIo = browserIo) {
	state.historyPage = page
	await loadCloseApproachHistory(state, io)
}

// Sets the target or the time span of the history, from its page 1.
export async function filterCloseApproachHistory(state: CloseApproachesState, change: Partial<Pick<CloseApproachesState, 'historyBody' | 'historyWindow'>>, io: CloseApproachesIo = browserIo) {
	Object.assign(state, change)
	state.historyPage = 1
	state.history = undefined
	await loadCloseApproachHistory(state, io)
}

// Reads an object by its exact designation, then its history.
export async function loadCloseApproachObject(state: CloseApproachesState, designation: string, io: CloseApproachesIo = browserIo) {
	const request = objectGuard.begin()
	historyGuard.cancel()
	observabilityGuard.cancel()
	state.observability = undefined
	state.observabilityLoading = false
	state.observabilityError = undefined
	state.designation = designation
	state.object = undefined
	state.objectLoading = true
	state.objectError = undefined
	state.history = undefined
	state.historyLoading = false
	state.historyError = undefined
	state.historyPage = 1

	try {
		const object = await fetchJson<MinorBodyDetailsResponse>(io, `/api/close-approaches/objects?designation=${encodeURIComponent(designation)}`, { signal: request.signal })
		if (!request.current()) return
		state.object = object
		state.objectLoading = false
		await loadCloseApproachHistory(state, io)
	} catch (error) {
		if (!request.current()) return
		state.objectError = closeApproachFailure(error)
		state.objectLoading = false
	}
}

// Selects an encounter. Another encounter of the same object keeps what is known of the object, so it is not read again.
export async function selectCloseApproach(state: CloseApproachesState, approach: CloseApproach, io: CloseApproachesIo = browserIo) {
	state.selected = approach
	if (state.designation !== approach.designation || state.objectError) await loadCloseApproachObject(state, approach.designation, io)
}

// Returns the key of what the position of the Observability section depends on: the object, the instant of the
// encounter (Unix milliseconds, UTC), the instant chosen, and the place of the site (locationKey), never its name or zone,
// so only a change of these reads the position again.
export function observabilityKey(spkId: string, approachTime: number, instant: ObservabilityInstant, site: GeographicLocation | undefined) {
	return `${spkId}|${approachTime}|${instant}|${locationKey(site)}`
}

// Reads the position of an object at the instant chosen, for the active observing site of the profile or the geocenter
// without one, through the same route as the Sky. `approachTime` is the instant of the encounter, Unix milliseconds (UTC);
// only the place of `site` is sent.
export async function loadCloseApproachObservability(state: CloseApproachesState, body: Pick<MinorBody, 'spkId' | 'designation'>, approachTime: number, site: GeographicLocation | undefined, io: CloseApproachesIo = browserIo) {
	const request = observabilityGuard.begin()
	const time = state.observabilityInstant === 'approach' ? approachTime : state.observabilityInstant === 'now' ? io.now() : io.skyTime()
	state.observabilityLoading = true
	state.observabilityError = undefined

	try {
		const position = await fetchSkyPosition({ kind: 'minorBody', spkId: body.spkId, designation: body.designation }, time, siteObserver(site), 'accurate', request.signal, { fetch: io.fetch, time: io.skyTime })
		if (!request.current()) return
		state.observability = position
	} catch (error) {
		if (!request.current()) return
		state.observability = undefined
		state.observabilityError = error instanceof Error ? error.message : String(error)
	}

	state.observabilityLoading = false
}

// Places the Sky in a tool: what showing an object changes, replaced in tests.
export interface SkyHandoff {
	// Sky workspace state.
	readonly sky: SkyState
	// Simulation clock.
	readonly clock: SkyClock
	// Route of the tab.
	readonly route: RouteState
	// Requests of the selection.
	readonly io: SkyIo
	// History of the tab.
	readonly history: Pick<History, 'pushState'>
}

// Returns the Sky of the tab.
function browserHandoff(): SkyHandoff {
	return { sky: skyState, clock: skyClock, route: routeState, io: browserSkyIo, history: window.history }
}

// Shows a body in the Sky workspace, selected through the Sky's own path from `site`, the active observing site of the
// profile (undefined without one). With `time` (Unix milliseconds, UTC) the simulation clock moves there first, since the
// selection reads it; without it the clock is left alone. Neither the site nor any device changes. `body` may be a
// snapshot of a render, a frozen Proxy the Sky could not keep, so the Sky receives a plain copy of its JSON.
export function showInSky(body: MinorBody, site: GeographicLocation | undefined, time?: number, handoff: SkyHandoff = browserHandoff()) {
	if (time !== undefined) setSkyTime(handoff.clock, time)
	selectSkyObject(handoff.sky, { ref: { kind: 'minorBody', spkId: body.spkId, designation: body.designation }, source: 'search', name: body.name, category: 'minorBody', minorBody: JSON.parse(JSON.stringify(body)) as MinorBody }, site, handoff.io)
	navigate(handoff.route, { workspace: 'sky' }, handoff.history)
}

// Returns a distance in AU in a unit, with the digits it means.
export function distanceValue(au: number, unit: CloseApproachDistanceDisplay) {
	if (unit === 'au') return au
	return unit === 'km' ? au * AU_KM : (au * AU_KM) / LUNAR_DISTANCE_KM
}

// Name of each distance unit as shown after a value.
const DISTANCE_UNIT_NAMES: Readonly<Record<CloseApproachDistanceDisplay, string>> = { au: 'AU', LD: 'LD', km: 'km' }

// Writes a number with `digits` significant digits, never in exponential notation: a value with more whole digits than
// that is rounded to a whole number, grouped by thousands.
function significant(value: number, digits: number) {
	return Math.abs(value) >= 10 ** digits ? Math.round(value).toLocaleString('en-US') : value.toPrecision(digits)
}

// Formats a distance in AU in a unit. A kilometer has no fraction worth showing, and its thousands are grouped.
export function formatDistance(au: number, unit: CloseApproachDistanceDisplay) {
	const value = distanceValue(au, unit)
	return unit === 'km' ? `${Math.round(value).toLocaleString('en-US')} km` : `${significant(value, 4)} ${DISTANCE_UNIT_NAMES[unit]}`
}

// Formats the 3-sigma bounds of a distance in AU in one unit, with the digits that tell them apart; absent without both.
export function formatDistanceRange(min: number | undefined, max: number | undefined, unit: CloseApproachDistanceDisplay) {
	if (min === undefined || max === undefined) return undefined
	return `${significant(distanceValue(min, unit), RANGE_DIGITS)} – ${significant(distanceValue(max, unit), RANGE_DIGITS)} ${DISTANCE_UNIT_NAMES[unit]}`
}

// Formats the 3-sigma uncertainty of the time of an encounter as CAD publishes it, "[< ][days_]hh:mm", in words, such as
// "< 1 min" or "1 d 15 h 27 min"; a text of another form is shown as published.
export function formatTimeUncertainty(text: string) {
	const match = /^(<\s*)?(?:(\d+)_)?(\d{1,2}):(\d{2})$/.exec(text.trim())
	if (!match) return text
	const [, below, days, hours, minutes] = match
	const parts = [Number(days) > 0 && `${Number(days)} d`, Number(hours) > 0 && `${Number(hours)} h`, (Number(minutes) > 0 || (!Number(days) && !Number(hours))) && `${Number(minutes)} min`].filter(Boolean)
	return `${below ? '< ' : ''}${parts.join(' ')}`
}

// Formats a velocity in km/s with the two decimals CAD publishes.
export function formatVelocity(velocity: number) {
	return formatSpeed(velocity, 2)
}

// Formats a measured diameter in km with its 1-sigma uncertainty when there is one.
export function formatDiameter(diameter: number, sigma?: number) {
	return sigma === undefined ? `${diameter} km` : `${diameter} ± ${sigma} km`
}

// Returns the name of a target body as CAD names it; a body the tool does not know is shown as published.
export function bodyName(body: string) {
	return BODY_NAMES[body as CloseApproachBody] ?? body
}

// Returns the number of pages of a total of rows, at least one.
export function pageCount(total: number, pageSize: number) {
	return Math.max(1, Math.ceil(total / pageSize))
}
