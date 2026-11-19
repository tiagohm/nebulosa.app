import type { PositionAndVelocity, PositionAndVelocityMut } from 'nebulosa/src/astronomy/coordinates/astrometry'
import type { SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { SatelliteEphemerisMiss } from 'nebulosa/src/astronomy/ephemeris/satellites'
import { computeSunMoonPositionAt, type SunMoonProvider, sunMoonPositionAround } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import { PlateCarree } from 'nebulosa/src/astronomy/projections/projection'
import { type Time, timeShift, toJulianDay, tt } from 'nebulosa/src/astronomy/time/time'
import { PIOVERTWO, RAD2DEG } from 'nebulosa/src/core/constants'
import { vecMinus } from 'nebulosa/src/math/linear-algebra/vec3'
import { errorResponse } from './http'
import { LruCache } from './lrucache'
import { missReason, type PlanetaryFallbackReason, type PlanetaryKernels, PlanetarySourceUnavailableError, type PlanetarySourceMiss, snapshotReason, unavailableResponse } from './planetary.source'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'

// Conventions shared by the lunar and solar eclipse routes (lunareclipses.ts, solareclipses.ts): stateless,
// read-only queries where an eclipse is named by its id, the Unix milliseconds of its greatest eclipse, and map
// paths are SVG path data on the degree plane. Geographic positions are degrees, longitude east positive. Every
// computation of one eclipse takes the Sun, the Earth, and the Moon from one source: the kernels of the SPICE Kernel
// Library when they cover the three bodies over the eclipse, else the analytical theories (eraEpv00 and eraMoon98
// corrected by ELPMPP02), unless the ephemeris policy is spkOnly, which fails instead.

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

// Half-width of the window the kernels must cover around an eclipse, in days: 13 hours, beyond the 8 hours of the
// analytical provider (more than an eclipse lasts on either side), the light time of the Sun, and the refinement.
const KERNEL_WINDOW_HALF_SPAN = 13 / 24

// Bodies of an eclipse computation.
export type EclipseBody = 'sun' | 'earth' | 'moon'

// NAIF code of each body of an eclipse computation.
const ECLIPSE_NAIF: Readonly<Record<EclipseBody, number>> = { sun: 10, earth: 399, moon: 301 }

// Bodies of an eclipse computation, in the order the kernels are probed.
const ECLIPSE_BODIES: readonly EclipseBody[] = ['sun', 'earth', 'moon']

// Source of the Sun, the Earth, and the Moon of an eclipse computation.
export type EclipseEphemerisSource = 'spk' | 'analytical'

// The ephemeris of one eclipse.
export interface EclipseEphemeris {
	// Source the computations start on.
	readonly source: EclipseEphemerisSource
	// Part of the keys of the results computed on it: analytical, or spk with the kernel generation.
	readonly key: string
	// Runs a computation on the Sun and the Moon of the eclipse, passing them and the key of the source they come from.
	// A kernel state missing in the middle reruns the whole computation on the analytical theories, or throws
	// EclipseEphemerisUnavailableError under spkOnly, so one computation never mixes sources.
	readonly run: <T>(compute: (sunMoon: SunMoonProvider, key: string) => T) => T
}

// Thrown under the spkOnly policy when the kernels cannot give the Sun, the Earth, and the Moon of an eclipse.
export class EclipseEphemerisUnavailableError extends PlanetarySourceUnavailableError<EclipseBody> {}

// A state the kernels could not resolve during an eclipse computation.
class EclipseKernelMiss extends SatelliteEphemerisMiss<EclipseBody> {}

// Key of the results computed on the analytical theories, which no kernel change alters.
const ANALYTICAL_KEY = 'analytical'

// Snapshot without kernels, under the automatic policy.
const NO_KERNELS_SNAPSHOT: SpiceKernelSnapshot = { generation: 0, policy: 'automatic', loading: false, readiness: new Map() }

// Kernels of the callers without the SPICE Kernel Library: none, so every eclipse is computed on the theories.
export const NO_ECLIPSE_KERNELS: PlanetaryKernels = { current: () => NO_KERNELS_SNAPSHOT }

// Analytical providers of the Sun and the Moon of each eclipse, by the Julian Day it falls on: creating one costs tens
// of milliseconds, and an eclipse needs it for its elements, its map, and every place.
const analyticalProviders = new LruCache<SunMoonProvider>(ECLIPSE_CACHE_LIMIT)

// Returns the analytical provider of the Sun and the Moon of the eclipse at an instant.
function analyticalSunMoon(time: Time): SunMoonProvider {
	const key = `${Math.round(toJulianDay(tt(time)))}`
	let provider = analyticalProviders.get(key)

	if (!provider) {
		provider = sunMoonPositionAround(time)
		analyticalProviders.set(key, provider)
	}

	return provider
}

// Returns the provider of the Sun and the Moon from the kernels: barycentric Sun and Earth and the Moon relative to
// the Earth, each throwing EclipseKernelMiss at an epoch the kernels do not resolve.
function kernelSunMoon(set: SpkKernelSet): SunMoonProvider {
	const state =
		(body: EclipseBody) =>
		(time: Time): PositionAndVelocity => {
			const result = set.stateAt(ECLIPSE_NAIF[body], time)
			if (!result.ok) throw new EclipseKernelMiss(body, result.body, result.reason, time)
			return result.state
		}

	const sun = state('sun')
	const earth = state('earth')
	const moonBarycentric = state('moon')

	const moon = (time: Time): PositionAndVelocityMut => {
		const [moonPosition, moonVelocity] = moonBarycentric(time)
		const [earthPosition, earthVelocity] = earth(time)
		return [vecMinus(moonPosition, earthPosition), vecMinus(moonVelocity, earthVelocity)]
	}

	return (time) => computeSunMoonPositionAt(time, sun, earth, moon)
}

// Why the kernels of snapshot cannot give the bodies over the window of an eclipse centered on center, or undefined
// when they resolve the three of them at both ends and at the center of the window.
function kernelFallback(snapshot: SpiceKernelSnapshot, center: Time): { readonly reason: PlanetaryFallbackReason; readonly miss?: PlanetarySourceMiss<EclipseBody> } | undefined {
	const fallback = snapshotReason(ECLIPSE_NAIF, ECLIPSE_BODIES, snapshot)
	if (fallback) return fallback

	for (const offset of [-KERNEL_WINDOW_HALF_SPAN, 0, KERNEL_WINDOW_HALF_SPAN]) {
		const time = timeShift(center, offset)

		for (const body of ECLIPSE_BODIES) {
			const result = snapshot.set!.stateAt(ECLIPSE_NAIF[body], time)
			if (!result.ok) return { reason: missReason(ECLIPSE_NAIF, new EclipseKernelMiss(body, result.body, result.reason, time)), miss: { target: body, body: result.body } }
		}
	}

	return undefined
}

// Builds the error of an eclipse the kernels cannot give under spkOnly.
function unavailable(reason: PlanetaryFallbackReason, miss?: PlanetarySourceMiss<EclipseBody>) {
	return new EclipseEphemerisUnavailableError(`The SPK kernels cannot give the Sun, the Earth, and the Moon of this eclipse (${reason})`, reason, miss)
}

// Returns the ephemeris of the eclipse centered on center (its greatest eclipse, or a candidate's) from snapshot, read
// once per computation: the kernels when they cover the Sun, the Earth, and the Moon over the eclipse, else the
// analytical theories. Throws EclipseEphemerisUnavailableError under spkOnly when the kernels cannot be used.
export function eclipseEphemeris(snapshot: SpiceKernelSnapshot, center: Time): EclipseEphemeris {
	const fallback = kernelFallback(snapshot, center)

	if (fallback) {
		if (snapshot.policy === 'spkOnly') throw unavailable(fallback.reason, fallback.miss)
		return { source: 'analytical', key: ANALYTICAL_KEY, run: (compute) => compute(analyticalSunMoon(center), ANALYTICAL_KEY) }
	}

	const key = `spk:${snapshot.generation}`
	const sunMoon = kernelSunMoon(snapshot.set!)

	return {
		source: 'spk',
		key,
		run: (compute) => {
			try {
				return compute(sunMoon, key)
			} catch (error) {
				if (!(error instanceof EclipseKernelMiss)) throw error
				if (snapshot.policy === 'spkOnly') throw unavailable(missReason(ECLIPSE_NAIF, error), { target: error.target, body: error.body })
				return compute(analyticalSunMoon(center), ANALYTICAL_KEY)
			}
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
	// Refinements already computed, by the key of the source and the instant of the candidate; undefined entries are
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
		const ephemeris = eclipseEphemeris(snapshot, center(candidate))
		const key = `${ephemeris.key}:${instant(candidate)}`
		let entry = cache.get(key)

		if (!entry) {
			entry = { eclipse: ephemeris.run((sunMoon) => refine(candidate, sunMoon)) }
			cache.set(key, entry)
		}

		const { eclipse } = entry
		if (eclipse && (next ? instant(eclipse) > time : instant(eclipse) < time)) return eclipse
		from = instant(candidate)
	}
}

// Returns the eclipse an id names on the sources of snapshot: the one whose greatest eclipse is within
// ID_MATCH_TOLERANCE of it, or undefined when there is none; search is the search of its kind.
export function resolveRefinedEclipse<E>(search: RefinedEclipseSearch<E>, id: string, snapshot: SpiceKernelSnapshot): E | undefined {
	const time = +id
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

// Answers a request of an eclipse route, turning an eclipse the kernels cannot give under spkOnly into the 503 of the
// planetary sources (coverageUnavailable, missingDependency, or unsupportedKernel, with the reason and the body). A
// synchronous answer stays synchronous.
export function answerEclipse(answer: () => Response): Response
export function answerEclipse(answer: () => Promise<Response>): Promise<Response>
export function answerEclipse(answer: () => Response | Promise<Response>): Response | Promise<Response> {
	try {
		const response = answer()
		return response instanceof Promise ? response.catch(eclipseUnavailableResponse) : response
	} catch (error) {
		return eclipseUnavailableResponse(error)
	}
}

// The 503 of an eclipse the kernels cannot give; rethrows any other error.
function eclipseUnavailableResponse(error: unknown): Response {
	if (error instanceof EclipseEphemerisUnavailableError) return unavailableResponse(error)
	throw error
}
