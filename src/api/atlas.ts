import Elysia from 'elysia'
import { type Angle, deg, parseAngle } from 'nebulosa/src/angle'
import { altaz } from 'nebulosa/src/astrometry'
import { AU_KM, DEG2RAD, ONE_PARSEC, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import type { CartesianCoordinate } from 'nebulosa/src/coordinate'
import type { CsvRow } from 'nebulosa/src/csv'
import { type Distance, meter } from 'nebulosa/src/distance'
import { eraC2s, eraS2p } from 'nebulosa/src/erfa'
import { precessFk5FromJ2000 } from 'nebulosa/src/fk5'
import { observer, type Quantity } from 'nebulosa/src/horizons'
import { localSiderealTime } from 'nebulosa/src/location'
import { bcrs, type Star, star } from 'nebulosa/src/star'
import { season } from 'nebulosa/src/sun'
import { parseTemporal, type Temporal, temporalAdd, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract, temporalToDate } from 'nebulosa/src/temporal'
import { toUnix } from 'nebulosa/src/time'
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import { type BodyPosition, type ChartOfBody, expectedPierSide, type PositionOfBody, type SkyObject, type SkyObjectSearch, type SkyObjectSearchItem, type SolarSeasons, type Twilight, type UTCTime } from '../shared/types'
import type { CacheManager } from './cache'

const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

const NAUTICAL_ALTITUDE = -6 * DEG2RAD
const ASTRONOMICAL_ALTITUDE = -12 * DEG2RAD
const NIGHT_ALTITUDE = -18 * DEG2RAD

export class AtlasManager {
	private readonly ephemeris: Record<string, Map<number, BodyPosition>> = {}
	private readonly stars = new Map<number, Star>()

	constructor(readonly cache: CacheManager) {}

	imageOfSun() {}

	positionOfSun(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('10', req, deg(req.location.longitude), deg(req.location.latitude), meter(req.location.elevation))
	}

	chartOfSun(req: ChartOfBody) {
		return this.computeChart('10', req.time, 1, req.type || 'altitude')
	}

	seasons(req: PositionOfBody): SolarSeasons {
		const [year] = temporalToDate(req.time.utc)
		const spring = toUnix(season(year, 'SPRING')) // Autumn in southern hemisphere
		const summer = toUnix(season(year, 'SUMMER')) // Winter in southern hemisphere
		const autumn = toUnix(season(year, 'AUTUMN')) // Spring in southern hemisphere
		const winter = toUnix(season(year, 'WINTER')) // Summer in southern hemisphere
		return { spring, summer, autumn, winter }
	}

	positionOfMoon(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('301', req, deg(req.location.longitude), deg(req.location.latitude), meter(req.location.elevation))
	}

	chartOfMoon(req: ChartOfBody) {
		return this.computeChart('301', req.time, 1, req.type || 'altitude')
	}

	moonPhases() {}

	async twilight(req: PositionOfBody) {
		await this.positionOfSun(req)

		const [startTime, endTime] = this.computeStartAndEndTime(req.time, true)
		const offset = req.time.offset * 60000
		const sun = this.ephemeris['10']!

		const twilight: Twilight = {
			start: [startTime + offset, 0],
			dawn: {
				civil: [0, 0],
				nautical: [0, 0],
				astronomical: [0, 0],
			},
			dusk: {
				civil: [0, 0],
				nautical: [0, 0],
				astronomical: [0, 0],
			},
			day: [0, 0],
			night: [0, 0],
			end: [endTime + offset, 1441],
		}

		let step = 0

		for (let time = startTime, i = 0; time <= endTime; time += 60000, i++) {
			const position = sun.get(time / 1000)

			if (position) {
				const { altitude } = position

				if (step === 0) {
					if (altitude >= 0) twilight.dusk.civil = [time + offset, i]
					else step = 1
				} else if (step === 1) {
					if (altitude >= NAUTICAL_ALTITUDE) twilight.dusk.nautical = [time + offset, i]
					else step = 2
				} else if (step === 2) {
					if (altitude >= ASTRONOMICAL_ALTITUDE) twilight.dusk.astronomical = [time + offset, i]
					else step = 3
				} else if (step === 3) {
					if (altitude >= NIGHT_ALTITUDE) twilight.night = [time + offset, i]
					else step = 4
				} else if (step === 4) {
					if (altitude < NIGHT_ALTITUDE) twilight.dawn.astronomical = [time + offset, i]
					else step = 5
				} else if (step === 5) {
					if (altitude < ASTRONOMICAL_ALTITUDE) twilight.dawn.nautical = [time + offset, i]
					else step = 6
				} else if (step === 6) {
					if (altitude < NAUTICAL_ALTITUDE) twilight.dawn.civil = [time + offset, i]
					else step = 7
				} else if (step === 7) {
					if (altitude < 0) twilight.day = [time + offset, i]
					else break
				}
			}
		}

		return twilight
	}

	positionOfPlanet(code: string, req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt(code, req, deg(req.location.longitude), deg(req.location.latitude), meter(req.location.elevation))
	}

	chartOfPlanet(code: string, req: ChartOfBody) {
		return this.computeChart(code, req.time, 1, req.type || 'altitude')
	}

	searchMinorPlanet() {}

	closeApproachesForMinorPlanets() {}

	searchSkyObject(req: SkyObjectSearch) {
		const limit = 5
		const offset = Math.max(0, (req.page ?? 0) - 1) * limit
		const where = []
		const joinWhere = ['n.dsoId = d.id']

		if (req.types.length) where.push(`d.type IN (${req.types.join(',')})`)
		if (req.constellations.length) where.push(`d.constellation IN (${req.constellations.join(',')})`)
		if (req.nameType >= 0) joinWhere.push(`n.type = ${req.nameType}`)
		if (req.magnitudeMin > -30) where.push(`d.magnitude >= ${req.magnitudeMin}`)
		if (req.magnitudeMax < 30) where.push(`d.magnitude <= ${req.magnitudeMax}`)

		const name = req.name.trim()

		if (name)
			if (name.startsWith('=')) joinWhere.push(`n.name = '${name.substring(1).trim()}'`)
			else if (name.includes('%')) joinWhere.push(`n.name LIKE '${name}'`)
			else joinWhere.push(`n.name = '%${name}%'`)

		if (req.radius > 0 && req.rightAscension && req.declination) {
			const rightAscension = parseAngle(req.rightAscension, { isHour: true })!
			const declination = parseAngle(req.declination)!

			where.push(`(acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${deg(req.radius)})`)
		}

		if (req.visible && req.visibleAbove >= 0) {
			const location = this.cache.geographicCoordinate(req.location)
			const time = this.cache.time(req.time.utc, location)
			const lst = localSiderealTime(time, location, true)

			where.push(`(asin(sin(d.declination) * ${Math.sin(location.latitude)} + cos(d.declination) * ${Math.cos(location.latitude)} * cos(${lst} - d.rightAscension)) >= ${deg(req.visibleAbove)})`)
		}

		if (!where.length) where.push('1 = 1')

		const sortDirection = req.sort.direction === 'ascending' ? 'ASC' : 'DESC'

		const q = `SELECT DISTINCT d.id, d.magnitude, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ${req.nameType >= 0 ? `AND n.type = ${req.nameType}` : 'ORDER BY n.type'} LIMIT 1) as name FROM dsos d ${joinWhere.length > 1 ? `JOIN names n ON ${joinWhere.join(' AND ')}` : ''} WHERE ${where.join(' AND ')} ORDER BY d.${req.sort.column} ${sortDirection} LIMIT ${limit} OFFSET ${offset}`

		return nebulosa.query(q).all() as SkyObjectSearchItem[]
	}

	positionOfSkyObject(req: PositionOfBody, id: string | number | SkyObject): BodyPosition {
		const dso = typeof id === 'object' ? id : (nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObject)
		const names = nebulosa.query(`SELECT (n.type || ':' || n.name) as name FROM names n WHERE n.dsoId = ${id}`).all() as { name: string }[]

		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)

		let icrs: CartesianCoordinate

		if (dso.pmRa && dso.pmDec) {
			const px = dso.distance > 0 ? 1 / dso.distance : 0
			const s = this.stars.get(dso.id) ?? star(dso.rightAscension, dso.declination, dso.pmRa, dso.pmDec, px, dso.rv)
			this.stars.set(dso.id, s)
			icrs = bcrs(s, time)[0]
		} else {
			icrs = eraS2p(dso.rightAscension, dso.declination, ONE_PARSEC * 1000)
		}

		const ebpv = this.cache.earth(time)
		const [azimuth, altitude] = altaz(icrs, time, ebpv)!

		icrs = precessFk5FromJ2000(icrs, time)
		const [rightAscension, declination] = eraC2s(...icrs)

		return {
			magnitude: dso.magnitude,
			constellation: CONSTELLATION_LIST[dso.constellation],
			distance: dso.distance,
			illuminated: 0,
			elongation: 0,
			leading: false,
			rightAscension,
			declination,
			rightAscensionJ2000: dso.rightAscension,
			declinationJ2000: dso.declination,
			azimuth,
			altitude,
			names: names.map((n) => n.name),
			pierSide: expectedPierSide(rightAscension, declination, localSiderealTime(time, location, true)),
		}
	}

	chartOfSkyObject(req: ChartOfBody, id: string) {
		let [startTime] = this.computeStartAndEndTime(req.time, true)

		const dso = nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObject
		const location = this.cache.geographicCoordinate(req.location)
		const type = req.type || 'altitude'
		const data = new Array<number>(1441)

		// Generate chart data for each minute
		for (let i = 0; i < data.length; i++) {
			if (type === 'magnitude') {
				data[i] = dso.magnitude
				continue
			}

			const time = this.cache.time(startTime, location)

			let icrs: CartesianCoordinate

			if (dso.pmRa && dso.pmDec) {
				const px = dso.distance > 0 ? 1 / dso.distance : 0
				const s = this.stars.get(dso.id) ?? star(dso.rightAscension, dso.declination, dso.pmRa, dso.pmDec, px, dso.rv)
				this.stars.set(dso.id, s)
				icrs = bcrs(s, time)[0]
			} else {
				icrs = eraS2p(dso.rightAscension, dso.declination, ONE_PARSEC * 1000)
			}

			if (type === 'azimuth' || type === 'altitude') {
				const ebpv = this.cache.earth(time)
				const [azimuth, altitude] = altaz(icrs, time, ebpv)!
				data[i] = type === 'altitude' ? altitude : azimuth
			} else {
				icrs = precessFk5FromJ2000(icrs, time)
				const [rightAscension, declination] = eraC2s(...icrs)
				data[i] = type === 'declination' ? declination : rightAscension
			}

			startTime += 60000
		}

		return data
	}

	searchSatellites() {}

	positionOfSatellite(req: PositionOfBody, id: string) {}

	chartOfSatellite(req: ChartOfBody) {}

	async computeFromHorizonsPositionAt(code: string, req: PositionOfBody, longitude: Angle, latitude: Angle, elevation: Distance) {
		const key = Math.trunc(temporalSet(req.time.utc, 0, 's') / 1000)

		let position = this.ephemeris[code]?.get(key)

		if (!position) {
			const [startTime, endTime] = this.computeStartAndEndTime(req.time, true)
			const horizons = await observer(code, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1 })
			const positions = makeBodyPositionFromHorizons(horizons!)
			const map = this.ephemeris[code] ?? new Map()
			positions.forEach((e) => map.set(e[0], e[1]))
			this.ephemeris[code] = map
			position = map.get(key)!
		}

		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)
		position.pierSide = expectedPierSide(position.rightAscension, position.declination, localSiderealTime(time, location, true))

		return position
	}

	computeChart(code: string, time: UTCTime, stepSizeInMinutes: number, type: ChartOfBody['type'] = 'altitude') {
		const positions = this.ephemeris[code]!

		const [startTime] = this.computeStartAndEndTime(time, false)
		const minutes = temporalSet(startTime, 0, 's')
		const chart: number[] = []

		chart.push(positions.get(minutes)![type])

		for (let i = stepSizeInMinutes; i <= 1440 - stepSizeInMinutes; i += stepSizeInMinutes) {
			chart.push(positions.get(minutes + i * 60)![type])
		}

		chart.push(positions.get(minutes + 1440 * 60)![type])

		return chart
	}

	computeStartAndEndTime(time: UTCTime, local: boolean): readonly [Temporal, Temporal] {
		const { utc, offset } = time
		const hour = temporalGet(temporalAdd(utc, offset, 'm'), 'h')

		let startTime = temporalStartOfDay(utc)
		// if not passed noon, go to the previous day
		if (hour < 12) startTime = temporalSubtract(startTime, 1, 'd')
		// set to UTC noon + local offset (if enabled)
		startTime = temporalAdd(startTime, 720 - (local ? offset : 0), 'm')
		// set end time to noon of the next day
		const endTime = temporalAdd(startTime, 1, 'd')

		return [startTime, endTime]
	}
}

export function atlas(atlas: AtlasManager) {
	const app = new Elysia({ prefix: '/atlas' })
		// Endpoints!
		// '/sun/image'
		// '/moon/phases'
		// '/minorplanets'
		// '/minorplanets/closeapproaches'
		// '/satellites'
		// '/satellites/:id/position'
		// '/satellites/:id/chart'
		.post('/sun/position', ({ body }) => atlas.positionOfSun(body as never))
		.post('/sun/chart', ({ body }) => atlas.chartOfSun(body as never))
		.post('/sun/seasons', ({ body }) => atlas.seasons(body as never))
		.post('/sun/twilight', ({ body }) => atlas.twilight(body as never))
		.post('/moon/position', ({ body }) => atlas.positionOfMoon(body as never))
		.post('/moon/chart', ({ body }) => atlas.chartOfMoon(body as never))
		.post('/planets/:code/position', ({ params, body }) => atlas.positionOfPlanet(params.code, body as never))
		.post('/planets/:code/chart', ({ params, body }) => atlas.chartOfPlanet(params.code, body as never))
		.post('/skyobjects/search', ({ body }) => atlas.searchSkyObject(body as never))
		.post('/skyobjects/:id/position', ({ params, body }) => atlas.positionOfSkyObject(body as never, params.id))
		.post('/skyobjects/:id/chart', ({ params, body }) => atlas.chartOfSkyObject(body as never, params.id))

	return app
}

function makeBodyPositionFromHorizons(ephemeris: CsvRow[]): readonly [number, BodyPosition][] {
	const seconds = Math.trunc(parseTemporal(ephemeris[0][0], 'YYYY-MMM-DD HH:mm') / 1000)

	return ephemeris.map((e, i) => {
		const lightTime = parseFloat(e[11]) || 0
		const distance = lightTime * ((SPEED_OF_LIGHT * 0.06) / AU_KM) // AU

		return [
			seconds + i * 60,
			{
				rightAscensionJ2000: parseAngle(e[3]),
				declinationJ2000: parseAngle(e[4]),
				rightAscension: parseAngle(e[5]),
				declination: parseAngle(e[6]),
				azimuth: parseAngle(e[7]),
				altitude: parseAngle(e[8]),
				magnitude: parseFloat(e[9]),
				constellation: e[15].toUpperCase(),
				distance,
				illuminated: parseFloat(e[12]),
				elongation: parseAngle(e[13]),
				leading: e[14] === '/L',
				pierSide: 'NEITHER',
			} as BodyPosition,
		]
	})
}
