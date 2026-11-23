import { dateTimeFormat } from '../format'
import type { DateTimePreferences, DisplayTimeZoneMode } from '../profile/schema'

// Civil time zones of the application, and the one rule that says which zone a civil time is shown in. A zone is always
// named by its IANA identifier, never by an offset or an empty sentinel. Instants stay Unix milliseconds (UTC): the zone
// only reads them as wall-clock dates and times, so choosing one never changes an instant, a calculation, or a device.
//
// Which zone shows a time (resolveDisplayZone): a tool's own choice when it made one (an IANA zone, UTC, the browser's,
// or the site of the tool); otherwise the profile's default (Settings → Date & Time): the observing site's zone, UTC,
// the browser's, or one IANA zone. The browser's is read by each device for itself, so two devices of one profile may
// show the same instant at different clock times; every other choice reads the same everywhere. The site is the location the tool uses, which may be another saved site than the profile's or
// coordinates typed in; without one the browser's zone stands in and says so. Which zone names a local day or night is
// never this rule: it is always the zone of the place observed.

// Whether a name is an IANA time zone the browser knows ('UTC' included).
export function isKnownTimeZone(timeZone: string) {
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}

// Every IANA time zone the browser knows, 'UTC' first; what a zone selector offers.
export const TIME_ZONES: readonly string[] = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')]

// IANA time zone of the browser, read once when the page loads.
export const BROWSER_TIME_ZONE = new Intl.DateTimeFormat().resolvedOptions().timeZone

// Zone a tool shows its civil times in: the profile's default, one of the default's choices for this tool only, or an
// IANA zone.
export type DisplayZoneOverride = { readonly mode: 'default' | Exclude<DisplayTimeZoneMode, 'zone'> } | { readonly mode: 'zone'; readonly zone: string }

// The choice of a tool that follows the profile's default.
export const DEFAULT_ZONE_OVERRIDE: DisplayZoneOverride = { mode: 'default' }

// Why a zone shows the times: the site of the tool, UTC, the browser's, an IANA zone a tool or the profile chose, or the
// browser's standing in for a site there is none of.
export type DisplayZoneSource = 'site' | 'utc' | 'browser' | 'zone' | 'browserFallback'

// Zone civil times are shown in, and why.
export interface DisplayZone {
	// IANA identifier; never empty.
	readonly zone: string
	// Why it was chosen.
	readonly source: DisplayZoneSource
}

// Returns the zone civil times are shown in: the override of the tool unless it is absent or default, then the
// profile's preferences, whose zone mode takes their zone (UTC until one is chosen). site is the location the tool uses,
// whose zone the site mode takes; without one the browser's zone stands in (browserFallback). browserZone is the
// browser's zone.
export function resolveDisplayZone(preferences: DateTimePreferences, override: DisplayZoneOverride | undefined, site: { readonly timeZone: string } | undefined, browserZone: string = BROWSER_TIME_ZONE): DisplayZone {
	if (override?.mode === 'zone') return { zone: override.zone, source: 'zone' }
	const mode = override === undefined || override.mode === 'default' ? preferences.displayTimeZone : override.mode
	if (mode === 'zone') return { zone: preferences.timeZone ?? 'UTC', source: 'zone' }
	if (mode === 'utc') return { zone: 'UTC', source: 'utc' }
	if (mode === 'browser') return { zone: browserZone, source: 'browser' }
	return site ? { zone: site.timeZone, source: 'site' } : { zone: browserZone, source: 'browserFallback' }
}

// Returns how a resolved zone is named to people: "America/Sao_Paulo (site)", "UTC", "Europe/Berlin (this device)",
// "Europe/Berlin (this device, no site)".
export function describeDisplayZone({ zone, source }: DisplayZone): string {
	switch (source) {
		case 'site':
			return `${zone} (site)`
		case 'browser':
			return `${zone} (this device)`
		case 'browserFallback':
			return `${zone} (this device, no site)`
		default:
			return zone
	}
}

// Returns the offset of a time zone from UTC at an instant (Unix milliseconds) as text, east positive: "UTC−03:00",
// "UTC+05:45", "UTC+00:00". It holds at that instant only, since a zone's offset changes with daylight saving time and
// its history.
export function formatUtcOffset(timeZone: string, time: number) {
	const parts = dateTimeFormat({ timeZone, timeZoneName: 'longOffset' }).formatToParts(time)
	const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
	const offset = name.replace('GMT', '').replace('-', '−')
	return `UTC${offset || '+00:00'}`
}

// Returns the short name of a time zone at an instant (Unix milliseconds), such as "GMT-3" or "CEST".
export function zoneShortName(timeZone: string, time: number) {
	return (
		dateTimeFormat({ timeZone, timeZoneName: 'short' })
			.formatToParts(time)
			.find((part) => part.type === 'timeZoneName')?.value ?? ''
	)
}

// Wall-clock reading of an instant in a time zone. Months are 1-12.
export interface WallTime {
	// Calendar year.
	readonly year: number
	// Month, 1-12.
	readonly month: number
	// Day of the month, 1-31.
	readonly day: number
	// Hour, 0-23.
	readonly hour: number
	// Minute, 0-59.
	readonly minute: number
	// Second, 0-59.
	readonly second: number
}

// Milliseconds in one day.
const DAY_MS = 86_400_000

// Returns the wall-clock reading of an instant (Unix milliseconds) in a time zone. Seconds are truncated.
export function zonedWallTime(time: number, timeZone: string): WallTime {
	const formatter = dateTimeFormat({ timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
	const parts: Record<string, number> = {}
	for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') parts[part.type] = +part.value
	return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second }
}

// Returns the offset of a time zone from UTC at an instant, in milliseconds (east positive).
function zoneOffset(time: number, timeZone: string) {
	const whole = Math.floor(time / 1000) * 1000
	const wall = zonedWallTime(whole, timeZone)
	return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - whole
}

// How far ahead nextOffsetChange looks by default, in milliseconds: a year and two days, so a change made once a year is
// always found.
const OFFSET_CHANGE_HORIZON_MS = 367 * DAY_MS

// Change of the offset of a time zone from UTC, such as the start or the end of daylight saving time.
export interface OffsetChange {
	// First instant of the new offset, Unix milliseconds, on a whole second.
	readonly time: number
	// Offset before the change, in milliseconds, east positive.
	readonly before: number
	// Offset from the change on, in milliseconds, east positive.
	readonly after: number
}

// Returns the first change of the offset of a time zone from UTC after an instant (Unix milliseconds) and within horizon
// (milliseconds, positive; a year and two days by default), or undefined when the offset holds all along, as in UTC or
// a zone without daylight saving time. The offset is read once a day and the change found to the second between two
// readings, so two changes within one day that cancel each other are not seen; no zone makes them.
export function nextOffsetChange(timeZone: string, time: number, horizon: number = OFFSET_CHANGE_HORIZON_MS): OffsetChange | undefined {
	const before = zoneOffset(time, timeZone)
	const end = time + horizon

	for (let start = time; start < end; start += DAY_MS) {
		const next = Math.min(start + DAY_MS, end)
		if (zoneOffset(next, timeZone) === before) continue
		// Whole seconds: the offset of low is the one before the change, the offset of high is not.
		let low = Math.floor(start / 1000)
		let high = Math.ceil(next / 1000)

		while (high - low > 1) {
			const middle = Math.floor((low + high) / 2)
			if (zoneOffset(middle * 1000, timeZone) === before) low = middle
			else high = middle
		}

		return { time: high * 1000, before, after: zoneOffset(high * 1000, timeZone) }
	}

	return undefined
}

// Half a year, in milliseconds: the second instant zoneSolarDifference reads a zone's offset at, so one of the two falls
// outside daylight saving time.
const HALF_YEAR_MS = 182 * DAY_MS

// Returns how far a time zone's clock runs ahead of the mean solar time at a longitude (degrees, east positive), in hours,
// negative when it runs behind: the zone's offset minus longitude / 15. Of the offsets at an instant (Unix milliseconds)
// and half a year later, the one nearer the solar time is used, so daylight saving time alone never widens it. Civil
// zones keep within about 3 h of it, so a larger difference points to a zone chosen for another place; it never chooses
// one.
export function zoneSolarDifference(timeZone: string, longitude: number, time: number): number {
	const solar = longitude / 15
	const [a, b] = [zoneOffset(time, timeZone), zoneOffset(time + HALF_YEAR_MS, timeZone)].map((offset) => offset / 3_600_000 - solar)
	return Math.abs(a) <= Math.abs(b) ? a : b
}

// Instant a wall-clock reading names in a time zone: one instant, two when the clocks went back and read it twice (the
// earlier and the later, in time order), or none when the clocks went forward over it.
export type WallTimeInstant = { readonly kind: 'exact'; readonly time: number } | { readonly kind: 'ambiguous'; readonly earlier: number; readonly later: number } | { readonly kind: 'nonexistent' }

// Returns the instant (Unix milliseconds) at which the clocks of a time zone read a wall time, the two instants of a
// reading they repeat, or none for a reading they skip. Never chooses between them or moves a skipped reading.
export function wallTimeToInstant(wall: WallTime, timeZone: string): WallTimeInstant {
	const local = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)
	const candidates = new Set([local - zoneOffset(local - DAY_MS, timeZone), local - zoneOffset(local + DAY_MS, timeZone)])
	const valid = [...candidates].filter((time) => time + zoneOffset(time, timeZone) === local).sort((a, b) => a - b)
	if (valid.length === 0) return { kind: 'nonexistent' }
	return valid.length === 1 ? { kind: 'exact', time: valid[0] } : { kind: 'ambiguous', earlier: valid[0], later: valid[1] }
}
