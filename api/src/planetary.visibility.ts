import { altitudeOf } from 'nebulosa/src/astronomy/events/horizon'
import { visibilityWindows } from 'nebulosa/src/astronomy/events/visibility'
import { airmassKastenYoung } from 'nebulosa/src/astronomy/formulas'
import { type Time, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { LruCache } from './lrucache'
import { OBSERVING_PRESETS, type PlanningBodyCode, type PlanningSite, PlanningNight, SEARCH_STEP_DAYS } from './observingplanner.astronomy'
import { yieldToEventLoop } from './planetary.source'
import type { TimeSpan } from './sky/sun'

// Site visibility shared by the planetary satellite planners (Jupiter, Saturn). A phenomenon is geocentric; a site only
// decides when it can be watched: the parts of its physically visible interval inside the site's planetary windows,
// with the planet at or above the Observing Planner's planetary minimum altitude (25°) and the Sun at or below its limit
// (−6°), computed from the planet's local VSOP87E position on the site's Astro Weather nights. Nothing here changes the
// geocentric contacts. Times are Unix milliseconds (UTC) and angles radians.

// Whether an event can be watched from the site.
export type PlanetVisibilityStatus = 'observable' | 'partial' | 'notObservable' | 'unknownNoSite'

// Visibility of an event from a site, with planner-specific reason codes.
export interface PlanetEventVisibility<R extends string> {
	readonly status: PlanetVisibilityStatus
	// Civil date, in the site's zone, of the evening of the night holding the maximum; absent without a site.
	readonly eveningDate?: string
	// Parts of the event interval that can be watched, Unix milliseconds.
	readonly windows: readonly TimeSpan[]
	// Longest watchable part, milliseconds.
	readonly longestMs: number
	// Highest geometric altitude of the planet over the event interval.
	readonly peakAltitude?: number
	// Kasten–Young airmass at the peak altitude; absent below the horizon.
	readonly peakAirmass?: number
	// Geometric altitude of the Sun's centre at the maximum.
	readonly sunAltitude?: number
	// Why the event, or part of it, cannot be watched; empty when it can be watched whole.
	readonly reasons: readonly R[]
	// Position among the watchable events of the answer, 1 the best (longest watchable part, then highest peak); absent
	// when nothing of it can be watched.
	readonly rank?: number
}

// A night of a site with the planet's watchable windows.
export interface PlanetNight {
	// Civil date of the evening in the site's zone.
	readonly eveningDate: string
	// The night, from the Sun's upper transit to the next, Unix milliseconds.
	readonly start: number
	readonly end: number
	// Sunset and sunrise, Unix milliseconds; absent when the Sun does not set or rise.
	readonly sunset?: number
	readonly sunrise?: number
	// Stretches with the planet at or above the planetary minimum altitude and the Sun at or below the planetary limit.
	readonly windows: readonly TimeSpan[]
}

// A night of a site prepared for the visibility of the events.
export interface SiteNight {
	readonly planning: PlanningNight
	readonly night: PlanetNight
}

// The span of an event: its first and last instants and its maximum, Unix milliseconds.
export interface EventSpan {
	readonly start: number
	readonly maximum: number
	readonly end: number
}

// The physically visible part of an event, before any site, and why part of it is not.
export interface VisiblePart<R extends string> {
	readonly spans: readonly TimeSpan[]
	readonly reason?: R
}

// Spacing of the altitude samples of an event interval, milliseconds.
const ALTITUDE_SAMPLE_MS = 600_000

// Intersection of two sorted lists of spans.
export function intersect(a: readonly TimeSpan[], b: readonly TimeSpan[]): TimeSpan[] {
	const out: TimeSpan[] = []

	for (const x of a) {
		for (const y of b) {
			const start = Math.max(x.start, y.start)
			const end = Math.min(x.end, y.end)
			if (end > start) out.push({ start, end })
		}
	}

	return out.sort((x, y) => x.start - y.start)
}

// Spans of `spans` with the parts covered by `holes` removed.
export function subtract(spans: readonly TimeSpan[], holes: readonly TimeSpan[]): TimeSpan[] {
	let out = [...spans]

	for (const hole of holes) {
		const next: TimeSpan[] = []

		for (const span of out) {
			if (hole.end <= span.start || hole.start >= span.end) next.push(span)
			else {
				if (hole.start > span.start) next.push({ start: span.start, end: hole.start })
				if (hole.end < span.end) next.push({ start: hole.end, end: span.end })
			}
		}

		out = next
	}

	return out
}

// Total length of spans, milliseconds.
export function totalMs(spans: readonly TimeSpan[]) {
	let sum = 0
	for (const span of spans) sum += span.end - span.start
	return sum
}

// The planning nights of a site covering [start, end): each with its PlanningNight and the windows of the planet of NAIF
// `body` (a code of PLANNING_BODY_CODES, such as '599' or '699'). Yields to the event loop between nights, whose Sun
// and Moon take a noticeable time to compute the first time.
export async function siteNights(nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, site: PlanningSite, body: PlanningBodyCode, start: number, end: number, signal?: AbortSignal): Promise<SiteNight[]> {
	const out: SiteNight[] = []
	const { minimumAltitude, maximumSunAltitude } = OBSERVING_PRESETS.planetary
	let time = start

	while (time < end) {
		if (out.length > 0) {
			await yieldToEventLoop()
			signal?.throwIfAborted()
		}

		const night = nights({ observer: site, timeZone: site.timeZone, time })
		const planning = new PlanningNight(site, night)
		const found = visibilityWindows(planning.bodyAt(body), planning.location, planning.start, planning.end, { minimumAltitude, maximumSunAltitude }, { sunAt: planning.sunAt, step: SEARCH_STEP_DAYS })
		const windows = found.map((e) => ({ start: timeToUnixMillis(e.start), end: timeToUnixMillis(e.end) }))
		out.push({ planning, night: { eveningDate: night.sun.localDate, start: night.sun.start, end: night.sun.end, sunset: night.sun.sunset, sunrise: night.sun.sunrise, windows } })
		time = night.sun.end
	}

	return out
}

// Reason codes of the site limits: the Sun above the planetary limit, and the planet below the planetary minimum.
export interface SiteReasons<R extends string> {
	readonly sunTooHigh: R
	readonly planetTooLow: R
}

// Visibility of an event of the planet of NAIF `body` from the nights of a site. A zero-length event is observable when
// its instant is physically visible and inside a watchable window. `nights` must not be empty.
export function siteVisibility<R extends string>(event: EventSpan, visible: VisiblePart<R>, nights: readonly SiteNight[], body: PlanningBodyCode, codes: SiteReasons<R>): PlanetEventVisibility<R> {
	const { minimumAltitude, maximumSunAltitude } = OBSERVING_PRESETS.planetary
	const watchable = nights.flatMap((e) => e.night.windows)
	const windows = intersect(visible.spans, watchable)
	let longestMs = 0
	for (const window of windows) longestMs = Math.max(longestMs, window.end - window.start)
	const whole = Math.max(event.end - event.start, 0)
	const covered = totalMs(windows)
	const instant = whole === 0 && visible.spans.length > 0 && watchable.some((e) => event.maximum >= e.start && event.maximum <= e.end)
	const status: PlanetVisibilityStatus = whole === 0 ? (instant ? 'observable' : 'notObservable') : longestMs === 0 ? 'notObservable' : covered >= whole - 1000 ? 'observable' : 'partial'

	// The night holding the maximum, or the nearest one.
	const holder = nights.find((e) => event.maximum >= e.night.start && event.maximum < e.night.end) ?? nights[0]
	const { planning } = holder
	const location = planning.location
	const planetAt = planning.bodyAt(body)
	const altitude = (time: number) => {
		const t = planning.time(time)
		return altitudeOf(planetAt(t), t, location)
	}
	const sunAltitude = (time: number) => {
		const t = planning.time(time)
		return altitudeOf(planning.sunAt(t), t, location)
	}

	let peakAltitude = altitude(event.maximum)
	for (let time = event.start; time <= event.end; time += ALTITUDE_SAMPLE_MS) peakAltitude = Math.max(peakAltitude, altitude(time))
	peakAltitude = Math.max(peakAltitude, altitude(event.end))

	const reasons = new Set<R>()
	if (visible.reason) reasons.add(visible.reason)

	if (status !== 'observable') {
		// Explain the longest part of the physically visible interval the site cannot watch.
		const missed = subtract(visible.spans, windows).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
		const probe = missed ? (missed.start + missed.end) / 2 : event.maximum
		if (sunAltitude(probe) > maximumSunAltitude) reasons.add(codes.sunTooHigh)
		if (altitude(probe) < minimumAltitude) reasons.add(codes.planetTooLow)
	}

	return {
		status,
		eveningDate: holder.night.eveningDate,
		windows,
		longestMs,
		peakAltitude,
		peakAirmass: peakAltitude > 0 ? airmassKastenYoung(peakAltitude) : undefined,
		sunAltitude: sunAltitude(event.maximum),
		reasons: [...reasons],
	}
}

// An event with an identity, an interval and a visibility, as ranked and linked by overlap.
interface RankedEvent extends EventSpan {
	readonly id: string
	readonly visibility: { readonly longestMs: number; readonly peakAltitude?: number; readonly rank?: number }
}

// Ids of the events whose intervals intersect each event's, a zero-length event intersecting what contains its instant.
export function overlapsOf(events: readonly (EventSpan & { readonly id: string })[]): string[][] {
	return events.map((a) => events.filter((b) => b !== a && a.start <= b.end && b.start <= a.end && (a.end > a.start || b.end > b.start)).map((b) => b.id))
}

// Ranks the watchable events in place: the longest watchable part first, then the highest peak altitude.
export function rank(events: RankedEvent[]) {
	const watchable = events.filter((e) => e.visibility.longestMs > 0).sort((a, b) => b.visibility.longestMs - a.visibility.longestMs || (b.visibility.peakAltitude ?? 0) - (a.visibility.peakAltitude ?? 0))
	const ranks = new Map(watchable.map((e, i) => [e.id, i + 1]))

	for (let i = 0; i < events.length; i++) {
		const value = ranks.get(events[i].id)
		if (value !== undefined) events[i] = { ...events[i], visibility: { ...events[i].visibility, rank: value } }
	}
}

// Sites whose nights are kept.
const NIGHT_SITES_LIMIT = 8

// Nights kept per site: a 14-day range with its padding and one more.
const NIGHTS_PER_SITE = 20

// Nights of sites by instant, from the provider once and then from a bounded per-site list, which holds a whole range of
// nights where the provider keeps fewer. Keyed by the site's zone and coordinates.
export class SiteNightCache {
	readonly #nights = new LruCache<AstroWeatherNight[]>(NIGHT_SITES_LIMIT)

	// `provider` gives the night of a site containing an instant (Astro Weather's local night).
	constructor(private readonly provider: (request: AstroWeatherNightRequest) => AstroWeatherNight) {}

	// Night of a site containing an instant.
	readonly night = (request: AstroWeatherNightRequest): AstroWeatherNight => {
		const { observer, timeZone, time } = request
		const key = `${timeZone}|${observer.latitude}|${observer.longitude}|${observer.elevation}`
		const nights = this.#nights.get(key) ?? []
		const cached = nights.find(({ sun }) => sun.start <= time && time < sun.end)
		if (cached) return cached

		const night = this.provider(request)
		this.#nights.set(key, [...nights, night].slice(-NIGHTS_PER_SITE))
		return night
	}
}

// Contacts of an event of a planet's moons, Unix milliseconds; each only where it is computed and reached (see the
// toolkit's phenomena). A mutual event has only external1 and external2.
export interface MoonEventContacts {
	// First external contact.
	readonly external1?: number
	// First internal contact.
	readonly internal1?: number
	// First contact of the centre.
	readonly center1?: number
	// Last contact of the centre.
	readonly center2?: number
	// Last internal contact.
	readonly internal2?: number
	// Last external contact.
	readonly external2?: number
	// For a shadow transit, when its centre starts to face the Earth.
	readonly visibleStart?: number
	// For a shadow transit, when its centre stops facing the Earth.
	readonly visibleEnd?: number
}

// An event of a planet's moons as its physical visibility is judged: its kind, the moons it involves, and its contacts.
export interface MoonEventSpan<M extends string> extends EventSpan {
	// Kind of the event, as the planner names it.
	readonly kind: string
	// Moons the event involves: one for a phenomenon, front then back for a mutual event, none for a feature of the disk.
	readonly moons: readonly M[]
	// Contacts of the event.
	readonly contacts: MoonEventContacts
}

// Intervals in which a moon is hidden from the Earth, by moon: its centre behind the planet's limb (occulted) or inside
// the planet's umbra (eclipsed), Unix milliseconds.
export interface HiddenIntervals<M extends string> {
	// Intervals with the moon's centre behind the limb.
	readonly occulted: Readonly<Record<M, readonly TimeSpan[]>>
	// Intervals with the moon's centre inside the umbra.
	readonly eclipsed: Readonly<Record<M, readonly TimeSpan[]>>
}

// Unix milliseconds of an optional toolkit instant.
export function unixMillisOf(time: Time | undefined) {
	return time === undefined ? undefined : timeToUnixMillis(time)
}

// Contacts without their undefined entries.
export function definedContacts(contacts: MoonEventContacts): MoonEventContacts {
	const defined: Record<string, number> = {}
	for (const [key, value] of Object.entries(contacts)) if (value !== undefined) defined[key] = value
	return defined
}

// No interval for every moon of moons.
function emptyIntervals<M extends string>(moons: readonly M[]): Record<M, TimeSpan[]> {
	const intervals = {} as Record<M, TimeSpan[]>
	for (const moon of moons) intervals[moon] = []
	return intervals
}

// Collects the centre-contact intervals of the occultations and eclipses (satelliteOccultation, satelliteEclipse) of every
// moon of moons.
export function hiddenIntervals<M extends string>(events: readonly MoonEventSpan<M>[], moons: readonly M[]): HiddenIntervals<M> {
	const occulted = emptyIntervals(moons)
	const eclipsed = emptyIntervals(moons)

	for (const event of events) {
		if (event.kind !== 'satelliteOccultation' && event.kind !== 'satelliteEclipse') continue
		const { center1, center2 } = event.contacts
		if (center1 === undefined || center2 === undefined) continue
		const into = event.kind === 'satelliteOccultation' ? occulted : eclipsed
		into[event.moons[0]].push({ start: center1, end: center2 })
	}

	return { occulted, eclipsed }
}

// The part of an event that is physically visible from the Earth: a shadow transit while its centre faces the Earth
// (shadowHidden otherwise), an eclipse while the moon is not behind the disk (its fading is what is watched), a mutual
// event while neither moon is behind the disk or in the umbra (moonHidden otherwise); any other event whole. A
// zero-length event is one instant, visible or not.
export function physicallyVisible<M extends string>(event: MoonEventSpan<M>, { occulted, eclipsed }: HiddenIntervals<M>): VisiblePart<'moonHidden' | 'shadowHidden'> {
	const whole: TimeSpan[] = [{ start: event.start, end: Math.max(event.end, event.start) }]
	let holes: readonly TimeSpan[] = []
	let reason: 'moonHidden' | 'shadowHidden' = 'moonHidden'

	if (event.kind === 'shadowTransit') {
		const { visibleStart, visibleEnd } = event.contacts
		const facing = visibleStart !== undefined && visibleEnd !== undefined ? [{ start: visibleStart, end: visibleEnd }] : []
		holes = subtract(whole, facing)
		reason = 'shadowHidden'
	} else if (event.kind === 'satelliteEclipse') {
		holes = occulted[event.moons[0]]
	} else if (event.kind === 'mutualOccultation' || event.kind === 'mutualEclipse') {
		holes = event.moons.flatMap((moon) => [...occulted[moon], ...eclipsed[moon]])
	}

	const hit = holes.some((hole) => hole.start <= event.end && hole.end >= event.start)
	if (!hit) return { spans: whole }
	if (event.end <= event.start) return { spans: [], reason }
	return { spans: subtract(whole, holes), reason }
}
