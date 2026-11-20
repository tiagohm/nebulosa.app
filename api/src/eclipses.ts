import { analyticalEphemerisSource, type EphemerisSource, interpolatedEphemerisSource, spkEphemerisSource } from 'nebulosa/src/astronomy/ephemeris/source'
import { type SunMoonProvider, sunMoonPositionOf } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import { PlateCarree } from 'nebulosa/src/astronomy/projections/projection'
import { type Time, timeShift, toJulianDay, tt } from 'nebulosa/src/astronomy/time/time'
import { PIOVERTWO, RAD2DEG } from 'nebulosa/src/core/constants'
import { computeEphemerisSync, type EphemerisProvenance, snapshotKernels } from './ephemeris.chain'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'

// Conventions shared by the lunar and solar eclipse routes (lunareclipses.ts, solareclipses.ts): stateless,
// read-only queries where an eclipse is named by its id, the Unix milliseconds of its greatest eclipse, and map
// paths are SVG path data on the degree plane. Geographic positions are degrees, longitude east positive. Every
// computation of one eclipse takes the Sun, the Earth, and the Moon from one source of the fast ephemeris chain
// (ephemeris.chain.ts): the kernels of the SPICE Kernel Library when they cover the three bodies over the eclipse, else
// the analytical theories (VSOP87E and ELPMPP02), which always can, interpolated (interpolatedEphemerisSource) since a
// contact or map search samples hundreds of instants.

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

// Milliseconds within which an id names the eclipse whose greatest eclipse it is near. The ephemeris sources place a
// greatest eclipse up to about a second apart, so an id taken from one source still names its eclipse after the kernels
// change; eclipses of a kind are a month apart.
export const ID_MATCH_TOLERANCE = 60_000

// Milliseconds around an instant in which a series eclipse is taken as a candidate. Refining moves a series instant by
// about a minute at most, so this is ample, and it is far below the month between two eclipses of a kind.
const REFINEMENT_MARGIN = 600_000

// Providers of the Sun and the Moon and refinements kept in memory: enough for a scan of eclipses to reuse them.
const ECLIPSE_CACHE_LIMIT = 128

// Half-width of the window the kernels must cover around an eclipse, in days: a day and a half, beyond the 8 hours an
// eclipse lasts on either side, the light time of the Sun, the refinement, and the three node steps the interpolation of
// the Earth reads on either side of an instant.
const KERNEL_WINDOW_HALF_SPAN = 1.5

// Bodies of an eclipse computation.
export type EclipseBody = 'sun' | 'earth' | 'moon'

// NAIF code of each body of an eclipse computation.
const ECLIPSE_NAIF: Readonly<Record<EclipseBody, number>> = { sun: 10, earth: 399, moon: 301 }

// Bodies of an eclipse computation, in the order the kernels are probed.
const ECLIPSE_BODIES: readonly EclipseBody[] = ['sun', 'earth', 'moon']

// A computation on the ephemeris of one eclipse: its result and the source it came from.
export interface EclipseComputation<T> {
	readonly result: T
	readonly provenance: EphemerisProvenance
}

// The ephemeris of one eclipse.
export interface EclipseEphemeris {
	// Runs a computation on the Sun and the Moon of the eclipse over the fast ephemeris chain, passing them and the key of
	// the source they come from: the kernels when they cover the eclipse, else (or after a kernel state missing in the
	// middle, rerunning the whole computation) the analytical theories, so one computation never mixes sources.
	readonly run: <T>(compute: (sunMoon: SunMoonProvider, key: string) => T) => EclipseComputation<T>
}

// Analytical providers of the Sun and the Moon of each eclipse, by the Julian Day it falls on: the interpolation nodes
// of the theories cost tens of milliseconds, and an eclipse needs them for its elements, its map, and every place.
const analyticalProviders = new LruCache<SunMoonProvider>(ECLIPSE_CACHE_LIMIT)

// Returns the analytical provider of the Sun and the Moon of the eclipse at an instant.
function analyticalSunMoon(time: Time): SunMoonProvider {
	const key = `${Math.round(toJulianDay(tt(time)))}`
	let provider = analyticalProviders.get(key)

	if (!provider) {
		provider = sunMoonPositionOf(interpolatedEphemerisSource(analyticalEphemerisSource))
		analyticalProviders.set(key, provider)
	}

	return provider
}

// Returns the provider of the Sun and the Moon of an SPK source, interpolated, after probing the three bodies at both ends
// and at the center of the window of the eclipse centered on center, so an eclipse the kernels do not cover falls to the
// theories before any computation; a state they miss throws EphemerisMiss.
function kernelSunMoon(source: EphemerisSource, center: Time): SunMoonProvider {
	for (const offset of [-KERNEL_WINDOW_HALF_SPAN, 0, KERNEL_WINDOW_HALF_SPAN]) {
		const time = timeShift(center, offset)
		for (const body of ECLIPSE_BODIES) source.state(ECLIPSE_NAIF[body], time)
	}

	return sunMoonPositionOf(interpolatedEphemerisSource(source))
}

// Returns the ephemeris of the eclipse centered on center (its greatest eclipse, or a candidate's) from snapshot, read
// once per computation, over the fast ephemeris chain (ephemeris.chain.ts): the analytical theories always exist, so
// an eclipse is never unavailable.
export function eclipseEphemeris(snapshot: SpiceKernelSnapshot, center: Time): EclipseEphemeris {
	return {
		run: (compute) => {
			const { result, provenance } = computeEphemerisSync({
				kernels: snapshotKernels(snapshot),
				mode: 'fast',
				sources: {
					bodies: ECLIPSE_BODIES.map((body) => ({ name: body, naif: ECLIPSE_NAIF[body] })),
					spk: (set) => kernelSunMoon(spkEphemerisSource(set), center),
					analytical: () => analyticalSunMoon(center),
				},
				compute: (sunMoon, _, context) => compute(sunMoon, context.key),
			})

			return { result, provenance }
		},
	}
}

// Search of one kind of eclipse over a series of candidates that a refinement moves or rejects.
export interface RefinedEclipseSearch<E> {
	// Returns the series eclipse nearest an instant (Unix milliseconds) in a direction, strictly past it.
	readonly nearest: (time: number, next: boolean) => E
	// Returns the refined eclipse of a candidate on the Sun and the Moon of a source; undefined when it turns out not to
	// be an eclipse.
	readonly refine: (candidate: E, sunMoon: SunMoonProvider) => E | undefined
	// Returns the instant of the greatest eclipse, as a toolkit time.
	readonly center: (eclipse: E) => Time
	// Returns the Unix milliseconds of the greatest eclipse.
	readonly instant: (eclipse: E) => number
	// Refinements already computed, by the kernel generation and the instant of the candidate; undefined entries are
	// rejected candidates.
	readonly cache: LruCache<{ readonly eclipse?: E }>
}

// Returns the eclipse nearest an instant in a direction by its refined greatest eclipse, refined on the source
// snapshot gives each candidate, so stepping from an id never returns the same eclipse, even when the series places
// that eclipse on the other side of the id. An id taken from another source can be up to a second before the eclipse
// it names, so stepping from it right after the kernels change may return that eclipse, with its new id, once.
export function findRefinedEclipse<E>({ nearest, refine, center, instant, cache }: RefinedEclipseSearch<E>, time: number, direction: EclipseDirection, snapshot: SpiceKernelSnapshot): E {
	const next = direction === 'next'
	let from = next ? time - REFINEMENT_MARGIN : time + REFINEMENT_MARGIN

	while (true) {
		const candidate = nearest(from, next)
		const instantKey = instant(candidate)
		let entry = cache.get(`${snapshot.generation}:${instantKey}`)

		if (!entry) {
			entry = { eclipse: eclipseEphemeris(snapshot, center(candidate)).run((sunMoon) => refine(candidate, sunMoon)).result }
			cache.set(`${snapshot.generation}:${instantKey}`, entry)
		}

		const { eclipse } = entry
		if (eclipse && (next ? instant(eclipse) > time : instant(eclipse) < time)) return eclipse
		from = instant(candidate)
	}
}

// Returns the eclipse an id names on the sources of snapshot: the one whose greatest eclipse is within
// ID_MATCH_TOLERANCE of it, or undefined when there is none, as for an id that is not a number of milliseconds,
// which would otherwise never end the search; search is the search of its kind.
export function resolveRefinedEclipse<E>(search: RefinedEclipseSearch<E>, id: string, snapshot: SpiceKernelSnapshot): E | undefined {
	const time = +id
	if (!Number.isFinite(time)) return undefined
	const eclipse = findRefinedEclipse(search, time - ID_SEARCH_MARGIN, 'next', snapshot)
	return Math.abs(search.instant(eclipse) - time) <= ID_MATCH_TOLERANCE ? eclipse : undefined
}

// Reads the place of the `longitude` and `latitude` query parameters, in degrees.
export function locationParams(params: URLSearchParams): EclipseLocation {
	return { longitude: Number(params.get('longitude')), latitude: Number(params.get('latitude')) }
}

// Answers an id that names no eclipse with a message, such as "Lunar eclipse not found".
export function eclipseNotFound(message: string) {
	return errorResponse(message, 404, 'notFound')
}
