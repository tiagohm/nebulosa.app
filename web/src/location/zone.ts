// Civil time zones of the application: which IANA names the browser knows, the zone of the browser, and the offset of a
// zone from UTC at an instant. Offsets are never stored: a zone is always named by its IANA identifier.

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

// Formatters of the UTC offset of an instant, by time zone.
const offsetFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns the offset of a time zone from UTC at an instant (Unix milliseconds) as text, east positive: "UTC−03:00",
// "UTC+05:45", "UTC+00:00". It holds at that instant only, since a zone's offset changes with daylight saving time and
// its history.
export function formatUtcOffset(timeZone: string, time: number) {
	let formatter = offsetFormatters.get(timeZone)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
		offsetFormatters.set(timeZone, formatter)
	}

	const name = formatter.formatToParts(time).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
	const offset = name.replace('GMT', '').replace('-', '−')
	return `UTC${offset || '+00:00'}`
}
