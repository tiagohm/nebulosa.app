import { describe, expect, test } from 'bun:test'
import { deg, formatALT, formatAZ, parseAngle } from 'nebulosa/src/angle'
import { lightYear, toKilometer } from 'nebulosa/src/distance'
import { StellariumObjectType } from 'nebulosa/src/stellarium'
import { formatTemporal } from 'nebulosa/src/temporal'
import { AtlasManager } from 'src/api/atlas'
import cache from 'src/api/cache'
import { type ChartOfBody, DEFAULT_SKY_OBJECT_SEARCH, type PositionOfBody } from 'src/shared/types'

const atlas = new AtlasManager(cache)

const DEFAULT_POSITION_OF_BODY: PositionOfBody = {
	utcTime: 1753628400000, // Sun Jul 27 2025 12:00:00 GMT-0300
	utcOffset: -180,
	latitude: -22,
	longitude: -45,
	elevation: 890,
}

const DEFAULT_CHART_OF_BODY: ChartOfBody = {
	...DEFAULT_POSITION_OF_BODY,
	type: 'altitude',
}

test('seasons', () => {
	const { spring, summer, autumn, winter } = atlas.seasons(DEFAULT_POSITION_OF_BODY)

	// https://aa.usno.navy.mil/calculated/seasons?year=2025&tz=0.00&tz_sign=-1&tz_label=false&dst=false&submit=Get+Data
	expect(formatTemporal(spring * 1000).substring(0, 16)).toBe('2025-03-20 09:02')
	expect(formatTemporal(summer * 1000).substring(0, 16)).toBe('2025-06-21 02:43')
	expect(formatTemporal(autumn * 1000).substring(0, 16)).toBe('2025-09-22 18:20')
	expect(formatTemporal(winter * 1000).substring(0, 16)).toBe('2025-12-21 15:04')
})

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

		expect(result).toHaveLength(4)
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

describe('position of sun', () => {
	test('after noon', async () => {
		const position = await atlas.positionOfSun(DEFAULT_POSITION_OF_BODY)

		expect(position.rightAscension).toBeCloseTo(parseAngle('08 28 44.08', { isHour: true })!, 6)
		expect(position.rightAscensionJ2000).toBeCloseTo(parseAngle('08 27 17.12', { isHour: true })!, 6)
		expect(position.declination).toBeCloseTo(parseAngle('19 02 29.5')!, 6)
		expect(position.declinationJ2000).toBeCloseTo(parseAngle('19 08 20.0')!, 6)
		expect(position.azimuth).toBeCloseTo(deg(2.356722), 6)
		expect(position.altitude).toBeCloseTo(deg(48.927252), 6)
		expect(toKilometer(position.distance)).toBeCloseTo(151909927.865284, 3)
		expect(position.magnitude).toBe(-26.709)
		expect(position.constellation).toBe('CNC')
		expect(position.names).toBeUndefined()
	})

	test('before noon', async () => {
		const position = await atlas.positionOfSun({ ...DEFAULT_POSITION_OF_BODY, utcTime: 1753624800000 })

		expect(position.rightAscension).toBeCloseTo(parseAngle('08 28 32.97', { isHour: true })!, 6)
		expect(position.rightAscensionJ2000).toBeCloseTo(parseAngle('08 27 07.43', { isHour: true })!, 6)
		expect(position.declination).toBeCloseTo(parseAngle('19 03 02.2')!, 6)
		expect(position.declinationJ2000).toBeCloseTo(parseAngle('19 08 54.1')!, 6)
		expect(position.azimuth).toBeCloseTo(deg(22.854746), 6)
		expect(position.altitude).toBeCloseTo(deg(45.845269), 6)
		expect(toKilometer(position.distance)).toBeCloseTo(151910834.43767697, 3)
		expect(position.magnitude).toBe(-26.709)
		expect(position.constellation).toBe('CNC')
		expect(position.names).toBeUndefined()
	})
})

test('position of moon', async () => {
	const position = await atlas.positionOfMoon(DEFAULT_POSITION_OF_BODY)

	expect(position.rightAscension).toBeCloseTo(parseAngle('10 48 30.64', { isHour: true })!, 6)
	expect(position.rightAscensionJ2000).toBeCloseTo(parseAngle('10 47 14.33', { isHour: true })!, 6)
	expect(position.declination).toBeCloseTo(parseAngle('09 07 43.3')!, 6)
	expect(position.declinationJ2000).toBeCloseTo(parseAngle('09 16 26.8')!, 6)
	expect(position.azimuth).toBeCloseTo(deg(52.956912), 6)
	expect(position.altitude).toBeCloseTo(deg(42.506418), 6)
	expect(toKilometer(position.distance)).toBeCloseTo(384774.8659, 3)
	expect(position.magnitude).toBe(-7.176)
	expect(position.constellation).toBe('LEO')
	expect(position.names).toBeUndefined()
})

test('position of jupiter', async () => {
	const position = await atlas.positionOfPlanet('599', DEFAULT_POSITION_OF_BODY)

	expect(position.rightAscension).toBeCloseTo(parseAngle('06 46 51.69', { isHour: true })!, 6)
	expect(position.rightAscensionJ2000).toBeCloseTo(parseAngle('06 45 17.28', { isHour: true })!, 6)
	expect(position.declination).toBeCloseTo(parseAngle('22 53 45.8')!, 6)
	expect(position.declinationJ2000).toBeCloseTo(parseAngle('22 56 22.8')!, 6)
	expect(position.azimuth).toBeCloseTo(deg(331.17762), 6)
	expect(position.altitude).toBeCloseTo(deg(39.462217), 6)
	expect(toKilometer(position.distance)).toBeCloseTo(907332191.3145665, 3)
	expect(position.magnitude).toBe(-1.908)
	expect(position.constellation).toBe('GEM')
	expect(position.names).toBeUndefined()
})

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

describe('chart of sky object', () => {
	test('altitude', () => {
		const chart = atlas.chartOfSkyObject(DEFAULT_CHART_OF_BODY, '32263')

		expect(chart).toHaveLength(1441)
		expect(formatALT(chart[0])).toBe('+66 48 39.29')
		expect(formatALT(chart[720])).toBe('-44 21 24.86')
		expect(formatALT(chart[1440])).toBe('+65 54 26.77')
	}, 5000)

	test('azimuth', () => {
		const chart = atlas.chartOfSkyObject({ ...DEFAULT_CHART_OF_BODY, type: 'azimuth' }, '32263')

		expect(chart).toHaveLength(1441)
		expect(formatAZ(chart[0])).toBe('278 50 39.10')
		expect(formatAZ(chart[720])).toBe('146 14 54.21')
		expect(formatAZ(chart[1440])).toBe('278 09 59.29')
	}, 5000)
})
