import type { SpkKernelSet, SpkMissReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { eccentricAnomaly, meanAnomaly, meanMotion, timeSincePeriapsis } from 'nebulosa/src/astronomy/orbits/asteroid'
import { type ClassicalElements, conicClass, ORBIT_CENTERS, orbitCenter, type OrbitDefinition, type OrbitDiagnostics, type OrbitFailureReason, orbitalElements, orbitDiagnostics, orbitOf, orbitStateAt, type ReferencePlane, stateResidual } from 'nebulosa/src/astronomy/orbits/mechanics'
import { type ConicMarkerKind, OPEN_ARC_RADIUS, ORBIT_SAMPLE_LIMIT, sampleConic, sampleStates } from 'nebulosa/src/astronomy/orbits/sampling'
import { type Time, Timescale, tdb, time, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { errorResponse } from './http'
import { ORBITAL_MECHANICS_PRESETS, type OrbitPreset } from './orbitalmechanics.presets'
import { solarSystemBody } from './sky/bodies'
import type { MinorBodyElements } from './sky/ephemeris'
import { type MinorBodies, type ResolvedMinorBody, SbdbUnavailableError } from './sky/minorbodies'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import { SsdBusyError, SsdThrottledError, SsdTimeoutError } from './ssd'

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
// - degenerateOrbit, outOfRange, solverFailed (422): outcomes of the two-body model.
// - objectNotFound (404): SBDB knows no such body; notCached (404): an offline lookup found no body read recently.
// - orbitSolutionUnavailable (422): SBDB publishes no usable elements; unsupportedFrame (422): they are not J2000.
// - centerUnavailable (422): the center has no trustworthy gravitational parameter.
// - kernelMissing, kernelCoverageUnavailable, unsupportedKernel (422), kernelReadFailed (503): the installed SPICE kernels
//   cannot give a state of a body at an instant, with the body and the instant.
// - serviceUnavailable, rateLimited (503): JPL cannot be reached, or asks to wait (with retryAfter in milliseconds).
export type OrbitalMechanicsErrorCode =
	| 'degenerateOrbit'
	| 'outOfRange'
	| 'solverFailed'
	| 'objectNotFound'
	| 'notCached'
	| 'orbitSolutionUnavailable'
	| 'unsupportedFrame'
	| 'centerUnavailable'
	| 'kernelMissing'
	| 'kernelCoverageUnavailable'
	| 'unsupportedKernel'
	| 'kernelReadFailed'
	| 'serviceUnavailable'
	| 'rateLimited'

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

// An outcome answered as an error with its status, stable code, and documented fields.
class OrbitModelError extends Error {
	constructor(
		readonly code: OrbitalMechanicsErrorCode,
		message: string,
		readonly status: number = 422,
		readonly details?: object,
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

// Where an orbit resolved from a real object comes from.
export type OrbitSourcePayload =
	| {
			readonly kind: 'sbdb'
			// SPK-ID of the body, its identity.
			readonly spkId: string
			// Primary designation.
			readonly designation: string
			// Identifier of the published orbit solution.
			readonly orbitId?: string
			// Date SBDB solved it.
			readonly solutionDate?: string
			// Epoch of the published elements, Julian date TDB.
			readonly epoch: number
			// When SBDB was read, Unix milliseconds.
			readonly fetchedAt: number
	  }
	| {
			readonly kind: 'spk'
			// NAIF ID of the target.
			readonly target: number
			// NAIF ID of the center.
			readonly center: number
			// Instant of the state, Julian date TDB.
			readonly epoch: number
			// Generation of the SPICE library the state was read from.
			readonly generation: number
			// Kernels that gave the target's and the center's states.
			readonly kernels: readonly string[]
	  }

// Request of POST /api/orbital-mechanics/resolve: a minor body by SPK-ID, designation, or name, read only from the
// bodies resolved recently unless `online` allows asking SBDB; or the osculating state of an SPK target about a center at
// an instant from the installed SPICE kernels.
export type OrbitResolveRequest = { readonly kind: 'minorBody'; readonly query: string; readonly online: boolean } | { readonly kind: 'spk'; readonly target: number; readonly center: number; readonly epoch: number }

// Answer of a resolve: the orbit, or the candidates of an ambiguous name to choose from.
export type OrbitResolveResponse =
	| {
			readonly kind: 'resolved'
			// Name of the object.
			readonly name: string
			// NAIF ID of the center the definition is about.
			readonly center: number
			// The orbit, with the center's DE440 gravitational parameter.
			readonly definition: OrbitDefinitionPayload
			// Where it comes from.
			readonly source: OrbitSourcePayload
	  }
	| { readonly kind: 'ambiguous'; readonly matches: readonly { readonly designation: string; readonly name: string }[] }

// Request of POST /api/orbital-mechanics/compare.
export interface OrbitCompareRequest {
	// NAIF ID of the target.
	readonly target: number
	// NAIF ID of the center, one of the DE440 centers.
	readonly center: number
	// Instant of the osculating state the Kepler model starts from, Julian date TDB.
	readonly anchor: number
	// First instant compared, Julian date TDB.
	readonly start: number
	// Last instant compared, Julian date TDB, after start.
	readonly end: number
	// Number of instants compared, evenly spaced, 2 to COMPARE_NODE_LIMIT; the anchor is added when inside.
	readonly count: number
}

// States at the instants of a comparison, parallel arrays, AU and AU/day relative to the center.
export interface OrbitStateTable {
	// Positions, AU.
	readonly positions: readonly OrbitVector[]
	// Velocities, AU/day.
	readonly velocities: readonly OrbitVector[]
}

// One instant of a comparison.
export interface OrbitCompareNode {
	// Instant, Julian date TDB.
	readonly time: number
	// |Δr| of the Kepler model minus the SPK reference, AU.
	readonly distance: number
	// |Δv|, AU/day.
	readonly speed: number
	// Δr on the RTN axes of the reference (radial, along-track, normal), AU; absent when the frame is undefined.
	readonly rtnPosition?: OrbitVector
	// Δv projected on the same axes, AU/day.
	readonly rtnVelocity?: OrbitVector
}

// Answer of a comparison: the difference between two models over the same instants, center, axes, and units, never an
// uncertainty of either.
export interface OrbitCompareResponse {
	// NAIF ID of the target.
	readonly target: number
	// NAIF ID of the center.
	readonly center: number
	// Name of the target.
	readonly name: string
	// The osculating two-body orbit at the anchor.
	readonly definition: OrbitDefinitionPayload
	// Its provenance: the SPK state it starts from, and every kernel the comparison read.
	readonly source: OrbitSourcePayload
	// Instants and residuals.
	readonly nodes: readonly OrbitCompareNode[]
	// SPK states at the instants.
	readonly reference: OrbitStateTable
	// Kepler states at the instants.
	readonly model: OrbitStateTable
	// Largest |Δr| (AU) and its instant (Julian date TDB), and the largest |Δv| (AU/day).
	readonly summary: { readonly maxDistance: number; readonly maxDistanceTime: number; readonly maxSpeed: number }
}

// Largest number of instants of a comparison.
export const COMPARE_NODE_LIMIT = 2048

// Collaborators of the service.
export interface OrbitalMechanicsServiceOptions {
	// SBDB lookups and their cache, shared with the Sky.
	readonly minorBodies: MinorBodies
	// SPICE library of the server.
	readonly kernels: { readonly current: () => SpiceKernelSnapshot }
}

// Error code of an SPK miss, by reason.
const MISS_ERRORS: Readonly<Record<SpkMissReason, OrbitalMechanicsErrorCode>> = { missing: 'kernelMissing', cycle: 'kernelMissing', coverage: 'kernelCoverageUnavailable', dataType: 'unsupportedKernel', frame: 'unsupportedKernel' }

// Stateless two-body analysis of the Orbital Mechanics Explorer.
export class OrbitalMechanicsService {
	readonly #minorBodies?: MinorBodies
	readonly #kernels?: OrbitalMechanicsServiceOptions['kernels']

	// Creates the service; the collaborators are needed only to resolve real objects and compare with SPICE.
	constructor(options?: OrbitalMechanicsServiceOptions) {
		this.#minorBodies = options?.minorBodies
		this.#kernels = options?.kernels
	}

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

	// The orbit of a real object: a minor body's published SBDB solution, or an SPK target's osculating state.
	async resolve(request: OrbitResolveRequest, signal?: AbortSignal): Promise<OrbitResolveResponse> {
		return request.kind === 'spk' ? this.#spkState(request.target, request.center, request.epoch) : await this.#minorBody(request.query.trim(), request.online, signal)
	}

	// The SBDB orbit of a minor body, as heliocentric J2000 ecliptic elements with the Sun's DE440 GM.
	async #minorBody(query: string, online: boolean, signal?: AbortSignal): Promise<OrbitResolveResponse> {
		const bodies = this.#minorBodies!
		// An SPK-ID of a small body has at least seven digits; anything else is a designation or a name.
		const spkId = /^\d{7,}$/.test(query) ? query : undefined
		let resolved: ResolvedMinorBody | undefined

		if (!online) {
			resolved = spkId === undefined ? undefined : bodies.cached(spkId)
			if (!resolved) throw new OrbitModelError('notCached', `${query} was not looked up recently, so it needs JPL`, 404)
		} else if (spkId !== undefined) {
			resolved = await bodies.body(spkId, signal)
		} else {
			const found = await bodies.search(query, signal)
			if (found.kind === 'ambiguous') return { kind: 'ambiguous', matches: found.matches }
			if (found.kind === 'found') resolved = bodies.cached(found.body.spkId)
		}

		if (!resolved) throw new OrbitModelError('objectNotFound', `JPL knows no small body ${query}`, 404)
		const { elements, body, found, fetchedAt } = resolved
		if (!elements) throw new OrbitModelError('orbitSolutionUnavailable', `JPL publishes no usable orbit of ${body.name}`)
		if (elements.referenceEclipticFrame === 'B1950') throw new OrbitModelError('unsupportedFrame', `The orbit of ${body.name} is referred to B1950, which is not supported`)

		const source: OrbitSourcePayload = { kind: 'sbdb', spkId: body.spkId, designation: body.designation, orbitId: found.orbit.orbit_id || undefined, solutionDate: found.orbit.soln_date || undefined, epoch: elements.epoch, fetchedAt }
		return { kind: 'resolved', name: body.name, center: 10, definition: minorBodyDefinition(elements, orbitCenter(10)!.mu), source }
	}

	// The osculating state of an SPK target about a center at an instant, read synchronously from one snapshot.
	#spkState(target: number, center: number, epoch: number): OrbitResolveResponse {
		const gm = orbitCenter(center)
		if (!gm) throw new OrbitModelError('centerUnavailable', `NAIF ${center} has no trustworthy gravitational parameter`)
		const { set, generation } = this.#snapshot()
		const state = relativeState(set, target, center, tdbTime(epoch))
		const definition: OrbitDefinitionPayload = { kind: 'cartesian', mu: gm.mu, position: state.position, velocity: state.velocity, epoch }
		return { kind: 'resolved', name: bodyName(target, this.#minorBodies), center, definition, source: { kind: 'spk', target, center, epoch, generation, kernels: state.kernels } }
	}

	// The current SPICE snapshot with a kernel set, or the error of an empty library.
	#snapshot() {
		const snapshot = this.#kernels!.current()
		if (!snapshot.set) throw new OrbitModelError('kernelMissing', snapshot.loading ? 'The SPICE kernels are still loading' : 'No SPICE kernel is installed and enabled')
		return { set: snapshot.set, generation: snapshot.generation }
	}

	// Kepler versus SPICE: the osculating two-body orbit of the target's SPK state at the anchor, propagated, against the
	// SPK states at the same instants, about the same center, in the same axes. Every read comes from one snapshot,
	// synchronously, so the whole comparison belongs to one generation of the library; an instant any kernel cannot give
	// fails the whole comparison, never patched by another source.
	compare({ target, center, anchor, start, end, count }: OrbitCompareRequest): OrbitCompareResponse {
		const gm = orbitCenter(center)
		if (!gm) throw new OrbitModelError('centerUnavailable', `NAIF ${center} has no trustworthy gravitational parameter`)
		const { set, generation } = this.#snapshot()
		const initial = relativeState(set, target, center, tdbTime(anchor))
		const definition: OrbitDefinitionPayload = { kind: 'cartesian', mu: gm.mu, position: initial.position, velocity: initial.velocity, epoch: anchor }
		const orbit = model(definition)
		const kernels = new Set(initial.kernels)

		const times: number[] = []
		// Bounded so a request can never allocate without limit.
		const nodes = Math.max(2, Math.min(COMPARE_NODE_LIMIT, Math.floor(count)))
		for (let k = 0; k < nodes; k++) times.push(start + ((end - start) * k) / (nodes - 1))
		if (anchor > start && anchor < end && !times.includes(anchor)) times.push(anchor)
		times.sort((a, b) => a - b)

		const result: OrbitCompareNode[] = []
		const reference: { positions: OrbitVector[]; velocities: OrbitVector[] } = { positions: [], velocities: [] }
		const kepler: { positions: OrbitVector[]; velocities: OrbitVector[] } = { positions: [], velocities: [] }
		let maxDistance = 0
		let maxDistanceTime = times[0]
		let maxSpeed = 0

		for (const jd of times) {
			const instant = tdbTime(jd)
			const spk = relativeState(set, target, center, instant)
			for (const kernel of spk.kernels) kernels.add(kernel)
			const state = orbitStateAt(orbit, instant)
			if (!state.ok) throw modelError(state.reason)

			const residual = stateResidual(state.position, state.velocity, spk.position, spk.velocity)
			result.push({ time: jd, distance: residual.distance, speed: residual.speed, rtnPosition: residual.rtnPosition && vector(residual.rtnPosition), rtnVelocity: residual.rtnVelocity && vector(residual.rtnVelocity) })
			reference.positions.push(spk.position)
			reference.velocities.push(spk.velocity)
			kepler.positions.push(vector(state.position))
			kepler.velocities.push(vector(state.velocity))

			if (residual.distance > maxDistance) {
				maxDistance = residual.distance
				maxDistanceTime = jd
			}

			maxSpeed = Math.max(maxSpeed, residual.speed)
		}

		const source: OrbitSourcePayload = { kind: 'spk', target, center, epoch: anchor, generation, kernels: [...kernels] }
		return { target, center, name: bodyName(target, this.#minorBodies), definition, source, nodes: result, reference, model: kepler, summary: { maxDistance, maxDistanceTime, maxSpeed } }
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

// Geometric state of `target` relative to `center` at `instant` (barycentric states subtracted, no light time), AU and
// AU/day in J2000 axes, with the kernels that gave both, or the error naming the body and the instant a kernel cannot give.
function relativeState(set: SpkKernelSet, target: number, center: number, instant: Time) {
	const read = (body: number) => {
		let result: ReturnType<SpkKernelSet['stateAt']>

		try {
			result = set.stateAt(body, instant)
		} catch (error) {
			throw new OrbitModelError('kernelReadFailed', `A SPICE kernel could not be read: ${error instanceof Error ? error.message : String(error)}`, 503)
		}

		if (!result.ok) {
			const jd = julianDateTdb(instant)
			const code = MISS_ERRORS[result.reason]
			const why = code === 'kernelCoverageUnavailable' ? 'is not covered' : code === 'unsupportedKernel' ? 'is in a segment that is not supported' : 'is in no installed kernel'
			throw new OrbitModelError(code, `NAIF ${result.body} ${why} at JD ${jd.toFixed(5)} TDB`, 422, { body: result.body, epoch: jd })
		}

		return result
	}

	const t = read(target)
	const c = read(center)
	const [[tx, ty, tz], [tvx, tvy, tvz]] = t.state
	const [[cx, cy, cz], [cvx, cvy, cvz]] = c.state
	const position: OrbitVector = [tx - cx, ty - cy, tz - cz]
	const velocity: OrbitVector = [tvx - cvx, tvy - cvy, tvz - cvz]
	return { position, velocity, kernels: [...new Set([...t.kernels, ...c.kernels])] }
}

// Name of a NAIF body: a planet, the Sun, or the Moon, a center, a minor body read recently, or its ID.
function bodyName(code: number, minorBodies?: MinorBodies) {
	return solarSystemBody(String(code))?.name ?? ORBIT_CENTERS.find((e) => e.code === code)?.name ?? minorBodies?.cached(String(code))?.body.name ?? `NAIF ${code}`
}

// Definition of SBDB's heliocentric J2000 ecliptic elements about the Sun with gravitational parameter `mu` (AU³/day²):
// an open orbit by its perihelion distance and time, a bound one by its semi-major axis and mean anomaly at the epoch
// (from the mean motion, or the perihelion time, when SBDB gives those instead).
export function minorBodyDefinition(elements: MinorBodyElements, mu: number): OrbitDefinitionPayload {
	const { ec, i, om, w, epoch, tpqr } = elements
	const angles = { mu, plane: 'ecliptic', inclination: i, node: om, argumentOfPeriapsis: w } as const

	if ('qr' in tpqr) {
		if (ec > 1) return { kind: 'hyperbolic', ...angles, periapsisDistance: tpqr.qr, eccentricity: ec, periapsisTime: tpqr.tp }
		if (ec === 1) return { kind: 'parabolic', ...angles, periapsisDistance: tpqr.qr, periapsisTime: tpqr.tp }
		const a = tpqr.qr / (1 - ec)
		return { kind: 'elliptic', ...angles, semiMajorAxis: a, eccentricity: ec, meanAnomaly: Math.sqrt(mu / (a * a * a)) * (epoch - tpqr.tp), epoch }
	}

	const a = 'a' in tpqr ? tpqr.a : Math.cbrt(mu / (tpqr.n * tpqr.n))
	return { kind: 'elliptic', ...angles, semiMajorAxis: a, eccentricity: ec, meanAnomaly: tpqr.ma, epoch }
}

// Error response of a failure of JPL, or undefined when it is not one.
function jplFailure(error: unknown) {
	const cause = error instanceof SbdbUnavailableError ? error.cause : error
	if (cause instanceof SsdThrottledError) return errorResponse(cause.message, 503, 'rateLimited' satisfies OrbitalMechanicsErrorCode, { retryAfter: cause.retryAfter })
	if (error instanceof SbdbUnavailableError || error instanceof SsdBusyError || error instanceof SsdTimeoutError) return errorResponse(error.message, 503, 'serviceUnavailable' satisfies OrbitalMechanicsErrorCode)
	return undefined
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

// Answers a computation of a route, mapping an outcome of the model or of its sources to its error; the abort of a
// request that left is not answered.
async function answer(req: Request, compute: () => unknown) {
	try {
		return Response.json(await compute())
	} catch (error) {
		if (req.signal.aborted) throw error
		if (error instanceof OrbitModelError) return errorResponse(error.message, error.status, error.code, error.details)
		const failure = jplFailure(error)
		if (failure) return failure
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
				return answer(req, () => service.solve(request))
			},
		},
		'/api/orbital-mechanics/trajectory': {
			POST: async (req: Request) => {
				const request = (await req.json()) as OrbitTrajectoryRequest
				return answer(req, () => service.trajectory(request))
			},
		},
		'/api/orbital-mechanics/resolve': {
			POST: async (req: Request) => {
				const request = (await req.json()) as OrbitResolveRequest
				return answer(req, () => service.resolve(request, req.signal))
			},
		},
		'/api/orbital-mechanics/compare': {
			POST: async (req: Request) => {
				const request = (await req.json()) as OrbitCompareRequest
				return answer(req, () => service.compare(request))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
