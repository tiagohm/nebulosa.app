import { vector as horizonsVector } from 'nebulosa/src/adapters/ephemeris/horizons'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { ASEC2RAD, DEG2RAD } from 'nebulosa/src/core/constants'
import { type Vec3, vecAngle } from 'nebulosa/src/math/linear-algebra/vec3'
import { LruCache } from './lrucache'
import { type ObservingReasonCode, type ObservingTargetRef, type PlannerEphemerisProvenance, type PlanningNight, type ResolvedTarget, SEARCH_STEP_DAYS } from './observingplanner.astronomy'
import type { ObservingMinorBodyStore, SavedMinorBody } from './observingplanner.minorbodies.store'
import { keplerOrbit, type MinorBodyElements, minorBodyMagnitude } from './sky/ephemeris'
import type { MinorBodies } from './sky/minorbodies'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import { SsdBusyError, type SsdRequestQueue, SsdThrottledError } from './ssd'

// Trajectories of asteroids and comets for the Observing Planner: one source prepared for a whole night, before the
// synchronous analysis evaluates it. The source follows the ephemeris policy of the SPICE Kernel Library: the SPK
// kernels when they cover the body and the Earth at every node of the night; then, under the automatic policy, a
// geometric vector table of JPL Horizons, and the two-body Kepler model of the SBDB elements when Horizons fails; under
// the offline policy, the Kepler model of elements already read (in memory or saved with a plan); under spkOnly,
// nothing else. A source covers the whole night or none of it: nodes of two sources are never mixed.
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
export type MinorBodyUnavailableReason = Extract<ObservingReasonCode, 'orbitalSolutionUnavailable' | 'kernelCoverageUnavailable' | 'ephemerisOffline' | 'ephemerisSourceUnavailable' | 'trajectoryResolutionExceeded'>

// Outcome of preparing a minor body for a night: its trajectory ready to analyze with the identity of its source, a body
// SBDB does not know, or a known body without a trajectory, with its name and type when known.
export type MinorBodyPreparation = { readonly kind: 'prepared'; readonly target: ResolvedTarget; readonly revision: string } | { readonly kind: 'unresolved' } | { readonly kind: 'unavailable'; readonly reason: MinorBodyUnavailableReason; readonly name?: string; readonly typeName?: string }

// Dependencies of the minor-body trajectories.
export interface MinorBodyTrajectoriesOptions {
	// SBDB lookups shared with the Sky and Close Approaches.
	readonly minorBodies: Pick<MinorBodies, 'body' | 'cached'>
	// Kernels of the SPICE Kernel Library and its ephemeris policy.
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

// A kernel set does not cover a node of the body or the Earth.
class SpkNodesMiss extends Error {}

// A kernel of the set could not be read: the kernels are broken, which is reported rather than replaced by another source.
class SpkReadFailure extends Error {}

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

// Why a failed Horizons request fell back to the Kepler model: the JPL queue refused or the request ran out of time, or
// Horizons could not be reached or answered without the table.
function fallbackReasonOf(error: unknown): 'timeout' | 'network' {
	if (error instanceof SsdBusyError || error instanceof SsdThrottledError) return 'timeout'
	return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network'
}

// Geocentric vectors of a grid from the SPK kernels: the body minus the Earth, both resolved to the barycenter at every
// node, and the kernels used. Throws SpkNodesMiss when a node is not covered and SpkReadFailure when a kernel cannot be
// read.
function spkNodes(snapshot: SpiceKernelSnapshot, code: number, grid: NodeGrid, kernels: Set<string>): Nodes {
	const set = snapshot.set
	if (!set?.bodies.has(code)) throw new SpkNodesMiss(`no kernel has the body ${code}`)
	const nodes = new Float64Array(3 * grid.count)

	for (let i = 0; i < grid.count; i++) {
		const time = timeUnix((grid.start + i * grid.spacing) / 1000, true)
		let body: ReturnType<typeof set.stateAt>
		let earth: ReturnType<typeof set.stateAt>

		try {
			body = set.stateAt(code, time)
			earth = set.stateAt(399, time)
		} catch (error) {
			throw new SpkReadFailure(`a kernel could not be read: ${Error.isError(error) ? error.message : String(error)}`, { cause: error })
		}

		if (!body.ok) throw new SpkNodesMiss(`the kernels do not cover ${body.body} (${body.reason})`)
		if (!earth.ok) throw new SpkNodesMiss(`the kernels do not cover ${earth.body} (${earth.reason})`)
		for (const id of body.kernels) kernels.add(id)
		for (const id of earth.kernels) kernels.add(id)
		for (let k = 0; k < 3; k++) nodes[3 * i + k] = body.state[0][k] - earth.state[0][k]
	}

	return nodes
}

// Geocentric vectors of the Sun (VSOP87E) every COARSE_NODE_MS over a night, interpolated for any grid of it, so a
// 1-minute Kepler grid costs no more evaluations of the analytical model than a 10-minute one.
function sunGeocentric(night: PlanningNight): (time: number) => Vec3 {
	const grid = gridOf(night, COARSE_NODE_MS)
	const nodes = new Float64Array(3 * grid.count)

	for (let i = 0; i < grid.count; i++) {
		const time = timeUnix((grid.start + i * grid.spacing) / 1000, true)
		const sun = vsop.sun(time)[0]
		const earth = vsop.earth(time)[0]
		for (let k = 0; k < 3; k++) nodes[3 * i + k] = sun[k] - earth[k]
	}

	return interpolate(nodes, grid)
}

// Prepares the trajectories of minor bodies over the nights of the planner, with a cache of the prepared ones.
export class MinorBodyTrajectories {
	readonly #vectors: HorizonsVectors
	readonly #cache = new LruCache<MinorBodyPreparation>(TRAJECTORY_CACHE_LIMIT)

	// Creates the service over its dependencies.
	constructor(readonly options: MinorBodyTrajectoriesOptions) {
		this.#vectors = options.vectors ?? horizonsVector
	}

	// Prepares a minor body for a night by the ephemeris policy of the SPICE Kernel Library, read once. A trajectory is
	// cached by the body, the night, the kernel generation and policy, and the answers of SBDB it may use; a Kepler
	// trajectory that replaced a failed Horizons request is not, so Horizons is asked again next time. Rejects only when
	// `signal` aborts.
	async prepare(target: MinorBodyTarget, night: PlanningNight, signal?: AbortSignal): Promise<MinorBodyPreparation> {
		const snapshot = this.options.kernels.current()
		const saved = this.options.store.get(target.spkId)
		const cached = this.options.minorBodies.cached(target.spkId)
		const key = JSON.stringify([target.spkId, night.key, snapshot.policy, snapshot.generation, saved?.fetchedAt ?? 0, cached?.fetchedAt ?? 0])
		const hit = this.#cache.get(key)
		if (hit) return hit

		const preparation = await this.#prepare(target, night, snapshot, saved, cached, signal)
		const fallback = preparation.kind === 'prepared' && (preparation.target.ephemeris!.fallbackReason === 'timeout' || preparation.target.ephemeris!.fallbackReason === 'network')
		if (preparation.kind === 'prepared' && !fallback) this.#cache.set(key, preparation)
		return preparation
	}

	// Prepares a minor body as prepare() describes, without the cache.
	async #prepare(target: MinorBodyTarget, night: PlanningNight, snapshot: SpiceKernelSnapshot, saved: SavedMinorBody | undefined, cached: SavedMinorBody | undefined, signal?: AbortSignal): Promise<MinorBodyPreparation> {
		let known = knownOf(cached ?? saved)

		if (snapshot.set) {
			const kernels = new Set<string>()

			try {
				const grid = (spacing: number) => {
					const nodes = gridOf(night, spacing)
					return { grid: nodes, nodes: spkNodes(snapshot, Number(target.spkId), nodes, kernels) }
				}

				const trajectory = await this.#refined(grid)
				if (!known && snapshot.policy === 'automatic') known = await this.#lookup(target, signal)
				return this.#prepared(target, night, known, trajectory, { source: 'spk', approximate: false, kernels: { generation: snapshot.generation, kernelIds: [...kernels] } })
			} catch (error) {
				if (error instanceof SpkReadFailure) return this.#unavailable('kernelCoverageUnavailable', known)
				if (!(error instanceof SpkNodesMiss)) throw error
			}
		}

		if (snapshot.policy === 'spkOnly') return this.#unavailable('kernelCoverageUnavailable', known)

		if (snapshot.policy === 'offline') {
			if (!known) return this.#unavailable('ephemerisOffline', known)
			return this.#kepler(target, night, known, 'offline')
		}

		let resolved: SavedMinorBody | undefined

		try {
			resolved = await this.options.minorBodies.body(target.spkId, signal)
			if (!resolved) return { kind: 'unresolved' }
			known = knownOf(resolved)
		} catch (error) {
			if (signal?.aborted) throw error
		}

		try {
			const grid = async (spacing: number) => {
				const nodes = gridOf(night, spacing)
				return { grid: nodes, nodes: await this.#horizonsNodes(target.spkId, nodes, signal) }
			}

			return this.#prepared(target, night, known, await this.#refined(grid), { source: 'horizons', approximate: false })
		} catch (error) {
			if (signal?.aborted) throw error
			if (!known) return this.#unavailable('ephemerisSourceUnavailable', known)
			return this.#kepler(target, night, known, fallbackReasonOf(error))
		}
	}

	// What SBDB answers for a body, for its name, type, and photometry; undefined when it does not know it or cannot be
	// reached. Rejects only when `signal` aborts.
	async #lookup(target: MinorBodyTarget, signal?: AbortSignal) {
		try {
			return knownOf(await this.options.minorBodies.body(target.spkId, signal))
		} catch (error) {
			if (signal?.aborted) throw error
			return undefined
		}
	}

	// Kepler trajectory of the elements of a known body, approximate, stating why it was used.
	async #kepler(target: MinorBodyTarget, night: PlanningNight, known: KnownMinorBody, fallbackReason: PlannerEphemerisProvenance['fallbackReason']): Promise<MinorBodyPreparation> {
		const orbit = known.elements && keplerOrbit(known.elements)
		if (!orbit) return this.#unavailable('orbitalSolutionUnavailable', known)
		const sun = sunGeocentric(night)

		const grid = (spacing: number) => {
			const nodes = gridOf(night, spacing)
			const vectors = new Float64Array(3 * nodes.count)

			for (let i = 0; i < nodes.count; i++) {
				const time = nodes.start + i * nodes.spacing
				const heliocentric = orbit.at(timeUnix(time / 1000, true))[0]
				const center = sun(time)
				for (let k = 0; k < 3; k++) vectors[3 * i + k] = heliocentric[k] + center[k]
			}

			return { grid: nodes, nodes: vectors }
		}

		return this.#prepared(target, night, known, await this.#refined(grid), { source: 'kepler', approximate: true, fallbackReason, orbitEpoch: known.elements?.epoch, solutionDate: known.solutionDate, elementsFetchedAt: known.fetchedAt })
	}

	// Nodes of a source on the coarse grid, or on the fine one when the coarse interpolation errs beyond the tolerance;
	// undefined when the fine one does too.
	async #refined(nodesOf: (spacing: number) => { readonly grid: NodeGrid; readonly nodes: Nodes } | Promise<{ readonly grid: NodeGrid; readonly nodes: Nodes }>) {
		for (const spacing of [COARSE_NODE_MS, FINE_NODE_MS]) {
			const trajectory = await nodesOf(spacing)
			if (interpolationError(trajectory.nodes, trajectory.grid.count) <= INTERPOLATION_TOLERANCE) return trajectory
		}

		return undefined
	}

	// Trajectory ready to analyze from its nodes and its source, with the search step its motion needs; unavailable when
	// the nodes or the step cannot follow the body.
	#prepared(target: MinorBodyTarget, night: PlanningNight, known: KnownMinorBody | undefined, trajectory: { readonly grid: NodeGrid; readonly nodes: Nodes } | undefined, source: Omit<PlannerEphemerisProvenance, 'nodeSpacingMs' | 'searchStepMs'>): MinorBodyPreparation {
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
	// turn of the JPL queue and shared with identical requests. Rejects when the table does not cover every node.
	async #horizonsNodes(spkId: string, grid: NodeGrid, signal?: AbortSignal): Promise<Nodes> {
		const { queue } = this.options
		const end = grid.start + (grid.count - 1) * grid.spacing
		const options = { stepSize: grid.spacing / 60_000, stepSizeUnit: 'm', referencePlane: 'FRAME', vectorCorrection: 'NONE', outputUnits: 'AU-D', headers: queue.headers } as const
		const rows = await queue.run((taskSignal) => this.#vectors(`DES=${spkId};`, '500@399', false, grid.start, end, options, taskSignal), { timeoutMs: HORIZONS_VECTORS_TIMEOUT_MS, signal, key: `horizons:vectors:${spkId}:${grid.start}:${grid.spacing}:${grid.count}` })
		if (rows.length < grid.count) throw new Error(`Horizons answered ${rows.length} of ${grid.count} vectors`)
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
