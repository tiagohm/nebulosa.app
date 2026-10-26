import { PlateCarree } from 'nebulosa/src/astronomy/projections/projection'
import { PIOVERTWO, RAD2DEG } from 'nebulosa/src/core/constants'
import { errorResponse } from './http'

// Conventions shared by the lunar and solar eclipse routes (lunareclipses.ts, solareclipses.ts): stateless,
// read-only queries where an eclipse is named by its id, the Unix milliseconds of its greatest eclipse, and map
// paths are SVG path data on the degree plane. Geographic positions are degrees, longitude east positive.

// Direction in which to look for an eclipse from an instant.
export type EclipseDirection = 'next' | 'previous'

// Geographic position, in degrees.
export interface EclipseLocation {
	// Longitude in degrees, east positive, [-180, 180].
	readonly longitude: number
	// Geodetic latitude in degrees, north positive, [-90, 90].
	readonly latitude: number
}

// Plate carrée of the degree plane the map paths are drawn on: one unit per degree, longitude -180° at x = 0 and
// latitude +90° at y = 0, so x = longitude + 180 in [0, 360] and y = 90 - latitude in [0, 180].
export const DEGREE_PLANE = new PlateCarree(0, { scale: RAD2DEG, falseEasting: 180, falseNorthing: 90, yAxisDirection: 'southUp', centralMeridian: 0, longitudeWrapMode: 'pi', maxLatitude: PIOVERTWO })

// Decimals of the map paths, in degrees: a thousandth is far finer than the map at its largest zoom.
export const MAP_PRECISION = 3

// Milliseconds before an id in which the eclipse it names is searched; eclipses of a kind are at least a lunar
// month apart.
export const ID_SEARCH_MARGIN = 86400000

// Lets the event loop run between two pieces of long work.
export function yieldEventLoop() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve)
	})
}

// Reads the place of the `longitude` and `latitude` query parameters, in degrees.
export function locationParams(params: URLSearchParams): EclipseLocation {
	return { longitude: Number(params.get('longitude')), latitude: Number(params.get('latitude')) }
}

// Answers an id that names no eclipse with a message, such as "Lunar eclipse not found".
export function eclipseNotFound(message: string) {
	return errorResponse(message, 404, 'notFound')
}
