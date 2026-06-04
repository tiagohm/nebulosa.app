import type { PositionAndVelocity } from 'nebulosa/src/astrometry'
import { eraNut06a, eraPmat06, eraPnm06a, eraPom00, eraSp00 } from 'nebulosa/src/erfa'
import * as iers from 'nebulosa/src/iers'
import { type GeographicCoordinate, type GeographicPosition, geodeticLocation } from 'nebulosa/src/location'
import { DEFAULT_TIME_PROVIDERS, type Time, type TimeProviders, timeUnix } from 'nebulosa/src/time'
import { earth } from 'nebulosa/src/vsop87e'

export type TimeGranularity = 's' | 'm' | 'h' | 'd'

const ONE_DAY = 24 * 3600 * 1000

export class CacheManager {
	private readonly earthCache = new Map<number, PositionAndVelocity>()
	private readonly geographicCoordinates: GeographicPosition[] = []
	private readonly timeProvidersLastTime = new Map<keyof TimeProviders, number>()

	private readonly timeProviders: Required<TimeProviders> = {
		...DEFAULT_TIME_PROVIDERS,
	}

	earth(time: Time): PositionAndVelocity {
		const jd = Math.trunc(time.day + time.fraction)
		let pv = this.earthCache.get(jd)

		if (pv === undefined) {
			pv = earth(time)
			this.earthCache.set(jd, pv)
		}

		return pv
	}

	time(utc: number | 'now', location?: GeographicPosition) {
		utc = utc === 'now' ? Date.now() : utc
		const time = timeUnix(utc / 1000, undefined, true)
		time.location = location
		time.providers = this.timeProviders
		this.recomputeTimeProviders(time)
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

	private recomputeTimeProviders(time: Time) {
		const now = Date.now()

		if (now - (this.timeProvidersLastTime.get('pm') ?? 0) > ONE_DAY) {
			const pm = iers.xy(time)
			this.timeProviders.pm = () => pm
			this.timeProvidersLastTime.set('pm', now)
		}

		if (now - (this.timeProvidersLastTime.get('nut') ?? 0) > ONE_DAY) {
			const nut = eraNut06a(time.day, time.fraction)
			this.timeProviders.nut = () => nut
			this.timeProvidersLastTime.set('nut', now)
		}

		if (now - (this.timeProvidersLastTime.get('pmat') ?? 0) > ONE_DAY) {
			const pmat = eraPmat06(time.day, time.fraction)
			this.timeProviders.pmat = () => pmat
			this.timeProvidersLastTime.set('pmat', now)
		}

		if (now - (this.timeProvidersLastTime.get('pnm') ?? 0) > ONE_DAY) {
			const pnm = eraPnm06a(time.day, time.fraction)
			this.timeProviders.pnm = () => pnm
			this.timeProvidersLastTime.set('pnm', now)
		}

		if (now - (this.timeProvidersLastTime.get('sp') ?? 0) > ONE_DAY) {
			const sp = eraSp00(time.day, time.fraction)
			this.timeProviders.sp = () => sp
			this.timeProvidersLastTime.set('sp', now)
		}

		if (now - (this.timeProvidersLastTime.get('pom') ?? 0) > ONE_DAY) {
			const [x, y] = this.timeProviders.pm(time)
			const s = this.timeProviders.sp(time)
			const pom = eraPom00(x, y, s)
			this.timeProviders.pom = () => pom
			this.timeProvidersLastTime.set('pom', now)
		}
	}
}

export default new CacheManager()
