import { LruCache } from './lrucache'
import { geographic, type SkyObserver } from './sky/ephemeris'
import { moonAboveHorizon, moonAppearance, type MoonPhaseName } from './sky/moon'
import { type SunLocalNight, sunNightAt, type TimeSpan } from './sky/sun'

// Local astronomical context of Astro Weather: the Sun over one night of a site and the Moon above its horizon. Computed
// from the toolkit, never the network, so it needs no forecast. A night costs a few hundred milliseconds, so the nights of
// each site are kept and found by the instant they contain. Times are Unix milliseconds.

// Sites kept in memory.
const SITE_CACHE_LIMIT = 16

// Nights kept per site: the seven forecast and a few around them.
const NIGHTS_PER_SITE = 10

// Margin shown before sunset and after sunrise, in milliseconds (one hour).
const DISPLAY_MARGIN_MS = 3_600_000

// Body of POST /api/astro-weather/night.
export interface AstroWeatherNightRequest {
	// Site of the night.
	readonly observer: SkyObserver
	// IANA time zone that names the civil date of the evening.
	readonly timeZone: string
	// Any instant of the night, Unix milliseconds; the previous night is reached with the start minus 1, the next with the end.
	readonly time: number
}

// The Moon over a night, as generic site-wide guidance: nothing here knows a target or its separation from the Moon.
export interface AstroWeatherMoon {
	// Instant of the appearance, the middle of the display window, Unix milliseconds.
	readonly time: number
	// Illuminated fraction seen from the site at `time`, [0, 1].
	readonly illuminatedFraction: number
	// Phase at `time`.
	readonly phase: MoonPhaseName
	// Intervals of the display window with the Moon above the horizon.
	readonly above: readonly TimeSpan[]
}

// One night of a site.
export interface AstroWeatherNight {
	// The Sun over the night, whose start and end are consecutive upper transits.
	readonly sun: SunLocalNight
	// Part of the night the tool shows: an hour before sunset to an hour after sunrise, or to the end of the night missing one.
	readonly display: TimeSpan
	// The Moon over the display window.
	readonly moon: AstroWeatherMoon
}

// Returns the part of a night to show.
function displayWindow({ start, end, sunset, sunrise }: SunLocalNight): TimeSpan {
	return { start: sunset === undefined ? start : Math.max(start, sunset - DISPLAY_MARGIN_MS), end: sunrise === undefined ? end : Math.min(end, sunrise + DISPLAY_MARGIN_MS) }
}

// Nights of the sites asked for, kept by site.
export class AstroWeatherNights {
	readonly #sites = new LruCache<AstroWeatherNight[]>(SITE_CACHE_LIMIT)

	// Returns the night containing an instant.
	night({ observer, timeZone, time }: AstroWeatherNightRequest): AstroWeatherNight {
		const key = `${timeZone}|${observer.latitude}|${observer.longitude}|${observer.elevation}`
		const nights = this.#sites.get(key) ?? []
		const cached = nights.find(({ sun }) => sun.start <= time && time < sun.end)
		if (cached) return cached

		const sun = sunNightAt(geographic(observer), time, timeZone)
		const display = displayWindow(sun)
		const middle = (display.start + display.end) / 2
		const { illuminatedFraction, phase } = moonAppearance(middle, observer)
		const night = { sun, display, moon: { time: middle, illuminatedFraction, phase, above: moonAboveHorizon(observer, display.start, display.end) } }

		this.#sites.set(key, [...nights, night].slice(-NIGHTS_PER_SITE))
		return night
	}
}
