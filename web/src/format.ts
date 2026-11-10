import { formatAngle, toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'

// Display formats shared by every screen for quantities that are not tied to one feature: fixed and signed numbers,
// percentages, angles in degrees, arcminutes, and arcseconds, hour angles, geographic positions and elevations, temperatures, lengths in pixels
// with their sky size, positions in an image, distances in kilometers, exposure times, durations, elapsed and signed clocks, instants
// in UTC or in an IANA time zone, byte sizes, and measurements of a wide dynamic range. Every Intl.DateTimeFormat of the
// web is built and cached here (`dateTimeFormat`), and every civil time a screen shows is one of the formats below.
// Each takes the value in its computational unit (radians, seconds, °C, pixels, bytes) and returns text only, so a
// value is never rounded before it is used elsewhere. The decimals are a presentation choice, never a claim of
// accuracy; a value that rounds to zero never shows a minus sign, and a value that is not finite is shown as MISSING,
// never as NaN or Infinity. Sky coordinates (right ascension, declination, and sky distances) live in `sky/format.ts`
// and `platesolving/coordinates.ts`, which honour the profile's coordinate format.

// Text of a value that is not available.
export const MISSING = '—'

// Minus sign of signed differences (U+2212), as wide as the plus sign so signed values align.
const MINUS = '−'

// Returns a number with a fixed number of decimals, without the minus sign of a value that rounds to zero ("-0.0"), or
// MISSING when it is absent or not finite.
export function formatFixed(value: number | undefined, digits: number) {
	if (value === undefined || !Number.isFinite(value)) return MISSING
	const text = value.toFixed(digits)
	return text.startsWith('-') && Number(text) === 0 ? text.slice(1) : text
}

// Returns a difference with a fixed number of decimals and its sign: "+1.2", "−0.4", "0.0" when it rounds to zero, or
// MISSING when it is not finite.
export function formatSigned(value: number, digits: number) {
	const text = formatFixed(Math.abs(value), digits)
	if (text === MISSING || Number(text) === 0) return text
	return `${value < 0 ? MINUS : '+'}${text}`
}

// Appends a unit to the text of a value, unless the value is MISSING.
function withUnit(text: string, unit: string) {
	return text === MISSING ? MISSING : `${text}${unit}`
}

// Returns an angle in radians as degrees with `digits` decimals (2 by default): "265.36°".
export function formatDegrees(angle: number, digits: number = 2) {
	return withUnit(formatFixed(toDeg(angle), digits), '°')
}

// Returns an angle in radians as arcminutes with `digits` decimals (1 by default): "12.3′".
export function formatArcmin(angle: number, digits: number = 1) {
	return withUnit(formatFixed(toArcmin(angle), digits), '′')
}

// Returns a signed angular difference in radians as arcminutes with `digits` decimals (1 by default): "+12.3′", "−0.4′".
export function formatSignedArcmin(angle: number, digits: number = 1) {
	return withUnit(formatSigned(toArcmin(angle), digits), '′')
}

// Returns an angle in radians as arcseconds with `digits` decimals (1 by default), or MISSING when it is absent: "12.3″".
export function formatArcsec(angle: number | undefined | null, digits: number = 1) {
	return angle === undefined || angle === null ? MISSING : withUnit(formatFixed(toArcsec(angle), digits), '″')
}

// Returns an angular size or separation in radians in the unit that suits it: arcseconds below 1′ ("12.34″"),
// arcminutes below 1° ("12.34′"), degrees otherwise ("1.234°"). The unit is chosen after rounding, so 59.999″ reads
// "1.00′" rather than "60.00″".
export function formatAngularSize(angle: number) {
	const arcsec = formatFixed(toArcsec(angle), 2)
	if (arcsec === MISSING) return MISSING
	if (Math.abs(Number(arcsec)) < 60) return `${arcsec}″`
	const arcmin = formatFixed(toArcmin(angle), 2)
	if (Math.abs(Number(arcmin)) < 60) return `${arcmin}′`
	return `${formatFixed(toDeg(angle), 3)}°`
}

// Returns a signed angular offset in radians in the unit that suits its size, with its sign: "+12.34″", "−1.234°", or
// "0.00″" when it rounds to zero.
export function formatSignedAngle(angle: number) {
	const text = formatAngularSize(Math.abs(angle))
	// The size ends with its one-character unit sign (″, ′, or °).
	if (text === MISSING || Number(text.slice(0, -1)) === 0) return text
	return `${angle < 0 ? MINUS : '+'}${text}`
}

const DIGIT_REGEX = /[1-9]/

// Returns a signed hour angle in radians, LAST − RA wrapped to ±12 h and positive west of the meridian, as sidereal hours,
// minutes, and seconds with fractionDigits decimals (0 by default): "+01:02:03", "−00:30:00", "+00:00:00" when it rounds
// to zero, or MISSING when it is not finite.
export function formatHourAngle(angle: number, fractionDigits: number = 0) {
	if (!Number.isFinite(angle)) return MISSING
	const text = formatAngle(Math.abs(angle), { isHour: true, separators: ':', noSign: true, fractionDigits })
	return `${angle < 0 && DIGIT_REGEX.test(text) ? MINUS : '+'}${text}`
}

// Returns a fraction in [0, 1] as a percentage with `digits` decimals (0 by default), with no space before the sign:
// "57%", "99.9%".
export function formatPercent(fraction: number, digits: number = 0) {
	return withUnit(formatFixed(fraction * 100, digits), '%')
}

// Returns a latitude and a longitude in degrees with their hemispheres, east longitudes positive, with `digits` decimals
// (4 by default, about 11 m on the Earth): "23.5505° S, 46.6333° W". A value that rounds to zero takes N or E.
export function formatGeographic(latitude: number, longitude: number, digits: number = 4) {
	const lat = formatFixed(Math.abs(latitude), digits)
	const lon = formatFixed(Math.abs(longitude), digits)
	if (lat === MISSING || lon === MISSING) return MISSING
	return `${lat}° ${latitude < 0 && Number(lat) !== 0 ? 'S' : 'N'}, ${lon}° ${longitude < 0 && Number(lon) !== 0 ? 'W' : 'E'}`
}

// Returns an elevation above sea level in meters, whole: "760 m", "-28 m", or MISSING when it is not finite.
export function formatElevation(meters: number) {
	return withUnit(formatFixed(meters, 0), ' m')
}

// Returns a temperature in °C with one decimal, the resolution drivers report: "-10.2 °C".
export function formatTemperature(celsius: number) {
	return withUnit(formatFixed(celsius, 1), ' °C')
}

// Returns a length in pixels with two decimals, such as a star width or a guide error, followed by its sky size when the
// pixel scale (arcsec/px) is known: "2.31 px", "2.31 px (4.50″)", or MISSING when it is absent.
export function formatPixelLength(pixels: number | undefined, pixelScale?: number) {
	if (pixels === undefined || !Number.isFinite(pixels)) return MISSING
	return pixelScale === undefined ? `${pixels.toFixed(2)} px` : `${pixels.toFixed(2)} px (${formatFixed(pixels * pixelScale, 2)}″)`
}

// Returns a duration in seconds: seconds below a minute, two decimals below 10 s ("2.50 s", "42.0 s"), then minutes and
// seconds ("4 min 05 s"), then hours and minutes ("12 h 05 min"), or MISSING when it is not finite.
export function formatDuration(seconds: number) {
	if (!Number.isFinite(seconds)) return MISSING
	if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`
	const total = Math.round(seconds)
	if (total < 3600) return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, '0')} s`
	const minutes = Math.round(seconds / 60)
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

// Returns an exposure time set on a camera or recorded with a frame, in seconds, as entered: six significant digits at
// most, so the float noise of a conversion never shows ("0.0001 s", "300 s"), or MISSING when it is not finite.
export function formatExposureTime(seconds: number) {
	return Number.isFinite(seconds) ? `${Number(seconds.toPrecision(6))} s` : MISSING
}

// Returns an elapsed time in seconds as a running clock, minutes and seconds below an hour ("4:05") and hours above
// ("1:02:05"); whole seconds, a negative time shown as zero.
export function formatClockDuration(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const s = String(total % 60).padStart(2, '0')
	const m = Math.floor(total / 60) % 60
	const h = Math.floor(total / 3600)
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Returns a signed time in seconds, such as one before or after an instant, as a running clock with its sign: "+4:05",
// "−1:02:05", whole seconds truncated toward zero as formatClockDuration does, "0:00" without a sign when it truncates to
// zero, or MISSING when it is not finite.
export function formatSignedClockDuration(seconds: number) {
	if (!Number.isFinite(seconds)) return MISSING
	const text = formatClockDuration(Math.abs(seconds))
	return Math.abs(seconds) < 1 ? text : `${seconds < 0 ? MINUS : '+'}${text}`
}

// Returns a length in milliseconds as whole hours and minutes, such as "5h 20m" or "0h 45m", or MISSING when it is not
// finite.
export function formatHours(ms: number) {
	if (!Number.isFinite(ms)) return MISSING
	const minutes = Math.round(ms / 60_000)
	return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

// Returns a measurement of a wide dynamic range, such as a flux or a signal, with four significant digits, in exponential
// notation from 1e5 and below 1e-2 in magnitude: "1234", "0.1235", "1.235e+5".
export function formatSignificant(value: number) {
	if (!Number.isFinite(value)) return MISSING
	const size = Math.abs(value)
	return value !== 0 && (size >= 1e5 || size < 1e-2) ? value.toExponential(3) : value.toPrecision(4)
}

// Returns an image sample level or dispersion, in ADU or the unit of its source, with six significant digits and no
// trailing zeros, in exponential notation from 1e7 and below 1e-4 in magnitude: "1019.99", "65535", "0.012345",
// "1.235e-5". NaN and infinities have their own labels, so an invalid sample never reads as a value.
export function formatSampleValue(value: number) {
	if (Number.isNaN(value)) return 'NaN'
	if (value === Number.POSITIVE_INFINITY) return '+∞'
	if (value === Number.NEGATIVE_INFINITY) return `${MINUS}∞`
	const size = Math.abs(value)
	const text = value !== 0 && (size >= 1e7 || size < 1e-4) ? value.toExponential(3) : String(Number(value.toPrecision(6)))
	return text.startsWith('-') ? `${MINUS}${text.slice(1)}` : text
}

// Returns a count of samples or pixels with thousands separators: "1,048,576".
export function formatCount(count: number) {
	return Number.isFinite(count) ? count.toLocaleString('en-US') : MISSING
}

const BYTE_UNITS = ['KiB', 'MiB', 'GiB', 'TiB']

// Returns a size in bytes in binary units, one decimal below 10 of a unit: "512 B", "3.4 MiB", "120 GiB".
export function formatByteSize(bytes: number) {
	if (!Number.isFinite(bytes)) return MISSING
	if (bytes < 1024) return `${bytes} B`
	let value = bytes / 1024
	let unit = 0

	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024
		unit++
	}

	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${BYTE_UNITS[unit]}`
}

// Returns a position in an image, in pixels from its top-left corner, with `digits` decimals (1 by default; 2 for a
// fitted centroid): "1203.4, 88.0 px", or MISSING when either coordinate is not finite.
export function formatPixelPosition(x: number, y: number, digits: number = 1) {
	const px = formatFixed(x, digits)
	const py = formatFixed(y, digits)
	return px === MISSING || py === MISSING ? MISSING : `${px}, ${py} px`
}

// Returns a distance or a length in kilometers with thousands separators and `digits` decimals (none by default):
// "384,400 km", "12.5 km", or MISSING when it is not finite.
export function formatKilometers(km: number, digits: number = 0) {
	const text = formatFixed(km, digits)
	return text === MISSING ? MISSING : `${Number(text).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`
}

// Formatters of instants, by locale and options. A formatter is costly to build and a table formats thousands of
// instants, so each locale and set of options is built once and shared by every screen.
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns the shared formatter of instants with a set of options in a locale (en-US by default), built on its first use.
// An absent `timeZone` option is the browser's zone. Every reading of an instant in a zone, shown or parsed into its
// wall-clock fields, goes through it; options that differ only by an undefined property share one formatter.
export function dateTimeFormat(options: Intl.DateTimeFormatOptions, locale: string = 'en-US') {
	const key = `${locale}|${JSON.stringify(options)}`
	let formatter = dateTimeFormatters.get(key)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, options)
		dateTimeFormatters.set(key, formatter)
	}

	return formatter
}

// Locale whose short date and medium time styles are ISO 8601: "2026-11-05 14:23:05".
const ISO_LOCALE = 'sv-SE'

// Returns the calendar date of an instant (Unix milliseconds) in an IANA time zone as YYYY-MM-DD: "2026-11-05", or
// MISSING when it is not finite.
export function formatDate(time: number, timeZone: string) {
	if (!Number.isFinite(time)) return MISSING
	return dateTimeFormat({ timeZone, dateStyle: 'short' }, ISO_LOCALE).format(time)
}

// Returns an instant (Unix milliseconds) in an IANA time zone to the second, or to the minute when `seconds` is false,
// as YYYY-MM-DD HH:mm:ss on 24 hours: "2026-11-05 14:23:05", "2026-11-05 14:23", or MISSING when it is not finite.
export function formatDateTime(time: number, timeZone: string, seconds: boolean = true) {
	if (!Number.isFinite(time)) return MISSING
	return dateTimeFormat({ timeZone, dateStyle: 'short', timeStyle: seconds ? 'medium' : 'short' }, ISO_LOCALE).format(time)
}

// Returns an instant (Unix milliseconds) in UTC to the second, or to the minute when `seconds` is false, with the zone
// named: "2026-11-05 14:23:05 UTC", "2026-11-05 14:23 UTC", or MISSING when it is not finite.
export function formatUtcDateTime(time: number, seconds: boolean = true) {
	return withUnit(formatDateTime(time, 'UTC', seconds), ' UTC')
}

// How a time of day is written.
export interface ClockTimeOptions {
	// Whether the seconds are shown; false by default.
	readonly seconds?: boolean
	// Whether the short name of the zone follows, whose offset tells apart an hour the clocks repeat; false by default.
	readonly named?: boolean
}

// Returns the time of day of an instant (Unix milliseconds) in an IANA time zone on 24 hours: "20:05", "20:05:07",
// "20:05 GMT-3" when named, or MISSING when it is not finite.
export function formatClockTime(time: number, timeZone: string, { seconds = false, named = false }: ClockTimeOptions = {}) {
	if (!Number.isFinite(time)) return MISSING
	return dateTimeFormat({ timeZone, hour: '2-digit', minute: '2-digit', second: seconds ? '2-digit' : undefined, hourCycle: 'h23', timeZoneName: named ? 'short' : undefined }).format(time)
}

// Returns a span between two instants (Unix milliseconds) as their times of day in an IANA time zone on 24 hours, such as
// "21:10–03:45"; an instant that is not finite reads MISSING.
export function formatSpan(start: number, end: number, timeZone: string) {
	return `${formatClockTime(start, timeZone)}–${formatClockTime(end, timeZone)}`
}

// Returns an instant (Unix milliseconds) as its time of day in an IANA time zone with the zone named, so a time is never
// ambiguous: "14:23 GMT-3". A time on another calendar day of the zone than `reference` (Unix milliseconds) also shows
// its month and day: "Oct 19, 14:23 UTC". An instant that is not finite reads MISSING.
export function formatLocalTime(time: number, timeZone: string, reference: number = time) {
	if (!Number.isFinite(time)) return MISSING
	const dated = Number.isFinite(reference) && formatDate(time, timeZone) !== formatDate(reference, timeZone)
	return dateTimeFormat({ timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short', ...(dated && { month: 'short', day: 'numeric' }) }).format(time)
}

// Returns an instant (Unix milliseconds) as its date and time to the second in an IANA time zone with the zone named,
// so a time past midnight shows its day: "1997-09-16 18:47:11 UTC", or MISSING when it is not finite.
export function formatLongDateTime(time: number, timeZone: string) {
	if (!Number.isFinite(time)) return MISSING
	return dateTimeFormat({ timeZone, year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(time)
}
