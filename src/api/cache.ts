import type { PositionAndVelocity } from 'nebulosa/src/astrometry'
import { type GeographicPosition, geodeticLocation } from 'nebulosa/src/location'
import { type Time, timeUnix } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'
import type { GeographicCoordinate } from 'src/shared/types'

export type TimeGranularity = 's' | 'm' | 'h' | 'd'

export class CacheManager {
	private readonly earthCache = new Map<number, PositionAndVelocity>()
	private readonly timeCache = new Map<number, Time>()
	private readonly geographicCoordinates: GeographicPosition[] = []

	earth(time: Time): PositionAndVelocity {
		const jd = Math.trunc(time.day + time.fraction)
		// @ts-expect-error
		return this.earthCache.getOrInsertComputed(jd, () => earth(time))
	}

	time(utc: number | 'now', location?: GeographicPosition, granularity: TimeGranularity = 's') {
		utc = timeWithGranularity(utc === 'now' ? Date.now() : utc, granularity)
		// @ts-expect-error
		const time = this.timeCache.getOrInsertComputed(utc, () => timeUnix(utc, undefined, true)) as Time

		if (location && location !== time.location) {
			time.location = location
			time.tdbMinusTt = undefined
		}

		return time
	}

	geographicCoordinate(coordinate: GeographicCoordinate) {
		const { latitude, longitude, elevation } = coordinate

		let location = this.geographicCoordinates.find((e) => e.latitude === latitude && e.longitude === longitude && e.elevation === elevation)

		if (!location) {
			location = geodeticLocation(longitude, latitude, elevation)
			this.geographicCoordinates.push(location)
		}

		return location
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
