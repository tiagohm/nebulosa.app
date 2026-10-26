import type { SkyObserverSettings } from '../../profile/schema'

// Place, time zone, and formatting rules shared by the Lunar and Solar Eclipse Map tools. The place starts as the
// Sky observer of the active profile, and a place chosen on the map or by hand never changes the profile. Times
// are Unix milliseconds (UTC), geographic positions degrees, longitude east positive.

// Where the place shown comes from.
export type EclipsePlaceSource = 'observer' | 'map' | 'manual'

// Place whose local circumstances are shown.
export interface EclipsePlace {
	// Where it comes from.
	readonly source: EclipsePlaceSource
	// Longitude in degrees, east positive, [-180, 180].
	readonly longitude: number
	// Geodetic latitude in degrees, north positive, [-90, 90].
	readonly latitude: number
	// Name of the Sky observer, when it is the place.
	readonly name?: string
	// IANA time zone of the Sky observer, when it is the place and has one.
	readonly timeZone?: string
}

// Browser services an eclipse tool uses, replaced in tests.
export interface EclipseIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Real current time, Unix milliseconds (UTC); never the Sky simulation clock.
	readonly time: () => number
}

// Browser implementation of EclipseIo.
export const browserEclipseIo: EclipseIo = {
	fetch: (input, init) => fetch(input, init),
	time: () => Date.now(),
}

// Returns the place of the Sky observer.
export function observerPlace(observer: SkyObserverSettings): EclipsePlace {
	return { source: 'observer', longitude: observer.longitude, latitude: observer.latitude, name: observer.name, timeZone: observer.timeZone }
}

// Returns the time zone the times are shown in: the one chosen (timeZone: UTC, an IANA zone, or empty for the
// browser's); otherwise the Sky observer's for the observer (empty, the browser's, when it has none); otherwise
// UTC, since a place on the map does not tell its civil time zone.
export function displayTimeZone(state: { readonly timeZone?: string; readonly place?: EclipsePlace }): string {
	if (state.timeZone !== undefined) return state.timeZone
	return state.place?.source === 'observer' ? (state.place.timeZone ?? '') : 'UTC'
}

// Formatters of eclipse times by locale and time zone.
const timeFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns an instant (Unix milliseconds) as its date and time to the second in a time zone (empty for the
// browser's), with the zone's name, such as "Sep 16, 1997, 18:47:11 UTC", so a time past midnight shows its day.
export function formatEclipseTime(time: number, timeZone: string, locale?: string): string {
	const key = `${locale ?? ''}|${timeZone}`
	let formatter = timeFormatters.get(key)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, { timeZone: timeZone || undefined, year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' })
		timeFormatters.set(key, formatter)
	}

	return formatter.format(time)
}

// Returns the UTC calendar date of an instant (Unix milliseconds) as YYYY-MM-DD, the value of a date field.
export function utcDate(time: number): string {
	return new Date(time).toISOString().slice(0, 10)
}

// Returns the Unix milliseconds of 00:00 UTC of a calendar date (YYYY-MM-DD).
export function utcDateStart(date: string): number {
	const [year, month, day] = date.split('-').map(Number)
	return Date.UTC(year, month - 1, day)
}

// Returns a duration in seconds as hours, minutes, and seconds, such as "3h 16m 05s".
export function formatDuration(seconds: number): string {
	const total = Math.round(seconds)
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor((total % 3600) / 60)
	const rest = total % 60
	return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(rest).padStart(2, '0')}s`
}

// Returns the message of a failure, or a generic one.
export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Request failed'
}

// Whether a failure is the abort of a superseded request.
export function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}
