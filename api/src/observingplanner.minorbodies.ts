import { vector as horizonsVector } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import type { KeplerOrbit } from 'nebulosa/src/astronomy/orbits/asteroid'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { ASEC2RAD, DEG2RAD } from 'nebulosa/src/core/constants'
import { type Vec3, vecAngle } from 'nebulosa/src/math/linear-algebra/vec3'
import { computeEphemeris, EphemerisKernelMiss, EphemerisUnavailableError, HorizonsCircuitBreaker, snapshotKernels } from './ephemeris.chain'
import { LruCache } from './lrucache'
import { type ObservingReasonCode, type ObservingTargetRef, type PlannerEphemerisProvenance, type PlanningNight, type ResolvedTarget, SEARCH_STEP_DAYS } from './observingplanner.astronomy'
import type { ObservingMinorBodyStore, SavedMinorBody } from './observingplanner.minorbodies.store'
import { ANALYTICAL_STATES, geocentricInterpolation, keplerOrbit, type MinorBodyElements, minorBodyMagnitude } from './sky/ephemeris'
import type { MinorBodies } from './sky/minorbodies'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SsdRequestQueue } from './ssd'

// Trajectories of asteroids and comets for the Observing Planner: one source prepared for a whole night, before the
// synchronous analysis evaluates it, over the fast ephemeris chain (ephemeris.chain.ts): the SPK kernels when they cover
// the body and the Earth at every node of the night, then the two-body Kepler model of the body's osculating elements
// (from SBDB, in memory or saved with a plan), then a geometric vector table of JPL Horizons. Online, SBDB is asked once
// for a body not yet known, for its name, type, photometry, and elements; offline, neither SBDB nor Horizons is asked. A
// source covers the whole night or none of it: nodes of two sources are never mixed.
//
// A trajectory is a grid of geometric geocentric ICRS vectors (AU, no light-time, like the planets of the planner),
// materialized when it is prepared, so evaluating it never reads a kernel, asks JPL, or queries the database, and a
// later change of the kernels cannot touch it. Vectors between nodes are interpolated linearly, and the observer's
// offset is removed at each instant by the night (PlanningNight.topocentric). The grid is 10 minutes, or 1 minute when
// the second differences of the nodes say linear interpolation errs by more than 1″; a body still beyond that, or so
// fast that a 1-minute search step cannot follow it, has no trajectory (trajectoryResolutionExceeded). Times are Unix
// milliseconds (UTC) and angles radians.

// Spacing of the nodes of a trajectory, in milliseconds (10 minutes), and of a fast body's (1 minute).
const COARSE_NODE_MS = 600_000
const FINE_NODE_MS = 60_000

// Largest error of the linear interpolation between nodes a trajectory accepts, in radians (1″): far below what changes
// a window, and the size of the error of the planner's geometry elsewhere.
const INTERPOLATION_TOLERANCE = ASEC2RAD

// Default root-finder step of the visibility search, in milliseconds (SEARCH_STEP_DAYS, 10 minutes).
const DEFAULT_SEARCH_STEP_MS = SEARCH_STEP_DAYS * 86_400_000

// Shortest root-finder step of a fast body, in milliseconds (1 minute).
const MINIMUM_SEARCH_STEP_MS = 60_000

// Largest motion of a body against the stars within one search step, in radians (2.5°): the sky's own rotation within
// the default step, so a body moving no faster changes its altitude at most twice as fast as a fixed star, which the
// search resolves.
const MAXIMUM_MOTION_PER_STEP = 2.5 * DEG2RAD

// Budget of one Horizons vector table, in milliseconds: up to a day of 1-minute rows.
const HORIZONS_VECTORS_TIMEOUT_MS = 20_000

// Prepared trajectories kept in memory.
const TRAJECTORY_CACHE_LIMIT = 32

// Version of the trajectory model: the grid, the interpolation, and the search step; part of the analyses' keys.
export const TRAJECTORY_MODEL_VERSION = 1

// Minor-body target of the planner.
export type MinorBodyTarget = Extract<ObservingTargetRef, { kind: 'minorBody' }>

// Horizons vector-table client; tests pass a mock.
export type HorizonsVectors = typeof horizonsVector

// Why a minor body has no trajectory over the night.
export type MinorBodyUnavailableReason = Extract<ObservingReasonCode, 'orbitalSolutionUnavailable' | 'ephemerisOffline' | 'ephemerisSourceUnavailable' | 'trajectoryResolutionExceeded'>

// Outcome of preparing a minor body for a night: its trajectory ready to analyze with the identity of its source, a body
// SBDB does not know, or a known body without a trajectory, with its name and type when known.
export type MinorBodyPreparation = { readonly kind: 'prepared'; readonly target: ResolvedTarget; readonly revision: string } | { readonly kind: 'unresolved' } | { readonly kind: 'unavailable'; readonly reason: MinorBodyUnavailableReason; readonly name?: string; readonly typeName?: string }

// Dependencies of the minor-body trajectories.
export interface MinorBodyTrajectoriesOptions {
	// SBDB lookups shared with the Sky and Close Approaches.
	readonly minorBodies: Pick<MinorBodies, 'body' | 'cached'>
	// Kernels of the SPICE Kernel Library and the offline switch.
	readonly kernels: { readonly current: () => SpiceKernelSnapshot }
	// Queue of every request of the process to JPL.
	readonly queue: SsdRequestQueue
	// Orbital elements saved with the night plans.
	readonly store: Pick<ObservingMinorBodyStore, 'get'>
	// Horizons vector-table client; the nebulosa adapter by default.
	readonly vectors?: HorizonsVectors
}

// Nodes of a trajectory: the first instant, the spacing, and the number of nodes, all in milliseconds.
interface NodeGrid {
	readonly start: number
	readonly spacing: number
	readonly count: number
}

// Geocentric ICRS vectors of a grid, in AU, x, y, z of each node in turn.
type Nodes = Float64Array

// Nodes of a source on a grid.
interface Trajectory {
	readonly grid: NodeGrid
	readonly nodes: Nodes
}

// What one source of the chain gives a night: its trajectory (undefined when even the fine grid cannot follow the body)
// and what its provenance tells of it.
interface SourceTrajectory {
	readonly trajectory?: Trajectory
	// Kernels the nodes came from, for the SPK source.
	readonly kernelIds?: ReadonlySet<string>
	// Elements of the Kepler model, for the analytical source.
	readonly elements?: KnownMinorBody
}

// Horizons answered a table without every node; a failure of the source, as a network one is, so the chain goes on.
class HorizonsTableIncomplete extends Error {
	// Marks the failure transient for the chain (see horizonsFailureReason).
	readonly code = 'HORIZONS_TABLE_INCOMPLETE'
}

// What is known of a body: its name, type, and elements with their solution.
interface KnownMinorBody {
	readonly name: string
	readonly typeName: string
	readonly elements?: MinorBodyElements
	readonly solutionDate: string
	readonly fetchedAt: number
}

// Name, type, and elements of what SBDB answered for a body, in memory or saved.
function knownOf(saved: SavedMinorBody | undefined): KnownMinorBody | undefined {
	if (!saved) return undefined
	const { body, elements, fetchedAt } = saved
	return { name: body.name, typeName: body.orbitClass || (body.kind === 'comet' ? 'Comet' : 'Asteroid'), elements, solutionDate: body.solutionDate, fetchedAt }
}

// Grid of a spacing covering the night of a planning night, from the node at or before its start to the one at or after
// its end.
function gridOf(night: PlanningNight, spacing: number): NodeGrid {
	const start = Math.floor(night.night.sun.start / spacing) * spacing
	const end = Math.ceil(night.night.sun.end / spacing) * spacing
	return { start, spacing, count: (end - start) / spacing + 1 }
}

// Linear interpolation of the vectors of a grid over Unix milliseconds; an instant outside the grid extends its first or
// last interval. Returns a new vector.
function interpolate(nodes: Nodes, grid: NodeGrid): (time: number) => Vec3 {
	return (time) => {
		const x = (time - grid.start) / grid.spacing
		const i = Math.min(Math.max(Math.floor(x), 0), grid.count - 2)
		const f = x - i
		const a = 3 * i
		const b = a + 3
		return [nodes[a] + (nodes[b] - nodes[a]) * f, nodes[a + 1] + (nodes[b + 1] - nodes[a + 1]) * f, nodes[a + 2] + (nodes[b + 2] - nodes[a + 2]) * f]
	}
}

// Largest angular error of the linear interpolation between the nodes of a grid, in radians: a quarter of the second
// difference at each inner node over its distance, the error at the middle of an interval of a smooth curve.
function interpolationError(nodes: Nodes, count: number) {
	let error = 0

	for (let i = 1; i < count - 1; i++) {
		const a = 3 * (i - 1)
		const b = a + 3
		const c = b + 3
		const dx = nodes[a] - 2 * nodes[b] + nodes[c]
		const dy = nodes[a + 1] - 2 * nodes[b + 1] + nodes[c + 1]
		const dz = nodes[a + 2] - 2 * nodes[b + 2] + nodes[c + 2]
		const distance = Math.hypot(nodes[b], nodes[b + 1], nodes[b + 2])
		error = Math.max(error, Math.hypot(dx, dy, dz) / 8 / distance)
	}

	return error
}

// Highest topocentric angular rate of a direction between consecutive nodes of a grid, in radians per minute.
function highestRate(night: PlanningNight, directionAt: (time: ReturnType<PlanningNight['time']>) => Vec3, grid: NodeGrid) {
	const minutes = grid.spacing / 60_000
	let previous = directionAt(night.time(grid.start))
	let rate = 0

	for (let i = 1; i < grid.count; i++) {
		const current = directionAt(night.time(grid.start + i * grid.spacing))
		rate = Math.max(rate, vecAngle(previous, current) / minutes)
		previous = current
	}

	return rate
}

// Root-finder step of a body moving at a rate (radians per minute), in whole minutes as milliseconds: the default step,
// shortened so the body moves no more than MAXIMUM_MOTION_PER_STEP within it; undefined when even the shortest step is
// too long.
function searchStepOf(rate: number) {
	const motion = rate * (DEFAULT_SEARCH_STEP_MS / 60_000)
	if (motion <= MAXIMUM_MOTION_PER_STEP) return DEFAULT_SEARCH_STEP_MS
	const step = Math.floor((DEFAULT_SEARCH_STEP_MS * MAXIMUM_MOTION_PER_STEP) / motion / 60_000) * 60_000
	return step >= MINIMUM_SEARCH_STEP_MS ? step : undefined
}

// Geocentric vectors of a grid from the SPK kernels: the body minus the Earth, both resolved to the barycenter at every
// node, adding the kernels used. Throws EphemerisKernelMiss when a node is not covered.
function spkNodes(set: SpkKernelSet, code: number, grid: NodeGrid, kernels: Set<string>): Nodes {
	const nodes = new Float64Array(3 * grid.count)

	for (let i = 0; i < grid.count; i++) {
		const time = timeUnix((grid.start + i * grid.spacing) / 1000, true)
		const body = set.stateAt(code, time)
		const earth = set.stateAt(399, time)
		if (!body.ok) throw new EphemerisKernelMiss(code, body.body, body.reason, time)
		if (!earth.ok) throw new EphemerisKernelMiss(code, earth.body, earth.reason, time)
		for (const id of body.kernels) kernels.add(id)
		for (const id of earth.kernels) kernels.add(id)
		for (let k = 0; k < 3; k++) nodes[3 * i + k] = body.state[0][k] - earth.state[0][k]
	}

	return nodes
}

// Geocentric vectors of a grid from a Kepler orbit: its heliocentric position plus the geocentric Sun.
function keplerNodes(orbit: KeplerOrbit, sun: (time: number) => Vec3, grid: NodeGrid): Nodes {
	const nodes = new Float64Array(3 * grid.count)

	for (let i = 0; i < grid.count; i++) {
		const time = grid.start + i * grid.spacing
		const heliocentric = orbit.at(timeUnix(time / 1000, true))[0]
		const center = sun(time)
		for (let k = 0; k < 3; k++) nodes[3 * i + k] = heliocentric[k] + center[k]
	}

	return nodes
}

// Nodes of a source on the coarse grid of a night, or on the fine one when the coarse interpolation errs beyond the
// tolerance; undefined when the fine one does too.
function refined(night: PlanningNight, nodesOf: (grid: NodeGrid) => Nodes): Trajectory | undefined {
	for (const spacing of [COARSE_NODE_MS, FINE_NODE_MS]) {
		const grid = gridOf(night, spacing)
		const nodes = nodesOf(grid)
		if (interpolationError(nodes, grid.count) <= INTERPOLATION_TOLERANCE) return { grid, nodes }
	}

	return undefined
}

// Prepares the trajectories of minor bodies over the nights of the planner, with a cache of the prepared ones.
export class MinorBodyTrajectories {
	readonly #vectors: HorizonsVectors
	readonly #cache = new LruCache<MinorBodyPreparation>(TRAJECTORY_CACHE_LIMIT)
	// Circuit breaker of the Horizons vector tables.
	readonly #breaker = new HorizonsCircuitBreaker()

	// Creates the service over its dependencies.
	constructor(readonly options: MinorBodyTrajectoriesOptions) {
		this.#vectors = options.vectors ?? horizonsVector
	}

	// Prepares a minor body for a night over the fast ephemeris chain, with the kernels and the offline switch read once. A
	// trajectory is cached by the body, the night, the kernel generation and the offline switch, and the answers of SBDB it
	// may use; a body without a trajectory is not, so its sources are tried again next time. Rejects only when `signal`
	// aborts.
	async prepare(target: MinorBodyTarget, night: PlanningNight, signal?: AbortSignal): Promise<MinorBodyPreparation> {
		const snapshot = this.options.kernels.current()
		const saved = this.options.store.get(target.spkId)
		const cached = this.options.minorBodies.cached(target.spkId)
		const key = JSON.stringify([target.spkId, night.key, snapshot.offline, snapshot.generation, saved?.fetchedAt ?? 0, cached?.fetchedAt ?? 0])
		const hit = this.#cache.get(key)
		if (hit) return hit

		const preparation = await this.#prepare(target, night, snapshot, saved, cached, signal)
		if (preparation.kind === 'prepared') this.#cache.set(key, preparation)
		return preparation
	}

	// Prepares a minor body as prepare() describes, without the cache: the body is first known from what SBDB answered
	// (asked now when online and nothing is known), then the chain gives its trajectory.
	async #prepare(target: MinorBodyTarget, night: PlanningNight, snapshot: SpiceKernelSnapshot, saved: SavedMinorBody | undefined, cached: SavedMinorBody | undefined, signal?: AbortSignal): Promise<MinorBodyPreparation> {
		let known = knownOf(cached ?? saved)
		// Whether SBDB answered that it does not know the body, so Horizons is not asked either.
		let unresolved = false

		if (!known && !snapshot.offline) {
			try {
				const resolved = await this.options.minorBodies.body(target.spkId, signal)
				if (resolved) known = knownOf(resolved)
				else unresolved = true
			} catch (error) {
				if (signal?.aborted) throw error
			}
		}

		const code = Number(target.spkId)
		const orbit = known?.elements && keplerOrbit(known.elements)

		try {
			const { results, provenance } = await computeEphemeris<SourceTrajectory, SourceTrajectory>({
				kernels: snapshotKernels(snapshot),
				mode: 'fast',
				signal,
				breaker: this.#breaker,
				sources: {
					bodies: [
						{ name: target.spkId, naif: code },
						{ name: '399', naif: 399, dependency: true },
					],
					spk: (set) => {
						const kernelIds = new Set<string>()
						return { trajectory: refined(night, (grid) => spkNodes(set, code, grid, kernelIds)), kernelIds }
					},
					analytical: () => {
						if (!orbit) return undefined
						// The Sun of the theories, interpolated hourly, so a 1-minute grid costs no more VSOP87E evaluations than a
						// 10-minute one.
						const sun = geocentricInterpolation(ANALYTICAL_STATES.sun, ANALYTICAL_STATES)
						return { trajectory: refined(night, (grid) => keplerNodes(orbit, sun, grid)), elements: known }
					},
					...(!unresolved && { horizons: async (horizonsSignal) => ({ trajectory: await this.#horizonsTrajectory(target.spkId, night, horizonsSignal) }) }),
					kernelsOf: (source) => [...(source.kernelIds ?? [])],
				},
				compute: (source) => source,
			})

			const { trajectory, elements } = results[0]
			const orbitOf = elements && { orbitEpoch: elements.elements?.epoch, solutionDate: elements.solutionDate, elementsFetchedAt: elements.fetchedAt }
			return this.#prepared(target, night, known, trajectory, { source: provenance.source, mode: provenance.mode, attempts: provenance.attempts, approximate: provenance.source === 'analytical', ...(provenance.kernels && { kernels: provenance.kernels }), ...orbitOf })
		} catch (error) {
			if (!(error instanceof EphemerisUnavailableError)) throw error
			if (unresolved) return { kind: 'unresolved' }
			if (known && !orbit) return this.#unavailable('orbitalSolutionUnavailable', known)
			return this.#unavailable(error.code === 'offline' ? 'ephemerisOffline' : 'ephemerisSourceUnavailable', known)
		}
	}

	// Trajectory of a body from Horizons vector tables: the coarse grid, and the fine one when the coarse interpolation
	// errs beyond the tolerance; undefined when the fine one does too.
	async #horizonsTrajectory(spkId: string, night: PlanningNight, signal?: AbortSignal): Promise<Trajectory | undefined> {
		for (const spacing of [COARSE_NODE_MS, FINE_NODE_MS]) {
			const grid = gridOf(night, spacing)
			const nodes = await this.#horizonsNodes(spkId, grid, signal)
			if (interpolationError(nodes, grid.count) <= INTERPOLATION_TOLERANCE) return { grid, nodes }
		}

		return undefined
	}

	// Trajectory ready to analyze from its nodes and its source, with the search step its motion needs; unavailable when
	// the nodes or the step cannot follow the body.
	#prepared(target: MinorBodyTarget, night: PlanningNight, known: KnownMinorBody | undefined, trajectory: Trajectory | undefined, source: Omit<PlannerEphemerisProvenance, 'nodeSpacingMs' | 'searchStepMs'>): MinorBodyPreparation {
		if (!trajectory) return this.#unavailable('trajectoryResolutionExceeded', known)
		const directionAt = night.topocentric(interpolate(trajectory.nodes, trajectory.grid))
		const motion = highestRate(night, directionAt, trajectory.grid)
		const searchStepMs = searchStepOf(motion)
		if (searchStepMs === undefined) return this.#unavailable('trajectoryResolutionExceeded', known)

		const ephemeris: PlannerEphemerisProvenance = { ...source, nodeSpacingMs: trajectory.grid.spacing, searchStepMs }
		const elements = known?.elements
		const magnitude = elements && ((sunToBody: Vec3, observerToBody: Vec3) => minorBodyMagnitude(elements, sunToBody, observerToBody))
		const resolved: ResolvedTarget = { ref: target, name: known?.name ?? target.designation, typeName: known?.typeName, directionAt, step: searchStepMs / 86_400_000, magnitude, ephemeris, motion }
		return { kind: 'prepared', target: resolved, revision: JSON.stringify([TRAJECTORY_MODEL_VERSION, ephemeris, elements?.h, elements?.g, elements?.m1, elements?.k1]) }
	}

	// A known body without a trajectory, with its name and type when known.
	#unavailable(reason: MinorBodyUnavailableReason, known: KnownMinorBody | undefined): MinorBodyPreparation {
		return { kind: 'unavailable', reason, name: known?.name, typeName: known?.typeName }
	}

	// Geocentric vectors of a grid from a Horizons vector table (geometric, ICRF equator, centered on the Earth), asked in a
	// turn of the JPL queue and shared with identical requests. Rejects with HorizonsTableIncomplete when the table does
	// not cover every node.
	async #horizonsNodes(spkId: string, grid: NodeGrid, signal?: AbortSignal): Promise<Nodes> {
		const { queue } = this.options
		const end = grid.start + (grid.count - 1) * grid.spacing
		const options = { stepSize: grid.spacing / 60_000, stepSizeUnit: 'm', referencePlane: 'FRAME', vectorCorrection: 'NONE', outputUnits: 'AU-D', headers: queue.headers } as const
		const rows = await queue.run((taskSignal) => this.#vectors(`DES=${spkId};`, '500@399', false, grid.start, end, options, taskSignal), { timeoutMs: HORIZONS_VECTORS_TIMEOUT_MS, signal, key: `horizons:vectors:${spkId}:${grid.start}:${grid.spacing}:${grid.count}` })
		if (rows.length < grid.count) throw new HorizonsTableIncomplete(`Horizons answered ${rows.length} of ${grid.count} vectors`)
		const nodes = new Float64Array(3 * grid.count)

		for (let i = 0; i < grid.count; i++) {
			const row = rows[i]
			nodes[3 * i] = +row[2]
			nodes[3 * i + 1] = +row[3]
			nodes[3 * i + 2] = +row[4]
		}

		return nodes
	}
}
