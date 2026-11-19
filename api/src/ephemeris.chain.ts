import type { SpkKernelSet, SpkMissReason } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { EphemerisMiss } from 'nebulosa/src/astronomy/ephemeris/source'
import { type Time, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { errorResponse } from './http'
import type { SpiceKernelSnapshot } from './spicekernels.runtime'
import { SsdBusyError, SsdThrottledError } from './ssd'
import { yieldToEventLoop } from './util'

// The ephemeris chain of the server: every computation of solar-system positions takes all its states from one source,
// tried in the order of its mode. The fast mode (dense sweeps, maps, planners, events) tries the SPK kernels of the SPICE
// Kernel Library, then the analytical theories, then JPL Horizons; the accurate mode (pointing, the selected object)
// tries the kernels, then Horizons, then the theories. The offline switch of the ephemeris sources removes Horizons, so
// a computation no other source can give fails. A computation offers only the sources it can use (no Horizons for a
// dense sweep, no theory for a minor body without elements), and a source it does not offer is skipped silently. A
// source that cannot give the whole computation (a kernel state missing at one epoch, Horizons timing out) is recorded
// as an attempt with its reason, and the computation runs whole on the next source, so sources are never mixed. The
// kernel snapshot is read once per computation; a long computation runs in chunks that yield to the event loop and
// restart when the kernel generation changes, at most GENERATION_RESTARTS times. Times are Unix milliseconds.

// How a computation trades accuracy and latency: fast never waits on the network when the kernels or a theory can give
// the computation; accurate asks Horizons before the theories.
export type EphemerisMode = 'fast' | 'accurate'

// A source of the chain: the SPK kernels, the analytical theories (VSOP87E, ELPMPP02, L1.2, TASS 1.7, Kepler orbits of
// osculating elements), or JPL Horizons.
export type EphemerisSourceKind = 'spk' | 'analytical' | 'horizons'

// Why the kernels did not give a computation: still loading at the start of the server, none enabled, a requested body
// or a body it depends on absent, an epoch outside the segments or in a gap, a selected segment of an unsupported frame
// or data type, a center chain that never ends, or a file that could not be read.
export type EphemerisKernelReason = 'loading' | 'noKernel' | 'targetMissing' | 'missingCenter' | 'outOfCoverage' | 'unsupportedFrame' | 'unsupportedType' | 'cycle' | 'kernelReadFailed'

// Why Horizons did not give a computation: the offline switch forbids it, it timed out (or the JPL queue refused the
// request), it could not be reached, or its circuit breaker skips it after repeated failures.
export type EphemerisHorizonsReason = 'offline' | 'timeout' | 'network' | 'breakerOpen'

// Why a source of the chain did not give a computation; noModel when no theory exists for the target.
export type EphemerisSkipReason = EphemerisKernelReason | 'noModel' | EphemerisHorizonsReason

// A source tried before the one that gave a computation, or every source of a failed one.
export interface EphemerisAttempt {
	readonly source: EphemerisSourceKind
	readonly reason: EphemerisSkipReason
	// Name of the requested body the kernels missed, as the computation names it.
	readonly target?: string
	// NAIF code of the body where the kernel resolution stopped: the target or one of its centers.
	readonly body?: number
	// Epoch the kernels could not resolve, Unix milliseconds; absent when no epoch was evaluated.
	readonly time?: number
}

// Kernels a computation took its states from.
export interface EphemerisKernelsUsed {
	// Generation of the kernel set of the SPICE Kernel Library.
	readonly generation: number
	// Ids of the kernels whose segments were used.
	readonly kernelIds: readonly string[]
}

// Where the states of a computation came from.
export interface EphemerisProvenance {
	readonly source: EphemerisSourceKind
	readonly mode: EphemerisMode
	// Sources tried before, in the order of the chain; empty when the first source offered gave the computation.
	readonly attempts: readonly EphemerisAttempt[]
	// Kernels of a computation on the SPK kernels.
	readonly kernels?: EphemerisKernelsUsed
}

// Order of the sources of each mode.
export const EPHEMERIS_ORDER: Readonly<Record<EphemerisMode, readonly EphemerisSourceKind[]>> = {
	fast: ['spk', 'analytical', 'horizons'],
	accurate: ['spk', 'horizons', 'analytical'],
}

// Restarts allowed when the kernel generation changes during a chunked computation on the kernels.
const GENERATION_RESTARTS = 2

// Live kernel snapshots of the SPICE Kernel Library, with the offline switch.
export interface EphemerisKernels {
	readonly current: () => SpiceKernelSnapshot
}

// Snapshot without kernels, online.
const NO_KERNELS_SNAPSHOT: SpiceKernelSnapshot = { generation: 0, offline: false, loading: false, readiness: new Map() }

// Kernels of the callers without the SPICE Kernel Library: none, online.
export const NO_EPHEMERIS_KERNELS: EphemerisKernels = { current: () => NO_KERNELS_SNAPSHOT }

// Kernels of a snapshot already read, for the parts of a computation that must not read the library again.
export function snapshotKernels(snapshot: SpiceKernelSnapshot): EphemerisKernels {
	return { current: () => snapshot }
}

// Stable codes of a computation no source of its chain could give: offline when Horizons was the source left and the
// offline switch forbids it, sourceUnavailable when Horizons failed, the kernel codes when the kernels were the only
// source offered, and generationChanged when the kernels kept changing during the computation.
export type EphemerisUnavailableCode = 'offline' | 'sourceUnavailable' | 'coverageUnavailable' | 'missingDependency' | 'unsupportedKernel' | 'generationChanged'

// No source of the chain could give a computation; attempts says why each one did not.
export class EphemerisUnavailableError extends Error {
	// Creates the error with its code and the attempts of the chain.
	constructor(
		message: string,
		readonly code: EphemerisUnavailableCode,
		readonly attempts: readonly EphemerisAttempt[],
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = 'EphemerisUnavailableError'
	}
}

// The 503 answer of a computation no source could give, with its code and attempts.
export function ephemerisUnavailableResponse(error: EphemerisUnavailableError): Response {
	return errorResponse(error.message, 503, error.code, { attempts: error.attempts })
}

// Consecutive-failure circuit breaker of Horizons: after threshold transient failures, Horizons is skipped for openMs; a
// success closes it. Shared by every computation that asks Horizons.
export class HorizonsCircuitBreaker {
	#failures = 0
	#openUntil = 0

	// Creates the breaker over a clock in milliseconds.
	constructor(
		private readonly now: () => number = Date.now,
		readonly threshold: number = 3,
		readonly openMs: number = 30_000,
	) {}

	// Whether Horizons is skipped now; an expired window closes the breaker.
	isOpen() {
		if (this.#openUntil === 0) return false
		if (this.now() < this.#openUntil) return true
		this.#openUntil = 0
		this.#failures = 0
		return false
	}

	// Records a successful Horizons request.
	recordSuccess() {
		this.#failures = 0
		this.#openUntil = 0
	}

	// Records a transient Horizons failure.
	recordFailure() {
		if (++this.#failures >= this.threshold && this.#openUntil === 0) this.#openUntil = this.now() + this.openMs
	}
}

// Whether the JPL queue refused a request, which says nothing about Horizons.
export function isQueueRefusal(error: unknown) {
	return error instanceof SsdBusyError || error instanceof SsdThrottledError
}

// Why a Horizons failure is transient, so the chain goes on: a queue refusal or a timeout, or a network failure;
// undefined for a semantic failure (an unknown target, an empty answer), which is rethrown.
export function horizonsFailureReason(error: unknown): 'timeout' | 'network' | undefined {
	if (isQueueRefusal(error)) return 'timeout'
	if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'timeout'
	if (error instanceof TypeError) return 'network'
	if (error instanceof Error && 'code' in error) return 'network'
	return undefined
}

// Reason of a kernel miss: a missing requested body, a missing body it depends on, or the kind of the miss.
export function kernelReason(reason: SpkMissReason, target: boolean): EphemerisKernelReason {
	if (reason === 'missing') return target ? 'targetMissing' : 'missingCenter'
	if (reason === 'coverage') return 'outOfCoverage'
	if (reason === 'frame') return 'unsupportedFrame'
	if (reason === 'dataType') return 'unsupportedType'
	return 'cycle'
}

// A body a computation needs from the kernels.
export interface EphemerisBody {
	// Name the computation gives it, reported in attempts.
	readonly name: string
	// NAIF code.
	readonly naif: number
	// Whether it is needed only to reduce the requested ones (the Earth and the Sun of an apparent place), so its absence
	// is a missing center rather than a missing target.
	readonly dependency?: boolean
}

// What a computation is told about the source it runs on.
export interface EphemerisContext {
	readonly source: EphemerisSourceKind
	readonly snapshot: SpiceKernelSnapshot
	// Part of the keys of results computed on this source: analytical, horizons, or spk with the kernel generation.
	readonly key: string
}

// The sources a computation offers, each building the ephemeris E its chunks evaluate. A source left out is not offered.
export interface EphemerisSources<E> {
	// Bodies the kernels must have, checked before the kernels are tried.
	readonly bodies?: readonly EphemerisBody[]
	// Ephemeris over the kernel set; its evaluations throw EphemerisMiss (or what miss classifies) at an epoch the
	// kernels do not resolve. It may throw a miss itself, after probing the kernels.
	readonly spk?: (set: SpkKernelSet, snapshot: SpiceKernelSnapshot) => E
	// Ephemeris of the theories; undefined when there is no theory for the target.
	readonly analytical?: () => E | undefined
	// Ephemeris from Horizons, fetched before the computation; rejects with a transient failure (timeout, network) or a
	// semantic one, which is rethrown.
	readonly horizons?: (signal: AbortSignal | undefined) => Promise<E>
	// Classifies a kernel miss thrown by the SPK ephemeris other than EphemerisMiss; undefined for any other error.
	readonly miss?: (error: unknown) => EphemerisAttempt | undefined
	// Ids of the kernels the SPK ephemeris used, read after the computation.
	readonly kernelsOf?: (ephemeris: E) => readonly string[]
}

// A computation over the chain: chunks evaluations of compute on the ephemeris of one source.
export interface EphemerisComputation<E, T> {
	readonly kernels: EphemerisKernels
	readonly mode: EphemerisMode
	readonly sources: EphemerisSources<E>
	// Evaluates one chunk; must evaluate only the bodies of the sources.
	readonly compute: (ephemeris: E, index: number, context: EphemerisContext) => T
	// Number of chunks, 1 by default; the event loop runs between them.
	readonly chunks?: number
	readonly signal?: AbortSignal
	// Circuit breaker of Horizons, consulted and fed when the computation offers Horizons.
	readonly breaker?: HorizonsCircuitBreaker
}

// Results of a computation, the source they came from, and the snapshot it read.
export interface EphemerisOutcome<T> {
	readonly results: readonly T[]
	readonly provenance: EphemerisProvenance
	readonly snapshot: SpiceKernelSnapshot
}

// Key of the results of a source.
function contextOf(source: EphemerisSourceKind, snapshot: SpiceKernelSnapshot): EphemerisContext {
	return { source, snapshot, key: source === 'spk' ? `spk:${snapshot.generation}` : source }
}

// Why the kernels of snapshot cannot be tried for sources, or undefined when every body has a segment.
function kernelSkip(sources: Pick<EphemerisSources<unknown>, 'bodies'>, snapshot: SpiceKernelSnapshot): EphemerisAttempt | undefined {
	if (snapshot.loading) return { source: 'spk', reason: 'loading' }
	if (!snapshot.set) return { source: 'spk', reason: 'noKernel' }
	const missing = sources.bodies?.find((body) => !snapshot.set!.bodies.has(body.naif))
	return missing && { source: 'spk', reason: missing.dependency ? 'missingCenter' : 'targetMissing', target: missing.name, body: missing.naif }
}

// The attempt of a failure of a computation on the kernels, or undefined when error must be rethrown. A failure that is
// not a miss (a file that cannot be read) is logged and goes on to the next source. A miss of a body the sources name
// reports it by that name.
function kernelFailure(error: unknown, sources: Pick<EphemerisSources<unknown>, 'miss' | 'bodies'>, signal: AbortSignal | undefined): EphemerisAttempt | undefined {
	if (signal?.aborted || error instanceof EphemerisUnavailableError) return undefined

	const classified = sources.miss?.(error)
	if (classified) return classified

	if (error instanceof EphemerisMiss && error.reason !== 'noModel') {
		const target = sources.bodies?.find((body) => body.naif === error.target)?.name
		return { source: 'spk', reason: kernelReason(error.reason, error.body === error.target), ...(target && { target }), body: error.body, time: timeToUnixMillis(error.time) }
	}

	console.error('An SPK kernel could not be read; the next ephemeris source is used', error)
	return { source: 'spk', reason: 'kernelReadFailed' }
}

// Provenance of a computation given by source after attempts.
function provenanceOf<E>(source: EphemerisSourceKind, mode: EphemerisMode, attempts: readonly EphemerisAttempt[], snapshot: SpiceKernelSnapshot, sources: Pick<EphemerisSources<E>, 'kernelsOf'>, ephemeris: E): EphemerisProvenance {
	const kernels = source === 'spk' ? { generation: snapshot.generation, kernelIds: sources.kernelsOf?.(ephemeris) ?? [] } : undefined
	return { source, mode, attempts, ...(kernels && { kernels }) }
}

// The error of a computation no source could give: offline or sourceUnavailable when Horizons was offered, else the code
// of the kernels' reason.
function unavailable(attempts: readonly EphemerisAttempt[]): EphemerisUnavailableError {
	const described = attempts.map((attempt) => `${attempt.source} (${attempt.reason})`).join(', ')
	const message = attempts.length > 0 ? `No ephemeris source can give this computation: ${described}` : 'No ephemeris source is offered for this computation'
	const horizons = attempts.find((attempt) => attempt.source === 'horizons')
	if (horizons) return new EphemerisUnavailableError(message, horizons.reason === 'offline' ? 'offline' : 'sourceUnavailable', attempts)
	const kernels = attempts.find((attempt) => attempt.source === 'spk')
	const reason = kernels?.reason
	const code = reason === 'outOfCoverage' || reason === 'targetMissing' ? 'coverageUnavailable' : reason === 'unsupportedFrame' || reason === 'unsupportedType' ? 'unsupportedKernel' : 'missingDependency'
	return new EphemerisUnavailableError(message, code, attempts)
}

// Runs a computation over the chain of its mode and returns its results with the source that gave them; rejects with
// EphemerisUnavailableError when no source can, and rethrows semantic Horizons failures, the failures of the theories,
// and aborts.
export async function computeEphemeris<E, T>(computation: EphemerisComputation<E, T>): Promise<EphemerisOutcome<T>> {
	const { kernels, mode, sources, compute, signal, breaker } = computation
	const chunks = computation.chunks ?? 1
	let restarts = 0

	attempt: while (true) {
		const snapshot = kernels.current()
		const attempts: EphemerisAttempt[] = []

		// Runs every chunk on one ephemeris, yielding and checking the signal between chunks.
		const run = async (ephemeris: E, context: EphemerisContext, kernelGeneration?: number) => {
			const results: T[] = []

			for (let i = 0; i < chunks; i++) {
				if (i > 0) {
					await yieldToEventLoop()
					signal?.throwIfAborted()
					if (kernelGeneration !== undefined && kernels.current().generation !== kernelGeneration) return undefined
				}

				results.push(compute(ephemeris, i, context))
			}

			return results
		}

		for (const source of EPHEMERIS_ORDER[mode]) {
			if (source === 'spk') {
				if (!sources.spk) continue
				const skip = kernelSkip(sources, snapshot)

				if (skip) {
					attempts.push(skip)
					continue
				}

				try {
					const ephemeris = sources.spk(snapshot.set!, snapshot)
					const results = await run(ephemeris, contextOf('spk', snapshot), snapshot.generation)

					if (!results) {
						if (++restarts > GENERATION_RESTARTS) throw new EphemerisUnavailableError('The SPK kernels kept changing during the computation', 'generationChanged', attempts)
						continue attempt
					}

					return { results, snapshot, provenance: provenanceOf('spk', mode, attempts, snapshot, sources, ephemeris) }
				} catch (error) {
					const failure = kernelFailure(error, sources, signal)
					if (!failure) throw error
					attempts.push(failure)
				}
			} else if (source === 'analytical') {
				if (!sources.analytical) continue
				const ephemeris = sources.analytical()

				if (ephemeris === undefined) {
					attempts.push({ source: 'analytical', reason: 'noModel' })
					continue
				}

				const results = (await run(ephemeris, contextOf('analytical', snapshot)))!
				return { results, snapshot, provenance: provenanceOf('analytical', mode, attempts, snapshot, sources, ephemeris) }
			} else {
				if (!sources.horizons) continue

				if (snapshot.offline) {
					attempts.push({ source: 'horizons', reason: 'offline' })
					continue
				}

				if (breaker?.isOpen()) {
					attempts.push({ source: 'horizons', reason: 'breakerOpen' })
					continue
				}

				let ephemeris: E

				try {
					ephemeris = await sources.horizons(signal)
					breaker?.recordSuccess()
				} catch (error) {
					if (signal?.aborted) throw error
					const reason = horizonsFailureReason(error)
					if (reason === undefined) throw error
					if (!isQueueRefusal(error)) breaker?.recordFailure()
					attempts.push({ source: 'horizons', reason })
					continue
				}

				const results = (await run(ephemeris, contextOf('horizons', snapshot)))!
				return { results, snapshot, provenance: provenanceOf('horizons', mode, attempts, snapshot, sources, ephemeris) }
			}
		}

		throw unavailable(attempts)
	}
}

// Runs a computation of one chunk that offers no Horizons synchronously, as computeEphemeris does, for the routes that
// answer synchronously. The kernel snapshot is read once.
export function computeEphemerisSync<E, T>(computation: Omit<EphemerisComputation<E, T>, 'chunks' | 'signal' | 'breaker' | 'sources'> & { readonly sources: Omit<EphemerisSources<E>, 'horizons'> }): { readonly result: T; readonly provenance: EphemerisProvenance; readonly snapshot: SpiceKernelSnapshot } {
	const { kernels, mode, sources, compute } = computation
	const snapshot = kernels.current()
	const attempts: EphemerisAttempt[] = []

	for (const source of EPHEMERIS_ORDER[mode]) {
		if (source === 'spk') {
			if (!sources.spk) continue
			const skip = kernelSkip(sources, snapshot)

			if (skip) {
				attempts.push(skip)
				continue
			}

			try {
				const ephemeris = sources.spk(snapshot.set!, snapshot)
				const result = compute(ephemeris, 0, contextOf('spk', snapshot))
				return { result, snapshot, provenance: provenanceOf('spk', mode, attempts, snapshot, sources, ephemeris) }
			} catch (error) {
				const failure = kernelFailure(error, sources, undefined)
				if (!failure) throw error
				attempts.push(failure)
			}
		} else if (source === 'analytical') {
			if (!sources.analytical) continue
			const ephemeris = sources.analytical()

			if (ephemeris === undefined) {
				attempts.push({ source: 'analytical', reason: 'noModel' })
				continue
			}

			const result = compute(ephemeris, 0, contextOf('analytical', snapshot))
			return { result, snapshot, provenance: provenanceOf('analytical', mode, attempts, snapshot, sources, ephemeris) }
		}
	}

	throw unavailable(attempts)
}
