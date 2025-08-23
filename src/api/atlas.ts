import Elysia from 'elysia'
import { type Angle, deg, parseAngle } from 'nebulosa/src/angle'
import { altaz } from 'nebulosa/src/astrometry'
import { AU_KM, DAYSEC, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import type { CartesianCoordinate } from 'nebulosa/src/coordinate'
import type { CsvRow } from 'nebulosa/src/csv'
import { type DateTime, dateFrom } from 'nebulosa/src/datetime'
import { type Distance, meter } from 'nebulosa/src/distance'
import { eraC2s } from 'nebulosa/src/erfa'
import { fk5, precessFk5FromJ2000 } from 'nebulosa/src/fk5'
import { observer, type Quantity } from 'nebulosa/src/horizons'
import { type GeographicPosition, geodeticLocation, localSiderealTime } from 'nebulosa/src/location'
import { bcrs, type Star, star } from 'nebulosa/src/star'
import { season } from 'nebulosa/src/sun'
import { type Time, timeUnix, toUnix } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import { type BodyPosition, type ChartOfBody, expectedPierSide, type PositionOfBody, type SkyObjectResult, type SkyObjectSearch, type SkyObjectSearchResult, type SolarSeasons } from '../shared/types'

const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

const GEOGRAPHIC_POSITIONS: GeographicPosition[] = []
const TIME_MAP = new Map<number, Time>()

function geographicPositionFor(position: Pick<PositionOfBody, 'latitude' | 'longitude' | 'elevation'>) {
	const latitude = deg(position.latitude)
	const longitude = deg(position.longitude)
	const elevation = meter(position.elevation)
	GEOGRAPHIC_POSITIONS.find((e) => e.latitude === latitude && e.longitude === longitude && e.elevation === elevation) ?? GEOGRAPHIC_POSITIONS.push(geodeticLocation(longitude, latitude, elevation))
	return GEOGRAPHIC_POSITIONS[GEOGRAPHIC_POSITIONS.length - 1]
}

function timeFor(utcTime: number, location?: GeographicPosition) {
	const seconds = Math.trunc(utcTime / 1000)
	const time = TIME_MAP.get(seconds) ?? timeUnix(seconds)
	TIME_MAP.set(seconds, time)

	if (location && time.location !== location) {
		time.location = location
		time.tdbMinusTt = undefined
	}

	return time
}

export class AtlasManager {
	private readonly ephemeris: Record<string, Map<number, BodyPosition>> = {}
	private readonly stars = new Map<number, Star>()

	imageOfSun() {}

	positionOfSun(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('10', req, deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	chartOfSun(req: ChartOfBody) {
		return this.computeChart('10', dateFrom(req.utcTime, true), 1, req.type || 'altitude')
	}

	seasons(req: PositionOfBody): SolarSeasons {
		const date = dateFrom(req.utcTime, true)
		const spring = toUnix(season(date.year(), 'SPRING')) // Autumn in southern hemisphere
		const summer = toUnix(season(date.year(), 'SUMMER')) // Winter in southern hemisphere
		const autumn = toUnix(season(date.year(), 'AUTUMN')) // Spring in southern hemisphere
		const winter = toUnix(season(date.year(), 'WINTER')) // Summer in southern hemisphere
		return { spring, summer, autumn, winter }
	}

	positionOfMoon(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('301', req, deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	chartOfMoon(req: ChartOfBody) {
		return this.computeChart('301', dateFrom(req.utcTime, true), 1, req.type || 'altitude')
	}

	moonPhases() {}

	twilight() {}

	positionOfPlanet(code: string, req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt(code, req, deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	chartOfPlanet(code: string, req: ChartOfBody) {
		return this.computeChart(code, dateFrom(req.utcTime, true), 1, req.type || 'altitude')
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
			const location = geographicPositionFor(req)
			const time = timeFor(req.utcTime, location)
			const lst = localSiderealTime(time, location, true)

			where.push(`(asin(sin(d.declination) * ${Math.sin(location.latitude)} + cos(d.declination) * ${Math.cos(location.latitude)} * cos(${lst} - d.rightAscension)) >= ${deg(req.visibleAbove)})`)
		}

		if (!where.length) where.push('1 = 1')

		const sortDirection = req.sort.direction === 'ascending' ? 'ASC' : 'DESC'

		const q = `SELECT DISTINCT d.id, d.magnitude, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ${req.nameType >= 0 ? `AND n.type = ${req.nameType}` : 'ORDER BY n.type'} LIMIT 1) as name FROM dsos d ${joinWhere.length > 1 ? `JOIN names n ON ${joinWhere.join(' AND ')}` : ''} WHERE ${where.join(' AND ')} ORDER BY d.${req.sort.column} ${sortDirection} LIMIT ${limit} OFFSET ${offset}`

		return nebulosa.query(q).all() as SkyObjectSearchResult[]
	}

	positionOfSkyObject(req: PositionOfBody, id: string | number | SkyObjectResult): BodyPosition {
		const dso = typeof id === 'object' ? id : (nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObjectResult)
		const names = nebulosa.query(`SELECT (n.type || ':' || n.name) as name FROM names n WHERE n.dsoId = ${id}`).all() as { name: string }[]

		const location = geographicPositionFor(req)
		const time = timeFor(req.utcTime, location)

		let icrs: CartesianCoordinate

		if (dso.pmRa && dso.pmDec) {
			const px = dso.distance > 0 ? 1 / dso.distance : 0
			const s = this.stars.get(dso.id) ?? star(dso.rightAscension, dso.declination, dso.pmRa, dso.pmDec, px, dso.rv)
			this.stars.set(dso.id, s)
			icrs = bcrs(s, time)[0]
		} else {
			icrs = fk5(dso.rightAscension, dso.declination)
		}

		const ebpv = earth(time)
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
		const data = new Array<number>(1441)
		const date = timeWithoutHourMinuteAndSecond(req.utcTime / 1000 + req.utcOffset * 60)
		const offset = date % DAYSEC >= 43200 ? 0 : DAYSEC // If the time is after noon, we want the next (julian) day
		const startTime = date + offset - req.utcOffset * 60 - 43200 // Start at noon UTC

		const dso = nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObjectResult
		const location = geographicPositionFor(req)
		const type = req.type || 'altitude'

		let utcTime = startTime * 1000

		// Generate chart data for each minute
		for (let i = 0; i < data.length; i++) {
			if (type === 'magnitude') {
				data[i] = dso.magnitude
				continue
			}

			const time = timeFor(utcTime, location)

			let icrs: CartesianCoordinate

			if (dso.pmRa && dso.pmDec) {
				const px = dso.distance > 0 ? 1 / dso.distance : 0
				const s = this.stars.get(dso.id) ?? star(dso.rightAscension, dso.declination, dso.pmRa, dso.pmDec, px, dso.rv)
				this.stars.set(dso.id, s)
				icrs = bcrs(s, time)[0]
			} else {
				icrs = fk5(dso.rightAscension, dso.declination)
			}

			if (type === 'azimuth' || type === 'altitude') {
				const ebpv = earth(time)
				const [azimuth, altitude] = altaz(icrs, time, ebpv)!
				data[i] = type === 'altitude' ? altitude : azimuth
			} else {
				icrs = precessFk5FromJ2000(icrs, time)
				const [rightAscension, declination] = eraC2s(...icrs)
				data[i] = type === 'declination' ? declination : rightAscension
			}

			utcTime += 60000
		}

		return data
	}

	searchSatellites() {}

	positionOfSatellite(req: PositionOfBody, id: string) {}

	chartOfSatellite(req: ChartOfBody) {}

	async computeFromHorizonsPositionAt(code: string, req: PositionOfBody, longitude: Angle, latitude: Angle, elevation: Distance) {
		const minutes = timeWithoutSeconds(req.utcTime / 1000)
		const location = geographicPositionFor(req)

		let position = this.ephemeris[code]?.get(minutes)

		if (!position) {
			const dateTime = dateFrom(req.utcTime, true)
			// Check if passed the (local) noon
			let startTime = dateTime.set('minute', 0).set('second', 0).set('millisecond', 0).add(req.utcOffset, 'm')
			// if not passed noon, go to the previous day
			if (startTime.hour() < 12) startTime = startTime.subtract(1, 'day')
			// set to UTC noon + local offset
			startTime = startTime.set('hour', 12).subtract(req.utcOffset, 'm')
			const endTime = startTime.add(1, 'day')

			const horizons = await observer(code, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1 })
			const positions = makeBodyPositionFromHorizons(horizons!)
			const map = this.ephemeris[code] ?? (this.ephemeris[code] = new Map())
			positions.forEach((e) => map.set(e[0], e[1]))
			position = map.get(minutes)!
		}

		const time = timeFor(req.utcTime, location)
		position.pierSide = expectedPierSide(position.rightAscension, position.declination, localSiderealTime(time, location, true))

		return position
	}

	computeChart(code: string, dateTime: DateTime, stepSizeInMinutes: number, type: ChartOfBody['type']) {
		const positions = this.ephemeris[code]!

		let startTime = dateTime.set('hour', 12).set('minute', 0).set('second', 0).set('millisecond', 0)
		if (dateTime.hour() < 12) startTime = startTime.subtract(1, 'day')
		const minutes = timeWithoutSeconds(startTime)
		const chart: number[] = []

		chart.push(positions.get(minutes)![type])

		for (let i = stepSizeInMinutes; i <= 1440 - stepSizeInMinutes; i += stepSizeInMinutes) {
			chart.push(positions.get(minutes + i * 60)![type])
		}

		chart.push(positions.get(minutes + 1440 * 60)![type])

		return chart
	}
}

export function atlas(atlas: AtlasManager) {
	const app = new Elysia({ prefix: '/atlas' })
		// Endpoints!
		// '/sun/image'
		// '/moon/phases'
		// '/twilight'
		// '/minorplanets'
		// '/minorplanets/closeapproaches'
		// '/satellites'
		// '/satellites/:id/position'
		// '/satellites/:id/chart'
		.post('/sun/position', ({ body }) => atlas.positionOfSun(body as never))
		.post('/sun/chart', ({ body }) => atlas.chartOfSun(body as never))
		.post('/sun/seasons', ({ body }) => atlas.seasons(body as never))
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
	const startTime = timeWithoutSeconds(dateFrom(`${ephemeris[0][0]}Z`, true))

	return ephemeris.map((e, i) => {
		const lightTime = parseFloat(e[11]) || 0
		const distance = lightTime * ((SPEED_OF_LIGHT * 0.06) / AU_KM) // AU

		return [
			startTime + i * 60,
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

function timeWithoutSeconds(dateTime: DateTime | number) {
	const seconds = typeof dateTime === 'number' ? Math.trunc(dateTime) : dateTime.unix()
	const remaining = seconds % 60
	return seconds - remaining
}

function timeWithoutHourMinuteAndSecond(dateTime: DateTime | number) {
	const seconds = typeof dateTime === 'number' ? Math.trunc(dateTime) : dateTime.unix()
	const remaining = seconds % DAYSEC
	return seconds - remaining
}
