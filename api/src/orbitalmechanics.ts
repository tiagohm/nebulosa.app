import { eccentricAnomaly, meanAnomaly, meanMotion, timeSincePeriapsis } from 'nebulosa/src/astronomy/orbits/asteroid'
// oxfmt-ignore
import { type ClassicalElements, conicClass, ORBIT_CENTERS, type OrbitDefinition, type OrbitDiagnostics, type OrbitFailureReason, orbitalElements, orbitDiagnostics, orbitOf, orbitStateAt, type ReferencePlane } from 'nebulosa/src/astronomy/orbits/mechanics'
import { type ConicMarkerKind, OPEN_ARC_RADIUS, ORBIT_SAMPLE_LIMIT, sampleConic, sampleStates } from 'nebulosa/src/astronomy/orbits/sampling'
import { type Time, Timescale, tdb, time, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { errorResponse } from './http'
import { ORBITAL_MECHANICS_PRESETS, type OrbitPreset } from './orbitalmechanics.presets'

// Orbital Mechanics Explorer: stateless two-body analysis over the toolkit's canonical Kepler model, never operations,
// events, devices, or persisted state. A request carries the whole orbit definition, so the server keeps nothing between
// requests and every answer is reproducible from its request alone. Every state is geometric and relative to the
// orbit's center in J2000 equatorial (ICRF-aligned) axes; instants are Julian dates TDB, distances AU, velocities
// AU/day, angles radians, and gravitational parameters AU³/day². The tool checks what it sends, so definitions are taken
// as valid; only scientific outcomes of the model are answered as errors (422).

// Julian date TDB of J2000.0.
const J2000_JD = 2451545

// Half-width of the supported range of instants around J2000, in days (±10 000 Julian years): KeplerOrbit measures
// offsets in TT, whose TDB − TT series is meaningful only within about 10⁷ days of J2000.
export const ORBIT_EPOCH_RANGE_DAYS = 3_652_500

// Largest number of orbits shown together by the tool.
export const ORBIT_LIMIT = 8

// Smallest |e − 1| above the parabolic class at which an orbit is still warned near-parabolic.
const NEAR_PARABOLIC = 1e-3

// Stable codes of the orbital mechanics errors.
export type OrbitalMechanicsErrorCode = 'degenerateOrbit' | 'outOfRange' | 'solverFailed'

// A 3-vector in J2000 equatorial axes.
export type OrbitVector = readonly [number, number, number]

// Classical elements of a definition on a plane, with its anchor instant as a Julian date TDB.
interface ConicDefinitionPayloadBase {
	// Gravitational parameter of the center, AU³/day².
	readonly mu: number
	// Plane the angles are referred to.
	readonly plane: ReferencePlane
	// Inclination, radians, 0..PI.
	readonly inclination: number
	// Longitude of the ascending node, radians.
	readonly node: number
	// Argument of periapsis, radians.
	readonly argumentOfPeriapsis: number
}

// An orbit definition as sent over HTTP: the toolkit's OrbitDefinition with every instant a Julian date TDB.
export type OrbitDefinitionPayload =
	| (ConicDefinitionPayloadBase & {
			readonly kind: 'elliptic'
			// Semi-major axis, AU.
			readonly semiMajorAxis: number
			// Eccentricity, 0 <= e < 1.
			readonly eccentricity: number
			// Mean anomaly at the epoch, radians.
			readonly meanAnomaly: number
			// Epoch, Julian date TDB.
			readonly epoch: number
	  })
	| (ConicDefinitionPayloadBase & {
			readonly kind: 'parabolic'
			// Periapsis distance, AU.
			readonly periapsisDistance: number
			// Time of periapsis passage, Julian date TDB.
			readonly periapsisTime: number
	  })
	| (ConicDefinitionPayloadBase & {
			readonly kind: 'hyperbolic'
			// Periapsis distance, AU.
			readonly periapsisDistance: number
			// Eccentricity, above 1.
			readonly eccentricity: number
			// Time of periapsis passage, Julian date TDB.
			readonly periapsisTime: number
	  })
	| {
			readonly kind: 'cartesian'
			// Gravitational parameter of the center, AU³/day².
			readonly mu: number
			// Position relative to the center, AU, J2000 equatorial axes.
			readonly position: OrbitVector
			// Velocity relative to the center, AU/day, J2000 equatorial axes.
			readonly velocity: OrbitVector
			// Epoch of the state, Julian date TDB.
			readonly epoch: number
	  }

// A gravitational center as the tool shows it: one of the toolkit's DE440 centers, or a custom one the operator defined.
export interface OrbitCenterPayload {
	// NAIF ID of a toolkit center; absent for a custom center.
	readonly code?: number
	// Name shown.
	readonly name: string
	// Gravitational parameter, AU³/day².
	readonly mu: number
	// Equatorial radius, AU, a geometric reference for warnings.
	readonly radius: number
	// Whether the GM is a planetary system's, acting at its barycenter.
	readonly system: boolean
}

// Classical elements as sent over HTTP: the toolkit's elements with the periapsis time a Julian date TDB.
export type OrbitElementsPayload = Omit<ClassicalElements, 'periapsisTime'> & {
	// Time of the periapsis passage, Julian date TDB, when it applies.
	readonly periapsisTime?: number
}

// A scientific caveat of a solved orbit, shown beside its values.
// - periapsisInsideCenter: the periapsis distance is below the center's radius, so the conic crosses the body; a
//   geometric statement, not a collision prediction.
// - insideCenter: the state itself is inside the center's radius.
// - nearParabolic: |e − 1| is below NEAR_PARABOLIC but above the parabolic class, so the period or the asymptotes are
//   very sensitive to the eccentricity.
export type OrbitWarning = 'periapsisInsideCenter' | 'insideCenter' | 'nearParabolic'

// Request of POST /api/orbital-mechanics/solve.
export interface OrbitSolveRequest {
	// The orbit.
	readonly definition: OrbitDefinitionPayload
	// Its center, for the geometric warnings.
	readonly center: OrbitCenterPayload
	// Instant of the state, Julian date TDB (default the model's anchor).
	readonly at?: number
}

// Exact state, elements, and diagnostics of an orbit at an instant.
export interface OrbitSolveResponse {
	// Hash of the definition, identifying the model the values come from.
	readonly fingerprint: string
	// Anchor of the model (epoch, or periapsis time of an open definition), Julian date TDB.
	readonly anchor: number
	// Instant of the values, Julian date TDB.
	readonly time: number
	// The same instant in Unix milliseconds UTC, for display.
	readonly utc: number
	// Position relative to the center, AU.
	readonly position: OrbitVector
	// Velocity relative to the center, AU/day.
	readonly velocity: OrbitVector
	// Elements referred to the equator and to the ecliptic.
	readonly elements: Readonly<Record<ReferencePlane, OrbitElementsPayload>>
	// Derived dynamical quantities.
	readonly diagnostics: OrbitDiagnostics
	// Caveats.
	readonly warnings: readonly OrbitWarning[]
	// For an open orbit, the instants it is at OPEN_ARC_RADIUS periapsis distances inbound and outbound, Julian dates TDB:
	// the span the tool plays by default.
	readonly arc?: { readonly start: number; readonly end: number }
}

// Request of POST /api/orbital-mechanics/trajectory.
export interface OrbitTrajectoryRequest {
	// The orbit.
	readonly definition: OrbitDefinitionPayload
	// First instant of the states, Julian date TDB.
	readonly start: number
	// Last instant of the states, Julian date TDB.
	readonly end: number
	// Plane whose nodes are marked on the curve.
	readonly plane: ReferencePlane
	// Largest distance of an open arc, AU (default OPEN_ARC_RADIUS periapsis distances).
	readonly maxRadius?: number
}

// A marked point of a curve.
export interface OrbitMarkerPayload {
	// What the point is.
	readonly kind: ConicMarkerKind
	// Position, AU.
	readonly position: OrbitVector
}

// The curve and the states of an orbit over a window, both analytic two-body values.
export interface OrbitTrajectoryResponse {
	// Hash of the definition.
	readonly fingerprint: string
	// The conic: the whole ellipse, or a finite arc of an open orbit.
	readonly curve: {
		// Whether it is a closed ellipse whose last point repeats the first.
		readonly closed: boolean
		// Points in order along the orbit, AU.
		readonly points: readonly OrbitVector[]
		// Apsides and nodes.
		readonly markers: readonly OrbitMarkerPayload[]
		// Whether the point budget stopped the refinement.
		readonly truncated: boolean
	}
	// Exact chronological states over the window, parallel arrays.
	readonly samples: {
		// Instants, Julian dates TDB, increasing, the window's ends included.
		readonly times: readonly number[]
		// Positions, AU.
		readonly positions: readonly OrbitVector[]
		// Velocities, AU/day.
		readonly velocities: readonly OrbitVector[]
		// Whether the sample budget stopped the refinement.
		readonly truncated: boolean
	}
}

// Supported ranges the tool checks its inputs against.
export interface OrbitalMechanicsLimits {
	// First supported instant, Julian date TDB.
	readonly epochMin: number
	// Last supported instant, Julian date TDB.
	readonly epochMax: number
	// Largest number of points of a curve or states of a window.
	readonly maxSamples: number
	// Largest number of orbits shown together.
	readonly maxOrbits: number
}

// Answer of GET /api/orbital-mechanics/reference.
export interface OrbitalMechanicsReference {
	// Centers with a DE440 gravitational parameter.
	readonly centers: readonly OrbitCenterPayload[]
	// Built-in scenarios.
	readonly presets: readonly OrbitPreset[]
	// Supported ranges.
	readonly limits: OrbitalMechanicsLimits
}

// A scientific outcome of the model, answered 422 with its stable code.
class OrbitModelError extends Error {
	constructor(
		readonly code: OrbitalMechanicsErrorCode,
		message: string,
	) {
		super(message)
	}
}

// Messages of the model's failures, meant for people.
const FAILURE_MESSAGES: Readonly<Record<OrbitFailureReason, [OrbitalMechanicsErrorCode, string]>> = {
	degenerate: ['degenerateOrbit', 'The position and velocity are parallel, so the motion is not a conic'],
	outOfRange: ['outOfRange', 'The instant is too far from the epoch for the two-body solver'],
	solverFailed: ['solverFailed', "Kepler's equation did not converge for this orbit"],
}

// Error of a failure of the model.
function modelError(reason: OrbitFailureReason) {
	const [code, message] = FAILURE_MESSAGES[reason]
	return new OrbitModelError(code, message)
}

// Instant of a Julian date TDB.
export function tdbTime(jd: number): Time {
	return time(jd, 0, Timescale.TDB)
}

// Julian date TDB of an instant.
export function julianDateTdb(t: Time) {
	const value = tdb(t)
	return value.day + value.fraction
}

// The toolkit definition of a payload, with its instants as TDB times.
export function orbitDefinition(payload: OrbitDefinitionPayload): OrbitDefinition {
	switch (payload.kind) {
		case 'elliptic':
		case 'cartesian':
			return { ...payload, epoch: tdbTime(payload.epoch) }
		default:
			return { ...payload, periapsisTime: tdbTime(payload.periapsisTime) }
	}
}

// Stable hash of a definition payload, in hexadecimal.
export function orbitFingerprint(payload: OrbitDefinitionPayload) {
	return Bun.hash(JSON.stringify(payload)).toString(16)
}

// Elements payload of the toolkit's elements.
function elementsPayload(elements: ClassicalElements): OrbitElementsPayload {
	const { periapsisTime, ...rest } = elements
	return periapsisTime === undefined ? rest : { ...rest, periapsisTime: julianDateTdb(periapsisTime) }
}

// Copies a vector into a plain tuple.
function vector(v: Readonly<ArrayLike<number>>): OrbitVector {
	return [v[0], v[1], v[2]]
}

// Builds the canonical model of a payload, or throws the model's failure.
function model(payload: OrbitDefinitionPayload) {
	const result = orbitOf(orbitDefinition(payload))
	if (!result.ok) throw modelError(result.reason)
	return result.orbit
}

// Stateless two-body analysis of the Orbital Mechanics Explorer.
export class OrbitalMechanicsService {
	// Centers, presets, and supported ranges; never changes while the server runs.
	reference(): OrbitalMechanicsReference {
		return {
			centers: ORBIT_CENTERS.map((e) => ({ code: e.code, name: e.name, mu: e.mu, radius: e.radius, system: e.system })),
			presets: ORBITAL_MECHANICS_PRESETS,
			limits: { epochMin: J2000_JD - ORBIT_EPOCH_RANGE_DAYS, epochMax: J2000_JD + ORBIT_EPOCH_RANGE_DAYS, maxSamples: ORBIT_SAMPLE_LIMIT, maxOrbits: ORBIT_LIMIT },
		}
	}

	// Exact state, elements on both planes, diagnostics, and warnings of an orbit at an instant.
	solve({ definition, center, at }: OrbitSolveRequest): OrbitSolveResponse {
		const orbit = model(definition)
		const instant = at === undefined ? orbit.epoch : tdbTime(at)
		const state = orbitStateAt(orbit, instant)
		if (!state.ok) throw modelError(state.reason)

		const { position, velocity } = state
		const equator = orbitalElements(instant, position, velocity, definition.mu, 'equator')
		const ecliptic = orbitalElements(instant, position, velocity, definition.mu, 'ecliptic')
		const diagnostics = orbitDiagnostics(position, velocity, definition.mu)
		const warnings: OrbitWarning[] = []

		if (equator.periapsisDistance < center.radius) warnings.push('periapsisInsideCenter')
		if (diagnostics.radius < center.radius) warnings.push('insideCenter')
		if (equator.conic !== 'parabolic' && Math.abs(equator.eccentricity - 1) < NEAR_PARABOLIC) warnings.push('nearParabolic')

		const response: OrbitSolveResponse = {
			fingerprint: orbitFingerprint(definition),
			anchor: julianDateTdb(orbit.epoch),
			time: julianDateTdb(instant),
			utc: timeToUnixMillis(instant),
			position: vector(position),
			velocity: vector(velocity),
			elements: { equator: elementsPayload(equator), ecliptic: elementsPayload(ecliptic) },
			diagnostics,
			warnings,
		}

		const arc = openArc(equator, definition.mu)
		return arc === undefined ? response : { ...response, arc }
	}

	// The curve and the exact states of an orbit over a window.
	trajectory({ definition, start, end, plane, maxRadius }: OrbitTrajectoryRequest): OrbitTrajectoryResponse {
		const orbit = model(definition)
		const curve = sampleConic(orbit, { plane, maxRadius })
		const states = sampleStates(orbit, tdbTime(start), tdbTime(end))
		if (!states.ok) throw modelError(states.reason)

		return {
			fingerprint: orbitFingerprint(definition),
			curve: { closed: curve.closed, points: curve.points.map(vector), markers: curve.markers.map((e) => ({ kind: e.kind, position: vector(e.position) })), truncated: curve.truncated },
			samples: {
				times: states.samples.map((e) => julianDateTdb(e.time)),
				positions: states.samples.map((e) => vector(e.position)),
				velocities: states.samples.map((e) => vector(e.velocity)),
				truncated: states.truncated,
			},
		}
	}
}

// For an open orbit, the instants it is at OPEN_ARC_RADIUS periapsis distances before and after its periapsis passage,
// the same arc sampleConic draws by default; undefined for a bound orbit. Uses the toolkit's time since periapsis,
// which falls back to Barker's equation when the mean motion vanishes.
function openArc(elements: ClassicalElements, mu: number) {
	const { eccentricity: e, semiLatusRectum: p, periapsisDistance: q, periapsisTime } = elements
	if (conicClass(e) === 'circular' || conicClass(e) === 'elliptic' || periapsisTime === undefined) return undefined

	const radius = OPEN_ARC_RADIUS * q
	const nu = Math.acos(Math.max(-1, Math.min(1, (p / radius - 1) / e)))
	const n = elements.semiMajorAxis === undefined ? 0 : meanMotion(elements.semiMajorAxis, mu)
	const since = timeSincePeriapsis(meanAnomaly(eccentricAnomaly(nu, e), e, false), n, nu, p, mu)
	const tp = julianDateTdb(periapsisTime)
	return { start: tp - since, end: tp + since }
}

// Answers a computation of a route, mapping a scientific outcome of the model to 422.
function answer(compute: () => unknown) {
	try {
		return Response.json(compute())
	} catch (error) {
		if (error instanceof OrbitModelError) return errorResponse(error.message, 422, error.code)
		throw error
	}
}

// Creates the routes of the Orbital Mechanics Explorer. The tool checks what it sends, so requests are taken as valid.
export function createOrbitalMechanicsRoutes(service: OrbitalMechanicsService) {
	return {
		'/api/orbital-mechanics/reference': {
			GET: () => Response.json(service.reference()),
		},
		'/api/orbital-mechanics/solve': {
			POST: async (req: Request) => {
				const request = (await req.json()) as OrbitSolveRequest
				return answer(() => service.solve(request))
			},
		},
		'/api/orbital-mechanics/trajectory': {
			POST: async (req: Request) => {
				const request = (await req.json()) as OrbitTrajectoryRequest
				return answer(() => service.trajectory(request))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
