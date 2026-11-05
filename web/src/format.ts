import { toArcmin, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'

// Display formats shared by every screen for quantities that are not tied to one feature: fixed and signed numbers,
// angles in degrees, arcminutes, and arcseconds, geographic positions, temperatures, lengths in pixels with their sky size, durations,
// elapsed clocks, and measurements of a wide dynamic range. Each takes the value in its computational unit (radians,
// seconds, °C, pixels) and returns text only, so a value is never rounded before it is used elsewhere. The decimals are
// a presentation choice, never a claim of accuracy; a value that rounds to zero never shows a minus sign, and a value
// that is not finite is shown as MISSING, never as NaN or Infinity. Sky coordinates (right ascension, declination, and
// sky distances) live in `sky/format.ts` and `platesolving/coordinates.ts`, which honour the profile's coordinate format.

// Text of a value that is not available.
export const MISSING = '—'

// Minus sign of signed differences (U+2212), as wide as the plus sign so signed values align.
const MINUS = '−'

// Returns a number with a fixed number of decimals, without the minus sign of a value that rounds to zero ("-0.0"), or
// MISSING when it is not finite.
export function formatFixed(value: number, digits: number) {
	if (!Number.isFinite(value)) return MISSING
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

// Returns a latitude and a longitude in degrees with their hemispheres, east longitudes positive, with `digits` decimals
// (4 by default, about 11 m on the Earth): "23.5505° S, 46.6333° W". A value that rounds to zero takes N or E.
export function formatGeographic(latitude: number, longitude: number, digits: number = 4) {
	const lat = formatFixed(Math.abs(latitude), digits)
	const lon = formatFixed(Math.abs(longitude), digits)
	if (lat === MISSING || lon === MISSING) return MISSING
	return `${lat}° ${latitude < 0 && Number(lat) !== 0 ? 'S' : 'N'}, ${lon}° ${longitude < 0 && Number(lon) !== 0 ? 'W' : 'E'}`
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

// Returns an elapsed time in seconds as a running clock, minutes and seconds below an hour ("4:05") and hours above
// ("1:02:05"); whole seconds, a negative time shown as zero.
export function formatClockDuration(seconds: number) {
	const total = Math.max(0, Math.floor(seconds))
	const s = String(total % 60).padStart(2, '0')
	const m = Math.floor(total / 60) % 60
	const h = Math.floor(total / 3600)
	return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Returns a measurement of a wide dynamic range, such as a flux or a signal, with four significant digits, in exponential
// notation from 1e5 and below 1e-2 in magnitude: "1234", "0.1235", "1.235e+5".
export function formatSignificant(value: number) {
	if (!Number.isFinite(value)) return MISSING
	const size = Math.abs(value)
	return value !== 0 && (size >= 1e5 || size < 1e-2) ? value.toExponential(3) : value.toPrecision(4)
}
