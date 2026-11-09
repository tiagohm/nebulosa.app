import { planetMagnitude } from 'nebulosa/src/astronomy/bodies/photometry'
import { apparentDirection, type LightDeflector, SUN_LIGHT_DEFLECTOR_LIMITER, SUN_LIGHT_DEFLECTOR_MASS } from 'nebulosa/src/astronomy/coordinates/apparent'
import type { PositionAndVelocityOverTime, PositionOverTime } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { eraNut06a, eraPnm06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { ecliptic } from 'nebulosa/src/astronomy/coordinates/frame'
import type { SpkKernelSet, SpkMissReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { interpolatedSatelliteEphemeris, type SatelliteEphemeris, SatelliteEphemerisMiss, type SatelliteSystem, spkSatelliteEphemeris } from 'nebulosa/src/astronomy/ephemeris/satellites'
import { planetaryAppulses, planetaryBrightnessMaxima, planetaryClosestApproaches, planetaryGreatestElongations, planetaryIlluminationCrossings, planetaryLongitudeConjunctions, planetaryLongitudeOppositions, planetaryLongitudeQuadratures, planetaryStations } from 'nebulosa/src/astronomy/events/planetary'
import type { TimeSearchOptions } from 'nebulosa/src/astronomy/events/search'
import { type Time, type TimeProviders, tdbMinusTtByFairheadAndBretagnon1990, timeShift, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { Mat3, MutMat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import { type Vec3, vecAngle, vecLatitude, vecLength, vecLongitude, vecMinus, vecMulScalar, vecNegate, vecZero } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import { type PlanetaryFallbackReason, type PlanetaryKernels, type PlanetarySource, type PlanetarySourceMiss, PlanetarySourceUnavailableError, type SatelliteSourceConfig, type SourcedResult, toolkitTime, withSatelliteSource } from './planetary.source'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// Astronomy of the Planetary Events almanac: the geocentric phenomena of Mercury to Neptune over a range, defined as an
// almanac defines them and found with the toolkit's planetary finders. Conjunctions with the Sun, oppositions and
// quadratures are conditions on the difference of true ecliptic longitudes of date (planetaryLongitude*); greatest
// elongations are maxima of the separation from the Sun; stations are roots of the longitude rate; a conjunction of two
// planets is their equal longitude and an appulse their least separation, two separate events; the closest approach is
// the minimum of the geometric Earth–planet distance; Venus's greatest brilliancy is a minimum of the Mallama and Hilton
// magnitude; a half illumination is the dichotomy of Mercury or Venus. Directions are geocentric apparent (three
// light-time iterations, the Sun's deflection and the Earth's aberration), distances, phases and magnitudes geometric at
// the instant. Every computation takes all its states from one source (planetary.source.ts): the SPICE kernels when the
// set resolves the Sun, the Earth and every selected planet, each planet by its centre (199–899) when the set has it and
// by its system barycentre (1–8) otherwise, else VSOP87E. The barycentre offset is at most about 300 km (Saturn, Titan),
// under 0.1″ seen from the Earth, far below VSOP87E's own error. A site never changes an event. Times are Unix
// milliseconds (UTC), angles radians, distances AU.

// Version of the planetary events model; changes whenever the meaning of a computed field changes.
export const PLANETARY_EVENTS_MODEL_VERSION = 1

// NAIF code of a planet, Mercury to Neptune, as the Observing Planner names it.
export type PlanetaryEventBody = '199' | '299' | '499' | '599' | '699' | '799' | '899'

// Every planet of the almanac, in order from the Sun.
export const PLANETARY_EVENT_BODIES: readonly PlanetaryEventBody[] = ['199', '299', '499', '599', '699', '799', '899']

// The phenomena of the almanac.
export type PlanetaryEventKind = 'solarConjunction' | 'opposition' | 'quadrature' | 'greatestElongation' | 'station' | 'planetaryConjunction' | 'planetaryAppulse' | 'closestEarthApproach' | 'greatestBrightness' | 'halfIllumination'

// Every kind, in the order of a listing.
export const PLANETARY_EVENT_KINDS: readonly PlanetaryEventKind[] = ['solarConjunction', 'opposition', 'quadrature', 'greatestElongation', 'station', 'planetaryConjunction', 'planetaryAppulse', 'closestEarthApproach', 'greatestBrightness', 'halfIllumination']

// The planets each single-body kind applies to; the pair kinds apply to every pair of selected planets.
export const PLANETARY_EVENT_APPLICABILITY: Readonly<Record<Exclude<PlanetaryEventKind, 'planetaryConjunction' | 'planetaryAppulse'>, readonly PlanetaryEventBody[]>> = {
	solarConjunction: PLANETARY_EVENT_BODIES,
	opposition: ['499', '599', '699', '799', '899'],
	quadrature: ['499', '599', '699', '799', '899'],
	greatestElongation: ['199', '299'],
	station: PLANETARY_EVENT_BODIES,
	closestEarthApproach: PLANETARY_EVENT_BODIES,
	greatestBrightness: ['299'],
	halfIllumination: ['199', '299'],
}

// Bodies of a computation: the Sun, the Earth and the planets.
type Body = 'sun' | 'earth' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

// Toolkit body of each planet code.
const BODY_OF: Readonly<Record<PlanetaryEventBody, Exclude<Body, 'sun' | 'earth'>>> = { '199': 'mercury', '299': 'venus', '499': 'mars', '599': 'jupiter', '699': 'saturn', '799': 'uranus', '899': 'neptune' }

// NAIF code of the body's centre.
const CENTRE: Readonly<Record<Body, number>> = { sun: 10, earth: 399, mercury: 199, venus: 299, mars: 499, jupiter: 599, saturn: 699, uranus: 799, neptune: 899 }

// NAIF code a kernel set must have for each body: the Sun and the Earth themselves, a planet its system barycentre,
// which every planetary kernel such as de440s holds; the centre is preferred when present (resolvedNaif).
const REQUIRED: Readonly<Record<Body, number>> = { sun: 10, earth: 399, mercury: 1, venus: 2, mars: 4, jupiter: 5, saturn: 6, uranus: 7, neptune: 8 }

// Interpolation node spacing in days of each body (six-point Lagrange): one day keeps the error far below a kilometre for
// Mercury (a·n⁶ ≈ 7.5 km/day⁶) and the Earth's monthly wobble about the Earth–Moon barycentre; the outer planets move
// slowly enough for two days.
const NODE_STEP: Readonly<Record<Body, number>> = { sun: 1, earth: 1, mercury: 1, venus: 1, mars: 1, jupiter: 2, saturn: 2, uranus: 2, neptune: 2 }

// Thrown by the kernel source when a body state cannot be resolved, so the computation reruns from VSOP87E.
export class PlanetaryEventsEphemerisMiss extends SatelliteEphemerisMiss<Body> {
	constructor(target: Body, body: number, reason: SpkMissReason, time: Time) {
		super(target, body, reason, time)
		this.name = 'PlanetaryEventsEphemerisMiss'
	}
}

// The bodies of a computation as an Earth-centred system without moons, so the toolkit's coherent satellite-system
// machinery (one kernel set, misses, interpolation) serves the planets.
const SYSTEM: SatelliteSystem<Body, never> = {
	planet: 'earth',
	bodies: ['sun', 'earth', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'],
	moons: [],
	naif: REQUIRED,
	nodeStep: NODE_STEP,
	miss: (target, body, reason, time) => new PlanetaryEventsEphemerisMiss(target, body, reason, time),
}

// Positions of the bodies of a computation (barycentric AU, ICRF), from one source.
export type PlanetaryEventsEphemeris = SatelliteEphemeris<Body, never, { readonly kind: 'spk' | 'analytical' }>

// VSOP87E barycentric positions of the bodies.
const ANALYTICAL: PlanetaryEventsEphemeris = {
	source: { kind: 'analytical' },
	position: (body, time) => vsop[body](time)[0],
}

// The NAIF code that supplies each body from a kernel set: a planet's centre when the set has it, else its barycentre.
function resolvedNaif(set: SpkKernelSet): Record<Body, number> {
	const naif = { ...REQUIRED }
	for (const body of SYSTEM.bodies) if (set.bodies.has(CENTRE[body])) naif[body] = CENTRE[body]
	return naif
}

// The analytical theory of a computation.
interface AnalyticalPlanetaryEventsSource {
	readonly kind: 'analytical'
	readonly planetary: 'VSOP87E'
}

// Source of the states of a computation; a kernel source also names the NAIF code that supplied each planet.
export type PlanetaryEventsSource = PlanetarySource<Body, AnalyticalPlanetaryEventsSource>

// The kernel state that could not be resolved.
export type PlanetaryEventsSourceMiss = PlanetarySourceMiss<Body>

// Live kernel snapshots of the SPICE Kernel Library.
export type PlanetaryEventsKernels = PlanetaryKernels

// Thrown when the policy is spkOnly and the kernels cannot give a whole computation, or when the kernel set kept changing.
export class PlanetaryEventsSourceUnavailableError extends PlanetarySourceUnavailableError<Body> {
	constructor(reason: PlanetaryFallbackReason | 'generationChanged', miss?: PlanetaryEventsSourceMiss) {
		super(reason === 'generationChanged' ? 'The SPICE kernels changed during the computation' : `The SPICE kernels cannot give the planetary states (${reason})`, reason, miss)
	}
}

// How the bodies are evaluated from the kernels or VSOP87E.
const SOURCE: SatelliteSourceConfig<Body, PlanetaryEventsEphemeris, AnalyticalPlanetaryEventsSource> = {
	naif: REQUIRED,
	analytical: ANALYTICAL,
	analyticalSource: { kind: 'analytical', planetary: 'VSOP87E' },
	spk: (set) => spkSatelliteEphemeris({ ...SYSTEM, naif: resolvedNaif(set) }, set),
	miss: PlanetaryEventsEphemerisMiss,
	unavailable: (reason, miss) => new PlanetaryEventsSourceUnavailableError(reason, miss),
}

// The conventions every event follows, for comparison with a printed almanac.
export interface PlanetaryEventsConvention {
	// Directions are geocentric apparent: light time, the Sun's deflection and the Earth's aberration.
	readonly position: 'geocentricApparent'
	// Longitudes and latitudes are on the true ecliptic and equinox of date.
	readonly longitudeFrame: 'trueEclipticOfDate'
	// Distances are geometric, centre to centre, at the instant.
	readonly distance: 'geometricCenterToCenter'
}

// The conventions of every answer.
export const PLANETARY_EVENTS_CONVENTION: PlanetaryEventsConvention = { position: 'geocentricApparent', longitudeFrame: 'trueEclipticOfDate', distance: 'geometricCenterToCenter' }

// Whether a planet of a kernel source came from its centre or its system barycentre.
export type PlanetaryEventsBodyOrigin = 'centre' | 'barycentre'

// Identity of a computed answer: the model, the conventions, its source and the kernel identity.
export interface PlanetaryEventsSignature {
	readonly modelVersion: number
	readonly convention: PlanetaryEventsConvention
	readonly source: PlanetaryEventsSource
	// For a kernel source, whether each planet came from its centre or its barycentre; absent for VSOP87E.
	readonly origins?: Readonly<Partial<Record<PlanetaryEventBody, PlanetaryEventsBodyOrigin>>>
	readonly policy: SpiceEphemerisPolicy
	// Generation of the kernel set the source was chosen from.
	readonly generation: number
}

// Signature of an answer computed from a source and a kernel snapshot, for the planets of `bodies`.
export function planetaryEventsSignature(source: PlanetaryEventsSource, snapshot: SpiceKernelSnapshot, bodies: readonly PlanetaryEventBody[]): PlanetaryEventsSignature {
	const signature = { modelVersion: PLANETARY_EVENTS_MODEL_VERSION, convention: PLANETARY_EVENTS_CONVENTION, source, policy: snapshot.policy, generation: snapshot.generation }
	if (source.kind !== 'spk' || !snapshot.set) return signature
	const naif = resolvedNaif(snapshot.set)
	const origins: Partial<Record<PlanetaryEventBody, PlanetaryEventsBodyOrigin>> = {}
	for (const code of bodies) origins[code] = naif[BODY_OF[code]] === CENTRE[BODY_OF[code]] ? 'centre' : 'barycentre'
	return { ...signature, origins }
}

// Body of POST /api/planetary-events/search.
export interface PlanetaryEventsSearchRequest {
	// First instant of the range, Unix milliseconds.
	readonly start: number
	// End of the range, exclusive, Unix milliseconds; the tool asks for at most 24 months.
	readonly end: number
	// Planets to search; a pair kind takes every pair of them.
	readonly bodies: readonly PlanetaryEventBody[]
	// Kinds to search.
	readonly kinds: readonly PlanetaryEventKind[]
	// Largest separation of an appulse kept, radians; never filters a conjunction.
	readonly appulseThreshold: number
}

// Circumstances of a planet at an event's instant.
export interface PlanetaryBodyCircumstances {
	readonly body: PlanetaryEventBody
	// Apparent true ecliptic longitude of date, [0, 2π).
	readonly longitude: number
	// Apparent true ecliptic latitude of date, [−π/2, π/2].
	readonly latitude: number
	// Apparent separation from the Sun, [0, π].
	readonly elongation: number
	// Geometric distance from the Earth's centre, AU.
	readonly earthDistance: number
	// Illuminated fraction of the disk seen from the Earth, [0, 1].
	readonly illuminatedFraction: number
	// Apparent visual magnitude (Mallama and Hilton 2018); absent where the model is undefined.
	readonly magnitude?: number
}

// What every event carries.
interface PlanetaryEventBase {
	// Stable identity: the kind, the bodies, the subtype and the instant to the second.
	readonly id: string
	// Geocentric instant of the event, Unix milliseconds (UTC); a site never changes it.
	readonly time: number
	// The planets of the event; a pair in the order of PLANETARY_EVENT_BODIES.
	readonly bodies: readonly PlanetaryEventBody[]
	// Circumstances of each planet of `bodies` at the instant, in the same order.
	readonly circumstances: readonly PlanetaryBodyCircumstances[]
	// Ids of the events of other kinds with the same bodies within 15 days.
	readonly relatedIds: readonly string[]
}

// Equal apparent ecliptic longitudes of a planet and the Sun; an outer planet is always superior.
export interface SolarConjunctionEvent extends PlanetaryEventBase {
	readonly kind: 'solarConjunction'
	// Inferior when the planet is nearer than the Sun.
	readonly subtype: 'inferior' | 'superior'
	// Separation from the Sun at the instant, radians.
	readonly separation: number
}

// Apparent ecliptic longitudes of a planet and the Sun differing by π.
export interface OppositionEvent extends PlanetaryEventBase {
	readonly kind: 'opposition'
	// Separation from the Sun at the instant, radians; under π for an inclined orbit.
	readonly separation: number
}

// Apparent ecliptic longitudes of a planet and the Sun differing by ±π/2.
export interface QuadratureEvent extends PlanetaryEventBase {
	readonly kind: 'quadrature'
	// East at +π/2 (evening sky), west at −π/2 (morning sky).
	readonly subtype: 'east' | 'west'
}

// A maximum of the separation of Mercury or Venus from the Sun.
export interface GreatestElongationEvent extends PlanetaryEventBase {
	readonly kind: 'greatestElongation'
	readonly subtype: 'east' | 'west'
	// The maximum separation, radians.
	readonly elongation: number
}

// A root of the apparent ecliptic longitude rate.
export interface StationEvent extends PlanetaryEventBase {
	readonly kind: 'station'
	readonly subtype: 'directToRetrograde' | 'retrogradeToDirect'
}

// Equal apparent ecliptic longitudes of two planets.
export interface PlanetaryConjunctionEvent extends PlanetaryEventBase {
	readonly kind: 'planetaryConjunction'
	// Separation at the instant, radians; not the least separation (see the appulse).
	readonly separation: number
	// The planet north of the other in ecliptic latitude.
	readonly northBody: PlanetaryEventBody
}

// A local minimum of the apparent separation of two planets, at most the request's threshold.
export interface PlanetaryAppulseEvent extends PlanetaryEventBase {
	readonly kind: 'planetaryAppulse'
	// The least separation, radians.
	readonly separation: number
}

// A local minimum of the geometric Earth–planet distance.
export interface ClosestEarthApproachEvent extends PlanetaryEventBase {
	readonly kind: 'closestEarthApproach'
	// The least distance, AU.
	readonly earthDistance: number
}

// Venus's greatest brilliancy: a minimum of the modelled magnitude on its crescent branch (phase angle 90° to 163.7°).
export interface GreatestBrightnessEvent extends PlanetaryEventBase {
	readonly kind: 'greatestBrightness'
	// Apparent visual magnitude at the minimum.
	readonly magnitude: number
	// Sun–planet–Earth angle, radians.
	readonly phaseAngle: number
}

// Mercury or Venus half illuminated (dichotomy); not the greatest elongation.
export interface HalfIlluminationEvent extends PlanetaryEventBase {
	readonly kind: 'halfIllumination'
	readonly subtype: 'increasing' | 'decreasing'
}

// A planetary phenomenon.
export type PlanetaryEvent = SolarConjunctionEvent | OppositionEvent | QuadratureEvent | GreatestElongationEvent | StationEvent | PlanetaryConjunctionEvent | PlanetaryAppulseEvent | ClosestEarthApproachEvent | GreatestBrightnessEvent | HalfIlluminationEvent

// An event before its identity and links are assigned.
type PendingEvent = PlanetaryEvent extends infer E ? (E extends PlanetaryEvent ? Omit<E, 'id' | 'relatedIds'> : never) : never

// Length of a scan chunk, days: about a month, so a long range yields often.
const CHUNK_DAYS = 30

// Extension of each chunk scan on both sides, days, so an extremum or root near a chunk edge is bracketed by the chunk
// that owns its instant; events are kept by their instant in the half-open chunk.
const CHUNK_HALO_DAYS = 3

// Scan options of every finder: a one-day step resolves the fastest relative motion (Mercury against the Sun or Venus,
// a few degrees per day) and every extremum, and 1e-6 day (0.09 s) refines the instant far below the display precision.
const SEARCH_OPTIONS: TimeSearchOptions = { step: 1, tolerance: 1e-6 }

// Half-step of the station longitude rate, days.
const STATION_HALF_STEP = 0.5

// Phase angles of Venus's greatest brilliancy, the crescent branch of Mallama and Hilton's magnitude: beyond 163.7° the
// forward-scattering branch makes faint minima around inferior conjunction, and below 90° the low-phase polynomial and
// the distance make shallow minima of about −3.9 near superior conjunction; neither is the greatest brilliancy.
const VENUS_BRILLIANCY_PHASE = [90 * DEG2RAD, 163.7 * DEG2RAD] as const

// Days within which an event of another kind with the same bodies is related.
const RELATED_DAYS = 15

// Half-step of the central difference that gives the Earth's and the Sun's velocities, days.
const VELOCITY_HALF_STEP = 0.01

// Spacing of the precession-nutation nodes, days; linear interpolation between them is in error by under 0.001″, since the
// shortest nutation terms have periods of days and amplitudes under 0.1″.
const ORIENTATION_NODE_DAYS = 0.5

// Earth orientation interpolated from the full IAU 2006/2000A evaluation at fixed TT nodes, which costs a few hundred
// microseconds per instant, and TDB − TT from the USNO Circular 179 series (within microseconds of the full model, at a
// fraction of its cost, for the interpolated ephemeris's TDB nodes); every instant shifted from one carrying these
// providers inherits them. One per computation.
function interpolatedOrientation(): TimeProviders {
	const matrices = new Map<number, Mat3>()
	const nutations = new Map<number, readonly [number, number]>()

	// Node index and weight of a TT instant.
	function node(t: Time): readonly [number, number] {
		const x = (t.day - 2451545 + t.fraction) / ORIENTATION_NODE_DAYS
		const index = Math.floor(x)
		return [index, x - index]
	}

	// Node TT Julian day as two parts.
	function nodeDay(index: number): readonly [number, number] {
		return [2451545, index * ORIENTATION_NODE_DAYS]
	}

	function matrixAt(index: number) {
		let matrix = matrices.get(index)
		if (!matrix) {
			const [a, b] = nodeDay(index)
			matrix = eraPnm06a(a, b)
			matrices.set(index, matrix)
		}
		return matrix
	}

	function nutationAt(index: number) {
		let nutation = nutations.get(index)
		if (!nutation) {
			const [a, b] = nodeDay(index)
			nutation = eraNut06a(a, b)
			nutations.set(index, nutation)
		}
		return nutation
	}

	return {
		tdbMinusTt: tdbMinusTtByFairheadAndBretagnon1990,
		pnm: (t) => {
			const [index, u] = node(t)
			const a = matrixAt(index)
			const b = matrixAt(index + 1)
			const out = new Array<number>(9) as MutMat3
			for (let i = 0; i < 9; i++) out[i] = a[i] + (b[i] - a[i]) * u
			return out
		},
		nut: (t) => {
			const [index, u] = node(t)
			const a = nutationAt(index)
			const b = nutationAt(index + 1)
			return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]
		},
	}
}

// Instant of a Unix time carrying the computation's orientation providers.
function oriented(time: number, orientation: TimeProviders): Time {
	const t = toolkitTime(time)
	Object.defineProperty(t, 'providers', { value: orientation, enumerable: false, writable: true })
	return t
}

// Providers of one stretch of a computation over an ephemeris, each memoized by instant so the Sun and the Earth are
// shared by every planet and pair and the coarse samples by every finder.
class Providers {
	readonly #apparent = new Map<Body, PositionOverTime>()
	readonly #geometric = new Map<Body, PositionOverTime>()
	readonly #earth: PositionAndVelocityOverTime
	readonly #sun: PositionAndVelocityOverTime
	readonly #deflectors: readonly LightDeflector[]

	constructor(readonly ephemeris: PlanetaryEventsEphemeris) {
		this.#earth = this.#state('earth')
		this.#sun = this.#state('sun')
		this.#deflectors = [{ mass: SUN_LIGHT_DEFLECTOR_MASS, limiter: SUN_LIGHT_DEFLECTOR_LIMITER, state: this.#sun }]
	}

	// Barycentric state of a body with its velocity from a central difference of the positions, memoized by instant.
	#state(body: Body): PositionAndVelocityOverTime {
		const cache = new Map<number, readonly [Vec3, Vec3]>()
		return (time) => {
			const key = time.day + time.fraction
			let state = cache.get(key)
			if (!state) {
				const before = this.ephemeris.position(body, timeShift(time, -VELOCITY_HALF_STEP))
				const after = this.ephemeris.position(body, timeShift(time, VELOCITY_HALF_STEP))
				state = [this.ephemeris.position(body, time), vecMulScalar(vecMinus(after, before), 1 / (2 * VELOCITY_HALF_STEP))]
				cache.set(key, state)
			}
			return state
		}
	}

	// Geocentric apparent vector of a body, AU: the apparent unit direction times the light-time distance.
	apparent(body: Body): PositionOverTime {
		let provider = this.#apparent.get(body)

		if (!provider) {
			const cache = new Map<number, Vec3>()
			const zero = vecZero()
			const target: PositionAndVelocityOverTime = body === 'sun' ? this.#sun : (time) => [this.ephemeris.position(body, time), zero]
			const deflectors = body === 'sun' ? [] : this.#deflectors

			provider = (time) => {
				const key = time.day + time.fraction
				let vector = cache.get(key)
				if (!vector) {
					const direction = apparentDirection(target, this.#earth, time, { sun: this.#sun, deflectors })!
					vector = vecMulScalar(direction.apparent, direction.distance)
					cache.set(key, vector)
				}
				return vector
			}

			this.#apparent.set(body, provider)
		}

		return provider
	}

	// Geometric geocentric vector of a body at the instant, AU.
	geometric(body: Body): PositionOverTime {
		let provider = this.#geometric.get(body)

		if (!provider) {
			const cache = new Map<number, Vec3>()
			provider = (time) => {
				const key = time.day + time.fraction
				let vector = cache.get(key)
				if (!vector) {
					vector = vecMinus(this.ephemeris.position(body, time), this.#earth(time)[0])
					cache.set(key, vector)
				}
				return vector
			}
			this.#geometric.set(body, provider)
		}

		return provider
	}

	// Circumstances of a planet at an instant.
	circumstances(code: PlanetaryEventBody, time: Time): PlanetaryBodyCircumstances {
		const body = BODY_OF[code]
		const apparent = this.apparent(body)(time)
		const sun = this.apparent('sun')(time)
		const geometric = this.geometric(body)(time)
		const sunToPlanet = vecMinus(geometric, this.geometric('sun')(time))
		const eclipticVector = ecliptic(apparent, time, vecZero())
		const phase = vecAngle(vecNegate(geometric), vecNegate(sunToPlanet))
		const magnitude = planetMagnitude(body, sunToPlanet, geometric, { year: julianYear(time) })
		return {
			body: code,
			longitude: vecLongitude(eclipticVector),
			latitude: vecLatitude(eclipticVector),
			elongation: vecAngle(apparent, sun),
			earthDistance: vecLength(geometric),
			illuminatedFraction: (1 + Math.cos(phase)) / 2,
			...(Number.isFinite(magnitude) && { magnitude }),
		}
	}
}

// Julian year of an instant, for Neptune's secular brightness term.
function julianYear(time: Time) {
	return 2000 + (time.day - 2451545 + time.fraction) / 365.25
}

// The pairs of `bodies`, each in the order of PLANETARY_EVENT_BODIES.
function pairs(bodies: readonly PlanetaryEventBody[]): (readonly [PlanetaryEventBody, PlanetaryEventBody])[] {
	const sorted = PLANETARY_EVENT_BODIES.filter((code) => bodies.includes(code))
	const out: (readonly [PlanetaryEventBody, PlanetaryEventBody])[] = []
	for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) out.push([sorted[i], sorted[j]])
	return out
}

// The events of a request found by scanning [from, to], before ownership by chunk.
function scanEvents(providers: Providers, request: PlanetaryEventsSearchRequest, from: Time, to: Time): PendingEvent[] {
	const kinds = new Set(request.kinds)
	const sun = providers.apparent('sun')
	const geometricSun = providers.geometric('sun')
	const events: PendingEvent[] = []
	const single = (kind: keyof typeof PLANETARY_EVENT_APPLICABILITY) => (kinds.has(kind) ? PLANETARY_EVENT_APPLICABILITY[kind].filter((code) => request.bodies.includes(code)) : [])
	const at = (time: Time, ...bodies: PlanetaryEventBody[]) => ({ time: timeToUnixMillis(time), bodies, circumstances: bodies.map((code) => providers.circumstances(code, time)) })

	for (const code of single('solarConjunction')) {
		for (const event of planetaryLongitudeConjunctions(providers.apparent(BODY_OF[code]), sun, from, to, SEARCH_OPTIONS)) {
			events.push({ kind: 'solarConjunction', subtype: event.kind, separation: event.separation, ...at(event.time, code) })
		}
	}

	for (const code of single('opposition')) {
		for (const event of planetaryLongitudeOppositions(providers.apparent(BODY_OF[code]), sun, from, to, SEARCH_OPTIONS)) {
			events.push({ kind: 'opposition', separation: event.separation, ...at(event.time, code) })
		}
	}

	for (const code of single('quadrature')) {
		for (const event of planetaryLongitudeQuadratures(providers.apparent(BODY_OF[code]), sun, from, to, SEARCH_OPTIONS)) {
			events.push({ kind: 'quadrature', subtype: event.kind, ...at(event.time, code) })
		}
	}

	for (const code of single('greatestElongation')) {
		for (const event of planetaryGreatestElongations(providers.apparent(BODY_OF[code]), sun, from, to, SEARCH_OPTIONS)) {
			events.push({ kind: 'greatestElongation', subtype: event.kind, elongation: event.elongation, ...at(event.time, code) })
		}
	}

	for (const code of single('station')) {
		for (const event of planetaryStations(providers.apparent(BODY_OF[code]), from, to, { ...SEARCH_OPTIONS, derivativeHalfStep: STATION_HALF_STEP })) {
			events.push({ kind: 'station', subtype: event.kind, ...at(event.time, code) })
		}
	}

	for (const code of single('closestEarthApproach')) {
		for (const event of planetaryClosestApproaches(providers.geometric(BODY_OF[code]), from, to, SEARCH_OPTIONS)) {
			events.push({ kind: 'closestEarthApproach', earthDistance: event.distance, ...at(event.time, code) })
		}
	}

	for (const code of single('greatestBrightness')) {
		for (const event of planetaryBrightnessMaxima(BODY_OF[code], providers.geometric(BODY_OF[code]), geometricSun, from, to, SEARCH_OPTIONS)) {
			if (event.phaseAngle > VENUS_BRILLIANCY_PHASE[0] && event.phaseAngle < VENUS_BRILLIANCY_PHASE[1]) events.push({ kind: 'greatestBrightness', magnitude: event.magnitude, phaseAngle: event.phaseAngle, ...at(event.time, code) })
		}
	}

	for (const code of single('halfIllumination')) {
		for (const event of planetaryIlluminationCrossings(providers.geometric(BODY_OF[code]), geometricSun, from, to, 0.5, SEARCH_OPTIONS)) {
			events.push({ kind: 'halfIllumination', subtype: event.kind, ...at(event.time, code) })
		}
	}

	const conjunctions = kinds.has('planetaryConjunction')
	const appulses = kinds.has('planetaryAppulse')

	if (conjunctions || appulses) {
		for (const [a, b] of pairs(request.bodies)) {
			const first = providers.apparent(BODY_OF[a])
			const second = providers.apparent(BODY_OF[b])

			if (conjunctions) {
				for (const event of planetaryLongitudeConjunctions(first, second, from, to, SEARCH_OPTIONS)) {
					events.push({ kind: 'planetaryConjunction', separation: event.separation, northBody: event.latitudeDifference > 0 ? a : b, ...at(event.time, a, b) })
				}
			}

			if (appulses) {
				for (const event of planetaryAppulses(first, second, from, to, SEARCH_OPTIONS)) {
					if (event.separation <= request.appulseThreshold) events.push({ kind: 'planetaryAppulse', separation: event.separation, ...at(event.time, a, b) })
				}
			}
		}
	}

	return events
}

// Subtype of an event, or the empty string, for its identity.
function subtypeOf(event: PendingEvent) {
	return 'subtype' in event ? event.subtype : ''
}

// Stable identity of an event: its kind, bodies, subtype and instant to the second.
export function planetaryEventId(kind: PlanetaryEventKind, bodies: readonly PlanetaryEventBody[], subtype: string, time: number) {
	return `${kind}|${bodies.join('-')}|${subtype}|${Math.round(time / 1000)}`
}

// Assigns identities and the links between events of other kinds with the same bodies, chronologically.
function finish(pending: PendingEvent[]): PlanetaryEvent[] {
	pending.sort((a, b) => a.time - b.time || PLANETARY_EVENT_KINDS.indexOf(a.kind) - PLANETARY_EVENT_KINDS.indexOf(b.kind))
	const ids = pending.map((event) => planetaryEventId(event.kind, event.bodies, subtypeOf(event), event.time))
	const keys = pending.map((event) => event.bodies.join('-'))
	const window = RELATED_DAYS * 86_400_000

	return pending.map((event, i) => {
		const relatedIds: string[] = []
		for (let j = 0; j < pending.length; j++) if (j !== i && keys[j] === keys[i] && pending[j].kind !== event.kind && Math.abs(pending[j].time - event.time) <= window) relatedIds.push(ids[j])
		return { ...event, id: ids[i], relatedIds }
	})
}

// Events of a range and the source that computed them.
export interface PlanetaryEventsSearch {
	readonly events: readonly PlanetaryEvent[]
	readonly sourced: SourcedResult<Body, AnalyticalPlanetaryEventsSource, readonly PendingEvent[]>
}

// Bodies a request needs from the source.
function sourceBodies(bodies: readonly PlanetaryEventBody[]): Body[] {
	return ['sun', 'earth', ...PLANETARY_EVENT_BODIES.filter((code) => bodies.includes(code)).map((code) => BODY_OF[code])]
}

// Searches the events of a request over [start, end) in month chunks with one source for all of them; each chunk scans its
// span padded by CHUNK_HALO_DAYS and keeps the events whose instant falls in the chunk, so none is reported twice or lost
// at a chunk edge. An aborted request stops between chunks.
export async function searchPlanetaryEvents(kernels: PlanetaryEventsKernels, request: PlanetaryEventsSearchRequest, signal?: AbortSignal): Promise<PlanetaryEventsSearch> {
	signal?.throwIfAborted()
	const span = Math.max(0, request.end - request.start)
	const chunkMs = CHUNK_DAYS * 86_400_000
	const count = Math.ceil(span / chunkMs)
	const orientation = interpolatedOrientation()
	const halo = CHUNK_HALO_DAYS * 86_400_000

	const sourced = await withSatelliteSource(
		kernels,
		SOURCE,
		sourceBodies(request.bodies),
		count,
		(ephemeris, index) => {
			const from = request.start + index * chunkMs
			const to = Math.min(request.end, from + chunkMs)
			const providers = new Providers(ephemeris)
			return scanEvents(providers, request, oriented(from - halo, orientation), oriented(to + halo, orientation)).filter((event) => event.time >= from && event.time < to)
		},
		(ephemeris) => interpolatedSatelliteEphemeris(SYSTEM, ephemeris),
		signal,
	)

	return { events: finish(sourced.results.flat()), sourced }
}

// Body of POST /api/planetary-events/series: the event a chart is drawn for.
export interface PlanetaryEventSeriesRequest {
	readonly kind: PlanetaryEventKind
	readonly bodies: readonly PlanetaryEventBody[]
	// Instant of the event, Unix milliseconds.
	readonly time: number
}

// What a series measures and its unit: radians, AU, magnitudes or a fraction.
export type PlanetaryEventQuantity = 'elongation' | 'separation' | 'longitudeDifference' | 'longitude' | 'earthDistance' | 'magnitude' | 'illuminatedFraction'

// One sampled curve.
export interface PlanetaryEventSeriesCurve {
	readonly quantity: PlanetaryEventQuantity
	// Value at each sample, null where undefined (a magnitude outside the model).
	readonly values: readonly (number | null)[]
}

// Sampled curves around an event, for display only: the event's instant is the solved one, never a sample.
export interface PlanetaryEventSeries {
	readonly kind: PlanetaryEventKind
	readonly time: number
	// Instants of the samples, Unix milliseconds, evenly spaced.
	readonly times: readonly number[]
	readonly curves: readonly PlanetaryEventSeriesCurve[]
	readonly signature: PlanetaryEventsSignature
}

// Number of samples of a series.
export const SERIES_SAMPLES = 241

// Half-width of a series around its event, days.
const SERIES_HALF_DAYS: Readonly<Record<PlanetaryEventKind, number>> = {
	solarConjunction: 30,
	opposition: 60,
	quadrature: 60,
	greatestElongation: 45,
	station: 60,
	planetaryConjunction: 10,
	planetaryAppulse: 10,
	closestEarthApproach: 60,
	greatestBrightness: 60,
	halfIllumination: 45,
}

// Quantities of the curves of each kind.
const SERIES_QUANTITIES: Readonly<Record<PlanetaryEventKind, readonly PlanetaryEventQuantity[]>> = {
	solarConjunction: ['elongation'],
	opposition: ['elongation'],
	quadrature: ['elongation'],
	greatestElongation: ['elongation'],
	station: ['longitude'],
	planetaryConjunction: ['separation', 'longitudeDifference'],
	planetaryAppulse: ['separation', 'longitudeDifference'],
	closestEarthApproach: ['earthDistance'],
	greatestBrightness: ['magnitude'],
	halfIllumination: ['illuminatedFraction'],
}

// Samples the curves of an event from one source; the longitude of a station and the longitude difference of a pair are
// unwrapped about their value at the event, radians.
export async function computeSeries(kernels: PlanetaryEventsKernels, request: PlanetaryEventSeriesRequest, signal?: AbortSignal) {
	const { kind, bodies, time } = request
	const half = SERIES_HALF_DAYS[kind] * 86_400_000
	const step = (2 * half) / (SERIES_SAMPLES - 1)
	const times = Array.from({ length: SERIES_SAMPLES }, (_, i) => Math.round(time - half + i * step))
	const orientation = interpolatedOrientation()

	const sourced = await withSatelliteSource(
		kernels,
		SOURCE,
		sourceBodies(bodies),
		1,
		(ephemeris) => {
			const providers = new Providers(ephemeris)
			const [a, b] = bodies.map((code) => BODY_OF[code])
			const sun = providers.apparent('sun')
			const reference = oriented(time, orientation)

			const longitudeOf = (body: Body, t: Time) => vecLongitude(ecliptic(providers.apparent(body)(t), t, vecZero()))
			const pairDifference = (t: Time) => normalizePI(longitudeOf(a, t) - longitudeOf(b, t))
			const origin = kind === 'station' ? longitudeOf(a, reference) : b ? pairDifference(reference) : 0

			const sample = (quantity: PlanetaryEventQuantity, t: Time): number | null => {
				switch (quantity) {
					case 'elongation':
						return vecAngle(providers.apparent(a)(t), sun(t))
					case 'separation':
						return vecAngle(providers.apparent(a)(t), providers.apparent(b)(t))
					case 'longitudeDifference':
						return origin + normalizePI(pairDifference(t) - origin)
					case 'longitude':
						return origin + normalizePI(longitudeOf(a, t) - origin)
					case 'earthDistance':
						return vecLength(providers.geometric(a)(t))
					case 'magnitude':
					case 'illuminatedFraction': {
						const value = providers.circumstances(bodies[0], t)
						return quantity === 'magnitude' ? (value.magnitude ?? null) : value.illuminatedFraction
					}
				}
			}

			const instants = times.map((ms) => oriented(ms, orientation))
			return SERIES_QUANTITIES[kind].map((quantity): PlanetaryEventSeriesCurve => ({ quantity, values: instants.map((t) => sample(quantity, t)) }))
		},
		(ephemeris) => interpolatedSatelliteEphemeris(SYSTEM, ephemeris),
		signal,
	)

	return { kind, time, times, curves: sourced.results[0], sourced }
}

// VSOP87E positions of the bodies on the interpolation grid, for the visibility of events, which only decides when an
// event can be watched and never uses the kernels. Nodes are cached for the lifetime of the ephemeris.
export function analyticalPlanetaryEventsEphemeris(): PlanetaryEventsEphemeris {
	return interpolatedSatelliteEphemeris(SYSTEM, ANALYTICAL)
}

// Geometric geocentric ICRS vector (AU) of the Sun or a planet over Unix milliseconds, from an ephemeris; a new vector.
// Instants are shifted from `reference`, so they inherit its providers (a cheap TDB − TT keeps the interpolation fast).
export function geocentricOf(ephemeris: PlanetaryEventsEphemeris, body: PlanetaryEventBody | 'sun', reference: Time): (time: number) => Vec3 {
	const name = body === 'sun' ? 'sun' : BODY_OF[body]
	const origin = timeToUnixMillis(reference)
	return (time) => {
		const t = timeShift(reference, (time - origin) / 86_400_000)
		return vecMinus(ephemeris.position(name, t), ephemeris.position('earth', t))
	}
}
