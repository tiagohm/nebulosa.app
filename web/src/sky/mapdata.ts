import type { SkyConstellations, SkyDeepSkyData, SkyStarData } from 'api'
import { eraC2s, eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { DAYSPERJY, J2000 } from 'nebulosa/src/core/constants'
import { type Mat3, matMulVec } from 'nebulosa/src/math/linear-algebra/mat3'
import type { MutVec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { mas, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { ofDateMatrix } from './footprint'

// Map data of the Sky workspace at an instant, computed in the browser from the J2000 map catalog the sky API serves once
// per tab: each star moved linearly by its proper motion from J2000 and every position turned by the IAU 2006/2000A
// precession-nutation matrix of the toolkit (ofDateMatrix) to the true equator and equinox of the instant, the frame the
// star map projects, so a new epoch needs no download. Pure functions; every call allocates the arrays it returns.

// J2000 map catalog of the sky API, independent of any instant.
export interface SkyMapCatalog {
	// Stars, with their proper motion.
	readonly stars: SkyStarData
	// Deep-sky objects.
	readonly dsos: SkyDeepSkyData
	// Constellation figures, boundaries, and labels.
	readonly constellations: SkyConstellations
}

// Map data at an instant: the catalog with its positions (radians) on the true equator and equinox of that instant.
export interface SkyMapData extends SkyMapCatalog {
	// Instant the positions are for, Unix milliseconds (UTC).
	readonly time: number
}

// Largest distance in milliseconds between the instant of the map data and the instant shown before the data is
// computed again: one Julian year, about 50″ of precession.
export const MAP_DATA_EPOCH_MS = DAYSPERJY * 86_400_000

// Julian Date of the Unix epoch.
const UNIX_EPOCH_JULIAN_DAY = 2440587.5

// Whether map data computed for an instant can show another instant (both Unix milliseconds).
export function mapDataCovers(dataTime: number, time: number) {
	return Math.abs(time - dataTime) <= MAP_DATA_EPOCH_MS
}

// Turns J2000 positions (radians) by a precession-nutation matrix of ofDateMatrix: [right ascension in [0, 2π),
// declination] of date. `years` and the proper motions (mas per Julian year, of right ascension not multiplied by cos δ)
// move each position linearly first; without them the positions are only turned.
function toDate(matrix: Mat3, ra: readonly number[], dec: readonly number[], years = 0, pmRA?: readonly number[], pmDEC?: readonly number[]) {
	const n = ra.length
	const outRa = new Array<number>(n)
	const outDec = new Array<number>(n)
	const vector: MutVec3 = [0, 0, 0]
	const factor = mas(years)

	for (let i = 0; i < n; i++) {
		const [x, y, z] = matMulVec(matrix, eraS2c(ra[i] + (pmRA ? pmRA[i] * factor : 0), dec[i] + (pmDEC ? pmDEC[i] * factor : 0), vector), vector)
		const [a, d] = eraC2s(x, y, z)
		outRa[i] = normalizeAngle(a)
		outDec[i] = d
	}

	return { ra: outRa, dec: outDec }
}

// Returns a polyline of J2000 [right ascension, declination] vertices (radians) of date.
function polylineToDate(matrix: Mat3, line: readonly (readonly [number, number])[]) {
	const { ra, dec } = toDate(
		matrix,
		line.map((e) => e[0]),
		line.map((e) => e[1]),
	)
	return ra.map((value, i) => [value, dec[i]] as [number, number])
}

// Returns the map data of an instant (Unix milliseconds, UTC) from the J2000 catalog. Proper motion runs for the Julian
// years since J2000 of the instant read as UTC, which is accurate to well under an arcsecond over the decades the map
// is used for.
export function skyMapAt(catalog: SkyMapCatalog, time: number): SkyMapData {
	const matrix = ofDateMatrix(time)
	const years = (time / 86_400_000 + UNIX_EPOCH_JULIAN_DAY - J2000) / DAYSPERJY
	const { stars, dsos, constellations } = catalog
	const starsOfDate = toDate(matrix, stars.ra, stars.dec, years, stars.pmRA, stars.pmDEC)
	const dsosOfDate = toDate(matrix, dsos.ra, dsos.dec)
	const labels = toDate(
		matrix,
		constellations.labels.map((e) => e.rightAscension),
		constellations.labels.map((e) => e.declination),
	)

	return {
		time,
		stars: { ...stars, ...starsOfDate },
		dsos: { ...dsos, ...dsosOfDate },
		constellations: {
			lines: constellations.lines.map((line) => polylineToDate(matrix, line)),
			boundaries: constellations.boundaries.map((line) => polylineToDate(matrix, line)),
			labels: constellations.labels.map(({ name, code }, i) => ({ name, code, rightAscension: labels.ra[i], declination: labels.dec[i] })),
		},
	}
}
