import { molecule } from 'bunshi'
import Elysia from 'elysia'
import { type Angle, deg, parseAngle } from 'nebulosa/src/angle'
import { altaz } from 'nebulosa/src/astrometry'
import { AU_KM, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import type { CartesianCoordinate } from 'nebulosa/src/coordinate'
import type { CsvRow } from 'nebulosa/src/csv'
import { type DateTime, dateFrom } from 'nebulosa/src/datetime'
import { type Distance, meter } from 'nebulosa/src/distance'
import { eraC2s } from 'nebulosa/src/erfa'
import { fk5, precessFk5FromJ2000 } from 'nebulosa/src/fk5'
import { observer, Quantity } from 'nebulosa/src/horizons'
import { Ellipsoid, type GeographicPosition, lst } from 'nebulosa/src/location'
import { bcrs, type Star, star } from 'nebulosa/src/star'
import { timeUnix } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
import type { BodyPosition, ChartOfBody, PositionOfBody, SkyObjectResult, SkyObjectSearch, SkyObjectSearchResult } from '../shared/types'

const HORIZONS_QUANTITIES: Quantity[] = [Quantity.ASTROMETRIC_RA_DEC, Quantity.APPARENT_RA_DEC, Quantity.APPARENT_AZ_EL, Quantity.VISUAL_MAG_SURFACE_BRGHT, Quantity.ONE_WAY_DOWN_LEG_LIGHT_TIME, Quantity.ILLUMINATED_FRACTION, Quantity.SUN_OBSERVER_TARGET_ELONG_ANGLE, Quantity.CONSTELLATION_ID]
const CACHED_STARS = new Map<number, Star>()

// Molecule for handling astronomical atlas requests
export const AtlasMolecule = molecule(() => {
	const ephemeris = new Map<string, Map<number, Readonly<BodyPosition>>>()

	function imageOfSun() {}

	// Computes the position of the Sun based on its ephemeris data
	function positionOfSun(req: PositionOfBody) {
		return computeFromNasaPositionAt('10', dateFrom(req.utcTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	// Generates a chart for the Sun based on its ephemeris data
	function chartOfSun(req: ChartOfBody) {
		return computeChart('10', dateFrom(req.utcTime, true), req.stepSize, req.type || 'altitude')
	}

	function earthSeasons() {}

	// Computes the position of the Moon based on its ephemeris data
	function positionOfMoon(req: PositionOfBody) {
		return computeFromNasaPositionAt('301', dateFrom(req.utcTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	// Generates a chart for the Moon based on its ephemeris data
	function chartOfMoon(req: ChartOfBody) {
		return computeChart('301', dateFrom(req.utcTime, true), req.stepSize, req.type || 'altitude')
	}

	function moonPhases() {}

	function twilight() {}

	// Computes the position of a planet based on its ephemeris data
	function positionOfPlanet(code: string, req: PositionOfBody) {
		return computeFromNasaPositionAt(code, dateFrom(req.utcTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	// Generates a chart for a planet based on its ephemeris data
	function chartOfPlanet(code: string, req: ChartOfBody) {
		return computeChart(code, dateFrom(req.utcTime, true), req.stepSize, req.type || 'altitude')
	}

	function searchMinorPlanet() {}

	function closeApproachesForMinorPlanets() {}

	// Searches for sky objects based on the provided request parameters
	function searchSkyObject(req: SkyObjectSearch) {
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
			const radius = deg(req.radius)

			where.push(`(acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${radius})`)
		}

		if (req.visible && req.visibleAbove >= 0) {
			const latitude = deg(req.latitude)
			const longitude = deg(req.longitude)
			const location: Partial<GeographicPosition> = { latitude, longitude }
			const time = timeUnix(req.utcTime / 1000)
			const lha = lst(time, location as never, true)

			where.push(`(asin(sin(d.declination) * sin(${latitude}) + cos(d.declination) * cos(${latitude}) * cos(${lha} - d.rightAscension)) > ${req.visibleAbove})`)
		}

		if (!where.length) where.push('1 = 1')

		const sortDirection = req.sort.direction === 'ascending' ? 'ASC' : 'DESC'

		const q = `SELECT DISTINCT d.id, d.magnitude, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ${req.nameType >= 0 ? `AND n.type = ${req.nameType}` : 'ORDER BY n.type'} LIMIT 1) as name FROM dsos d ${joinWhere.length > 1 ? `JOIN names n ON ${joinWhere.join(' AND ')}` : ''} WHERE ${where.join(' AND ')} ORDER BY d.${req.sort.column} ${sortDirection} LIMIT ${limit} OFFSET ${offset}`

		return nebulosa.query(q).all() as SkyObjectSearchResult[]
	}

	function positionOfSkyObject(req: PositionOfBody, id: string | number) {
		const dso = nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObjectResult
		const names = nebulosa.query(`SELECT (n.type || ':' || n.name) as name FROM names n WHERE n.dsoId = ${id}`).all() as { name: string }[]

		const latitude = deg(req.latitude)
		const longitude = deg(req.longitude)
		const elevation = meter(req.elevation)
		const location: GeographicPosition = { latitude, longitude, elevation, ellipsoid: Ellipsoid.IERS2010 }

		const time = timeUnix(req.utcTime / 1000)
		time.location = location

		let icrs: CartesianCoordinate

		if (dso.pmRa && dso.pmDec) {
			const px = dso.distance > 0 ? 1 / dso.distance : 0
			const s = CACHED_STARS.get(dso.id) ?? star(dso.rightAscension, dso.declination, dso.pmRa, dso.pmDec, px, dso.rv)
			CACHED_STARS.set(dso.id, s)
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
		} satisfies BodyPosition
	}

	function chartOfSkyObject(req: ChartOfBody, id: string) {}

	function searchSatellites() {}

	function positionOfSatellite(req: PositionOfBody, id: string) {}

	function chartOfSatellite(req: ChartOfBody) {}

	// Computes the position of a celestial body (planets, minor planets or satellites) from NASA's Horizons system
	async function computeFromNasaPositionAt(code: string, dateTime: DateTime, longitude: number, latitude: Angle, elevation: Distance) {
		const time = timeWithoutSeconds(dateTime)

		const position = ephemeris.get(code)?.get(time)

		if (position) return position

		let startTime = dateTime.set('hour', 12).set('minute', 0).set('second', 0).set('millisecond', 0)
		if (dateTime.hour() < 12) startTime = startTime.subtract(1, 'day')
		const endTime = startTime.add(1, 'day')

		const computedEphemeris = await observer(code, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES)
		const positions = makeBodyPositionFromEphemeris(computedEphemeris!)
		if (!ephemeris.has(code)) ephemeris.set(code, new Map())
		const map = ephemeris.get(code)!
		positions.forEach((e) => map.set(e[0], e[1]))
		return map.get(time)!
	}

	// Generates a chart for a celestial body (planets, minor planets or satellites) based on its ephemeris data
	function computeChart(code: string, dateTime: DateTime, stepSizeInMinutes: number, type: ChartOfBody['type']) {
		const positions = ephemeris.get(code)!

		let startTime = dateTime.set('hour', 12).set('minute', 0).set('second', 0).set('millisecond', 0)
		if (dateTime.hour() < 12) startTime = startTime.subtract(1, 'day')
		const time = timeWithoutSeconds(startTime)
		const chart: number[] = []

		chart.push(positions.get(time)![type])

		for (let i = stepSizeInMinutes; i <= 1440 - stepSizeInMinutes; i += stepSizeInMinutes) {
			chart.push(positions.get(time + i * 60)![type])
		}

		chart.push(positions.get(time + 1440 * 60)![type])

		return chart
	}

	// The endpoints for astronomical atlas requests
	const app = new Elysia({ prefix: '/atlas' })

	// '/sun/image'
	// '/earth/seasons'
	// '/moon/phases'
	// '/twilight'
	// '/minorplanets'
	// '/minorplanets/closeapproaches'
	// '/satellites'
	// '/satellites/:id/position'
	// '/satellites/:id/chart'

	app.post('/sun/position', ({ body }) => {
		return positionOfSun(body as never)
	})

	app.post('/sun/chart', ({ body }) => {
		return chartOfSun(body as never)
	})

	app.post('/moon/position', ({ body }) => {
		return positionOfMoon(body as never)
	})

	app.post('/moon/chart', ({ body }) => {
		return chartOfMoon(body as never)
	})

	app.post('/planets/:code/position', ({ params, body }) => {
		return positionOfPlanet(params.code, body as never)
	})

	app.post('/planets/:code/chart', ({ params, body }) => {
		return chartOfPlanet(params.code, body as never)
	})

	app.post('/skyobjects/search', ({ body }) => {
		return searchSkyObject(body as never)
	})

	app.post('/skyobjects/:id/position', ({ params, body }) => {
		return positionOfSkyObject(body as never, params.id)
	})

	app.post('/skyobjects/:id/chart', ({ params, body }) => {
		return chartOfSkyObject(body as never, params.id)
	})

	return {
		imageOfSun,
		positionOfSun,
		chartOfSun,
		earthSeasons,
		positionOfMoon,
		chartOfMoon,
		moonPhases,
		twilight,
		positionOfPlanet,
		chartOfPlanet,
		searchMinorPlanet,
		closeApproachesForMinorPlanets,
		searchSkyObject,
		positionOfSkyObject,
		chartOfSkyObject,
		searchSatellites,
		positionOfSatellite,
		chartOfSatellite,
		app,
	} as const
})

function makeBodyPositionFromEphemeris(ephemeris: CsvRow[]): readonly [number, BodyPosition][] {
	ephemeris.splice(0, 1)

	return ephemeris.map((e) => {
		const lightTime = parseFloat(e[11]) || 0
		let distance = lightTime * (SPEED_OF_LIGHT * 0.06) // km
		let distanceUnit = 'km'

		if (distance <= 0) {
			distance = 0
		} else if (distance >= AU_KM) {
			distance /= AU_KM
			distanceUnit = 'AU'
		}

		return [
			timeWithoutSeconds(dateFrom(`${e[0]}Z`)),
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
				distanceUnit,
				illuminated: parseFloat(e[12]),
				elongation: parseAngle(e[13]),
				leading: e[14] === '/L',
			} as BodyPosition,
		]
	})
}

function timeWithoutSeconds(dateTime: DateTime | number) {
	const seconds = typeof dateTime === 'number' ? Math.trunc(dateTime) : dateTime.unix()
	const remaining = Math.trunc(seconds % 60)
	return seconds - remaining
}
