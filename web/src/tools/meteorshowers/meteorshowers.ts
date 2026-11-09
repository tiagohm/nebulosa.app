import type { AstroWeatherForecast, MeteorActivityCurve, MeteorNightRanking, MeteorNightsRequest, MeteorObservingNight, MeteorObservingRequest, MeteorShowerDetail, MeteorShowerListPage, MeteorShowersCalendar, MeteorShowersCalendarRequest, MeteorShowerStatus } from 'api'
import { proxy } from 'valtio'
import { fetchJson, jsonInit } from '../../http'
import type { SiteLocation } from '../../location/site'
import { navigate, type RouteState, routeState } from '../../shell/route'
import { type SkyClock, setSkyTime, skyClock } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { browserSkyIo, selectSkyObject, type SkyIo, type SkyState, skyState } from '../../sky/sky'
import { addToObservingPlanner, planningSite, tonight } from '../observingplanner/observingplanner'
import { aborted, browserPlannerIo, errorMessage, type PlannerIo } from '../planetary/planetary'

// Meteor Showers of the tab: the section listed (the curated showers by their next maximum, the showers active now, or the
// whole IAU catalog), the search and filters, the list or the month of the calendar, the selected shower with its detail,
// and its geometric observing night from the tool's location. Every date, position, and window comes from the server;
// the tab only pages, lays out, and formats. The tab state is never persisted, and nothing here changes the Sky clock
// (unless asked to set it to a maximum), a site, the profile, or a device. Times are Unix milliseconds (UTC); angles radians.

// Section of the tool: the curated visual showers by next maximum, every shower active now, or the whole IAU catalog.
export type MeteorShowersSection = 'upcoming' | 'active' | 'all'

// Every section, in order.
export const METEOR_SHOWER_SECTIONS: readonly MeteorShowersSection[] = ['upcoming', 'active', 'all']

// How the showers are shown.
export type MeteorShowersDisplay = 'list' | 'calendar'

// Status filter of the whole catalog: every record, established ones, the working list, or the removed records.
export type MeteorStatusFilter = 'any' | MeteorShowerStatus

// Every status filter.
export const METEOR_STATUS_FILTERS: readonly MeteorStatusFilter[] = ['any', 'established', 'working', 'toBeEstablished', 'removed']

// Darkness required of a window: the Sun at most −18° (astronomical), −12° (nautical), or −6° (civil).
export type MeteorDarkness = 'astronomical' | 'nautical' | 'civil'

// Solar altitude of each darkness, degrees.
export const DARKNESS_ALTITUDES: Readonly<Record<MeteorDarkness, number>> = { astronomical: -18, nautical: -12, civil: -6 }

// Default lowest radiant altitude of a window, degrees: below it few meteors reach the observer.
export const DEFAULT_MINIMUM_RADIANT_ALTITUDE = 20

// Rows of a page of the list.
export const PAGE_SIZE = 25

// Default limiting magnitude of the modelled rates: the reference sky of the ZHR.
export const DEFAULT_LIMITING_MAGNITUDE = 6.5

// Evenings a ranking spans by default, and at most (the server ranks at most 31).
export const DEFAULT_RANKED_NIGHTS = 14
export const MAX_RANKED_NIGHTS = 31

// Assumptions of the modelled rates as the panel edits them.
export interface MeteorRateSettings {
	// Whether modelled rates are asked for; they apply only to a shower with a published activity profile.
	enabled: boolean
	// Limiting magnitude of the sky.
	limitingMagnitude: number
	// Part of the field obstructed, percent.
	obstructedPercent: number
}

// Tab-lived state of the tool.
export interface MeteorShowersState {
	// Section listed.
	section: MeteorShowersSection
	// List or calendar.
	display: MeteorShowersDisplay
	// Text searched.
	query: string
	// Status filter of the whole catalog.
	status: MeteorStatusFilter
	// Whether to keep only the radiants that reach the lowest altitude at the tool's location.
	reachable: boolean
	// Rows skipped.
	offset: number
	// The page listed.
	page?: MeteorShowerListPage
	// Whether the page is being read.
	pageLoading: boolean
	// Why the page could not be read.
	pageError?: string
	// Month the calendar shows, YYYY-MM (UTC); absent until shown.
	month?: string
	// Occurrences of the month.
	calendar?: MeteorShowersCalendar
	// Whether the month is being read.
	calendarLoading: boolean
	// Why the month could not be read.
	calendarError?: string
	// Id of the shower selected.
	selected?: string
	// Detail of the selected shower.
	detail?: MeteorShowerDetail
	// Whether the detail is being read.
	detailLoading: boolean
	// Why the detail could not be read.
	detailError?: string
	// Civil date of the evening in the location's zone, YYYY-MM-DD; absent until a location is known.
	eveningDate?: string
	// Darkness required of a window.
	darkness: MeteorDarkness
	// Lowest radiant altitude of a window, degrees.
	minimumAltitude: number
	// Smallest Moon–radiant separation while the Moon is up, degrees; absent to apply none.
	moonSeparation?: number
	// Observing night of the selected shower.
	night?: MeteorObservingNight
	// Whether the night is being computed.
	nightLoading: boolean
	// Why the night could not be computed.
	nightError?: string
	// Assumptions of the modelled rates.
	rates: MeteorRateSettings
	// Activity curve of the selected shower for the year of its next occurrence.
	activity?: MeteorActivityCurve
	// Why the curve could not be read.
	activityError?: string
	// Evenings the ranking spans.
	rankedNights: number
	// Ranking of the nights of the selected shower.
	ranking?: MeteorNightRanking
	// Whether the ranking is being computed.
	rankingLoading: boolean
	// Why the ranking could not be computed.
	rankingError?: string
	// Astro Weather forecast of the location, with the place it is for (locationKey).
	forecast?: { readonly place: string; readonly forecast: AstroWeatherForecast }
	// Why the forecast could not be read.
	forecastError?: string
}

// Creates the tab state of the tool.
export function createMeteorShowersState(): MeteorShowersState {
	return {
		section: 'upcoming',
		display: 'list',
		query: '',
		status: 'any',
		reachable: false,
		offset: 0,
		pageLoading: false,
		calendarLoading: false,
		detailLoading: false,
		darkness: 'astronomical',
		minimumAltitude: DEFAULT_MINIMUM_RADIANT_ALTITUDE,
		nightLoading: false,
		rates: { enabled: false, limitingMagnitude: DEFAULT_LIMITING_MAGNITUDE, obstructedPercent: 0 },
		rankedNights: DEFAULT_RANKED_NIGHTS,
		rankingLoading: false,
	}
}

// Tab state of the tool.
export const meteorShowersState = proxy<MeteorShowersState>(createMeteorShowersState())

// Guards of the requests of the tool, each superseding its previous one.
const pageGuard = createRequestGuard()
const calendarGuard = createRequestGuard()
const detailGuard = createRequestGuard()
const nightGuard = createRequestGuard()
const activityGuard = createRequestGuard()
const rankingGuard = createRequestGuard()
const forecastGuard = createRequestGuard()

// Query string of the page of a section, the search, and the filters; a latitude keeps the reachable radiants.
export function listQuery(state: Pick<MeteorShowersState, 'section' | 'query' | 'status' | 'reachable' | 'offset' | 'minimumAltitude'>, latitude: number | undefined): string {
	const params = new URLSearchParams()
	if (state.query.trim()) params.set('query', state.query.trim())
	if (state.section === 'upcoming') params.set('visual', 'true')
	if (state.section === 'active') params.set('active', 'true')
	if (state.section === 'all' && state.status !== 'any') params.set('status', state.status)
	params.set('sort', state.section === 'all' ? 'name' : 'nextPeak')
	if (state.reachable && latitude !== undefined) {
		params.set('latitude', String(latitude))
		params.set('minimumAltitude', String(state.minimumAltitude))
	}
	params.set('offset', String(state.offset))
	params.set('limit', String(PAGE_SIZE))
	return params.toString()
}

// Reads the page of the section, dropping the answer of a superseded request.
export async function loadPage(state: MeteorShowersState, latitude: number | undefined, io: PlannerIo = browserPlannerIo) {
	const request = pageGuard.begin()
	state.pageLoading = true

	try {
		const page = await fetchJson<MeteorShowerListPage>(io, `/api/meteor-showers?${listQuery(state, latitude)}`, { signal: request.signal })
		if (!request.current()) return
		state.page = page
		state.pageError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.page = undefined
		state.pageError = errorMessage(error)
	} finally {
		if (request.current()) state.pageLoading = false
	}
}

// Month, YYYY-MM (UTC), of an instant.
export function monthOfTime(time: number) {
	const date = new Date(time)
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// Request of the calendar of a month: the curated showers in the upcoming section, every established or working shower
// otherwise, never the removed records.
export function calendarRequest(month: string, section: MeteorShowersSection): MeteorShowersCalendarRequest {
	const [year, value] = month.split('-').map(Number)
	return { year, fromMonth: value, toMonth: value, filter: section === 'upcoming' ? { visual: true } : { status: ['established', 'working', 'toBeEstablished'] } }
}

// Reads the occurrences of the calendar's month, dropping the answer of a superseded request.
export async function loadCalendar(state: MeteorShowersState, io: PlannerIo = browserPlannerIo) {
	const month = (state.month ??= monthOfTime(io.time()))
	const request = calendarGuard.begin()
	state.calendarLoading = true

	try {
		const calendar = await fetchJson<MeteorShowersCalendar>(io, '/api/meteor-showers/calendar', jsonInit('POST', calendarRequest(month, state.section), request.signal))
		if (!request.current()) return
		state.calendar = calendar
		state.calendarError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.calendar = undefined
		state.calendarError = errorMessage(error)
	} finally {
		if (request.current()) state.calendarLoading = false
	}
}

// Selects a shower, forgetting the detail and the night of the previous one; nothing of the Sky changes.
export function selectShower(state: MeteorShowersState, id: string | undefined) {
	if (state.selected === id) return
	state.selected = id
	state.detail = undefined
	state.detailError = undefined
	state.night = undefined
	state.nightError = undefined
	state.activity = undefined
	state.activityError = undefined
	state.ranking = undefined
	state.rankingError = undefined
	detailGuard.cancel()
	nightGuard.cancel()
	activityGuard.cancel()
	rankingGuard.cancel()
	state.detailLoading = false
	state.nightLoading = false
	state.rankingLoading = false
}

// Reads the detail of the selected shower, dropping the answer of a superseded request.
export async function loadDetail(state: MeteorShowersState, io: PlannerIo = browserPlannerIo) {
	const id = state.selected
	if (id === undefined) return
	const request = detailGuard.begin()
	state.detailLoading = true

	try {
		const detail = await fetchJson<MeteorShowerDetail>(io, `/api/meteor-showers/${encodeURIComponent(id)}`, { signal: request.signal })
		if (!request.current()) return
		state.detail = detail
		state.detailError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.detail = undefined
		state.detailError = errorMessage(error)
	} finally {
		if (request.current()) state.detailLoading = false
	}
}

// The evening the night defaults to: tonight in the location's zone.
export function defaultEvening(site: SiteLocation, io: PlannerIo = browserPlannerIo) {
	return tonight(io.time(), site.timeZone)
}

// Request of the observing night of the tab's evening, darkness, and constraints at a site.
export function observingRequest(state: Pick<MeteorShowersState, 'eveningDate' | 'darkness' | 'minimumAltitude' | 'moonSeparation' | 'rates'>, site: SiteLocation, eveningDate: string): MeteorObservingRequest {
	const DEG = Math.PI / 180
	return {
		site: planningSite(site),
		eveningDate,
		maximumSolarAltitude: DARKNESS_ALTITUDES[state.darkness] * DEG,
		minimumRadiantAltitude: state.minimumAltitude * DEG,
		...(state.moonSeparation !== undefined && { minimumMoonSeparation: state.moonSeparation * DEG }),
		...(state.rates.enabled && { assumptions: { limitingMagnitude: state.rates.limitingMagnitude, obstructedFraction: state.rates.obstructedPercent / 100 } }),
	}
}

// Reads the observing night of the selected shower from a site, dropping the answer of a superseded request.
export async function loadNight(state: MeteorShowersState, site: SiteLocation, io: PlannerIo = browserPlannerIo) {
	const id = state.selected
	if (id === undefined) return
	const eveningDate = (state.eveningDate ??= defaultEvening(site, io))
	const request = nightGuard.begin()
	state.nightLoading = true

	try {
		const night = await fetchJson<MeteorObservingNight>(io, `/api/meteor-showers/${encodeURIComponent(id)}/observing`, jsonInit('POST', observingRequest(state, site, eveningDate), request.signal))
		if (!request.current()) return
		state.night = night
		state.nightError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.night = undefined
		state.nightError = errorMessage(error)
	} finally {
		if (request.current()) state.nightLoading = false
	}
}

// Reads the activity curve of the selected shower for a civil year, dropping the answer of a superseded request.
export async function loadActivity(state: MeteorShowersState, year: number, io: PlannerIo = browserPlannerIo) {
	const id = state.selected
	if (id === undefined) return
	const request = activityGuard.begin()

	try {
		const curve = await fetchJson<MeteorActivityCurve>(io, `/api/meteor-showers/${encodeURIComponent(id)}/activity`, jsonInit('POST', { year }, request.signal))
		if (!request.current()) return
		state.activity = curve
		state.activityError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.activity = undefined
		state.activityError = errorMessage(error)
	}
}

// Request of the ranking of the tab's evenings from a site.
export function rankingRequest(state: Pick<MeteorShowersState, 'eveningDate' | 'darkness' | 'minimumAltitude' | 'moonSeparation' | 'rates' | 'rankedNights'>, site: SiteLocation, startEveningDate: string): MeteorNightsRequest {
	const { eveningDate: _, ...night } = observingRequest(state, site, startEveningDate)
	return { ...night, startEveningDate, nights: Math.min(MAX_RANKED_NIGHTS, Math.max(1, Math.round(state.rankedNights))) }
}

// Ranks the evenings from the tab's evening for the selected shower, dropping the answer of a superseded request; asked
// for explicitly, since it searches up to a month of nights.
export async function loadRanking(state: MeteorShowersState, site: SiteLocation, io: PlannerIo = browserPlannerIo) {
	const id = state.selected
	if (id === undefined) return
	const start = (state.eveningDate ??= defaultEvening(site, io))
	const request = rankingGuard.begin()
	state.rankingLoading = true

	try {
		const ranking = await fetchJson<MeteorNightRanking>(io, `/api/meteor-showers/${encodeURIComponent(id)}/nights`, jsonInit('POST', rankingRequest(state, site, start), request.signal))
		if (!request.current()) return
		state.ranking = ranking
		state.rankingError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.ranking = undefined
		state.rankingError = errorMessage(error)
	} finally {
		if (request.current()) state.rankingLoading = false
	}
}

// Forgets the ranking, cancelling a request in flight, when its inputs change.
export function clearRanking(state: MeteorShowersState) {
	rankingGuard.cancel()
	state.ranking = undefined
	state.rankingLoading = false
	state.rankingError = undefined
}

// Reads the Astro Weather forecast of a site once per place, dropping the answer of a superseded request; a failure keeps
// the tool working without weather.
export async function loadForecast(state: MeteorShowersState, site: SiteLocation, place: string, io: PlannerIo = browserPlannerIo) {
	if (state.forecast?.place === place) return
	const request = forecastGuard.begin()

	try {
		const forecast = await fetchJson<AstroWeatherForecast>(io, `/api/astro-weather/forecast?latitude=${site.latitude}&longitude=${site.longitude}`, { signal: request.signal })
		if (!request.current()) return
		state.forecast = { place, forecast }
		state.forecastError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.forecast = undefined
		state.forecastError = errorMessage(error)
	}
}

// Forgets the night when the tool has no site, cancelling a request in flight.
export function clearNight(state: MeteorShowersState) {
	nightGuard.cancel()
	state.night = undefined
	state.nightLoading = false
	state.nightError = undefined
}

// Opens the tool on a shower, from the Sky or another tool; the tool keeps its own location and zone.
export function openMeteorShower(id: string, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	navigate(route, { workspace: 'tools', tool: 'meteor-showers', meteorShower: id }, history)
}

// Selects a shower's radiant in the Sky at the Sky's own time and shows the Sky; the clock, the mount, the profile, and
// the site are left alone, and nothing is targeted.
export function showRadiantInSky(id: string, name: string, site: SiteLocation | undefined, sky: SkyState = skyState, io: SkyIo = browserSkyIo, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	selectSkyObject(sky, { ref: { kind: 'meteorShower', id }, source: 'search', name, category: 'meteorShower' }, site, io)
	navigate(route, { workspace: 'sky' }, history)
}

// Sets the Sky clock to a maximum, the one deliberate change of the Sky clock, then shows the radiant there.
export function showRadiantInSkyAt(id: string, name: string, time: number, site: SiteLocation | undefined, clock: SkyClock = skyClock, io: PlannerIo = browserPlannerIo) {
	setSkyTime(clock, time, io.time())
	showRadiantInSky(id, name, site)
}

// Offers a meteor shower observation to the Observing Planner, where the operator chooses a plan and saves it: an
// observing event analyzed by the shower's geometric windows, never a fixed target at its radiant.
export function addShowerToPlanner(id: string, name: string, add: typeof addToObservingPlanner = addToObservingPlanner) {
	add({ target: { kind: 'meteorShower', id }, name })
}

// Opens the tool on a shower from another tool (the Observing Planner) with that tool's evening as the tool's own night;
// both tools observe from the active site.
export function openMeteorShowerAt(id: string, eveningDate: string, state: MeteorShowersState = meteorShowersState, route: RouteState = routeState, history: Pick<History, 'pushState'> = window.history) {
	selectShower(state, id)
	state.eveningDate = eveningDate
	openMeteorShower(id, route, history)
}
