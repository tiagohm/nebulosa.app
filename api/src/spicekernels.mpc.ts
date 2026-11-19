import { type MPCOrbitSolution, orbitCartesianState, orbitToKeplerOrbit } from 'nebulosa/src/adapters/orbits/mpc'
import { SPK_FRAME_J2000, spkSeconds } from 'nebulosa/src/astronomy/ephemeris/kernels/spk'
import type { SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { writeSpk } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.write'
import { EphemerisMiss, spkEphemerisSource } from 'nebulosa/src/astronomy/ephemeris/source'
import { DE440_PERTURBERS, type NonGravitationalParameters, type PointMassPerturber, SB441_N16_PERTURBERS, SmallBodyPropagator } from 'nebulosa/src/astronomy/orbits/propagation/nbody'
import type { Time } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, DAYSEC } from 'nebulosa/src/core/constants'

// Small-body SPK files integrated on this server from MPC Orbit Database solutions: the heliocentric Cartesian state of a
// solution (`mpc_orb`) is integrated through the toolkit's SmallBodyPropagator over the planetary kernels of the SPICE
// Kernel Library, with the DE440 point masses, the SB441-N16 asteroids the library holds, the Sun's post-Newtonian term,
// and the non-gravitational acceleration of the solution, and its accepted steps are written as one type 9 segment of the
// body relative to the Sun, as Horizons small-body kernels are. The integration yields to the event loop between chunks of
// steps and stops when its signal aborts; it reads the kernel set synchronously within each chunk, so the caller keeps the
// set open until the promise settles.

// Degree of the Lagrange interpolation of the written states.
const DEGREE = 11
// Largest motion relative to any perturber per accepted step, as a fraction of their distance. With DEGREE, the written
// table interpolates the integrated trajectory within meters, and within a few kilometers through a deep planetary flyby
// such as (99942) Apophis in 2029.
const RELATIVE_STEP = 0.05
// Largest accepted step, days.
const MAX_STEP = 32
// Fewest states the written interval holds, so a short interval still fills several interpolation windows.
const MIN_STATES = 4 * (DEGREE + 1)
// Accepted steps integrated between two yields to the event loop.
const CHUNK_STEPS = 64
// Margin, in seconds, within which a step is taken as the bound of the interval it lands on.
const BOUND_MARGIN = 1e-3
// Offset from the extended NAIF code of a numbered asteroid (20000000 + number) to its code in SB441-N16 (2000000 + number).
const SB441_CODE_OFFSET = 18_000_000

// Why an MPC solution could not be integrated: it has no heliocentric Cartesian state (a natural satellite or an
// unpublished frame), or the kernels miss a planetary body somewhere in the integrated span.
export type MpcKernelFailure = 'unsupportedOrbit' | 'missingDependency'

// Failure of an integration, with its reason and, for a missing dependency, the NAIF codes of the bodies.
export class MpcKernelError extends Error {
	// Creates the error.
	constructor(
		message: string,
		readonly reason: MpcKernelFailure,
		readonly bodies: readonly number[] = [],
	) {
		super(message)
	}
}

// An integrated kernel and how it was made.
export interface MpcKernel {
	// The SPK file: one type 9 segment of the target relative to the Sun, J2000.
	readonly bytes: Uint8Array
	// Osculating epoch of the solution, as published (TT or TDB).
	readonly epoch: Time
	// Asteroids of SB441-N16 the force model included.
	readonly asteroids: number
	// Non-gravitational acceleration of the solution, when it has one.
	readonly nonGravitational?: NonGravitationalParameters
	// Ids of the kernels whose segments gave the perturbers.
	readonly kernelIds: readonly string[]
	// States written.
	readonly states: number
}

// Integrates `solution` over [start, end] and writes it as the SPK segment of `target` (its NAIF code, the canonical SBDB
// SPK-ID) named `name` (printable ASCII, up to 40 characters). `set` must resolve the DE440 bodies (the Sun, the Mercury
// and Venus barycenters, the Earth, the Moon, and the other planetary barycenters) over the span from the epoch of the
// solution to both ends of the interval; each SB441-N16 asteroid it resolves there joins the force model, except the
// target itself. Rejects with MpcKernelError, or with the reason of `signal` when it aborts.
export async function integrateMpcKernel(solution: MPCOrbitSolution, target: number, name: string, start: Time, end: Time, set: SpkKernelSet, signal: AbortSignal): Promise<MpcKernel> {
	const state = orbitCartesianState(solution)
	const kepler = orbitToKeplerOrbit(solution)
	if (!state || !kepler) throw new MpcKernelError('The MPC solution has no heliocentric Cartesian state.', 'unsupportedOrbit')

	const epoch = state.epoch
	const probes = [start, end, epoch]
	const missing = DE440_PERTURBERS.filter((e) => probes.some((t) => !set.stateAt(e.naif, t).ok)).map((e) => e.naif)
	if (missing.length > 0) throw new MpcKernelError(`The kernels do not provide ${missing.join(', ')} over the integrated span.`, 'missingDependency', missing)

	const asteroids = asteroidPerturbers(set, probes, target)
	const source = spkEphemerisSource(set)
	const model = { perturbers: [...DE440_PERTURBERS, ...asteroids], relativity: true, nonGravitational: state.nonGravitational }

	// The heliocentric ICRF state of the solution (the Kepler orbit rotates its ecliptic state) moved to the barycenter.
	const [position, velocity] = kepler.at(epoch)
	const [sun, sunVelocity] = source.state(10, epoch)
	const barycentric = [position[0] + sun[0], position[1] + sun[1], position[2] + sun[2]] as const
	const barycentricVelocity = [velocity[0] + sunVelocity[0], velocity[1] + sunVelocity[1], velocity[2] + sunVelocity[2]] as const

	const first = spkSeconds(start)
	const last = spkSeconds(end)
	const origin = spkSeconds(epoch)
	const maxStep = Math.min(MAX_STEP, (last - first) / DAYSEC / MIN_STATES)
	const backward: number[][] = []
	const forward: number[][] = []

	// Records a state within the interval, relative to the Sun of the source: seconds past J2000, km, km/s.
	function record(table: number[][]) {
		return (t: Time, y: ArrayLike<number>) => {
			const seconds = spkSeconds(t)
			if (seconds < first - BOUND_MARGIN || seconds > last + BOUND_MARGIN) return
			const [p, v] = source.state(10, t)
			table.push([seconds, (y[0] - p[0]) * AU_KM, (y[1] - p[1]) * AU_KM, (y[2] - p[2]) * AU_KM, ((y[3] - v[0]) * AU_KM) / DAYSEC, ((y[4] - v[1]) * AU_KM) / DAYSEC, ((y[5] - v[2]) * AU_KM) / DAYSEC])
		}
	}

	try {
		if (origin >= first - BOUND_MARGIN && origin <= last + BOUND_MARGIN) record(forward)(epoch, [...barycentric, ...barycentricVelocity])

		if (last > origin) {
			const propagator = new SmallBodyPropagator(source, model, epoch, barycentric, barycentricVelocity, { maxStep, maxRelativeStep: RELATIVE_STEP, onStep: record(forward) })
			if (first > origin) await drive(propagator, start, signal)
			await drive(propagator, end, signal)
		}

		if (first < origin) {
			const propagator = new SmallBodyPropagator(source, model, epoch, barycentric, barycentricVelocity, { maxStep, maxRelativeStep: RELATIVE_STEP, onStep: record(backward) })
			if (last < origin) await drive(propagator, end, signal)
			await drive(propagator, start, signal)
		}
	} catch (error) {
		if (error instanceof EphemerisMiss) throw new MpcKernelError(`The kernels do not provide ${error.body} at an instant of the integrated span.`, 'missingDependency', [error.body])
		throw error
	}

	const rows = [...backward.toReversed(), ...forward]
	const epochs: number[] = []
	const states: number[] = []

	for (const row of rows) {
		// The epoch and an interval bound can each be recorded by both legs.
		if (epochs.length > 0 && !(row[0] > epochs.at(-1)!)) continue
		epochs.push(row[0])
		for (let i = 1; i < 7; i++) states.push(row[i])
	}

	const bytes = writeSpk([{ target, center: 10, frame: SPK_FRAME_J2000, name, degree: DEGREE, epochs: Float64Array.from(epochs), states: Float64Array.from(states) }], 'NEBULOSA MPC INTEGRATION')
	const kernelIds = new Set<string>()
	for (const ids of source.kernelsByBody.values()) for (const id of ids) kernelIds.add(id)

	return { bytes, epoch, asteroids: asteroids.length, nonGravitational: state.nonGravitational, kernelIds: [...kernelIds], states: epochs.length }
}

// SB441-N16 asteroids `set` resolves at every probe, each by its SB441-N16 code or, failing it, by the extended code of a
// Horizons kernel, without the target.
function asteroidPerturbers(set: SpkKernelSet, probes: readonly Time[], target: number) {
	const perturbers: PointMassPerturber[] = []

	for (const perturber of SB441_N16_PERTURBERS) {
		const extended = perturber.naif + SB441_CODE_OFFSET
		if (target === extended || target === perturber.naif) continue
		const naif = [perturber.naif, extended].find((code) => probes.every((t) => set.stateAt(code, t).ok))
		if (naif !== undefined) perturbers.push({ naif, gm: perturber.gm })
	}

	return perturbers
}

// Advances `propagator` to `target` in chunks of steps, yielding to the event loop between them.
async function drive(propagator: SmallBodyPropagator, target: Time, signal: AbortSignal) {
	signal.throwIfAborted()

	while (!propagator.advance(target, CHUNK_STEPS)) {
		await new Promise<void>((resolve) => {
			setImmediate(resolve)
		})
		signal.throwIfAborted()
	}
}
