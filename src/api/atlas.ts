import { molecule } from 'bunshi'
import Elysia from 'elysia'
import { type Angle, deg, parseAngle } from 'nebulosa/src/angle'
import { AU_KM, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import type { CsvRow } from 'nebulosa/src/csv'
import { type DateTime, dateFrom } from 'nebulosa/src/datetime'
import { type Distance, meter } from 'nebulosa/src/distance'
import { observer, Quantity } from 'nebulosa/src/horizons'
import type { BodyPosition, ChartOfBody, PositionOfBody } from './types'

export const HORIZONS_QUANTITIES: Quantity[] = [Quantity.ASTROMETRIC_RA_DEC, Quantity.APPARENT_RA_DEC, Quantity.APPARENT_AZ_EL, Quantity.VISUAL_MAG_SURFACE_BRGHT, Quantity.ONE_WAY_DOWN_LEG_LIGHT_TIME, Quantity.ILLUMINATED_FRACTION, Quantity.SUN_OBSERVER_TARGET_ELONG_ANGLE, Quantity.CONSTELLATION_ID]

// Molecule for handling astronomical atlas requests
export const AtlasMolecule = molecule(() => {
	const ephemeris = new Map<string, Map<number, Readonly<BodyPosition>>>()

	function imageOfSun() {}

	function positionOfSun(req: PositionOfBody) {
		return computePositionAt('10', dateFrom(req.dateTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	function chartOfSun(req: ChartOfBody) {
		return computeChart('10', dateFrom(req.dateTime, true), req.stepSize, req.type || 'altitude')
	}

	function earthSeasons() {}

	function positionOfMoon(req: PositionOfBody) {
		return computePositionAt('301', dateFrom(req.dateTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	function chartOfMoon(req: ChartOfBody) {
		return computeChart('301', dateFrom(req.dateTime, true), req.stepSize, req.type || 'altitude')
	}

	function moonPhases() {}

	function twilight() {}

	function positionOfPlanet(code: string, req: PositionOfBody) {
		return computePositionAt(code, dateFrom(req.dateTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	function chartOfPlanet(code: string, req: ChartOfBody) {
		return computeChart(code, dateFrom(req.dateTime, true), req.stepSize, req.type || 'altitude')
	}

	function searchMinorPlanet() {}

	function closeApproachesForMinorPlanets() {}

	function searchSkyObject() {}

	function skyObjectTypes() {}

	function positionOfSkyObject(req: PositionOfBody, id: string) {}

	function chartOfSkyObject(req: ChartOfBody) {}

	function searchSatellites() {}

	function positionOfSatellite(req: PositionOfBody, id: string) {}

	function chartOfSatellite(req: ChartOfBody) {}

	async function computePositionAt(code: string, dateTime: DateTime, longitude: number, latitude: Angle, elevation: Distance) {
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
	// '/skyobjects'
	// '/skyobjects/types'
	// '/skyobjects/:id/position'
	// '/skyobjects/:id/chart'
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
		skyObjectTypes,
		positionOfSkyObject,
		chartOfSkyObject,
		searchSatellites,
		positionOfSatellite,
		chartOfSatellite,
		app,
	}
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

function timeWithoutSeconds(dateTime: DateTime) {
	const seconds = dateTime.unix()
	const remaining = Math.trunc(seconds % 60)
	return seconds - remaining
}
