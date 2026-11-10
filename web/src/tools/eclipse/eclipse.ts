import { formatFixed, MISSING } from '../../format'
import { type ApiFetch, browserFetch } from '../../http'
import type { GeographicLocation, ToolLocation } from '../../location/site'

// Place and formatting rules shared by the Lunar and Solar Eclipse Map tools. Each tool observes from a ToolLocation
// of its own (the active profile's site until another is chosen); a click on the map makes it coordinates typed in,
// and nothing here changes the profile or a site. Local circumstances depend on the longitude and latitude of the
// place alone, so a new elevation, name, or zone asks for nothing. Times are Unix milliseconds (UTC), geographic
// positions degrees, longitude east positive.

// Place whose local circumstances are asked for: the coordinates of the tool's location, as the requests send them.
export interface EclipsePlace {
	// Longitude in degrees, east positive, [-180, 180].
	readonly longitude: number
	// Geodetic latitude in degrees, north positive, [-90, 90].
	readonly latitude: number
}

// Browser services an eclipse tool uses, replaced in tests.
export interface EclipseIo {
	// Performs HTTP requests to the API.
	readonly fetch: ApiFetch
	// Real current time, Unix milliseconds (UTC); never the Sky simulation clock.
	readonly time: () => number
}

// Browser implementation of EclipseIo.
export const browserEclipseIo: EclipseIo = {
	fetch: browserFetch,
	time: () => Date.now(),
}

// Returns the place of a location, its longitude and latitude in degrees; undefined without one.
export function eclipsePlace(location: GeographicLocation | undefined): EclipsePlace | undefined {
	return location && { longitude: location.longitude, latitude: location.latitude }
}

// Whether two places, or their absence, are the same longitude and latitude.
export function samePlace(a: EclipsePlace | undefined, b: EclipsePlace | undefined): boolean {
	return a === b || (a !== undefined && b !== undefined && a.longitude === b.longitude && a.latitude === b.latitude)
}

// Returns the location a click on the map at a point (degrees, east positive) gives: coordinates typed in at 0 m,
// in the zone of the coordinates typed in before, or UTC when the tool observed from a site, since a point on the map
// does not tell its civil time zone.
export function mapLocation(current: ToolLocation, point: EclipsePlace): Extract<ToolLocation, { mode: 'manual' }> {
	return { mode: 'manual', latitude: point.latitude, longitude: point.longitude, elevation: 0, timeZone: current.mode === 'manual' ? current.timeZone : 'UTC' }
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

// Returns an angle the eclipse API gives in degrees (an altitude, an azimuth, or a position or zenith angle of a contact)
// to a tenth: "23.4°", or MISSING when it is absent or not finite.
export function formatEclipseAngle(degrees: number | undefined) {
	const text = degrees === undefined ? MISSING : formatFixed(degrees, 1)
	return text === MISSING ? MISSING : `${text}°`
}

// Returns an eclipse magnitude, or a ratio of the same kind such as gamma or the Moon/Sun diameter ratio, with four
// decimals, the one precision of every eclipse screen: "1.0123", or MISSING when it is absent or not finite.
export function formatEclipseMagnitude(magnitude: number | undefined) {
	return magnitude === undefined ? MISSING : formatFixed(magnitude, 4)
}

// Returns the message of a failure, or a generic one.
export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : 'Request failed'
}

// Whether a failure is the abort of a superseded request.
export function aborted(error: unknown) {
	return error instanceof DOMException && error.name === 'AbortError'
}
