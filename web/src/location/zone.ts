// Civil time zones of the application: which IANA names the browser knows.

// Whether a name is an IANA time zone the browser knows ('UTC' included).
export function isKnownTimeZone(timeZone: string) {
	try {
		return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone !== ''
	} catch {
		return false
	}
}
