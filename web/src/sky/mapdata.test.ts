import { expect, test } from 'bun:test'
import type { SkyConstellations, SkyDeepSkyData, SkyStarData } from 'api'
import { mas } from 'nebulosa/src/math/units/angle'
import { ofDateMatrix, toDate } from './footprint'
import { MAP_DATA_EPOCH_MS, mapDataCovers, type SkyMapCatalog, skyMapAt } from './mapdata'

// Sirius at J2000 and its proper motion (mas per Julian year, of right ascension not multiplied by cos δ).
const SIRIUS = { ra: 1.7677953696021995, dec: -0.291751258517685, pmRA: -598.4, pmDEC: -1223.1 }

// 2026-01-01T00:00:00Z, about 26 years after J2000.
const TIME = Date.UTC(2026, 0, 1)

// Julian years from J2000 to TIME, as the map counts them.
const YEARS = (TIME / 86_400_000 + 2440587.5 - 2451545) / 365.25

const catalog: SkyMapCatalog = {
	stars: { ids: [32263, 1], names: ['Sirius', ''], designations: ['Alp CMa', ''], ra: [SIRIUS.ra, SIRIUS.ra], dec: [SIRIUS.dec, SIRIUS.dec], pmRA: [SIRIUS.pmRA, 0], pmDEC: [SIRIUS.pmDEC, 0], mag: [-1.44, 5], bv: [0, 0.65] } satisfies SkyStarData,
	dsos: { ids: [1000255], names: ['Andromeda Galaxy'], types: [1], ra: [SIRIUS.ra], dec: [SIRIUS.dec], mag: [3.4], size: [189.1], typeNames: ['Unknown', 'Galaxy'] } satisfies SkyDeepSkyData,
	constellations: { lines: [[[SIRIUS.ra, SIRIUS.dec]]], boundaries: [[[SIRIUS.ra, SIRIUS.dec]]], labels: [{ name: 'Canis Major', code: 'CMA', rightAscension: SIRIUS.ra, declination: SIRIUS.dec }] } satisfies SkyConstellations,
}

test('stars are moved by their proper motion and precessed to the equator of date', () => {
	const data = skyMapAt(catalog, TIME)
	const matrix = ofDateMatrix(TIME)
	const [ra, dec] = toDate(matrix, [SIRIUS.ra + mas(SIRIUS.pmRA * YEARS), SIRIUS.dec + mas(SIRIUS.pmDEC * YEARS)])
	expect(data.time).toBe(TIME)
	expect(data.stars.ra[0]).toBeCloseTo(ra, 12)
	expect(data.stars.dec[0]).toBeCloseTo(dec, 12)
	// Precession over 26 years moves Sirius about 0.3° east in right ascension.
	expect(data.stars.ra[1] - SIRIUS.ra).toBeWithin(0.0045, 0.006)
	// Its proper motion of about 1.3″ a year moves it about 32″ south in 26 years.
	expect((data.stars.dec[1] - data.stars.dec[0]) / mas(1000)).toBeCloseTo(-SIRIUS.pmDEC * YEARS * 1e-3, 1)
	expect(data.stars.names).toEqual(['Sirius', ''])
	expect(data.stars.mag).toEqual([-1.44, 5])
})

test('deep-sky objects and constellations are precessed without proper motion', () => {
	const data = skyMapAt(catalog, TIME)
	const star = data.stars.ra[1]
	expect(data.dsos.ra[0]).toBeCloseTo(star, 12)
	expect(data.dsos.names).toEqual(['Andromeda Galaxy'])
	expect(data.constellations.lines[0][0][0]).toBeCloseTo(star, 12)
	expect(data.constellations.boundaries[0][0][1]).toBeCloseTo(data.stars.dec[1], 12)
	expect(data.constellations.labels[0]).toMatchObject({ name: 'Canis Major', code: 'CMA' })
	expect(data.constellations.labels[0].rightAscension).toBeCloseTo(star, 12)
})

test('the catalog itself is left untouched', () => {
	skyMapAt(catalog, TIME)
	expect(catalog.stars.ra[0]).toBe(SIRIUS.ra)
	expect(catalog.constellations.labels[0].rightAscension).toBe(SIRIUS.ra)
})

test('map data covers instants up to a Julian year away', () => {
	expect(mapDataCovers(TIME, TIME + MAP_DATA_EPOCH_MS)).toBeTrue()
	expect(mapDataCovers(TIME, TIME - MAP_DATA_EPOCH_MS - 1)).toBeFalse()
})
