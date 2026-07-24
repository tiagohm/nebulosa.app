import type { PathLike } from 'fs'
import { readdir } from 'fs/promises'
import { eraPnm06a, eraPmat06, eraNut06a, eraGst06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import type { GeographicCoordinate, GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { TimeProviders } from 'nebulosa/src/astronomy/time/time'
import { TIME_PROVIDERS, toJulianDay } from 'nebulosa/src/astronomy/time/time'
import type { Writable } from 'nebulosa/src/core/types'
import type { MutMat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Angle } from 'nebulosa/src/math/units/angle'

const ONE_SECOND = 1000

export function makeTime(utc: number | 'now', location?: GeographicCoordinate) {
	utc = utc === 'now' ? Date.now() : utc
	const time = timeUnix(utc / 1000, true)

	if (location !== undefined) {
		;(location as Writable<GeographicPosition>).ellipsoid = 3
		time.location = location as GeographicPosition
	}

	return time
}

export async function directoryExists(path: PathLike): Promise<boolean> {
	try {
		await readdir(path)
		return true
	} catch {
		return false
	}
}

export async function waitFor(ms: number, callback: (remainingTime: number) => boolean) {
	let remainingTime = Math.trunc(ms)

	if (remainingTime >= ONE_SECOND) {
		while (true) {
			if (remainingTime <= 0) {
				return callback(0)
			} else if (!callback(remainingTime)) {
				return false
			}

			// Sleep for until 1 second
			await Bun.sleep(Math.min(ONE_SECOND, remainingTime))

			// Subtract 1 second from remaining time
			remainingTime -= ONE_SECOND
		}
	}

	return true
}
