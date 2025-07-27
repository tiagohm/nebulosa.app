import { describe, expect, test } from 'bun:test'
import { getDefaultInjector } from 'bunshi'
import { parseAngle } from 'nebulosa/src/angle'
import { lightYear } from 'nebulosa/src/distance'
import { StellariumObjectType } from 'nebulosa/src/stellarium'
import { AtlasMolecule } from 'src/api/atlas'
import { DEFAULT_SKY_OBJECT_SEARCH, type PositionOfBody } from 'src/shared/types'

const injector = getDefaultInjector()
const atlas = injector.get(AtlasMolecule)

describe('search sky object', () => {
	test('no filter', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 10 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('constellation', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, constellations: [0] })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(676)
		expect(result[0].magnitude).toBe(2.07)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(0)
		expect(result[0].name).toBe('0:Alpheratz')
	})

	test('magnitude min', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, magnitudeMin: 0 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(90979)
		expect(result[0].magnitude).toBe(0.03)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(51)
		expect(result[0].name).toBe('0:Vega')
	})

	test('magnitude max', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, magnitudeMax: -1.44 })

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('types', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, types: [StellariumObjectType.DARK_NEBULA] })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(1010829)
		expect(result[0].magnitude).toBe(93)
		expect(result[0].type).toBe(StellariumObjectType.DARK_NEBULA)
		expect(result[0].constellation).toBe(7)
		expect(result[0].name).toBe('10:26')
	})

	test('name type only', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, nameType: 1 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(1003144)
		expect(result[0].magnitude).toBe(1)
		expect(result[0].type).toBe(StellariumObjectType.HII_REGION)
		expect(result[0].constellation).toBe(15)
		expect(result[0].name).toBe('1:3372')
	})

	test('name and name type', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, nameType: 1, name: '=5139' })

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(1004779)
		expect(result[0].magnitude).toBe(5.33)
		expect(result[0].type).toBe(StellariumObjectType.GLOBULAR_STAR_CLUSTER)
		expect(result[0].constellation).toBe(17)
		expect(result[0].name).toBe('1:5139')
	})

	test('region', () => {
		const result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, rightAscension: '06 45 08.9173', declination: '-16 42 58', radius: 1 })

		expect(result).toHaveLength(3)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('visible', () => {
		// Sat Jul 26 2025 16:50:00 GMT-0300, Sirius is above the horizon
		let result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, visible: true, latitude: -22, longitude: -45, utcTime: 1753559400000 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')

		// Sat Jul 26 2025 17:00:00 GMT-0300, Sirius is below the horizon, Canopus is above the horizon
		result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, visible: true, latitude: -22, longitude: -45, utcTime: 1753560000000 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(30365)
		expect(result[0].magnitude).toBe(-0.62)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(15)
		expect(result[0].name).toBe('0:Canopus')

		// Sat Jul 26 2025 19:00:00 GMT-0300, Canopus is below the horizon, Arcturus is above the horizon
		result = atlas.searchSkyObject({ ...DEFAULT_SKY_OBJECT_SEARCH, limit: 5, visible: true, latitude: -22, longitude: -45, utcTime: 1753567200000 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(69451)
		expect(result[0].magnitude).toBe(-0.05)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(8)
		expect(result[0].name).toBe('0:Arcturus')
	})
})

const DEFAULT_POSITION_OF_BODY: PositionOfBody = {
	utcTime: 1753628400000, // Sun Jul 27 2025 12:00:00 GMT-0300
	utcOffset: 0,
	latitude: -22,
	longitude: -45,
	elevation: 890,
}

test('position of sky object', () => {
	const position = atlas.positionOfSkyObject(DEFAULT_POSITION_OF_BODY, '32263')

	expect(position.rightAscension).toBeCloseTo(parseAngle('06 46 16.56', { isHour: true })!, 6)
	expect(position.rightAscensionJ2000).toBeCloseTo(parseAngle('06 45 08.93', { isHour: true })!, 6)
	expect(position.declination).toBeCloseTo(parseAngle('-16 45 10.81')!, 6)
	expect(position.declinationJ2000).toBeCloseTo(parseAngle('-16 42 58.01')!, 6)
	expect(position.altitude).toBeCloseTo(parseAngle('66 48 39.29')!, 6)
	expect(position.azimuth).toBeCloseTo(parseAngle('278 50 39.10')!, 6)
	expect(position.distance).toBeCloseTo(lightYear(8.601071093), -1)
	expect(position.magnitude).toBe(-1.44)
	expect(position.constellation).toBe('CMA')
	expect(position.names).toEqual(['0:Sirius', '3:Alp', '4:9', '5:48915', '6:2491', '7:32349'])
	expect(position.illuminated).toBe(0)
	expect(position.elongation).toBe(0)
	expect(position.leading).toBe(false)
})
