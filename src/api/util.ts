import type { PathLike } from 'fs'
import { readdir } from 'fs/promises'
import type { GeographicCoordinate, GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { Writable } from 'nebulosa/src/core/types'

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

// Reports whether a promise settles, either way, within the non-negative timeout in milliseconds.
export async function settlesWithin(promise: Promise<unknown>, timeout: number): Promise<boolean> {
	const elapsed = Promise.withResolvers<boolean>()
	const timer = setTimeout(() => elapsed.resolve(false), Math.max(0, timeout))

	void promise.then(
		() => elapsed.resolve(true),
		() => elapsed.resolve(true),
	)

	try {
		return await elapsed.promise
	} finally {
		clearTimeout(timer)
	}
}
