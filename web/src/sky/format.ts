import { AU_KM } from 'nebulosa/src/core/constants'
import { formatDEC, formatRA, toArcmin, toArcsec } from 'nebulosa/src/math/units/angle'
import { formatFixed, MISSING } from '../format'

// Display formats of the Sky workspace: equatorial and horizontal angles, apparent angular sizes, distances,
// magnitudes, and instants in the browser's time zone with the zone named, so a time is never ambiguous. Azimuths and
// position angles are plain degrees, written by `formatDegrees` of `format.ts`. Right ascension and declination are
// always sexagesimal with the toolkit's default decimals, which carry a rounded 60 into the next field. Every format
// follows the rules of `format.ts`: a value that is not finite reads MISSING, and a unit or a number of decimals is
// chosen after rounding, so a boundary value never reads "60″", "10.0000 AU", or "100.0 ly".

// AU per light-year (IAU: 1 ly = 63 241.077 AU).
const AU_PER_LIGHT_YEAR = 63_241.077

// Distance below which a solar-system distance is shown in kilometers, in AU (about 2.6 lunar distances).
const KILOMETER_DISTANCE_LIMIT = 0.007

// Formatters of local times, by locale, time zone, and whether they show the date.
const localTimeFormatters = new Map<string, Intl.DateTimeFormat>()

// Formatters of the calendar day of an instant, by time zone, which tell whether two instants share a day.
const dayFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns a number with thousands separators and no decimals: "1,344".
function formatWhole(value: number) {
	return Math.round(value).toLocaleString('en-US')
}

// Formats a right ascension in radians as hours, minutes, and seconds: "06 45 08.93".
export function formatRightAscension(angle: number) {
	return Number.isFinite(angle) ? formatRA(angle) : MISSING
}

// Formats a declination or altitude in radians as signed degrees, arcminutes, and arcseconds: "-16 42 58.02".
export function formatDeclination(angle: number) {
	return Number.isFinite(angle) ? formatDEC(angle) : MISSING
}

// Formats an apparent diameter or a field of view in radians as catalogs give them: arcminutes with two decimals, or
// whole arcseconds below one arcminute ("189.10′", "45″").
export function formatApparentSize(angle: number) {
	const arcsec = formatFixed(toArcsec(angle), 0)
	if (arcsec === MISSING) return MISSING
	return Number(arcsec) < 60 ? `${arcsec}″` : `${formatFixed(toArcmin(angle), 2)}′`
}

// Formats a solar-system distance in AU: whole kilometers near the Earth, AU otherwise, with four decimals below
// 10 AU and two beyond.
export function formatSolarSystemDistance(au: number) {
	if (!Number.isFinite(au)) return MISSING
	if (au < KILOMETER_DISTANCE_LIMIT) return `${formatWhole(au * AU_KM)} km`
	return `${formatFixed(au, Number(au.toFixed(4)) < 10 ? 4 : 2)} AU`
}

// Formats an interstellar distance in AU as light-years, with one decimal below 100 ly, or as millions of light-years
// from one million, with one decimal below 100 Mly.
export function formatStellarDistance(au: number) {
	if (!Number.isFinite(au)) return MISSING
	const ly = au / AU_PER_LIGHT_YEAR

	if (Math.round(ly) >= 1e6) {
		const mly = ly / 1e6
		return `${Number(mly.toFixed(1)) < 100 ? mly.toFixed(1) : formatWhole(mly)} Mly`
	}

	return `${Number(ly.toFixed(1)) < 100 ? ly.toFixed(1) : formatWhole(ly)} ly`
}

// Formats a visual magnitude with two decimals: "-1.46", "8.00".
export function formatMagnitude(magnitude: number) {
	return formatFixed(magnitude, 2)
}

// Formats an instant (Unix milliseconds) as a local time with its time zone: "14:23 GMT-3". A time on another day than
// `reference` also shows the date. An instant that is not finite reads MISSING.
export function formatLocalTime(time: number, reference: number = time, locale: string = 'en-US', timeZone?: string) {
	if (!Number.isFinite(time)) return MISSING
	const zone = timeZone ?? ''
	let day = dayFormatters.get(zone)

	if (!day) {
		day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
		dayFormatters.set(zone, day)
	}

	const dated = Number.isFinite(reference) && day.format(time) !== day.format(reference)
	const key = `${locale}|${zone}|${dated}`
	let formatter = localTimeFormatters.get(key)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short', ...(dated && { month: 'short', day: 'numeric' }) })
		localTimeFormatters.set(key, formatter)
	}

	return formatter.format(time)
}
