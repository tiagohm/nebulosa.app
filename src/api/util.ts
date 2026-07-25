import type { PathLike } from 'fs'
import { readdir } from 'fs/promises'
import type { GeographicCoordinate, GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { Writable } from 'nebulosa/src/core/types'

const ONE_SECOND = 1000

// Converts an unknown exception to diagnostic text; failed coercion returns a stable fallback instead of throwing.
export function errorMessage(error: unknown) {
	if (error instanceof Error) return error.message

	try {
		return String(error)
	} catch {
		return 'Unknown error'
	}
}

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
