import Elysia from 'elysia'
import { type Angle, deg, parseAngle } from 'nebulosa/src/angle'
import { AU_KM, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import type { CsvRow } from 'nebulosa/src/csv'
import { type DateTime, dateFrom } from 'nebulosa/src/datetime'
import { type Distance, meter } from 'nebulosa/src/distance'
import { observer, Quantity } from 'nebulosa/src/horizons'
import type { AltitudeChartOfBody, BodyPosition, PositionOfBody } from './types'

export const HORIZONS_QUANTITIES: Quantity[] = [Quantity.ASTROMETRIC_RA_DEC, Quantity.APPARENT_RA_DEC, Quantity.APPARENT_AZ_EL, Quantity.VISUAL_MAG_SURFACE_BRGHT, Quantity.ONE_WAY_DOWN_LEG_LIGHT_TIME, Quantity.ILLUMINATED_FRACTION, Quantity.SUN_OBSERVER_TARGET_ELONG_ANGLE, Quantity.CONSTELLATION_ID]

// Manager for handling astronomical atlas requests
export class AtlasManager {
	private readonly positions = new Map<string, Map<number, Readonly<BodyPosition>>>()

	imageOfSun() {}

	positionOfSun(req: PositionOfBody) {
		return this.computeEphemeris('10', dateFrom(req.dateTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	altitudeChartOfSun(req: AltitudeChartOfBody) {
		return this.computeAltitudeChart('10', dateFrom(req.dateTime, true), req.stepSize)
	}

	earthSeasons() {}

	positionOfMoon(req: PositionOfBody) {
		return this.computeEphemeris('301', dateFrom(req.dateTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	altitudeChartOfMoon(req: AltitudeChartOfBody) {
		return this.computeAltitudeChart('301', dateFrom(req.dateTime, true), req.stepSize)
	}

	moonPhases() {}

	twilight() {}

	positionOfPlanet(code: string, req: PositionOfBody) {
		return this.computeEphemeris(code, dateFrom(req.dateTime, true), deg(req.longitude), deg(req.latitude), meter(req.elevation))
	}

	altitudeChartOfPlanet(code: string, req: AltitudeChartOfBody) {
		return this.computeAltitudeChart(code, dateFrom(req.dateTime, true), req.stepSize)
	}

	searchMinorPlanet() {}

	closeApproachesForMinorPlanets() {}

	searchSkyObject() {}

	skyObjectTypes() {}

	positionOfSkyObject(req: PositionOfBody, id: string) {}

	altitudeChartOfSkyObject(req: AltitudeChartOfBody) {}

	searchSatellites() {}

	positionOfSatellite(req: PositionOfBody, id: string) {}

	altitudeChartOfSatellite(req: AltitudeChartOfBody) {}

	private async computeEphemeris(code: string, dateTime: DateTime, longitude: number, latitude: Angle, elevation: Distance) {
		const time = timeWithoutSeconds(dateTime)

		const position = this.positions.get(code)?.get(time)
		if (position) return position

		let startTime = dateTime.set('hour', 12).set('minute', 0).set('second', 0).set('millisecond', 0)
		if (dateTime.hour() < 12) startTime = startTime.subtract(1, 'day')
		const endTime = startTime.add(1, 'day')

		const ephemeris = await observer(code, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES)
		const positions = makeBodyPositionFromEphemeris(ephemeris!)
		if (!this.positions.has(code)) this.positions.set(code, new Map())
		const map = this.positions.get(code)!
		positions.forEach((e) => map.set(e[0], e[1]))
		return map.get(time)!
	}

	private computeAltitudeChart(code: string, dateTime: DateTime, stepSizeInMinutes: number) {
		const positions = this.positions.get(code)!

		let startTime = dateTime.set('hour', 12).set('minute', 0).set('second', 0).set('millisecond', 0)
		if (dateTime.hour() < 12) startTime = startTime.subtract(1, 'day')
		const time = timeWithoutSeconds(startTime)
		const altitude: number[] = []

		altitude.push(positions.get(time)!.altitude)

		for (let i = stepSizeInMinutes; i <= 1440 - stepSizeInMinutes; i += stepSizeInMinutes) {
			altitude.push(positions.get(time + i * 60)!.altitude)
		}

		altitude.push(positions.get(time + 1440 * 60)!.altitude)

		return altitude
	}
}

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

// '/sun/image'
// '/earth/seasons'
// '/moon/phases'
// '/twilight'
// '/minor-planets'
// '/minor-planets/close-approaches'
// '/sky-objects'
// '/sky-objects/types'
// '/sky-objects/:id/position'
// '/sky-objects/:id/altitude-chart'
// '/satellites'
// '/satellites/:id/position'
// '/satellites/:id/altitude-chart'

// Creates an instance of Elysia for atlas endpoints
export function atlas(atlas: AtlasManager) {
	const app = new Elysia({ prefix: '/atlas' })

	app.post('/sun/position', ({ body }) => {
		return atlas.positionOfSun(body as never)
	})

	app.post('/sun/altitudeChart', ({ body }) => {
		return atlas.altitudeChartOfSun(body as never)
	})

	app.post('/moon/position', ({ body }) => {
		return atlas.positionOfMoon(body as never)
	})

	app.post('/moon/altitudeChart', ({ body }) => {
		return atlas.altitudeChartOfMoon(body as never)
	})

	app.post('/planets/:code/position', ({ params, body }) => {
		return atlas.positionOfPlanet(params.code, body as never)
	})

	app.post('/planets/:code/altitudeChart', ({ params, body }) => {
		return atlas.altitudeChartOfPlanet(params.code, body as never)
	})

	return app
}
