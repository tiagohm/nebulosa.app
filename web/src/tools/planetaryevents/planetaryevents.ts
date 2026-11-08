import type { PlanetaryEvent, PlanetaryEventBody, PlanetaryEventKind, PlanetaryEventSeries, PlanetaryEventSeriesRequest, PlanetaryEventsSearch, PlanetaryEventsSearchRequest, PlanetaryEventsVisibility, PlanetaryEventsVisibilityRequest, PlanetaryEventVisibility, PlanetaryVisibilityStatus } from 'api'
import { proxy } from 'valtio'
import { formatDate } from '../../format'
import { ApiResponseError, fetchJson, jsonInit } from '../../http'
import { ACTIVE_TOOL_LOCATION, type SiteLocation, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride, wallTimeToInstant, zonedWallTime } from '../../location/zone'
import { type SkyClock, setSkyTime, skyClock, skyTime } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { addToObservingPlanner, planningSite, showTargetInSky } from '../observingplanner/observingplanner'
import { aborted, browserPlannerIo, errorMessage, type PlannerIo } from '../planetary/planetary'
import { BODY_LABELS } from './planetaryevents.format'

// Planetary Events of the tab: the range, the planets and kinds searched, the appulse threshold, the view and its filters,
// and the server's answers (the events of the range, their visibility from the tool's location, and the curves of the
// selected event). Every event, instant, and visibility comes from the server; the tab only filters, groups by civil day,
// and lays out a month. The range opens on real now, never on the Sky clock, and nothing here changes the Sky clock
// unless the operator asks for an event's time in the Sky, a site, the profile, or a device. Times are Unix milliseconds
// (UTC); angles radians.

// Every planet, in order from the Sun.
export const EVENT_BODIES: readonly PlanetaryEventBody[] = ['199', '299', '499', '599', '699', '799', '899']

// Every kind, in the order of a listing.
export const EVENT_KINDS: readonly PlanetaryEventKind[] = ['solarConjunction', 'opposition', 'quadrature', 'greatestElongation', 'station', 'planetaryConjunction', 'planetaryAppulse', 'closestEarthApproach', 'greatestBrightness', 'halfIllumination']

// Months a range may span; the server is asked for at most 24.
export type RangeMonths = 1 | 3 | 6 | 12 | 24

// Every range length, in months.
export const RANGE_MONTHS: readonly RangeMonths[] = [1, 3, 6, 12, 24]

// How the events are shown.
export type PlanetaryEventsView = 'timeline' | 'calendar'

// Which events the list keeps by their visibility from the site: every one, those observable at their instant or nearby,
// those that are not (including the solar conjunctions, never recommended), or those without a known visibility.
export type VisibilityFilter = 'all' | 'observable' | 'notObservable' | 'unknown'

// Every visibility filter.
export const VISIBILITY_FILTERS: readonly VisibilityFilter[] = ['all', 'observable', 'notObservable', 'unknown']

// Default appulse threshold, degrees.
export const DEFAULT_THRESHOLD_DEGREES = 5

// Range of the appulse threshold, degrees.
export const THRESHOLD_DEGREES = { min: 0.1, max: 15 } as const

// Visibility of the events from one site, by event id.
export interface SiteVisibility {
	// Place of the site the visibility was computed for (siteKey).
	readonly site: string
	readonly byId: Readonly<Record<string, PlanetaryEventVisibility>>
}

// Tab-lived state of the tool.
export interface PlanetaryEventsState {
	// Where the visibility is judged from.
	location: ToolLocation
	// Zone the times are shown in.
	zone: DisplayZoneOverride
	// First instant of the range; absent until the tool opens, then real now.
	start?: number
	// Months of the range.
	months: RangeMonths
	// Planets searched.
	bodies: PlanetaryEventBody[]
	// Kinds searched.
	kinds: PlanetaryEventKind[]
	// Largest separation of an appulse listed, degrees.
	thresholdDegrees: number
	// List or month view.
	view: PlanetaryEventsView
	// Month shown by the calendar, YYYY-MM in the display zone; absent until shown.
	month?: string
	// Which events the list keeps by their visibility.
	visibilityFilter: VisibilityFilter
	// Id of the event selected.
	selected?: string
	// Events of the range.
	search?: PlanetaryEventsSearch
	// Whether the events are being computed.
	searchLoading: boolean
	// Why the events could not be computed.
	searchError?: string
	// Whether the error of the events is the kernels' refusal under spkOnly.
	kernelsRefused: boolean
	// Visibility of the events from the tool's location.
	visibility?: SiteVisibility
	// Whether the visibility is being computed.
	visibilityLoading: boolean
	// Why the visibility could not be computed.
	visibilityError?: string
	// Curves of the selected event.
	series?: PlanetaryEventSeries
	// Whether the curves are being computed.
	seriesLoading: boolean
	// Why the curves could not be computed.
	seriesError?: string
}

// Creates the tab state of the tool.
export function createPlanetaryEventsState(): PlanetaryEventsState {
	return {
		location: { ...ACTIVE_TOOL_LOCATION },
		zone: { ...DEFAULT_ZONE_OVERRIDE },
		months: 12,
		bodies: [...EVENT_BODIES],
		kinds: [...EVENT_KINDS],
		thresholdDegrees: DEFAULT_THRESHOLD_DEGREES,
		view: 'timeline',
		visibilityFilter: 'all',
		searchLoading: false,
		kernelsRefused: false,
		visibilityLoading: false,
		seriesLoading: false,
	}
}

// Tab state of the tool.
export const planetaryEventsState = proxy<PlanetaryEventsState>(createPlanetaryEventsState())

// Guards of the requests of the tool, each superseding its previous one.
const searchGuard = createRequestGuard()
const visibilityGuard = createRequestGuard()
const seriesGuard = createRequestGuard()

// End of a range of `months` calendar months from `start` (UTC calendar), Unix milliseconds.
export function rangeEnd(start: number, months: RangeMonths) {
	const date = new Date(start)
	date.setUTCMonth(date.getUTCMonth() + months)
	return date.getTime()
}

// Opens the range on real now the first time the tool is shown.
export function initialize(state: PlanetaryEventsState, io: PlannerIo = browserPlannerIo) {
	state.start ??= io.time()
}

// Moves the start of the range to the Sky's simulated instant, leaving the Sky clock alone.
export function startAtSkyTime(state: PlanetaryEventsState, clock: Readonly<SkyClock> = skyClock, io: PlannerIo = browserPlannerIo) {
	state.start = skyTime(clock, io.time())
}

// The search of the tab's range, planets, kinds, and threshold; undefined until the range is open.
export function searchRequest(state: Pick<PlanetaryEventsState, 'start' | 'months' | 'bodies' | 'kinds' | 'thresholdDegrees'>): PlanetaryEventsSearchRequest | undefined {
	if (state.start === undefined) return undefined
	return { start: state.start, end: rangeEnd(state.start, state.months), bodies: [...state.bodies], kinds: [...state.kinds], appulseThreshold: (state.thresholdDegrees * Math.PI) / 180 }
}

// Reads the events of the range, dropping the answer of a superseded request; the visibility of the previous answer no
// longer applies.
export async function loadSearch(state: PlanetaryEventsState, io: PlannerIo = browserPlannerIo) {
	const body = searchRequest(state)
	if (!body) return
	const request = searchGuard.begin()
	visibilityGuard.cancel()
	state.searchLoading = true

	try {
		const answer = await fetchJson<PlanetaryEventsSearch>(io, '/api/planetary-events/search', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.search = answer
		state.searchError = undefined
		state.kernelsRefused = false
		state.visibility = undefined
		state.visibilityLoading = false
		if (state.selected && !answer.events.some((e) => e.id === state.selected)) state.selected = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.search = undefined
		state.visibility = undefined
		state.searchError = errorMessage(error)
		state.kernelsRefused = error instanceof ApiResponseError && error.status === 503
	} finally {
		if (request.current()) state.searchLoading = false
	}
}

// Identity of a site's place: its coordinates, never its zone, which only formats.
export function siteKey(site: SiteLocation) {
	return JSON.stringify([site.latitude, site.longitude, site.elevation])
}

// Reads the visibility of every event of the answer from a site, dropping the answer of a superseded request.
export async function loadVisibility(state: PlanetaryEventsState, site: SiteLocation, io: PlannerIo = browserPlannerIo) {
	const search = state.search
	if (!search) return
	const key = siteKey(site)
	if (state.visibility?.site === key) return
	const request = visibilityGuard.begin()
	state.visibilityLoading = true
	const body: PlanetaryEventsVisibilityRequest = {
		events: search.events.map(({ id, kind, bodies, time }) => ({ id, kind, bodies, time })),
		site: planningSite(site),
		appulseThreshold: (state.thresholdDegrees * Math.PI) / 180,
	}

	try {
		const answer = await fetchJson<PlanetaryEventsVisibility>(io, '/api/planetary-events/visibility', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.visibility = { site: key, byId: answer.visibility }
		state.visibilityError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.visibility = undefined
		state.visibilityError = errorMessage(error)
	} finally {
		if (request.current()) state.visibilityLoading = false
	}
}

// Forgets the visibility when the tool has no site, cancelling a request in flight.
export function clearVisibility(state: PlanetaryEventsState) {
	visibilityGuard.cancel()
	state.visibility = undefined
	state.visibilityLoading = false
	state.visibilityError = undefined
}

// Reads the curves of an event, dropping the answer of a superseded request.
export async function loadSeries(state: PlanetaryEventsState, event: Pick<PlanetaryEvent, 'kind' | 'bodies' | 'time'>, io: PlannerIo = browserPlannerIo) {
	const request = seriesGuard.begin()
	state.seriesLoading = true
	const body: PlanetaryEventSeriesRequest = { kind: event.kind, bodies: event.bodies, time: event.time }

	try {
		const answer = await fetchJson<PlanetaryEventSeries>(io, '/api/planetary-events/series', jsonInit('POST', body, request.signal))
		if (!request.current()) return
		state.series = answer
		state.seriesError = undefined
	} catch (error) {
		if (aborted(error) || !request.current()) return
		state.series = undefined
		state.seriesError = errorMessage(error)
	} finally {
		if (request.current()) state.seriesLoading = false
	}
}

// Selects an event; the Sky clock, the site, and the devices are left alone.
export function selectEvent(state: PlanetaryEventsState, id: string | undefined) {
	state.selected = id
	if (id === undefined) state.series = undefined
}

// Visibility status of an event: the server's, or unknownNoSite without a site or before the answer.
export function visibilityStatus(visibility: SiteVisibility | undefined, id: string): PlanetaryVisibilityStatus {
	return visibility?.byId[id]?.status ?? 'unknownNoSite'
}

// Whether an event passes the visibility filter; without a site every event is unknown, and none is dropped by the
// filter 'all'.
export function passesVisibility(filter: VisibilityFilter, status: PlanetaryVisibilityStatus) {
	switch (filter) {
		case 'all':
			return true
		case 'observable':
			return status === 'observable' || status === 'nearby'
		case 'notObservable':
			return status === 'notObservable' || status === 'notSuitable'
		case 'unknown':
			return status === 'unknownNoSite'
	}
}

// The events listed: those passing the visibility filter, chronologically by their UTC instant.
export function listedEvents(events: readonly PlanetaryEvent[], filter: VisibilityFilter, visibility: SiteVisibility | undefined) {
	return events.filter((e) => passesVisibility(filter, visibilityStatus(visibility, e.id))).sort((a, b) => a.time - b.time)
}

// Events grouped by the civil date of their instant in a zone, in order; the instants decide the order, never the dates.
export function groupByDay(events: readonly PlanetaryEvent[], timeZone: string) {
	const groups: { date: string; events: PlanetaryEvent[] }[] = []
	for (const event of [...events].sort((a, b) => a.time - b.time)) {
		const date = formatDate(event.time, timeZone)
		const last = groups.at(-1)
		if (last?.date === date) last.events.push(event)
		else groups.push({ date, events: [event] })
	}
	return groups
}

// A day of a calendar month.
export interface CalendarDay {
	// Civil date, YYYY-MM-DD.
	readonly date: string
	// Day of the month.
	readonly day: number
	// Whether it belongs to the month shown, rather than padding a week.
	readonly inMonth: boolean
	// Events of that date, chronologically.
	readonly events: readonly PlanetaryEvent[]
}

// Month, YYYY-MM, of an instant in a zone.
export function monthOf(time: number, timeZone: string) {
	return formatDate(time, timeZone).slice(0, 7)
}

// Month, YYYY-MM, `delta` months after `month`.
export function shiftMonth(month: string, delta: number) {
	const [year, value] = month.split('-').map(Number)
	const date = new Date(Date.UTC(year, value - 1 + delta, 1))
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// Weeks of a month, Monday first, each of seven days, with the events of each civil date in the zone.
export function calendarWeeks(month: string, events: readonly PlanetaryEvent[], timeZone: string): CalendarDay[][] {
	const [year, value] = month.split('-').map(Number)
	const byDate = new Map<string, PlanetaryEvent[]>()
	for (const group of groupByDay(events, timeZone)) byDate.set(group.date, group.events)
	const first = new Date(Date.UTC(year, value - 1, 1))
	const offset = (first.getUTCDay() + 6) % 7
	const days = new Date(Date.UTC(year, value, 0)).getUTCDate()
	const weeks: CalendarDay[][] = []

	for (let index = -offset; index < days || (index - -offset) % 7 !== 0; index++) {
		const date = new Date(Date.UTC(year, value - 1, 1 + index))
		const iso = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
		if ((index + offset) % 7 === 0) weeks.push([])
		weeks.at(-1)!.push({ date: iso, day: date.getUTCDate(), inMonth: index >= 0 && index < days, events: byDate.get(iso) ?? [] })
	}

	return weeks
}

// Instant of the first moment of a civil date in a zone, for the start of a custom range; undefined for a date the
// clocks skip at midnight.
export function dayStart(date: string, timeZone: string) {
	const [year, month, day] = date.split('-').map(Number)
	const instant = wallTimeToInstant({ year, month, day, hour: 0, minute: 0, second: 0 }, timeZone)
	return instant.kind === 'exact' ? instant.time : instant.kind === 'ambiguous' ? instant.earlier : undefined
}

// Civil date, YYYY-MM-DD, of an instant in a zone, for the start field.
export function dateInput(time: number, timeZone: string) {
	const { year, month, day } = zonedWallTime(time, timeZone)
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// Shows a planet in the Sky at the Sky's own time, through the Observing Planner's handoff, which changes no clock and
// moves no device.
export function showPlanetInSky(code: PlanetaryEventBody, site: SiteLocation | undefined, show: typeof showTargetInSky = showTargetInSky) {
	show({ target: { kind: 'body', code }, name: BODY_LABELS[code] }, site)
}

// Sets the Sky clock to an event's instant, the one deliberate change of the Sky clock, then shows the planet there.
export function showPlanetInSkyAt(code: PlanetaryEventBody, time: number, site: SiteLocation | undefined, clock: SkyClock = skyClock, show: typeof showTargetInSky = showTargetInSky, io: PlannerIo = browserPlannerIo) {
	setSkyTime(clock, time, io.time())
	showPlanetInSky(code, site, show)
}

// Offers a planet to the Observing Planner as an independent target; it never picks a night or schedules the event.
export function addPlanetToPlanner(code: PlanetaryEventBody, add: typeof addToObservingPlanner = addToObservingPlanner) {
	add({ target: { kind: 'body', code }, name: BODY_LABELS[code] })
}
