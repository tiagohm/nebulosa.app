import { AU_KM } from 'nebulosa/src/core/constants'
import { formatAngle, toArcmin, toDeg } from 'nebulosa/src/math/units/angle'

// Display formats of the Sky workspace: equatorial and horizontal angles, angular sizes, distances,
// magnitudes, and instants in the browser's time zone with the zone named, so a time is never ambiguous.

// AU per light-year (IAU: 1 ly = 63 241.077 AU).
const AU_PER_LIGHT_YEAR = 63_241.077

// Distance below which a solar-system distance is shown in kilometers, in AU (about 2.6 lunar distances).
const KILOMETER_DISTANCE_LIMIT = 0.007

// Formats a right ascension in radians as hours, minutes, and seconds: "06h 45m 08.93s".
export function formatRightAscension(angle: number) {
	return formatAngle(angle, { isHour: true, separators: ['h ', 'm ', 's'], fractionDigits: 2, noSign: true })
}

// Formats a declination or altitude in radians as signed degrees, arcminutes, and arcseconds: "-16° 42′ 58.02″".
export function formatDeclination(angle: number) {
	return formatAngle(angle, { separators: ['° ', '′ ', '″'], fractionDigits: 2, plusSign: '+' })
}

// Formats an azimuth or a position angle in radians as degrees with two decimals: "265.36°".
export function formatDegrees(angle: number) {
	return `${toDeg(angle).toFixed(2)}°`
}

// Formats an angular size in radians as arcminutes, or arcseconds below one arcminute: "189.10′", "45″".
export function formatAngularSize(angle: number) {
	const arcmin = toArcmin(angle)
	return arcmin >= 1 ? `${arcmin.toFixed(2)}′` : `${(arcmin * 60).toFixed(0)}″`
}

// Formats a solar-system distance in AU: kilometers near the Earth, AU otherwise.
export function formatSolarSystemDistance(au: number) {
	return au < KILOMETER_DISTANCE_LIMIT ? `${Math.round(au * AU_KM).toLocaleString('en-US')} km` : `${au.toFixed(au < 10 ? 4 : 2)} AU`
}

// Formats an interstellar distance in AU as light-years, or millions of light-years beyond that.
export function formatStellarDistance(au: number) {
	const ly = au / AU_PER_LIGHT_YEAR
	if (ly >= 1e6) return `${(ly / 1e6).toFixed(ly >= 1e8 ? 0 : 1)} Mly`
	return `${ly >= 100 ? Math.round(ly).toLocaleString('en-US') : ly.toFixed(1)} ly`
}

// Formats a visual magnitude with two decimals.
export function formatMagnitude(magnitude: number) {
	return magnitude.toFixed(2)
}

// Formats an instant (Unix milliseconds) as a local time with its time zone: "14:23 GMT-3". A time on
// another day than `reference` also shows the date.
export function formatLocalTime(time: number, reference: number = time, locale?: string, timeZone?: string) {
	const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
	const options: Intl.DateTimeFormatOptions = { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }
	if (sameDay.format(time) !== sameDay.format(reference)) Object.assign(options, { month: 'short', day: 'numeric' })
	return new Intl.DateTimeFormat(locale, options).format(time)
}
