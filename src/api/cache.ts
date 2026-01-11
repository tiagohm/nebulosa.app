import type { PositionAndVelocity } from 'nebulosa/src/astrometry'
import { type GeographicCoordinate, type GeographicPosition, geodeticLocation } from 'nebulosa/src/location'
import { temporalSubtract } from 'nebulosa/src/temporal'
import { type Time, timeUnix } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'

export type TimeGranularity = 's' | 'm' | 'h' | 'd'

export class CacheManager {
	private readonly earthCache = new Map<number, PositionAndVelocity>()
	private readonly timeCache = new Map<number, Time>()
	private readonly geographicCoordinates: GeographicPosition[] = []

	earth(time: Time): PositionAndVelocity {
		const jd = Math.trunc(time.day + time.fraction)
		let pv = this.earthCache.get(jd)

		if (pv === undefined) {
			pv = earth(time)
			this.earthCache.set(jd, pv)
		}

		return pv
	}

	time(utc: number | 'now', location?: GeographicPosition, granularity: TimeGranularity = 's') {
		utc = timeWithGranularity(utc === 'now' ? Date.now() : utc, granularity)
		let time = this.timeCache.get(utc)

		if (time === undefined) {
			time = timeUnix(utc, undefined, true)
			this.timeCache.set(utc, time)
		}

		if (location && location !== time.location) {
			time.location = location
			time.tdbMinusTt = undefined
		}

		return time
	}

	geographicCoordinate(coordinate: GeographicCoordinate) {
		const { latitude, longitude, elevation } = coordinate

		let location = this.geographicCoordinates.find((e) => e.latitude === latitude && e.longitude === longitude && e.elevation === elevation)

		if (location === undefined) {
			location = geodeticLocation(longitude, latitude, elevation)
			this.geographicCoordinates.push(location)
		}

		return location
	}

	clear() {
		const now = timeWithGranularity(temporalSubtract(Date.now(), 1, 'h'), 's')

		this.timeCache
			.keys()
			.filter((time) => time < now)
			.forEach((e) => this.timeCache.delete(e))
	}
}

function timeWithGranularity(utc: number, granularity: TimeGranularity = 's') {
	const seconds = Math.trunc(utc / 1000)

	if (granularity === 's') return seconds
	else if (granularity === 'm') return seconds - (seconds % 60)
	else if (granularity === 'h') return seconds - (seconds % 3600)
	else if (granularity === 'd') return seconds - (seconds % 86400)
	else return seconds
}

export default new CacheManager()
