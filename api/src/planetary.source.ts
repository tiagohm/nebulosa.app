import type { SpkKernelSet, SpkMissReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import type { SatelliteEphemerisMiss } from 'nebulosa/src/astronomy/ephemeris/satellites'
import { type Time, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { errorResponse } from './http'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

// Source orchestration shared by the planetary satellite planners (Jupiter, Saturn): every computation takes all its
// states from one source chosen once, the kernels of the SPICE Kernel Library when they resolve every body the
// computation needs, else the analytical theories, unless the ephemeris policy is spkOnly, which fails instead. A kernel
// miss in the middle of a computation discards it and reruns it whole from the theories, so sources are never mixed;
// Horizons is never asked. Long computations run in chunks that yield to the event loop, check their abort signal and
// re-read the kernel snapshot, restarting when its generation changed so no closed kernel is ever read, at most
// GENERATION_RESTARTS times. A planner describes its system with a SatelliteSourceConfig and chooses the bodies of each
// computation, so a ring-only computation of Saturn needs neither a satellite kernel nor a satellite theory. Times are
// Unix milliseconds (UTC).

// Why the analytical theories were used instead of the kernels:
// - noKernel: no kernel is enabled; loading: the kernels are still being opened at the start of the server;
// - targetMissing: no kernel has a required body; missingCenter: a body is relative to a center no kernel has;
// - outOfCoverage: an epoch falls outside the segments or in a gap;
// - unsupportedFrame or unsupportedType: the selected segment cannot be evaluated; cycle: a center chain never ends.
export type PlanetaryFallbackReason = 'noKernel' | 'loading' | 'targetMissing' | 'missingCenter' | 'outOfCoverage' | 'unsupportedFrame' | 'unsupportedType' | 'cycle'

// The kernel state that could not be resolved.
export interface PlanetarySourceMiss<B extends string> {
	// Body requested.
	readonly target: B
	// NAIF code of the body of the chain where resolution stopped.
	readonly body: number
	// Epoch that could not be resolved, Unix milliseconds; absent when no epoch was evaluated.
	readonly time?: number
}

// Source of the states of a computation: the analytical theories described by `A` with why the kernels were not used,
// or the kernels with the ids that supplied each body.
export type PlanetarySource<B extends string, A extends object> =
	| (A & {
			// Why the kernels were not used.
			readonly fallbackReason: PlanetaryFallbackReason
			// The state the kernels could not resolve, when one was tried.
			readonly miss?: PlanetarySourceMiss<B>
	  })
	| {
			readonly kind: 'spk'
			// Ids of the kernels that supplied each body.
			readonly kernels: Readonly<Partial<Record<B, readonly string[]>>>
	  }

// Thrown when the ephemeris policy is spkOnly and the kernels cannot give a whole computation, or when the kernel set
// kept changing during one. Each planner throws its own subclass through its SatelliteSourceConfig.
export class PlanetarySourceUnavailableError<B extends string = string> extends Error {
	constructor(
		message: string,
		readonly reason: PlanetaryFallbackReason | 'generationChanged',
		readonly miss?: PlanetarySourceMiss<B>,
	) {
		super(message)
	}
}

// Live kernel snapshots of the SPICE Kernel Library.
export interface PlanetaryKernels {
	readonly current: () => SpiceKernelSnapshot
}

// An ephemeris whose positions a readiness probe can evaluate.
interface Evaluable<B extends string> {
	readonly position: (body: B, time: Time) => unknown
}

// How a planner's satellite system is evaluated from either source.
export interface SatelliteSourceConfig<B extends string, E extends Evaluable<B>, A extends object> {
	// NAIF code of each body.
	readonly naif: Readonly<Record<B, number>>
	// The analytical ephemeris, which never fails.
	readonly analytical: E
	// Description of the analytical theories, copied into an analytical source.
	readonly analyticalSource: A
	// Builds the ephemeris over a kernel set, recording the files that supplied each body.
	readonly spk: (set: SpkKernelSet) => E & { readonly kernelsByBody: ReadonlyMap<B, ReadonlySet<string>> }
	// Class of the miss the SPK ephemeris throws.
	readonly miss: abstract new (...args: never[]) => SatelliteEphemerisMiss<B>
	// Builds the planner's error for an unavailable source.
	readonly unavailable: (reason: PlanetaryFallbackReason | 'generationChanged', miss?: PlanetarySourceMiss<B>) => PlanetarySourceUnavailableError<B>
}

// Result of a computation and the source it used.
export interface SourcedResult<B extends string, A extends object, T> {
	readonly results: readonly T[]
	readonly source: PlanetarySource<B, A>
	readonly snapshot: SpiceKernelSnapshot
}

// Restarts allowed when the kernel generation changes during a computation.
const GENERATION_RESTARTS = 2

// Yields to the event loop.
export function yieldToEventLoop() {
	return new Promise<void>((resolve) => {
		setImmediate(resolve)
	})
}

// Toolkit instant of a Unix time in milliseconds.
export function toolkitTime(time: number): Time {
	return timeUnix(time / 1000, true)
}

// Fallback reason of a kernel miss: a missing requested body is a missing target, a missing link of its chain a missing center.
export function missReason<B extends string>(naif: Readonly<Record<B, number>>, miss: SatelliteEphemerisMiss<B>): PlanetaryFallbackReason {
	const reason: SpkMissReason = miss.reason
	if (reason === 'missing') return miss.body === naif[miss.target] ? 'targetMissing' : 'missingCenter'
	if (reason === 'coverage') return 'outOfCoverage'
	if (reason === 'frame') return 'unsupportedFrame'
	if (reason === 'dataType') return 'unsupportedType'
	return 'cycle'
}

// Why a snapshot cannot even be tried for `bodies`, or undefined when its set has a segment for each of them.
export function snapshotReason<B extends string>(naif: Readonly<Record<B, number>>, bodies: readonly B[], snapshot: SpiceKernelSnapshot): { readonly reason: PlanetaryFallbackReason; readonly miss?: PlanetarySourceMiss<B> } | undefined {
	if (snapshot.loading) return { reason: 'loading' }
	if (!snapshot.set) return { reason: 'noKernel' }
	const target = bodies.find((body) => !snapshot.set!.bodies.has(naif[body]))
	return target === undefined ? undefined : { reason: 'targetMissing', miss: { target, body: naif[target] } }
}

// Kernel ids that supplied each body of an SPK ephemeris.
function kernelsOf<B extends string>(kernelsByBody: ReadonlyMap<B, ReadonlySet<string>>): Partial<Record<B, readonly string[]>> {
	const kernels: Partial<Record<B, readonly string[]>> = {}
	for (const [body, ids] of kernelsByBody) kernels[body] = [...ids]
	return kernels
}

// Runs `count` chunks of a computation with one source for all of them, yielding to the event loop and checking `signal`
// between chunks. The kernels are tried first when they have a segment for every body of `bodies`; a miss in any chunk
// discards the kernel results and reruns every chunk from the analytical theories, or throws the planner's
// PlanetarySourceUnavailableError under spkOnly. A kernel computation restarts from the first chunk when the kernel
// generation changed during a yield, at most GENERATION_RESTARTS times. `wrap`, when given, wraps the chosen ephemeris
// (an interpolator for dense sampling); a single instant is evaluated directly. `chunk` must evaluate only `bodies`.
export async function withSatelliteSource<B extends string, E extends Evaluable<B>, A extends object, T>(
	kernels: PlanetaryKernels,
	config: SatelliteSourceConfig<B, E, A>,
	bodies: readonly B[],
	count: number,
	chunk: (ephemeris: E, index: number) => T,
	wrap?: (ephemeris: E) => E,
	signal?: AbortSignal,
): Promise<SourcedResult<B, A, T>> {
	let restarts = 0

	attempts: while (true) {
		const snapshot = kernels.current()
		let fallback = snapshotReason(config.naif, bodies, snapshot)

		if (fallback === undefined) {
			const spk = config.spk(snapshot.set!)
			const ephemeris = wrap ? wrap(spk) : spk
			const results: T[] = []

			try {
				for (let i = 0; i < count; i++) {
					if (i > 0) {
						await yieldToEventLoop()
						signal?.throwIfAborted()

						if (kernels.current().generation !== snapshot.generation) {
							if (++restarts > GENERATION_RESTARTS) throw config.unavailable('generationChanged')
							continue attempts
						}
					}

					results.push(chunk(ephemeris, i))
				}

				return { results, source: { kind: 'spk', kernels: kernelsOf(spk.kernelsByBody) }, snapshot }
			} catch (error) {
				if (!(error instanceof config.miss)) throw error
				fallback = { reason: missReason(config.naif, error), miss: { target: error.target, body: error.body, time: timeToUnixMillis(error.time) } }
			}
		}

		if (snapshot.policy === 'spkOnly') throw config.unavailable(fallback.reason, fallback.miss)

		const ephemeris = wrap ? wrap(config.analytical) : config.analytical
		const results: T[] = []

		for (let i = 0; i < count; i++) {
			if (i > 0) {
				await yieldToEventLoop()
				signal?.throwIfAborted()
			}

			results.push(chunk(ephemeris, i))
		}

		return { results, source: { ...config.analyticalSource, fallbackReason: fallback.reason, ...(fallback.miss && { miss: fallback.miss }) }, snapshot }
	}
}

// Readiness of the kernels for a computation over a range:
// - ready: every required body resolves at every probe;
// - partialCoverage: some probe falls outside the segments or in a gap;
// - unsupported: a selected segment cannot be evaluated;
// - missingDependencies: no kernel, a missing body or center, a cycle, or the kernels still loading.
export type PlanetaryKernelReadiness = 'ready' | 'partialCoverage' | 'unsupported' | 'missingDependencies'

// Readiness of the kernels and the source a computation over a range would use.
export interface PlanetaryReadinessReport<B extends string> {
	readonly readiness: PlanetaryKernelReadiness
	// Source a computation would use: the kernels, the theories, or none under spkOnly.
	readonly source: 'spk' | 'analytical' | 'unavailable'
	// Why the kernels are not ready; absent when they are.
	readonly reason?: PlanetaryFallbackReason
	// First state the kernels could not resolve.
	readonly miss?: PlanetarySourceMiss<B>
	readonly policy: SpiceEphemerisPolicy
	readonly generation: number
	// Number of probed epochs (evenly spaced over the range, both ends included).
	readonly probes: number
}

// Shortest spacing of the readiness probes, milliseconds: 6 hours.
const PROBE_STEP_MS = 6 * 3_600_000

// Most probes of one readiness report, so a multi-decade range stays cheap.
const MAX_PROBES = 2000

// Probes the kernels over [start, end] for `bodies`: every body every 6 hours, or at most MAX_PROBES evenly spaced
// epochs for a long range, both ends included. Not a guarantee for a scan, which evaluates many more epochs, but an
// explanation of what the kernels lack.
export function kernelReadiness<B extends string, E extends Evaluable<B>, A extends object>(config: SatelliteSourceConfig<B, E, A>, bodies: readonly B[], snapshot: SpiceKernelSnapshot, start: number, end: number): PlanetaryReadinessReport<B> {
	const { policy, generation } = snapshot
	const unready = (readiness: PlanetaryKernelReadiness, reason: PlanetaryFallbackReason, probes: number, miss?: PlanetarySourceMiss<B>): PlanetaryReadinessReport<B> => ({ readiness, source: policy === 'spkOnly' ? 'unavailable' : 'analytical', reason, ...(miss && { miss }), policy, generation, probes })
	const fallback = snapshotReason(config.naif, bodies, snapshot)
	if (fallback) return unready('missingDependencies', fallback.reason, 0, fallback.miss)

	const ephemeris = config.spk(snapshot.set!)
	const step = Math.max(PROBE_STEP_MS, Math.ceil((end - start) / (MAX_PROBES - 1)))
	let probes = 0

	for (let time = start; ; time = Math.min(end, time + step)) {
		probes++

		for (const body of bodies) {
			try {
				ephemeris.position(body, toolkitTime(time))
			} catch (error) {
				if (!(error instanceof config.miss)) throw error
				const reason = missReason(config.naif, error)
				const readiness = reason === 'outOfCoverage' ? 'partialCoverage' : reason === 'unsupportedFrame' || reason === 'unsupportedType' ? 'unsupported' : 'missingDependencies'
				return unready(readiness, reason, probes, { target: error.target, body: error.body, time })
			}
		}

		if (time >= end) break
	}

	return { readiness: 'ready', source: 'spk', policy, generation, probes }
}

// Stable codes of a 503 answer of an unavailable source: the kernels lack coverage, a dependency, or support for a
// segment under spkOnly, or the kernel set kept changing during the computation.
export type PlanetarySourceErrorCode = 'coverageUnavailable' | 'missingDependency' | 'unsupportedKernel' | 'generationChanged'

// The 503 answer of an unavailable source, with its code, reason and the state it lacked.
export function unavailableResponse(error: PlanetarySourceUnavailableError): Response {
	const code: PlanetarySourceErrorCode = error.reason === 'generationChanged' ? 'generationChanged' : error.reason === 'outOfCoverage' ? 'coverageUnavailable' : error.reason === 'unsupportedFrame' || error.reason === 'unsupportedType' ? 'unsupportedKernel' : 'missingDependency'
	return errorResponse(error.message, 503, code, { reason: error.reason, ...(error.miss && { miss: error.miss }) })
}
