import { describe, expect, test } from 'bun:test'
import { deg, formatALT, parseAngle } from 'nebulosa/src/angle'
import { lightYear, meter, toKilometer } from 'nebulosa/src/distance'
import { StellariumObjectType } from 'nebulosa/src/stellarium'
import { formatTemporal } from 'nebulosa/src/temporal'
import { AtlasManager } from 'src/api/atlas'
import cache from 'src/api/cache'
import { DEFAULT_SKY_OBJECT_SEARCH, type PositionOfBody, type SkyObjectSearch } from 'src/shared/types'

const atlas = new AtlasManager(cache)

const POSITION_OF_BODY: PositionOfBody = {
	time: {
		utc: 1753628400000, // Sun Jul 27 2025 12:00:00 GMT-0300
		offset: -180,
	},
	location: {
		latitude: deg(-22),
		longitude: deg(-45),
		elevation: meter(890),
	},
}

const SKY_OBJECT_SEARCH: SkyObjectSearch = {
	...DEFAULT_SKY_OBJECT_SEARCH,
	time: POSITION_OF_BODY.time,
	location: POSITION_OF_BODY.location,
}

test('seasons', () => {
	const { spring, summer, autumn, winter } = atlas.seasons(POSITION_OF_BODY)

	// https://aa.usno.navy.mil/calculated/seasons?year=2025&tz=0.00&tz_sign=-1&tz_label=false&dst=false&submit=Get+Data
	expect(formatTemporal(spring).substring(0, 16)).toBe('2025-03-20 09:02')
	expect(formatTemporal(summer).substring(0, 16)).toBe('2025-06-21 02:43')
	expect(formatTemporal(autumn).substring(0, 16)).toBe('2025-09-22 18:20')
	expect(formatTemporal(winter).substring(0, 16)).toBe('2025-12-21 15:04')
})

describe('search sky object', () => {
	test('no filter', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 10 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('constellation', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, constellations: [0] })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(676)
		expect(result[0].magnitude).toBe(2.07)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(0)
		expect(result[0].name).toBe('0:Alpheratz')
	})

	test('magnitude min', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, magnitudeMin: 0 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(90979)
		expect(result[0].magnitude).toBe(0.03)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(51)
		expect(result[0].name).toBe('0:Vega')
	})

	test('magnitude max', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, magnitudeMax: -1.44 })

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('types', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, types: [StellariumObjectType.DARK_NEBULA] })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(1010829)
		expect(result[0].magnitude).toBe(93)
		expect(result[0].type).toBe(StellariumObjectType.DARK_NEBULA)
		expect(result[0].constellation).toBe(7)
		expect(result[0].name).toBe('10:26')
	})

	test('name type only', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, nameType: 1 })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(1003144)
		expect(result[0].magnitude).toBe(1)
		expect(result[0].type).toBe(StellariumObjectType.HII_REGION)
		expect(result[0].constellation).toBe(15)
		expect(result[0].name).toBe('1:3372')
	})

	test('name and name type', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, nameType: 1, name: '=5139' })

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(1004779)
		expect(result[0].magnitude).toBe(5.33)
		expect(result[0].type).toBe(StellariumObjectType.GLOBULAR_STAR_CLUSTER)
		expect(result[0].constellation).toBe(17)
		expect(result[0].name).toBe('1:5139')
	})

	test('name contains', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, name: '%5139%' })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(1004779)
		expect(result[0].magnitude).toBe(5.33)
		expect(result[0].type).toBe(StellariumObjectType.GLOBULAR_STAR_CLUSTER)
		expect(result[0].constellation).toBe(17)
		expect(result[0].name).toBe('0:Ome Cen Cluster')
	})

	test('name', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, name: 'Sirius' })

		expect(result).toHaveLength(1)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('region', () => {
		const result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, rightAscension: '06 45 08.9173', declination: '-16 42 58', radius: 1 })

		expect(result).toHaveLength(4)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')
	})

	test('visible', () => {
		// Sat Jul 26 2025 16:50:00 GMT-0300, Sirius is above the horizon
		let result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, visible: true, time: { ...POSITION_OF_BODY.time, utc: 1753559400000 } })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(32263)
		expect(result[0].magnitude).toBe(-1.44)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(9)
		expect(result[0].name).toBe('0:Sirius')

		// Sat Jul 26 2025 17:00:00 GMT-0300, Sirius is below the horizon, Canopus is above the horizon
		result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, visible: true, time: { ...POSITION_OF_BODY.time, utc: 1753560000000 } })

		expect(result).toHaveLength(5)
		expect(result[0].id).toBe(30365)
		expect(result[0].magnitude).toBe(-0.62)
		expect(result[0].type).toBe(StellariumObjectType.STAR)
		expect(result[0].constellation).toBe(15)
		expect(result[0].name).toBe('0:Canopus')

		// Sat Jul 26 2025 19:00:00 GMT-0300, Canopus is below the horizon, Arcturus is above the horizon
		result = atlas.searchSkyObject({ ...SKY_OBJECT_SEARCH, limit: 5, visible: true, time: { ...POSITION_OF_BODY.time, utc: 1753567200000 } })

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
		const position = await atlas.positionOfSun(POSITION_OF_BODY)

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
		const position = await atlas.positionOfSun({ ...POSITION_OF_BODY, time: { ...POSITION_OF_BODY.time, utc: 1753624800000 } })

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

test('twilight', async () => {
	const twilight = await atlas.twilight(POSITION_OF_BODY)

	expect(formatTemporal(twilight.start[0])).toBe('2025-07-27 12:00:00.000')
	expect(formatTemporal(twilight.dusk.civil[0])).toBe('2025-07-27 17:37:00.000')
	expect(formatTemporal(twilight.dusk.nautical[0])).toBe('2025-07-27 18:04:00.000')
	expect(formatTemporal(twilight.dusk.astronomical[0])).toBe('2025-07-27 18:31:00.000')
	expect(formatTemporal(twilight.night[0])).toBe('2025-07-27 18:58:00.000')
	expect(formatTemporal(twilight.dawn.astronomical[0])).toBe('2025-07-28 05:14:00.000')
	expect(formatTemporal(twilight.dawn.nautical[0])).toBe('2025-07-28 05:40:00.000')
	expect(formatTemporal(twilight.dawn.civil[0])).toBe('2025-07-28 06:07:00.000')
	expect(formatTemporal(twilight.day[0])).toBe('2025-07-28 06:35:00.000')
	expect(formatTemporal(twilight.end[0])).toBe('2025-07-28 12:00:00.000')

	expect(twilight.start[1]).toBe(0)
	expect(twilight.dusk.civil[1]).toBe(337)
	expect(twilight.dusk.nautical[1]).toBe(364)
	expect(twilight.dusk.astronomical[1]).toBe(391)
	expect(twilight.night[1]).toBe(418)
	expect(twilight.dawn.astronomical[1]).toBe(1034)
	expect(twilight.dawn.nautical[1]).toBe(1060)
	expect(twilight.dawn.civil[1]).toBe(1087)
	expect(twilight.day[1]).toBe(1115)
	expect(twilight.end[1]).toBe(1441)
})

test('position of moon', async () => {
	const position = await atlas.positionOfMoon(POSITION_OF_BODY)

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

describe('moon phases', () => {
	const req = structuredClone(POSITION_OF_BODY)

	test('black moon', () => {
		req.time.utc = 1734706800000 // Fri Dec 20 2024 15:00:00 GMT+0000
		const phases = atlas.moonPhases(req)

		expect(phases).toHaveLength(5)
		expect(phases[0][0]).toBe(0)
		expect(formatTemporal(phases[0][1]).substring(0, 16)).toEqual('2024-12-01 06:21')
		expect(phases[1][0]).toBe(1)
		expect(formatTemporal(phases[1][1]).substring(0, 16)).toEqual('2024-12-08 15:26')
		expect(phases[2][0]).toBe(2)
		expect(formatTemporal(phases[2][1]).substring(0, 16)).toEqual('2024-12-15 09:01')
		expect(phases[3][0]).toBe(3)
		expect(formatTemporal(phases[3][1]).substring(0, 16)).toEqual('2024-12-22 22:18')
		expect(phases[4][0]).toBe(0)
		expect(formatTemporal(phases[4][1]).substring(0, 16)).toEqual('2024-12-30 22:26')
	})

	test('blue moon', () => {
		req.time.utc = 1779289200000 // Wed May 20 2026 15:00:00 GMT+0000
		const phases = atlas.moonPhases(req)

		expect(phases).toHaveLength(5)
		expect(phases[0][0]).toBe(2)
		expect(formatTemporal(phases[0][1]).substring(0, 16)).toEqual('2026-05-01 17:23')
		expect(phases[1][0]).toBe(3)
		expect(formatTemporal(phases[1][1]).substring(0, 16)).toEqual('2026-05-09 21:10')
		expect(phases[2][0]).toBe(0)
		expect(formatTemporal(phases[2][1]).substring(0, 16)).toEqual('2026-05-16 20:01')
		expect(phases[3][0]).toBe(1)
		expect(formatTemporal(phases[3][1]).substring(0, 16)).toEqual('2026-05-23 11:11')
		expect(phases[4][0]).toBe(2)
		expect(formatTemporal(phases[4][1]).substring(0, 16)).toEqual('2026-05-31 08:45')
	})
})

test('position of jupiter', async () => {
	const position = await atlas.positionOfPlanet('599', POSITION_OF_BODY)

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
	const position = atlas.positionOfSkyObject(POSITION_OF_BODY, '32263')

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

test('chart of sky object', () => {
	const chart = atlas.chartOfSkyObject(POSITION_OF_BODY, '32263')

	expect(chart).toHaveLength(1441)
	expect(formatALT(chart[0])).toBe('+66 48 39.29')
	expect(formatALT(chart[720])).toBe('-44 21 24.74')
	expect(formatALT(chart[1440])).toBe('+65 54 26.76')
})
