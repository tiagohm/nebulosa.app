import type { AstroWeatherForecast, AstroWeatherNight, AstroWeatherNightRequest, SkyObserver, TimeSpan } from 'api'
import { proxy } from 'valtio'
import { fetchJson } from '../../http'
import type { AstroWeatherMode, SkyObserverSettings } from '../../profile/schema'
import { BROWSER_TIME_ZONE } from '../../sky/clock'
import { createRequestGuard } from '../../sky/selection'
import { aborted, browserEclipseIo, type EclipseIo, type EclipsePlace, errorMessage } from '../eclipse/eclipse'
import type { MissingMetric, Outlook, OutlookReason, WindowBlock } from './observing'

// State of the Astro Weather tool, tab-lived and never persisted but for the observing mode, which the profile keeps: the site
// typed in for the tool alone, the night shown, the forecast, and the hour under the cursor. The forecast and the night are
// independent requests, each behind a guard of its own, so one failing leaves the other shown and an answer for another site
// never replaces a newer one. The server caches forecasts for every tab, so nothing here polls or bypasses that: changing
// mode, night, or hour asks for no forecast. Forecasts describe real instants, so the Sky clock plays no part. Times are Unix
// milliseconds (UTC).

// Age of a forecast from which opening the tool reads it again, in milliseconds (30 minutes, the shortest cache of the server).
const FORECAST_REFRESH_MS = 30 * 60_000

// Name of each observing mode.
export const MODE_LABELS: Readonly<Record<AstroWeatherMode, string>> = { visual: 'Visual', deepSky: 'Deep Sky', planetary: 'Planetary' }

// Name of each reading.
export const OUTLOOK_LABELS: Readonly<Record<Outlook, string>> = { favorable: 'Favorable', variable: 'Variable', unfavorable: 'Unfavorable', unavailable: 'Unavailable' }

// Text of each reason of a reading.
export const REASON_LABELS: Readonly<Record<OutlookReason, string>> = {
	heavyCloud: 'Heavy cloud cover',
	someCloud: 'Some cloud cover',
	rain: 'Rain likely',
	possibleRain: 'Possible rain',
	strongGusts: 'Strong gusts',
	moderateGusts: 'Moderate gusts',
	dewLikely: 'Dew likely',
	dewRisk: 'Some dew risk',
	poorSeeing: 'Poor seeing',
	fairSeeing: 'Fair seeing',
	poorTransparency: 'Poor transparency',
	fairTransparency: 'Fair transparency',
	brightMoon: 'Bright Moon up, depending on the target and filter',
	moonUp: 'Bright Moon up, for faint targets only',
	noDarkness: 'No astronomical darkness',
}

// Name of what a reading may lack.
export const MISSING_LABELS: Readonly<Record<MissingMetric, string>> = { weather: 'weather forecast', seeing: 'seeing forecast', transparency: 'transparency forecast' }

// Explanation of why no window is recommended.
export const BLOCK_LABELS: Readonly<Record<WindowBlock, string>> = {
	noCoverage: 'The forecast does not cover what this mode needs for this night.',
	staleForecast: 'No window is recommended from an old forecast.',
	noDarkness: 'The Sun does not reach −18° this night.',
	noNight: 'The Sun does not set this night, or this night has passed.',
	noWindow: 'No favorable continuous window predicted.',
}

// Band of arcseconds each 7Timer! seeing class stands for, 1 the best; the service's categories, never measurements.
export const SEEING_BANDS = ['below 0.5″', '0.5–0.75″', '0.75–1″', '1–1.25″', '1.25–1.5″', '1.5–2″', '2–2.5″', 'above 2.5″'] as const

// Band of magnitudes per airmass each 7Timer! transparency class stands for, 1 the best.
export const TRANSPARENCY_BANDS = ['below 0.3', '0.3–0.4', '0.4–0.5', '0.5–0.6', '0.6–0.7', '0.7–0.85', '0.85–1', 'above 1'] as const

// Site a forecast is read for.
export interface AstroWeatherSite extends SkyObserver {
	// Name of the Sky observer, when it is the site.
	readonly name?: string
	// IANA time zone that names the nights and shows the times.
	readonly timeZone: string
}

// Astro Weather state of the tab.
export interface AstroWeatherState {
	// Place chosen for the tool alone; absent follows the Sky observer of the profile.
	place?: EclipsePlace
	// Time zone chosen for the tool alone; absent uses the site's.
	timeZone?: string
	// Latest forecast of the site.
	forecast?: AstroWeatherForecast
	// Whether a forecast is being read.
	forecastLoading: boolean
	// Why the latest forecast could not be read.
	forecastError?: string
	// Night shown.
	night?: AstroWeatherNight
	// Whether a night is being computed.
	nightLoading: boolean
	// Why the night could not be read.
	nightError?: string
	// Start of the hour under the cursor; absent shows the first hour left.
	cursor?: number
	// Key of the site the values belong to.
	siteKey?: string
	// Id of the profile the place and zone were chosen under.
	profileId?: string
}

// Astro Weather store of the tab.
export const astroWeatherState = proxy<AstroWeatherState>({ forecastLoading: false, nightLoading: false })

// Forecast standing for none while it loads or fails, so the hours of the night still read as unknown.
export const EMPTY_FORECAST: AstroWeatherForecast = { latitude: 0, longitude: 0, generatedAt: 0, meteorology: { source: { provider: 'openMeteo', state: 'unavailable' }, samples: [] }, astronomy: { source: { provider: 'sevenTimer', state: 'unavailable' }, cellDegrees: 0.1, samples: [] } }

// Guard of the forecast requests.
const forecastGuard = createRequestGuard()

// Guard of the night requests.
const nightGuard = createRequestGuard()

// Returns the site shown: the place chosen, at sea level since none is given, or the Sky observer. Undefined without either.
// A coordinate does not tell its civil time zone, so a place takes UTC until one is chosen, and the observer its own.
export function effectiveSite(state: Pick<AstroWeatherState, 'place' | 'timeZone'>, observer: SkyObserverSettings | undefined): AstroWeatherSite | undefined {
	if (state.place) return { latitude: state.place.latitude, longitude: state.place.longitude, elevation: 0, timeZone: state.timeZone || 'UTC' }
	if (!observer) return undefined
	const { latitude, longitude, elevation, name } = observer
	return { latitude, longitude, elevation, name, timeZone: state.timeZone || observer.timeZone || BROWSER_TIME_ZONE }
}

// Returns the key of what a site's values depend on.
export function siteKey({ latitude, longitude, elevation, timeZone }: AstroWeatherSite) {
	return `${latitude}|${longitude}|${elevation}|${timeZone}`
}

// Reads the forecast of a site, keeping the one shown until the answer. Answers of an older request are discarded.
export async function loadForecast(state: AstroWeatherState, site: AstroWeatherSite, io: EclipseIo = browserEclipseIo) {
	const request = forecastGuard.begin()
	state.forecastLoading = true
	state.forecastError = undefined

	try {
		const forecast = await fetchJson<AstroWeatherForecast>(io, `/api/astro-weather/forecast?latitude=${site.latitude}&longitude=${site.longitude}`, { signal: request.signal })
		if (!request.current()) return
		state.forecast = forecast
		state.forecastLoading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.forecastError = errorMessage(error)
		state.forecastLoading = false
	}
}

// Computes the night of a site containing an instant. Answers of an older request are discarded.
export async function loadNight(state: AstroWeatherState, site: AstroWeatherSite, time: number, io: EclipseIo = browserEclipseIo) {
	const request = nightGuard.begin()
	state.nightLoading = true
	state.nightError = undefined

	try {
		const body: AstroWeatherNightRequest = { observer: { latitude: site.latitude, longitude: site.longitude, elevation: site.elevation }, timeZone: site.timeZone, time }
		const night = await fetchJson<AstroWeatherNight>(io, '/api/astro-weather/night', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: request.signal })
		if (!request.current()) return
		state.night = night
		state.cursor = undefined
		state.nightLoading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.nightError = errorMessage(error)
		state.nightLoading = false
	}
}

// Takes the active profile: another profile goes back to its own Sky observer, forgetting the place and zone chosen here.
export function followProfile(state: AstroWeatherState, profileId: string) {
	if (state.profileId !== undefined && state.profileId !== profileId) {
		state.place = undefined
		state.timeZone = undefined
	}

	state.profileId = profileId
}

// Starts showing a site: another site forgets the values of the one before at once and shows the night of now, and the same
// site reads its forecast again only when it is old. Returns a function that cancels what is in progress.
export function followSite(state: AstroWeatherState, site: AstroWeatherSite, io: EclipseIo = browserEclipseIo): () => void {
	const key = siteKey(site)

	if (key !== state.siteKey) {
		state.siteKey = key
		state.forecast = undefined
		state.forecastError = undefined
		state.night = undefined
		state.nightError = undefined
		state.cursor = undefined
	}

	const now = io.time()
	const fetchedAt = state.forecast?.generatedAt
	if (fetchedAt === undefined || now - fetchedAt >= FORECAST_REFRESH_MS) void loadForecast(state, site, io)
	if (!state.night || now >= state.night.sun.end) void loadNight(state, site, now, io)

	return () => {
		forecastGuard.cancel()
		nightGuard.cancel()
		state.forecastLoading = false
		state.nightLoading = false
	}
}

// Shows the night before or after the one shown. Asks for no forecast, which already covers every night it can.
export function stepNight(state: AstroWeatherState, site: AstroWeatherSite, direction: -1 | 1, io: EclipseIo = browserEclipseIo) {
	const { night } = state
	if (night) return loadNight(state, site, direction < 0 ? night.sun.start - 1 : night.sun.end, io)
}

// Whether the night shown has begun, so the one before it has passed and has no forecast worth showing.
export function firstNight(night: AstroWeatherNight, now: number) {
	return night.sun.start <= now
}

// Whether the forecast has anything for the night after the one shown.
export function hasNextNight(night: AstroWeatherNight, forecast: AstroWeatherForecast | undefined) {
	const validTo = forecast?.meteorology.source.validTo ?? forecast?.astronomy.source.validTo
	return validTo !== undefined && night.sun.end < validTo
}

// How much of a span a forecast covers.
export type Coverage = 'full' | 'partial' | 'none'

// Returns how much of a span a forecast from `validFrom` to `validTo` covers.
export function coverage(span: TimeSpan, validFrom: number | undefined, validTo: number | undefined): Coverage {
	if (validFrom === undefined || validTo === undefined || validTo <= span.start || validFrom >= span.end) return 'none'
	return validFrom <= span.start && validTo >= span.end ? 'full' : 'partial'
}

// Formatters of times by locale, zone, and whether they name the zone.
const clockFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns the time of day of an instant in a time zone, optionally with the zone's name, whose offset tells apart an hour the
// clocks repeat.
export function formatClock(time: number, timeZone: string, named = false, locale?: string) {
	const key = `${locale ?? ''}|${timeZone}|${named}`
	let formatter = clockFormatters.get(key)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: named ? 'short' : undefined })
		clockFormatters.set(key, formatter)
	}

	return formatter.format(time)
}

// Returns the length of a span as hours and minutes, such as "5h 20m".
export function formatLength({ start, end }: TimeSpan) {
	const minutes = Math.round((end - start) / 60_000)
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

// Part of a night by how dark it is.
export type SkyBand = 'day' | 'twilight' | 'dark'

// Interval of one darkness of the sky.
export interface SkyBandSpan extends TimeSpan {
	// Darkness of the interval.
	readonly band: SkyBand
}

// Returns the display window of a night split by how dark the sky is, in time order. Polar nights and days need no invented
// crossing: what the Sun does not cross is simply not split.
export function skyBands({ sun, display }: AstroWeatherNight): readonly SkyBandSpan[] {
	const sunset = sun.sunset ?? (sun.daylight === 'continuousAbove' ? display.end : display.start)
	const sunrise = sun.sunrise ?? (sun.daylight === 'continuousAbove' ? display.start : display.end)
	const cuts = new Set([display.start, display.end])
	const inside = (time: number) => time > display.start && time < display.end
	for (const time of [sunset, sunrise, ...sun.darkness.flatMap((span) => [span.start, span.end])]) if (inside(time)) cuts.add(time)
	const edges = [...cuts].sort((a, b) => a - b)
	const bands: SkyBandSpan[] = []

	for (let i = 1; i < edges.length; i++) {
		const start = edges[i - 1]
		const end = edges[i]
		const middle = (start + end) / 2
		const band = sun.darkness.some((span) => span.start <= middle && middle < span.end) ? 'dark' : middle < sunset || middle >= sunrise ? 'day' : 'twilight'
		bands.push({ start, end, band })
	}

	return bands
}
