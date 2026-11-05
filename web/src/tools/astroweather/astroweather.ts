import type { AstroWeatherForecast, AstroWeatherNight, AstroWeatherNightRequest, TimeSpan } from 'api'
import { proxy } from 'valtio'
import { fetchJson } from '../../http'
import { ACTIVE_TOOL_LOCATION, locationKey, type SiteLocation, siteObserver, type ToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, type DisplayZoneOverride } from '../../location/zone'
import type { AstroWeatherMode } from '../../profile/schema'
import { createRequestGuard } from '../../sky/selection'
import { aborted, browserEclipseIo, type EclipseIo, errorMessage } from '../eclipse/eclipse'
import type { MissingMetric, Outlook, OutlookReason, WindowBlock } from './observing'

// State of the Astro Weather tool, tab-lived and never persisted but for the observing mode, which the profile keeps: the
// location chosen for the tool alone, the zone its times are shown in, the night shown, the forecast, and the hour under the
// cursor. The forecast and the night are independent requests, each behind a guard of its own, so one failing leaves the
// other shown and an answer for another site never replaces a newer one. The server caches forecasts for every tab, so
// nothing here polls or bypasses that: changing mode, night, hour, or display zone asks for nothing. A night is named in the
// location's own zone, never in the display zone, which only formats the times. Forecasts describe real instants, so the Sky
// clock plays no part. Times are Unix milliseconds (UTC).

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

// Astro Weather state of the tab.
export interface AstroWeatherState {
	// Where the tool observes from: the active profile's site, followed live, unless one was chosen for the tool alone.
	location: ToolLocation
	// Zone the tool shows its times in; it never names a night, keys a value, or changes a request.
	zone: DisplayZoneOverride
	// Latest forecast of the site.
	forecast?: AstroWeatherForecast
	// Whether a forecast is being read.
	forecastLoading: boolean
	// Why the latest forecast could not be read.
	forecastError?: string
	// Night shown.
	night?: AstroWeatherNight
	// Start of the current night, the first one offered, Unix milliseconds.
	currentNightStart?: number
	// Whether a night is being computed.
	nightLoading: boolean
	// Why the night could not be read.
	nightError?: string
	// Start of the hour under the cursor; absent shows the first hour left.
	cursor?: number
	// Key of the location the values belong to (siteKey).
	siteKey?: string
	// Id of the profile the location and zone were chosen under.
	profileId?: string
}

// Astro Weather store of the tab.
export const astroWeatherState = proxy<AstroWeatherState>({ location: { ...ACTIVE_TOOL_LOCATION }, zone: { ...DEFAULT_ZONE_OVERRIDE }, forecastLoading: false, nightLoading: false })

// Forecast standing for none while it loads or fails, so the hours of the night still read as unknown.
export const EMPTY_FORECAST: AstroWeatherForecast = { latitude: 0, longitude: 0, generatedAt: 0, meteorology: { source: { provider: 'openMeteo', state: 'unavailable' }, samples: [] }, astronomy: { source: { provider: 'sevenTimer', state: 'unavailable' }, cellDegrees: 0.1, samples: [] } }

// Guard of the forecast requests.
const forecastGuard = createRequestGuard()

// Guard of the night requests.
const nightGuard = createRequestGuard()

// Returns the key of what the values of a location depend on: its place, and its own zone, which names its nights. The
// display zone is no part of it, so choosing one never clears or requests anything.
export function siteKey(location: SiteLocation) {
	return `${locationKey(location)}|${location.timeZone}`
}

// Reads the forecast of a site, keeping the one shown until the answer. Answers of an older request are discarded.
export async function loadForecast(state: AstroWeatherState, site: SiteLocation, io: EclipseIo = browserEclipseIo) {
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

// Reads the night of a site containing an instant, named in the site's own zone.
function readNight(site: SiteLocation, time: number, signal: AbortSignal, io: EclipseIo) {
	const body: AstroWeatherNightRequest = { observer: siteObserver(site), timeZone: site.timeZone, time }
	return fetchJson<AstroWeatherNight>(io, '/api/astro-weather/night', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
}

// Shows the night a reader answers, marking it as the current night when `current` is set. Answers of an older request are
// discarded.
async function showNight(state: AstroWeatherState, read: (signal: AbortSignal) => Promise<AstroWeatherNight>, current: boolean) {
	const request = nightGuard.begin()
	state.nightLoading = true
	state.nightError = undefined

	try {
		const night = await read(request.signal)
		if (!request.current()) return
		state.night = night
		if (current) state.currentNightStart = night.sun.start
		state.cursor = undefined
		state.nightLoading = false
	} catch (error) {
		if (!request.current() || aborted(error)) return
		state.nightError = errorMessage(error)
		state.nightLoading = false
	}
}

// Computes the night of a site containing an instant.
export function loadNight(state: AstroWeatherState, site: SiteLocation, time: number, io: EclipseIo = browserEclipseIo) {
	return showNight(state, (signal) => readNight(site, time, signal, io), false)
}

// Computes the current night of a site: the one containing now, or the next one once the display window of that one has ended,
// since a night runs until the upper transit of the next day but has nothing left to show after the morning.
export function loadCurrentNight(state: AstroWeatherState, site: SiteLocation, io: EclipseIo = browserEclipseIo) {
	return showNight(
		state,
		async (signal) => {
			const now = io.time()
			const night = await readNight(site, now, signal, io)
			return now < night.display.end ? night : readNight(site, night.sun.end, signal, io)
		},
		true,
	)
}

// Whether the display window of a night has ended.
export function nightEnded(night: AstroWeatherNight, now: number) {
	return now >= night.display.end
}

// Takes the active profile: another profile goes back to its own active site and default zone, forgetting the location and
// zone chosen here.
export function followProfile(state: AstroWeatherState, profileId: string) {
	if (state.profileId !== undefined && state.profileId !== profileId) {
		state.location = { ...ACTIVE_TOOL_LOCATION }
		state.zone = { ...DEFAULT_ZONE_OVERRIDE }
	}

	state.profileId = profileId
}

// Starts showing a site: another site forgets the values of the one before at once and shows the current night, and the same
// site reads its forecast again only when it is old. Returns a function that cancels what is in progress.
export function followSite(state: AstroWeatherState, site: SiteLocation, io: EclipseIo = browserEclipseIo): () => void {
	const key = siteKey(site)

	if (key !== state.siteKey) {
		state.siteKey = key
		state.forecast = undefined
		state.forecastError = undefined
		state.night = undefined
		state.currentNightStart = undefined
		state.nightError = undefined
		state.cursor = undefined
	}

	const now = io.time()
	const fetchedAt = state.forecast?.generatedAt
	if (fetchedAt === undefined || now - fetchedAt >= FORECAST_REFRESH_MS) void loadForecast(state, site, io)
	if (!state.night || nightEnded(state.night, now)) void loadCurrentNight(state, site, io)

	return () => {
		forecastGuard.cancel()
		nightGuard.cancel()
		state.forecastLoading = false
		state.nightLoading = false
	}
}

// Shows the night before or after the one shown. Asks for no forecast, which already covers every night it can.
export function stepNight(state: AstroWeatherState, site: SiteLocation, direction: -1 | 1, io: EclipseIo = browserEclipseIo) {
	const { night } = state
	if (night) return loadNight(state, site, direction < 0 ? night.sun.start - 1 : night.sun.end, io)
}

// Whether the night before the one shown has passed and has no forecast worth showing: the night shown has begun, or is the
// current night, which starts later than now from the end of the morning window to the upper transit of the Sun.
export function firstNight(night: AstroWeatherNight, now: number, currentNightStart = now) {
	return night.sun.start <= Math.max(now, currentNightStart)
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
export function formatClock(time: number, timeZone: string, named = false, locale: string = 'en-US') {
	const key = `${locale}|${timeZone}|${named}`
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
