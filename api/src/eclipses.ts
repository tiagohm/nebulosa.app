import { type SunMoonProvider, sunMoonPositionAround } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import { PlateCarree } from 'nebulosa/src/astronomy/projections/projection'
import { type Time, toJulianDay, tt } from 'nebulosa/src/astronomy/time/time'
import { PIOVERTWO, RAD2DEG } from 'nebulosa/src/core/constants'
import { errorResponse } from './http'
import { LruCache } from './lrucache'

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

// Milliseconds around an instant in which a series eclipse is taken as a candidate. Refining moves a series instant by
// about a minute at most, so this is ample, and it is far below the month between two eclipses of a kind.
const REFINEMENT_MARGIN = 600_000

// Providers of the Sun and the Moon and refinements kept in memory: enough for a scan of eclipses to reuse them.
const ECLIPSE_CACHE_LIMIT = 128

// Provider of the Sun and the Moon of each eclipse, by the Julian Day it falls on: creating one costs tens of
// milliseconds, and an eclipse needs it for its elements, its map, and every place.
const providers = new LruCache<SunMoonProvider>(ECLIPSE_CACHE_LIMIT)

// Returns the provider of the Sun and the Moon of the eclipse at an instant: the one every eclipse computation of the
// API uses, so its contacts, maps, and local circumstances agree.
export function eclipseSunMoon(time: Time): SunMoonProvider {
	const key = `${Math.round(toJulianDay(tt(time)))}`
	let provider = providers.get(key)

	if (!provider) {
		provider = sunMoonPositionAround(time)
		providers.set(key, provider)
	}

	return provider
}

// Search of one kind of eclipse over a series of candidates that a refinement moves or rejects.
export interface RefinedEclipseSearch<E> {
	// Returns the series eclipse nearest an instant (Unix milliseconds) in a direction, strictly past it.
	readonly nearest: (time: number, next: boolean) => E
	// Returns the refined eclipse of a candidate; undefined when it turns out not to be an eclipse.
	readonly refine: (candidate: E) => E | undefined
	// Returns the Unix milliseconds of the greatest eclipse.
	readonly instant: (eclipse: E) => number
	// Refinements already computed, by the instant of the candidate; undefined entries are rejected candidates.
	readonly cache: LruCache<{ readonly eclipse?: E }>
}

// Returns the eclipse nearest an instant in a direction by its refined greatest eclipse, so stepping from an id never
// returns the same eclipse, even when the series places that eclipse on the other side of the id.
export function findRefinedEclipse<E>({ nearest, refine, instant, cache }: RefinedEclipseSearch<E>, time: number, direction: EclipseDirection): E {
	const next = direction === 'next'
	let from = next ? time - REFINEMENT_MARGIN : time + REFINEMENT_MARGIN

	while (true) {
		const candidate = nearest(from, next)
		const key = `${instant(candidate)}`
		let entry = cache.get(key)

		if (!entry) {
			entry = { eclipse: refine(candidate) }
			cache.set(key, entry)
		}

		const { eclipse } = entry
		if (eclipse && (next ? instant(eclipse) > time : instant(eclipse) < time)) return eclipse
		from = instant(candidate)
	}
}

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
