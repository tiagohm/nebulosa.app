import { equatorial, type PositionOverTime } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { equatorialFromJ2000, equatorialToHorizontal } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { altitudeOf } from 'nebulosa/src/astronomy/events/horizon'
import { visibilityWindows } from 'nebulosa/src/astronomy/events/visibility'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { type Time, tdbMinusTtByFairheadAndBretagnon1990, timeShift, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { vecAngle } from 'nebulosa/src/math/linear-algebra/vec3'
import { fixedOrientationProviders, OBSERVING_PRESETS, type PlanningSite, SEARCH_STEP_DAYS, SiteOffset } from './observingplanner.astronomy'
import { toolkitTime, yieldToEventLoop } from './planetary.source'
import { intersect } from './planetary.visibility'
import { analyticalPlanetaryEventsEphemeris, geocentricOf, type PlanetaryEventBody, type PlanetaryEventKind, type PlanetaryEventsEphemeris } from './planetaryevents.astronomy'
import { geographic } from './sky/ephemeris'
import type { TimeSpan } from './sky/sun'

// Visibility of planetary events from a site. An event is geocentric and instantaneous; a site only decides whether it can
// be watched at its instant and when the best nearby stretch to watch its planets is. Each event gets one span around its
// instant (±3.5 days, ±2.5 for a pair) with a fixed Earth orientation (under 2″ of altitude error over a week), and the
// toolkit's visibilityWindows finds, every 10 minutes and refined, where each planet is high enough and the Sun low
// enough; a pair needs both planets at once. Positions are geometric VSOP87E, interpolated, never the kernels: they only
// decide when an event can be watched. Altitudes are geometric (airless) and the horizon has no terrain. Times are Unix
// milliseconds (UTC), angles radians.

// Constraints chosen for an event: the Observing Planner's planetary preset (the planet at least 25° high, the Sun at
// most −6°) for Mars to Neptune, and a twilight profile (at least 5° high, the Sun at most −6°) whenever Mercury or Venus
// takes part, which are seen low in a bright sky.
export type PlanetaryVisibilityProfile = 'night' | 'twilight'

// Altitude limits of a profile.
interface ProfileLimits {
	// Lowest geometric altitude of every planet of the event, radians.
	readonly minimumAltitude: number
	// Highest geometric altitude of the Sun's centre, radians.
	readonly maximumSunAltitude: number
}

// Limits of each profile.
export const PLANETARY_VISIBILITY_PROFILES: Readonly<Record<PlanetaryVisibilityProfile, ProfileLimits>> = {
	night: { minimumAltitude: OBSERVING_PRESETS.planetary.minimumAltitude, maximumSunAltitude: OBSERVING_PRESETS.planetary.maximumSunAltitude },
	twilight: { minimumAltitude: 5 * DEG2RAD, maximumSunAltitude: -6 * DEG2RAD },
}

// Whether and how an event can be watched from the site:
// - observable: the planets can be watched at the event's instant;
// - nearby: not at the instant, but in a nearby window (bestWindow);
// - notObservable: neither at the instant nor nearby;
// - notSuitable: a conjunction with the Sun, in its glare, which is never recommended for watching;
// - unknownNoSite: no site was given (the web's status; the route always has a site).
export type PlanetaryVisibilityStatus = 'observable' | 'nearby' | 'notObservable' | 'notSuitable' | 'unknownNoSite'

// Why an event cannot be watched at its instant or nearby:
// - sunTooHigh: the Sun is above the profile's limit at the instant;
// - planetTooLow: a planet (lowBodies) is below the profile's minimum at the instant;
// - solarGlare: a conjunction with the Sun;
// - noWindow: no nearby window of at least 15 minutes (polar day, a planet too far south or north, the Sun's glare);
// - separationTooWide: the nearby windows of a pair come when its planets are farther apart than the appulse threshold.
export type PlanetaryVisibilityReason = 'sunTooHigh' | 'planetTooLow' | 'solarGlare' | 'noWindow' | 'separationTooWide'

// A planet at the event's instant, seen from the site.
export interface PlanetaryBodyHorizontal {
	readonly body: PlanetaryEventBody
	// Geometric altitude, radians.
	readonly altitude: number
	// Azimuth from the north toward the east, radians in [0, 2π).
	readonly azimuth: number
}

// The site at the event's instant.
export interface PlanetaryAtEvent {
	readonly bodies: readonly PlanetaryBodyHorizontal[]
	// Geometric altitude of the Sun's centre, radians.
	readonly sunAltitude: number
	// Whether every planet and the Sun are within the profile's limits.
	readonly observable: boolean
	// Planets below the profile's minimum.
	readonly lowBodies: readonly PlanetaryEventBody[]
}

// A stretch near the event when every planet of it can be watched.
export interface PlanetaryObservingWindow {
	// First and last instants, Unix milliseconds.
	readonly start: number
	readonly end: number
	// Evening or morning sky, from the Sun's motion at the window's middle.
	readonly period: 'evening' | 'morning'
	// Highest geometric altitude of each planet over the window, radians, in the event's order of bodies.
	readonly peakAltitudes: readonly number[]
	// Topocentric separation of a pair at the window's middle, radians; absent for one planet.
	readonly separation?: number
	// Milliseconds from the event's instant to the window: 0 when it contains the instant, positive after, negative before.
	readonly offsetMs: number
}

// The visibility of one event from a site.
export interface PlanetaryEventVisibility {
	readonly status: PlanetaryVisibilityStatus
	readonly profile: PlanetaryVisibilityProfile
	// Limits of the profile, radians.
	readonly minimumAltitude: number
	readonly maximumSunAltitude: number
	readonly atEvent: PlanetaryAtEvent
	// The best nearby window: the one holding the instant, else the fewest whole days from it, then the longest, then the
	// highest lowest peak.
	readonly bestWindow?: PlanetaryObservingWindow
	readonly reasons: readonly PlanetaryVisibilityReason[]
}

// An event whose visibility is asked: its identity, kind, planets and instant.
export interface PlanetaryVisibilityEvent {
	readonly id: string
	readonly kind: PlanetaryEventKind
	readonly bodies: readonly PlanetaryEventBody[]
	readonly time: number
}

// Body of POST /api/planetary-events/visibility.
export interface PlanetaryEventsVisibilityRequest {
	readonly events: readonly PlanetaryVisibilityEvent[]
	readonly site: PlanningSite
	// Largest separation of a pair in a window, radians (the search's appulse threshold).
	readonly appulseThreshold: number
}

// Answer of POST /api/planetary-events/visibility: each asked event's visibility by id.
export interface PlanetaryEventsVisibility {
	readonly visibility: Readonly<Record<string, PlanetaryEventVisibility>>
}

// Half-width of the span searched around an event, milliseconds: 3.5 days, 2.5 for a pair, which only meets near the event.
const SPAN_HALF_MS = 3.5 * 86_400_000
const PAIR_SPAN_HALF_MS = 2.5 * 86_400_000

// Shortest window worth watching, milliseconds: the planetary preset's continuous duration.
const MINIMUM_WINDOW_MS = OBSERVING_PRESETS.planetary.minimumContinuousMs

// Spacing of the peak-altitude samples of a window, milliseconds.
const PEAK_SAMPLE_MS = 600_000

// Half-step of the Sun's altitude rate that tells evening from morning, milliseconds.
const PERIOD_HALF_MS = 300_000

// Events between two yields of a batch.
const BATCH_YIELD = 10

// Profile of an event: twilight when Mercury or Venus takes part.
function profileOf(bodies: readonly PlanetaryEventBody[]): PlanetaryVisibilityProfile {
	return bodies.some((code) => code === '199' || code === '299') ? 'twilight' : 'night'
}

// The middle of an event's span: its instant with the span's fixed Earth orientation (fixedOrientationProviders) and the
// USNO Circular 179 TDB − TT, which keeps the interpolated ephemeris cheap; every instant of the span is shifted from it.
function spanMiddle(time: number): Time {
	const middle = toolkitTime(time)
	Object.defineProperty(middle, 'providers', { value: { ...fixedOrientationProviders(middle), tdbMinusTt: tdbMinusTtByFairheadAndBretagnon1990 }, enumerable: false, writable: true })
	return middle
}

// Whether a window score ranks before another, comparing their terms in order (lower first).
function precedes(a: readonly number[], b: readonly number[]) {
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i]
	return false
}

// Geometric altitude and azimuth of a topocentric ICRS vector at an instant.
function horizontal(direction: Parameters<typeof equatorial>[0], time: Time, location: GeographicPosition): readonly [number, number] {
	const [ra2000, dec2000] = equatorial(direction)
	const [rightAscension, declination] = equatorialFromJ2000(ra2000, dec2000, time)
	const [azimuth, altitude] = equatorialToHorizontal(rightAscension, declination, location.latitude, localSiderealTime(time, location, false))
	return [altitude, azimuth]
}

// Visibility of one event from a site over its span, from the batch's ephemeris and site offset.
function eventVisibility(ephemeris: PlanetaryEventsEphemeris, site: SiteOffset, event: PlanetaryVisibilityEvent, appulseThreshold: number): PlanetaryEventVisibility {
	const profile = profileOf(event.bodies)
	const limits = PLANETARY_VISIBILITY_PROFILES[profile]
	const location = site.location
	const middle = spanMiddle(event.time)
	const time = (ms: number) => timeShift(middle, (ms - event.time) / 86_400_000)
	const sunAt = site.topocentric(geocentricOf(ephemeris, 'sun', middle))
	const planets: PositionOverTime[] = event.bodies.map((code) => site.topocentric(geocentricOf(ephemeris, code, middle)))

	const bodies = event.bodies.map((body, i): PlanetaryBodyHorizontal => {
		const [altitude, azimuth] = horizontal(planets[i](middle), middle, location)
		return { body, altitude, azimuth }
	})
	const sunAltitude = altitudeOf(sunAt(middle), middle, location)
	const lowBodies = bodies.filter((e) => e.altitude < limits.minimumAltitude).map((e) => e.body)
	const observable = sunAltitude <= limits.maximumSunAltitude && lowBodies.length === 0
	const atEvent: PlanetaryAtEvent = { bodies, sunAltitude, observable, lowBodies }
	const base = { profile, minimumAltitude: limits.minimumAltitude, maximumSunAltitude: limits.maximumSunAltitude, atEvent }

	if (event.kind === 'solarConjunction') return { ...base, status: 'notSuitable', reasons: ['solarGlare'] }

	const half = event.bodies.length > 1 ? PAIR_SPAN_HALF_MS : SPAN_HALF_MS
	const start = time(event.time - half)
	const end = time(event.time + half)
	let windows: TimeSpan[] | undefined

	for (const planetAt of planets) {
		const found = visibilityWindows(planetAt, location, start, end, limits, { sunAt, step: SEARCH_STEP_DAYS }).map((e) => ({ start: timeToUnixMillis(e.start), end: timeToUnixMillis(e.end) }))
		windows = windows === undefined ? found : intersect(windows, found)
	}

	const reasons: PlanetaryVisibilityReason[] = []
	if (sunAltitude > limits.maximumSunAltitude) reasons.push('sunTooHigh')
	if (lowBodies.length > 0) reasons.push('planetTooLow')

	let separationTooWide = false
	let best: PlanetaryObservingWindow | undefined
	let bestScore: readonly number[] | undefined

	for (const window of windows ?? []) {
		if (window.end - window.start < MINIMUM_WINDOW_MS) continue
		const mid = time((window.start + window.end) / 2)
		const separation = planets.length > 1 ? vecAngle(planets[0](mid), planets[1](mid)) : undefined

		if (separation !== undefined && separation > appulseThreshold) {
			separationTooWide = true
			continue
		}

		const peakAltitudes = planets.map((planetAt) => {
			let peak = -Infinity
			for (let ms = window.start; ms < window.end; ms += PEAK_SAMPLE_MS) {
				const t = time(ms)
				peak = Math.max(peak, altitudeOf(planetAt(t), t, location))
			}
			const t = time(window.end)
			return Math.max(peak, altitudeOf(planetAt(t), t, location))
		})
		const offsetMs = event.time < window.start ? window.start - event.time : event.time > window.end ? window.end - event.time : 0
		const before = time((window.start + window.end) / 2 - PERIOD_HALF_MS)
		const after = time((window.start + window.end) / 2 + PERIOD_HALF_MS)
		const period = altitudeOf(sunAt(after), after, location) < altitudeOf(sunAt(before), before, location) ? 'evening' : 'morning'
		const score = [offsetMs === 0 ? 0 : 1, Math.floor(Math.abs(offsetMs) / 86_400_000), -(window.end - window.start), -Math.min(...peakAltitudes)]

		if (!bestScore || precedes(score, bestScore)) {
			best = { start: window.start, end: window.end, period, peakAltitudes, ...(separation !== undefined && { separation }), offsetMs }
			bestScore = score
		}
	}

	if (observable) return { ...base, status: 'observable', ...(best && { bestWindow: best }), reasons }
	if (best) return { ...base, status: 'nearby', bestWindow: best, reasons }
	reasons.push(separationTooWide ? 'separationTooWide' : 'noWindow')
	return { ...base, status: 'notObservable', reasons }
}

// Visibility of a batch of events from one site, yielding to the event loop every few events and stopping when `signal`
// aborts; `cached` answers the events already computed, which are neither recomputed nor counted toward a yield.
export async function computeVisibility(request: PlanetaryEventsVisibilityRequest, cached: (event: PlanetaryVisibilityEvent) => PlanetaryEventVisibility | undefined, signal?: AbortSignal): Promise<Map<string, PlanetaryEventVisibility>> {
	signal?.throwIfAborted()
	const ephemeris = analyticalPlanetaryEventsEphemeris()
	const site = new SiteOffset(geographic(request.site))
	const out = new Map<string, PlanetaryEventVisibility>()
	let computed = 0

	for (const event of request.events) {
		const known = cached(event)
		if (known) {
			out.set(event.id, known)
			continue
		}

		if (computed > 0 && computed % BATCH_YIELD === 0) {
			await yieldToEventLoop()
			signal?.throwIfAborted()
		}

		out.set(event.id, eventVisibility(ephemeris, site, event, request.appulseThreshold))
		computed++
	}

	return out
}
