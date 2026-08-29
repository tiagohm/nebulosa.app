import { observer as horizonsObserver } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { Quantity } from 'nebulosa/src/adapters/ephemeris/horizons'
import { planetMagnitude } from 'nebulosa/src/astronomy/bodies/photometry'
import type { Planet } from 'nebulosa/src/astronomy/bodies/photometry'
import { observeStar } from 'nebulosa/src/astronomy/bodies/star'
import { equatorial, icrsToObserved, lightTime, phaseAngle, topocentricDirection } from 'nebulosa/src/astronomy/coordinates/astrometry'
import type { PositionAndVelocity, PositionAndVelocityOverTime } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { cirsToObserved } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { CONSTELLATION_LIST } from 'nebulosa/src/astronomy/coordinates/constellation'
import { equatorialFromJ2000, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { eraS2p } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { frameToFrame, ICRS, ITRS, TEME } from 'nebulosa/src/astronomy/coordinates/frame'
import { itrs } from 'nebulosa/src/astronomy/coordinates/itrs'
import { linearInterpolator } from 'nebulosa/src/astronomy/ephemeris/interpolation/ephemeris'
import * as elpmpp02 from 'nebulosa/src/astronomy/ephemeris/models/analytical/elpmpp02'
import * as gust86 from 'nebulosa/src/astronomy/ephemeris/models/analytical/gust86'
import * as l12 from 'nebulosa/src/astronomy/ephemeris/models/analytical/l12'
import * as marssat from 'nebulosa/src/astronomy/ephemeris/models/analytical/marssat'
import { pluto } from 'nebulosa/src/astronomy/ephemeris/models/analytical/pluto'
import * as tass17 from 'nebulosa/src/astronomy/ephemeris/models/analytical/tass17'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { asteroidMagnitudeEstimate, cometMagnitudeEstimate } from 'nebulosa/src/astronomy/formulas'
import type { GeographicCoordinate, GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { asteroid, comet, KeplerOrbit } from 'nebulosa/src/astronomy/orbits/asteroid'
import { parseTLE, sgp4 } from 'nebulosa/src/astronomy/orbits/propagation/sgp4'
import { formatTemporal, parseTemporal, temporalAdd, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Temporal } from 'nebulosa/src/astronomy/time/temporal'
import { time, timeShift, timeUnix, Timescale, toJulianEpoch } from 'nebulosa/src/astronomy/time/time'
import type { Time } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, GM_SUN_PITJEVA_2005, ONE_KILOPARSEC, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import type { Writable } from 'nebulosa/src/core/types'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import type { CsvRow } from 'nebulosa/src/io/csv'
import { vecAngle, vecLength } from 'nebulosa/src/math/linear-algebra/vec3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { lerp } from 'nebulosa/src/math/numerical/math'
import { brentRoot } from 'nebulosa/src/math/numerical/optimization'
import { normalizeAngle, normalizePI, parseAngle, toDeg } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { OsculatingElementsInput } from '#/asteroid'
import { resolveBodyPositionFlags } from '#/atlas'
import type { BodyPosition, BodyPositionFlags, EphemerisFallbackReason, EphemerisSource, PositionOfBody } from '#/atlas'
import type { SkyObject } from '#/galaxy'
import { coordinateInfo } from '#/mount'
import type { Satellite } from '#/satellite'
import { abortReasonOf, makeTime, settleWithSignal } from './util'

// Atlas ephemeris service: provider selection, Horizons observer-table tiles, and local models
// (VSOP87E, ELPMPP02, Meeus Pluto, MARSSAT/L12/TASS17/GUST86, SGP4, Kepler, stars, sky points).
// `fast` prefers a local model when one exists; otherwise Horizons. Distances are AU, angles
// radians, instants Unix milliseconds. Horizons is still sampled every 60 s over local noon-to-noon;
// position at an off-grid utc interpolates apparent RA/Dec (unwrap) and scalars, and does not
// extrapolate. Cheap offline position is evaluated at the requested utc. BodyPositionFlags skip
// unrequested frames and photometry; omitted flags still yield a complete BodyPosition. Horizons
// observer() is bounded by HORIZONS_TIMEOUT_MS and an AbortSignal; transient failures fall back once
// to a local model when one exists, and a circuit breaker skips Horizons while it is open. Aborting
// one consumer does not cancel a shared in-flight tile still needed by another.

// Maximum number of noon-to-noon Horizons series retained. Each tile is ~1441 samples; eviction is
// LRU by series, not by sample count.
export const ATLAS_EPHEMERIS_CACHE_LIMIT = 64

// Wall-clock budget around one Horizons observer() call. Passed to observer() as AbortSignal.timeout
// and also raced so a mock that ignores the signal still unblocks the pipeline.
export const HORIZONS_TIMEOUT_MS = 5_000

// Consecutive transient Horizons failures that open the circuit breaker.
export const HORIZONS_BREAKER_FAILURE_THRESHOLD = 3

// How long the breaker stays open after the failure threshold, in milliseconds.
export const HORIZONS_BREAKER_OPEN_MS = 30_000

// Open duration for HTTP 429 when Retry-After is absent, in milliseconds.
export const HORIZONS_BREAKER_RETRY_AFTER_MS = 60_000

// Horizons observer-table sampling interval used by this extraction, in seconds.
const HORIZONS_STEP_SIZE_SECONDS = 60

// Apparent visual magnitude of the Sun used by the offline path (Mallama solar constant).
const SUN_VISUAL_MAGNITUDE = -26.74

// Maximum KeplerOrbit instances retained, keyed by the canonical element fingerprint.
const KEPLER_ORBIT_CACHE_LIMIT = 16

// Light-time fixed-point iterations, matching computeSunMoonPositionAt.
const LIGHT_TIME_ITERATIONS = 2

// Horizons COMMAND values for the eight VSOP87E planets. Pluto is not in this set.
export type PlanetHorizonsCode = '199' | '299' | '499' | '599' | '699' | '799' | '899'

// Requested calculation path. `fast` on PositionOfBody maps to `'fast'`; omitted/`false` is `'accurate'`.
export type EphemerisMode = 'fast' | 'accurate'

// Discriminated target. The handler translates route/UI ids; the service does not take opaque strings.
export type EphemerisTarget =
	| { readonly type: 'sun' }
	| { readonly type: 'moon' }
	| { readonly type: 'planet'; readonly code: PlanetHorizonsCode; readonly name: Planet }
	| { readonly type: 'pluto' }
	| { readonly type: 'star'; readonly object: SkyObject }
	| { readonly type: 'skyPoint'; readonly rightAscension: Angle; readonly declination: Angle }
	| { readonly type: 'minorBody'; readonly command?: string; readonly elements?: OsculatingElementsInput }
	| { readonly type: 'satellite'; readonly satellite: Satellite }
	| { readonly type: 'naturalSatellite'; readonly code: string }
	| { readonly type: 'horizons'; readonly command: string }

// Window and sampling of one provider fetch. `start`/`end` are Unix ms; `stepSize` is seconds.
export interface EphemerisSampleRequest {
	readonly target: EphemerisTarget
	readonly location: GeographicCoordinate
	readonly start: number
	readonly end: number
	readonly stepSize: number
	// Which BodyPosition fields to materialize. Omitted flags mean compute everything. Not part of
	// the series cache key; Horizons tiles stay complete and projection applies flags later.
	readonly flags?: BodyPositionFlags
	// Cancels this consumer. A shared Horizons fetch is aborted only when every waiter has aborted.
	readonly signal?: AbortSignal
}

// Cached or freshly computed samples for one physical identity. Keys are Unix seconds (Horizons,
// truncated) or the exact utc ms (star / sky point).
export interface EphemerisSampleSeries {
	readonly key: string
	readonly source: EphemerisSource
	readonly samples: ReadonlyMap<number, BodyPosition>
	// Why Horizons was not used. Set only on an accurate-path fallback to a local model.
	readonly fallbackReason?: EphemerisFallbackReason
}

// First zero of `value` inside a sampled window, after refining the coarse 60 s bracket.
export interface EphemerisCrossing {
	// Crossing instant, Unix milliseconds UTC.
	readonly time: number
	// Chart sample index relative to `origin` (or `start` when origin is omitted), floor of the
	// crossing. Matches the 1441-point noon-to-noon altitude chart.
	readonly index: number
}

// Options for findCrossing. `stepMs` is only used to turn the refined instant into a chart index.
export interface FindCrossingOptions {
	// Chart origin, Unix milliseconds. Defaults to the search `start`.
	readonly origin?: number
	// Chart sample spacing, milliseconds. Defaults to 60_000.
	readonly stepMs?: number
	// Cancels the scan. Checked on each coarse sample pair.
	readonly signal?: AbortSignal
}

// Internal provider. `supports` is a static table, never "try and see if it throws".
export interface EphemerisProvider {
	readonly source: EphemerisSource
	readonly supports: (target: EphemerisTarget) => boolean
	readonly samples: (request: EphemerisSampleRequest) => Promise<EphemerisSampleSeries>
}

// Horizons observer() used by the service. Tests inject a mock so they do not need NASA.
export type HorizonsObserver = typeof horizonsObserver

// Construction options. VSOP/ELP/SGP4 are not injected: they are pure functions.
export interface AtlasEphemerisOptions {
	// Horizons observer-table client. Defaults to the nebulosa adapter.
	readonly observer?: HorizonsObserver
	// Maximum cached series. Defaults to ATLAS_EPHEMERIS_CACHE_LIMIT. Tests pass a smaller cap.
	readonly cacheLimit?: number
	// Horizons provider. Tests inject a mock to assert selection without fetching.
	readonly horizons?: EphemerisProvider
	// Offline provider. Tests inject a mock to assert selection without running models.
	readonly offline?: EphemerisProvider
	// Observer-table timeout in milliseconds. Defaults to HORIZONS_TIMEOUT_MS. Tests pass a shorter budget.
	readonly horizonsTimeoutMs?: number
	// Clock for the circuit breaker. Defaults to Date.now. Tests pass a fake clock.
	readonly now?: () => number
}

// Horizons observer-table target: a COMMAND string or a TLE (id plus line hash is the fingerprint).
export type HorizonsEphemerisInput = string | Omit<Satellite, 'name' | 'groups'>

// Quantities requested from Horizons: astrometric RA/Dec, apparent RA/Dec, Az/El, visual magnitude,
// one-way light-time, illuminated fraction, solar elongation, and constellation.
const HORIZONS_QUANTITIES: readonly Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

// Horizons COMMAND → Mallama/VSOP planet name. `'999'` is Pluto, not in this table.
const PLANET_BY_CODE: Readonly<Record<PlanetHorizonsCode, Planet>> = {
	'199': 'mercury',
	'299': 'venus',
	'499': 'mars',
	'599': 'jupiter',
	'699': 'saturn',
	'799': 'uranus',
	'899': 'neptune',
}

// Natural satellites with a dedicated target type. Offline models are not wired in this phase, so every
// code here is Horizons-only. Other moons in planetary.satellites.json go through `horizons`.
const NATURAL_SATELLITE_CODES: ReadonlySet<string> = new Set(['401', '402', '501', '502', '503', '504', '601', '602', '603', '604', '605', '606', '607', '608', '701', '702', '703', '704', '705', '901', '902', '903', '904', '905'])

// VSOP87E barycentric sampler for each planet COMMAND. Pluto is not in this table.
const VSOP_BY_CODE: Readonly<Record<PlanetHorizonsCode, PositionAndVelocityOverTime>> = {
	'199': vsop.mercury,
	'299': vsop.venus,
	'499': vsop.mars,
	'599': vsop.jupiter,
	'699': vsop.saturn,
	'799': vsop.uranus,
	'899': vsop.neptune,
}

// Planetocentric J2000 sampler plus the parent VSOP planet. 607 is Hyperion, not Iapetus.
const NATURAL_SATELLITE_MODEL: Readonly<Record<string, { readonly moon: PositionAndVelocityOverTime; readonly planet: PositionAndVelocityOverTime }>> = {
	'401': { moon: marssat.phobos, planet: vsop.mars },
	'402': { moon: marssat.deimos, planet: vsop.mars },
	'501': { moon: l12.io, planet: vsop.jupiter },
	'502': { moon: l12.europa, planet: vsop.jupiter },
	'503': { moon: l12.ganymede, planet: vsop.jupiter },
	'504': { moon: l12.callisto, planet: vsop.jupiter },
	'601': { moon: tass17.mimas, planet: vsop.saturn },
	'602': { moon: tass17.enceladus, planet: vsop.saturn },
	'603': { moon: tass17.tethys, planet: vsop.saturn },
	'604': { moon: tass17.dione, planet: vsop.saturn },
	'605': { moon: tass17.rhea, planet: vsop.saturn },
	'606': { moon: tass17.titan, planet: vsop.saturn },
	'607': { moon: tass17.hyperion, planet: vsop.saturn },
	'608': { moon: tass17.iapetus, planet: vsop.saturn },
	'701': { moon: gust86.ariel, planet: vsop.uranus },
	'702': { moon: gust86.umbriel, planet: vsop.uranus },
	'703': { moon: gust86.titania, planet: vsop.uranus },
	'704': { moon: gust86.oberon, planet: vsop.uranus },
	'705': { moon: gust86.miranda, planet: vsop.uranus },
}

// Cached noon-to-noon Horizons samples, keyed by truncated Unix seconds. Entries are frozen.
type HorizonsSampleMap = Map<number, BodyPosition>

// Shared in-flight Horizons tile. `abort` cancels observer() only when `consumers` drops to 0 before
// the promise settles, so one aborted HTTP client does not cancel a fetch still needed by another.
interface HorizonsInflight {
	readonly promise: Promise<HorizonsSampleMap>
	consumers: number
	readonly abort: AbortController
}

// No provider accepted the target.
export class EphemerisUnavailableError extends Error {
	constructor(message = 'ephemeris unavailable', options?: ErrorOptions) {
		super(message, options)
		this.name = 'EphemerisUnavailableError'
	}
}

// Horizons failed in a way that must not be masked by an offline model.
export class HorizonsEphemerisError extends Error {
	constructor(message = 'horizons ephemeris failed', options?: ErrorOptions) {
		super(message, options)
		this.name = 'HorizonsEphemerisError'
	}
}

// Local model is missing or refused the target.
export class OfflineEphemerisUnavailableError extends Error {
	constructor(message = 'offline ephemeris unavailable') {
		super(message)
		this.name = 'OfflineEphemerisUnavailableError'
	}
}

// Interpolation asked for a time outside the sampled tile. Never clamps or extrapolates.
export class EphemerisInterpolationError extends Error {
	constructor(message = 'ephemeris interpolation out of range', options?: ErrorOptions) {
		super(message, options)
		this.name = 'EphemerisInterpolationError'
	}
}

// Horizons observer() exceeded HORIZONS_TIMEOUT_MS. Transient: fallback to offline when a local
// model exists.
export class HorizonsTimeoutError extends Error {
	constructor(message = 'horizons timeout', options?: ErrorOptions) {
		super(message, options)
		this.name = 'HorizonsTimeoutError'
	}
}

// Horizons HTTP failure. 429 and 5xx are transient; other 4xx are semantic and must not be masked
// by an offline model. `retryAfterMs` is honoured by the breaker on 429.
export class HorizonsHttpError extends Error {
	readonly status: number
	readonly retryAfterMs?: number

	constructor(status: number, message = `horizons HTTP ${status}`, options?: ErrorOptions & { retryAfterMs?: number }) {
		super(message, options)
		this.name = 'HorizonsHttpError'
		this.status = status
		this.retryAfterMs = options?.retryAfterMs
	}
}

// Whether a Horizons failure may be retried locally. Transient failures trip the breaker; semantic
// failures (4xx except 429, empty CSV, parse) never fall back to an offline model.
export type HorizonsFailureClass = 'transient' | 'semantic'

// Classifies a rejected Horizons observer() / HTTP / parse failure.
//
// - error: the thrown value; AbortError / TimeoutError / TypeError / ECONNRESET / 429 / 5xx are
//   transient, everything else is semantic (including unknown bugs).
export function classifyHorizonsFailure(error: unknown): HorizonsFailureClass {
	if (error instanceof HorizonsTimeoutError) return 'transient'
	if (error instanceof TypeError) return 'transient'
	if (isAbortOrTimeoutError(error)) return 'transient'
	if (isConnectionError(error)) return 'transient'

	const status = httpStatusOf(error)
	if (status === 429 || (status !== undefined && status >= 500)) return 'transient'
	if (status !== undefined && status >= 400) return 'semantic'
	if (error instanceof HorizonsEphemerisError) return 'semantic'
	return 'semantic'
}

// True when `error` is an AbortError or TimeoutError (DOMException or Error with that name).
function isAbortOrTimeoutError(error: unknown): boolean {
	if (!(error instanceof Error)) return false
	return error.name === 'AbortError' || error.name === 'TimeoutError' || error.name === 'HorizonsTimeoutError'
}

// True when `error` looks like a socket/DNS failure from fetch.
function isConnectionError(error: unknown): boolean {
	if (!(error instanceof Error) || !('code' in error)) return false
	const code = String(error.code)
	return code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN'
}

// HTTP status attached to `error`, if any.
function httpStatusOf(error: unknown): number | undefined {
	if (error instanceof HorizonsHttpError) return error.status
	if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') return error.status
	return undefined
}

// Breaker open duration for a transient failure. 429 uses retryAfterMs or 60 s; other transients
// do not open until HORIZONS_BREAKER_FAILURE_THRESHOLD consecutive failures.
function retryAfterMsOf(error: unknown): number | undefined {
	if (error instanceof HorizonsHttpError && error.retryAfterMs !== undefined) return error.retryAfterMs
	if (error && typeof error === 'object' && 'retryAfterMs' in error && typeof error.retryAfterMs === 'number') return error.retryAfterMs
	if (httpStatusOf(error) === 429) return HORIZONS_BREAKER_RETRY_AFTER_MS
	return undefined
}

// Consecutive-failure circuit breaker for Horizons. Open: skip Horizons when an offline model
// exists; Horizons-only targets in `fast` still go to the network; accurate Horizons-only throws
// without waiting. A success closes. 429 opens immediately for Retry-After or 60 s.
class HorizonsCircuitBreaker {
	private failures = 0
	private openUntil = 0

	constructor(private readonly now: () => number) {}

	// True while the breaker is open. An expired window closes it and resets the failure count.
	isOpen(): boolean {
		if (this.openUntil === 0) return false

		if (this.now() >= this.openUntil) {
			this.openUntil = 0
			this.failures = 0
			return false
		}

		return true
	}

	// A successful Horizons fetch closes the breaker.
	recordSuccess() {
		const wasOpen = this.openUntil !== 0
		this.failures = 0
		this.openUntil = 0
		if (wasOpen) console.info('horizons breaker close')
	}

	// A transient failure. `retryAfterMs` opens immediately (429); otherwise the threshold opens
	// for HORIZONS_BREAKER_OPEN_MS.
	recordTransient(retryAfterMs?: number) {
		this.failures++

		const now = this.now()

		if (retryAfterMs !== undefined) {
			this.openUntil = now + retryAfterMs
			console.info('horizons breaker open:', this.failures, retryAfterMs, 'retry-after')
			return
		}

		if (this.failures >= HORIZONS_BREAKER_FAILURE_THRESHOLD && this.openUntil === 0) {
			this.openUntil = now + HORIZONS_BREAKER_OPEN_MS
			console.info('horizons breaker open:', this.failures, HORIZONS_BREAKER_OPEN_MS)
		}
	}
}

// Rejects with HorizonsTimeoutError when `promise` does not settle within `ms`. observer() is also
// given AbortSignal.timeout so a real fetch is cancelled; the race still unblocks mocks that ignore it.
async function raceHorizonsTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: Timer | undefined

	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new HorizonsTimeoutError()), ms)
	})

	try {
		return await Promise.race([promise, timeout])
	} finally {
		clearTimeout(timer)
	}
}

// Maps a `/atlas/planets/:code` COMMAND to an EphemerisTarget. `10` and `301` are accepted if someone
// hits those routes. `elements` attach only to `minorBody`; they are ignored for planets, moons, and
// opaque Horizons codes.
export function planetTargetFromCode(code: string, elements?: OsculatingElementsInput): EphemerisTarget {
	if (code === '10') return { type: 'sun' }
	if (code === '301') return { type: 'moon' }
	if (code === '999') return { type: 'pluto' }

	if (isPlanetHorizonsCode(code)) return { type: 'planet', code, name: PLANET_BY_CODE[code] }
	if (NATURAL_SATELLITE_CODES.has(code)) return { type: 'naturalSatellite', code }
	if (isMinorBodyCommand(code)) return elements ? { type: 'minorBody', command: code, elements } : { type: 'minorBody', command: code }
	return { type: 'horizons', command: code }
}

// Whether `code` is a VSOP planet COMMAND (`199`…`899`, not Pluto).
function isPlanetHorizonsCode(code: string): code is PlanetHorizonsCode {
	return code in PLANET_BY_CODE
}

const MINOR_BODY_COMMAND_REGEX = /^\d+;$/

// Horizons small-body COMMAND: `DES=…;`, a trailing-semicolon id (`1;`), or `';'` (elements-only).
function isMinorBodyCommand(code: string): boolean {
	return code === ';' || code.startsWith('DES=') || MINOR_BODY_COMMAND_REGEX.test(code)
}

// Generic LRU. Get promotes; set evicts the oldest when over `limit`.
class LruCache<T> {
	private readonly entries = new Map<string, T>()

	// `limit` is the maximum number of entry, not samples.
	constructor(private readonly limit: number) {}

	// Cached entry for `key`, or undefined on miss. A hit becomes most-recently used.
	get(key: string): T | undefined {
		const value = this.entries.get(key)
		if (value === undefined) return undefined
		this.entries.delete(key)
		this.entries.set(key, value)
		return value
	}

	// Stores the cached entry for `key` as most-recently used.
	refresh(key: string) {
		const cached = this.entries.get(key)

		if (cached !== undefined) {
			this.entries.delete(key)
			this.entries.set(key, cached)
		}

		return cached
	}

	// Stores `value` as most-recently used and evicts the oldest entry while size exceeds `limit`.
	set(key: string, value: T) {
		if (this.entries.has(key)) this.entries.delete(key)
		this.entries.set(key, value)

		while (this.entries.size > this.limit) {
			const oldest = this.entries.keys().next().value
			if (oldest === undefined) break
			this.entries.delete(oldest)
		}
	}
}

// Horizons observer-table provider. Does not fall back to offline.
class HorizonsEphemerisProvider implements EphemerisProvider {
	readonly source = 'horizons'
	private readonly observer: HorizonsObserver
	private readonly cache: LruCache<HorizonsSampleMap>
	private readonly timeoutMs: number
	private readonly inflight = new Map<string, HorizonsInflight>()

	// `observer` is the NASA client; `cacheLimit` caps retained noon-to-noon tiles; `timeoutMs` is
	// the wall-clock budget around observer().
	constructor(observer: HorizonsObserver, cacheLimit: number, timeoutMs: number) {
		this.observer = observer
		this.cache = new LruCache(cacheLimit)
		this.timeoutMs = timeoutMs
	}

	// True for every target Horizons can name: Sun, Moon, planets, Pluto, minor bodies, TLE, natural
	// satellites, and opaque COMMANDs. False for catalog stars and sky points.
	supports(target: EphemerisTarget): boolean {
		return target.type !== 'star' && target.type !== 'skyPoint'
	}

	// Noon-to-noon Horizons tile for `request.target` at `request.location`.
	async samples(request: EphemerisSampleRequest): Promise<EphemerisSampleSeries> {
		request.signal?.throwIfAborted()
		const input = horizonsInputFromTarget(request.target)
		const samples = await this.horizonsSeries(input, request.location, request.start, request.end, request.signal)
		return { key: horizonsSeriesKey(input, request.location, request.start, request.end), source: 'horizons', samples }
	}

	// 1441 altitudes (radians) at 1 min from the cached noon-to-noon series for `input` at `req`.
	chartFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody): number[] {
		const [startTime, endTime] = computeStartAndEndTime(req.time)
		const seriesKey = horizonsSeriesKey(input, req.location, startTime, endTime)
		const positions = this.cache.get(seriesKey)

		if (!positions) throw new Error(`object not found: ${horizonsFingerprint(input)}`)

		console.info(`generating chart for ${horizonsFingerprint(input)} at time [${formatTemporal(startTime, undefined, 0)} - ${formatTemporal(endTime, undefined, 0)}]`)

		const seconds = Math.trunc(startTime / 1000)
		const chart = new Array<number>(1441)

		for (let i = 0; i <= 1440; i++) {
			const position = positions.get(seconds + i * 60)
			if (!position) throw new Error(`ephemeris not found for ${horizonsFingerprint(input)} at chart index ${i}`)
			chart[i] = position.horizontal[1]
		}

		return chart
	}

	// Cached Horizons series for `input` at `req`'s observer and noon-to-noon window, or undefined.
	cachedPositions(input: HorizonsEphemerisInput, req: PositionOfBody): HorizonsSampleMap | undefined {
		const [startTime, endTime] = computeStartAndEndTime(req.time)
		return this.cache.get(horizonsSeriesKey(input, req.location, startTime, endTime))
	}

	// Loads the noon-to-noon Horizons tile, sharing in-flight work on the same key. `signal` cancels
	// this waiter; observer() is aborted only when every waiter has aborted.
	private horizonsSeries(input: HorizonsEphemerisInput, location: GeographicCoordinate, startTime: number, endTime: number, signal?: AbortSignal): Promise<HorizonsSampleMap> {
		signal?.throwIfAborted()
		const seriesKey = horizonsSeriesKey(input, location, startTime, endTime)
		const cached = this.cache.get(seriesKey)
		if (cached) return Promise.resolve(cached)

		let entry = this.inflight.get(seriesKey)

		if (!entry) {
			const abort = new AbortController()
			const timeout = new AbortController()
			const timer = setTimeout(() => timeout.abort(), this.timeoutMs)
			const fetchSignal = AbortSignal.any([timeout.signal, abort.signal])
			const promise = this.fetchHorizonsSeries(input, location, startTime, endTime, fetchSignal, abort.signal)
				.then((samples) => {
					this.cache.set(seriesKey, samples)
					return samples
				})
				.finally(() => {
					clearTimeout(timer)
					this.inflight.delete(seriesKey)
				})

			entry = { promise, consumers: 0, abort }
			this.inflight.set(seriesKey, entry)
		}

		return this.followInflight(seriesKey, entry, signal)
	}

	// Attaches `signal` to a shared in-flight tile. The last waiter to abort cancels observer().
	private async followInflight(seriesKey: string, entry: HorizonsInflight, signal?: AbortSignal): Promise<HorizonsSampleMap> {
		entry.consumers++

		try {
			return await settleWithSignal(entry.promise, signal)
		} finally {
			entry.consumers--

			if (entry.consumers === 0 && this.inflight.get(seriesKey) === entry) {
				this.inflight.delete(seriesKey)
				entry.abort.abort()
			}
		}
	}

	// Fetches one Horizons observer table and parses it into a frozen sample map. Does not touch the cache.
	// Empty tables and parse failures are semantic HorizonsEphemerisError; timeouts are transient.
	// `fetchSignal` is timeout ∪ shared-abort; `consumerAbort` distinguishes client cancel from timeout.
	private async fetchHorizonsSeries(input: HorizonsEphemerisInput, location: GeographicCoordinate, startTime: Temporal, endTime: Temporal, fetchSignal: AbortSignal, consumerAbort: AbortSignal): Promise<HorizonsSampleMap> {
		const { longitude, latitude, elevation } = location

		console.info(`fetching ephemeris for ${horizonsFingerprint(input)} at time [${formatTemporal(startTime, undefined, 0)} - ${formatTemporal(endTime, undefined, 0)}] and location [${toDeg(latitude)}, ${toDeg(longitude)}, ${toMeter(elevation).toFixed(0)}]`)

		const pending = this.observer(input, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1, stepSizeUnit: 'm' }, fetchSignal)
		void pending.catch(() => {})

		try {
			const rows = await raceHorizonsTimeout(pending, this.timeoutMs)
			if (consumerAbort.aborted) throw abortReasonOf(consumerAbort)
			if (rows.length === 0) throw new HorizonsEphemerisError('empty ephemeris')
			const samples: HorizonsSampleMap = new Map()

			try {
				makeBodyPositionFromHorizons(rows, samples)
			} catch (error) {
				throw new HorizonsEphemerisError(error instanceof Error ? error.message : 'horizons parse failed', { cause: error })
			}

			return samples
		} catch (error) {
			if (consumerAbort.aborted) throw error
			if (error instanceof HorizonsTimeoutError) throw error
			if (isAbortOrTimeoutError(error)) throw new HorizonsTimeoutError('horizons timeout', { cause: error })
			throw error
		}
	}
}

// Sum of two barycentric states. Allocates a fresh pair so VSOP/moon buffers are not aliased.
function sumPositionAndVelocity(a: PositionAndVelocity, b: PositionAndVelocity): PositionAndVelocity {
	return [
		[a[0][0] + b[0][0], a[0][1] + b[0][1], a[0][2] + b[0][2]],
		[a[1][0] + b[1][0], a[1][1] + b[1][1], a[1][2] + b[1][2]],
	]
}

// Geocentric TEME state rotated into GCRS/ICRS, as a PositionAndVelocity offset from the geocenter.
function temeStateToGcrs(teme: PositionAndVelocity, time: Time): PositionAndVelocity {
	return frameToFrame(teme, TEME, ICRS, time)
}

// Barycentric ICRS state of the ground site: VSOP Earth plus the ITRS geodetic offset rotated to ICRS.
function observerBarycentric(time: Time): PositionAndVelocity {
	const location = time.location!
	const site: GeographicPosition = { longitude: location.longitude, latitude: location.latitude, elevation: location.elevation }
	const earth = vsop.earth(time)
	const offset = frameToFrame(itrs(site), ITRS, ICRS, time)
	return [[earth[0][0] + offset[0], earth[0][1] + offset[1], earth[0][2] + offset[2]], earth[1]]
}

// Light-time and illumination geometry of one topocentric observation.
export interface ObserveSolarSystemGeometry {
	// Observer-to-body vector at reception, light-time corrected, AU.
	readonly observerToBody: Vec3
	// Sun-to-body vector at the emission instant, AU.
	readonly sunToBody: Vec3
}

// Magnitude supplied as a constant or derived from the light-time geometry.
export type ObserveSolarSystemMagnitude = number | null | ((geometry: ObserveSolarSystemGeometry) => number | null)

// BodyPositionFlags carried by a PositionOfBody, without location/time/fast/elements.
//
// - req: the position request; only the BodyPositionFlags fields are copied.
function bodyPositionFlagsOf(req: PositionOfBody): BodyPositionFlags {
	return {
		equatorial: req.equatorial,
		equatorialJ2000: req.equatorialJ2000,
		horizontal: req.horizontal,
		ecliptic: req.ecliptic,
		galactic: req.galactic,
		constellation: req.constellation,
		lst: req.lst,
		names: req.names,
		magnitude: req.magnitude,
		distance: req.distance,
		illuminated: req.illuminated,
		elongation: req.elongation,
		leading: req.leading,
	}
}

// Derived CoordinateInfo frames from an already-apparent equatorial and/or astrometric J2000.
// Does not recompute Az/El: Horizons and icrsToObserved already produced horizontal in their own
// refraction models. Galactic uses astrometric J2000 when provided; ecliptic, constellation, and
// LST use the apparent place. Unrequested fields stay at the BodyPosition zeros.
//
// - time: instant of the conversions, carrying the observing site.
// - longitude: site longitude in radians, used for LST.
// - apparent: equinox-of-date RA/Dec when ecliptic, constellation, or LST is requested.
// - j2000: astrometric ICRS RA/Dec when galactic is requested.
// - flags: resolved BodyPositionFlags; only the derived-frame members are read here.
function derivedFrames(time: Time, longitude: Angle, apparent: { rightAscension: Angle; declination: Angle } | undefined, j2000: readonly [Angle, Angle] | undefined, flags: Required<BodyPositionFlags>): Pick<BodyPosition, 'ecliptic' | 'galactic' | 'constellation' | 'lst' | 'pierSide' | 'meridianTimeIn'> {
	const wantApparentDerived = flags.ecliptic || flags.constellation || flags.lst
	const result: Writable<Pick<BodyPosition, 'ecliptic' | 'galactic' | 'constellation' | 'lst' | 'pierSide' | 'meridianTimeIn'>> = {
		ecliptic: [0, 0],
		galactic: [0, 0],
		constellation: 'AND',
		lst: 0,
		pierSide: 'NEITHER',
		meridianTimeIn: 0,
	}

	if (wantApparentDerived && apparent) {
		const frames = coordinateInfo(time, longitude, apparent, {
			equatorial: false,
			equatorialJ2000: false,
			horizontal: false,
			ecliptic: flags.ecliptic,
			galactic: flags.galactic && !j2000,
			constellation: flags.constellation,
			lst: flags.lst,
		})
		if (flags.ecliptic) result.ecliptic = frames.ecliptic
		if (flags.constellation) result.constellation = frames.constellation
		if (flags.lst) {
			result.lst = frames.lst
			result.pierSide = frames.pierSide
			result.meridianTimeIn = frames.meridianTimeIn
		}
		if (flags.galactic && !j2000) result.galactic = frames.galactic
	}

	if (flags.galactic && j2000) {
		result.galactic = coordinateInfo(time, longitude, { type: 'J2000', J2000: { x: j2000[0], y: j2000[1] } }, { galactic: true }).galactic
	}

	return result
}

// Copies requested BodyPosition fields from `computed`. Unrequested fields stay at the
// DEFAULT_BODY_POSITION zeros (`0`, `false`, `'AND'`, `'NEITHER'`). Magnitude is `null` when
// requested and the model has no formula, and `0` when the field was not requested.
//
// - flags: resolved BodyPositionFlags.
// - computed: fields that were actually produced; missing keys are treated as absent.
function bodyPositionWithFlags(flags: Required<BodyPositionFlags>, computed: Partial<BodyPosition>): BodyPosition {
	return {
		equatorial: flags.equatorial && computed.equatorial ? [computed.equatorial[0], computed.equatorial[1]] : [0, 0],
		equatorialJ2000: flags.equatorialJ2000 && computed.equatorialJ2000 ? [computed.equatorialJ2000[0], computed.equatorialJ2000[1]] : [0, 0],
		horizontal: flags.horizontal && computed.horizontal ? [computed.horizontal[0], computed.horizontal[1]] : [0, 0],
		ecliptic: flags.ecliptic && computed.ecliptic ? [computed.ecliptic[0], computed.ecliptic[1]] : [0, 0],
		galactic: flags.galactic && computed.galactic ? [computed.galactic[0], computed.galactic[1]] : [0, 0],
		constellation: flags.constellation && computed.constellation !== undefined ? computed.constellation : 'AND',
		lst: flags.lst && computed.lst !== undefined ? computed.lst : 0,
		pierSide: flags.lst && computed.pierSide !== undefined ? computed.pierSide : 'NEITHER',
		meridianTimeIn: flags.lst && computed.meridianTimeIn !== undefined ? computed.meridianTimeIn : 0,
		magnitude: flags.magnitude ? (computed.magnitude !== undefined ? computed.magnitude : null) : 0,
		distance: flags.distance && computed.distance !== undefined ? computed.distance : 0,
		illuminated: flags.illuminated && computed.illuminated !== undefined ? computed.illuminated : 0,
		elongation: flags.elongation && computed.elongation !== undefined ? computed.elongation : 0,
		leading: flags.leading && computed.leading !== undefined ? computed.leading : false,
		names: flags.names ? computed.names : undefined,
	}
}

// Apparent topocentric BodyPosition of a barycentric ICRS target at `time`.
//
// Uses two light-time iterations (`topocentricDirection`), then `icrsToObserved` for apparent RA/Dec
// and Az/El. Diurnal parallax is the ITRS site offset added to VSOP Earth. `time.location` is the
// observer; angles radians, distance AU. `flags` skip unrequested frames and photometry; omitted
// flags compute everything.
export function observeSolarSystemBody(target: PositionAndVelocityOverTime, time: Time, magnitude: ObserveSolarSystemMagnitude, flags: BodyPositionFlags = {}): BodyPosition {
	const want = resolveBodyPositionFlags(flags)
	const wantApparent = want.equatorial || want.horizontal || want.ecliptic || want.constellation || want.lst || want.leading
	const wantJ2000 = want.equatorialJ2000 || want.galactic
	const wantMagnitudeFn = want.magnitude && typeof magnitude === 'function'
	const wantGeometry = want.illuminated || want.elongation || want.leading || wantMagnitudeFn
	const wantAnything = wantApparent || wantJ2000 || want.distance || wantGeometry || want.magnitude

	if (!wantAnything) return bodyPositionWithFlags(want, {})

	const direction = topocentricDirection(target, observerBarycentric, time, LIGHT_TIME_ITERATIONS)
	let equatorialJ2000: readonly [Angle, Angle] | undefined

	if (wantJ2000) {
		const eq = equatorial(direction)
		equatorialJ2000 = [eq[0], eq[1]]
	}

	let rightAscension = 0
	let declination = 0
	let azimuth = 0
	let altitude = 0
	let mag: number | null = want.magnitude && typeof magnitude !== 'function' ? magnitude : null
	let illuminated = 0
	let elongation = 0
	let leading = false
	let distance = 0

	if (want.distance) distance = vecLength(direction)

	const earth = wantApparent ? vsop.earth(time) : undefined
	if (wantApparent) {
		const observed = icrsToObserved(direction, time, earth!)
		// eraAtioq RA is CIO/CIRS; Horizons and BodyPosition.equatorial use the equinox of date.
		rightAscension = normalizeAngle(observed.rightAscension - observed.equationOfOrigins)
		declination = observed.declination
		azimuth = observed.azimuth
		altitude = observed.altitude
	}

	if (wantGeometry) {
		const emission = timeShift(time, -lightTime(direction))
		const body = target(emission)[0]
		const sun = vsop.sun(emission)[0]
		const observer = observerBarycentric(time)[0]
		const sunToBody: Vec3 = [body[0] - sun[0], body[1] - sun[1], body[2] - sun[2]]
		const observerToSun: Vec3 = [sun[0] - observer[0], sun[1] - observer[1], sun[2] - observer[2]]
		const geometry: ObserveSolarSystemGeometry = { observerToBody: direction, sunToBody }
		if (wantMagnitudeFn) mag = magnitude(geometry)
		// The Sun has no unique phase geometry (body == sun); keep full illumination and zero elongation.
		const self = vecLength(sunToBody) < 1e-12
		if (want.illuminated) illuminated = self ? 1 : 0.5 * (1 + Math.cos(phaseAngle(body, sun, observer)))
		if (want.elongation) elongation = self ? 0 : vecAngle(observerToSun, direction)
		if (want.leading && !self && earth) {
			const sunObserved = icrsToObserved(observerToSun, time, earth)
			const sunRightAscension = normalizeAngle(sunObserved.rightAscension - sunObserved.equationOfOrigins)
			leading = normalizePI(rightAscension - sunRightAscension) > 0
		}
	}

	const derived = derivedFrames(time, time.location!.longitude, wantApparent ? { rightAscension, declination } : undefined, equatorialJ2000, want)

	return bodyPositionWithFlags(want, {
		equatorial: [rightAscension, declination],
		equatorialJ2000,
		horizontal: [azimuth, altitude],
		...derived,
		magnitude: mag,
		distance,
		illuminated,
		elongation,
		leading,
	})
}

// Barycentric ICRS sampler for a solar-system target that has a local model. Undefined for stars,
// sky points, TLE, and Horizons-only codes.
function barycentricTarget(target: EphemerisTarget): PositionAndVelocityOverTime | undefined {
	switch (target.type) {
		case 'sun':
			return vsop.sun
		case 'planet':
			return VSOP_BY_CODE[target.code]
		case 'pluto':
			return (t) => {
				const sun = vsop.sun(t)
				const helio = pluto(t)
				return [[sun[0][0] + helio[0], sun[0][1] + helio[1], sun[0][2] + helio[2]], sun[1]]
			}
		case 'moon':
			return (t) => sumPositionAndVelocity(vsop.earth(t), elpmpp02.moon(t))
		case 'naturalSatellite': {
			const model = NATURAL_SATELLITE_MODEL[target.code]
			if (!model) return undefined
			return (t) => sumPositionAndVelocity(model.planet(t), model.moon(t))
		}
		default:
			return undefined
	}
}

// IAU HG phase correction in magnitudes for phase angle `phase` (radians) and slope `g`.
function asteroidHgPhaseCorrection(phase: Angle, g: number): number {
	const t = Math.tan(Math.max(0, phase) / 2)
	const phi1 = Math.exp(-3.33 * t ** 0.63)
	const phi2 = Math.exp(-1.87 * t ** 1.22)
	return -2.5 * Math.log10((1 - g) * phi1 + g * phi2)
}

// Apparent magnitude from osculating photometry. `null` when neither H nor m1 is present.
function minorBodyMagnitude(elements: OsculatingElementsInput, geometry: ObserveSolarSystemGeometry): number | null {
	const r = vecLength(geometry.sunToBody)
	const delta = vecLength(geometry.observerToBody)
	if (elements.m1 !== undefined) return cometMagnitudeEstimate(elements.m1, delta, r, elements.k1 ?? 10)
	if (elements.h === undefined) return null
	const phase = vecAngle(geometry.sunToBody, geometry.observerToBody)
	const correction = elements.g === undefined ? 0 : asteroidHgPhaseCorrection(phase, elements.g)
	return asteroidMagnitudeEstimate(elements.h, r, delta, correction)
}

// Canonical fingerprint of osculating elements. Not JSON.stringify: field order is fixed.
function elementsFingerprint(elements: OsculatingElementsInput): string {
	const frame = elements.referenceEclipticFrame ?? 'J2000'
	const { tpqr } = elements
	const anomaly = 'qr' in tpqr ? `qr:${tpqr.qr}|tp:${tpqr.tp}` : 'a' in tpqr ? `ma:${tpqr.ma}|a:${tpqr.a}` : `ma:${tpqr.ma}|n:${tpqr.n}`
	return `${elements.epoch}|${frame}|${elements.ec}|${anomaly}|${elements.om}|${elements.w}|${elements.i}|${elements.h ?? ''}|${elements.g ?? ''}|${elements.m1 ?? ''}`
}

// KeplerOrbit from J2000 osculating elements. `e >= 1` uses the perihelion branch; B1950 is rejected.
function keplerFromElements(elements: OsculatingElementsInput): KeplerOrbit {
	if (elements.referenceEclipticFrame === 'B1950') throw new OfflineEphemerisUnavailableError('Kepler offline model requires J2000 elements')

	const { tpqr, ec, i, om, w } = elements
	if (ec >= 1 || 'qr' in tpqr) {
		if (!('qr' in tpqr)) throw new OfflineEphemerisUnavailableError('parabolic or hyperbolic Kepler needs perihelion distance and time')
		return comet(tpqr.qr * (1 + ec), ec, i, om, w, time(tpqr.tp, 0, Timescale.TDB))
	}

	if ('a' in tpqr) return asteroid(tpqr.a, ec, i, om, w, tpqr.ma, time(elements.epoch, 0, Timescale.TDB))
	const a = Math.cbrt(GM_SUN_PITJEVA_2005 / (tpqr.n * tpqr.n))
	return asteroid(a, ec, i, om, w, tpqr.ma, time(elements.epoch, 0, Timescale.TDB))
}

// Local models: stars, sky points, VSOP/ELP/Pluto, natural satellites, SGP4, and Kepler when elements
// are present. Point samples are evaluated at `request.start` (the requested utc).
class OfflineEphemerisProvider implements EphemerisProvider {
	readonly source = 'offline'
	private readonly keplerOrbits = new LruCache<KeplerOrbit>(KEPLER_ORBIT_CACHE_LIMIT)

	// True when a local model exists for `target`. Charon, B1950 elements, and command-only minor
	// bodies are false.
	supports(target: EphemerisTarget): boolean {
		switch (target.type) {
			case 'star':
			case 'skyPoint':
			case 'sun':
			case 'moon':
			case 'planet':
			case 'pluto':
			case 'satellite':
				return true
			case 'naturalSatellite':
				return target.code in NATURAL_SATELLITE_MODEL
			case 'minorBody':
				return target.elements !== undefined && target.elements.referenceEclipticFrame !== 'B1950'
			default:
				return false
		}
	}

	// One sample at `request.start` (the requested utc). Does not build a noon-to-noon tile.
	samples(request: EphemerisSampleRequest): Promise<EphemerisSampleSeries> {
		request.signal?.throwIfAborted()
		const { target, location, start, flags } = request
		const req: PositionOfBody = { location, time: { utc: start, offset: 0 }, ...flags }
		const position = this.positionAt(target, req)
		const samples = new Map<number, BodyPosition>([[start, position]])
		return Promise.resolve({ key: `offline|${target.type}|${start}`, source: 'offline', samples })
	}

	// Apparent BodyPosition of `target` at `req.time.utc`.
	private positionAt(target: EphemerisTarget, req: PositionOfBody): BodyPosition {
		if (target.type === 'star') return positionOfStar(target.object, req)
		if (target.type === 'skyPoint') return positionOfSkyPoint(target.rightAscension, target.declination, req)

		const time = makeTime(req.time.utc, req.location)

		if (target.type === 'satellite') {
			const tle = parseTLE(target.satellite.line1, target.satellite.line2, target.satellite.name)
			return observeSolarSystemBody((t) => sumPositionAndVelocity(vsop.earth(t), temeStateToGcrs(sgp4(t, tle), t)), time, null, req)
		}

		if (target.type === 'minorBody') {
			if (!target.elements) throw new OfflineEphemerisUnavailableError('offline minor body needs osculating elements')
			const orbit = this.keplerOrbit(target.elements)
			const elements = target.elements
			return observeSolarSystemBody(
				(t) => sumPositionAndVelocity(vsop.sun(t), orbit.at(t)),
				time,
				(geometry) => minorBodyMagnitude(elements, geometry),
				req,
			)
		}

		const barycentric = barycentricTarget(target)
		if (!barycentric) throw new OfflineEphemerisUnavailableError(`offline ephemeris is not implemented for ${target.type}`)

		if (target.type === 'sun') return observeSolarSystemBody(barycentric, time, SUN_VISUAL_MAGNITUDE, req)
		if (target.type === 'planet') {
			const name = target.name
			return observeSolarSystemBody(
				barycentric,
				time,
				(geometry) => {
					const mag = planetMagnitude(name, geometry.sunToBody, geometry.observerToBody, { year: toJulianEpoch(time) })
					return Number.isFinite(mag) ? mag : null
				},
				req,
			)
		}

		return observeSolarSystemBody(barycentric, time, null, req)
	}

	// Cached KeplerOrbit for `elements`, evicting the oldest entry past KEPLER_ORBIT_CACHE_LIMIT.
	private keplerOrbit(elements: OsculatingElementsInput): KeplerOrbit {
		const key = elementsFingerprint(elements)
		const cached = this.keplerOrbits.refresh(key)

		if (cached !== undefined) {
			return cached
		}

		const orbit = keplerFromElements(elements)
		this.keplerOrbits.set(key, orbit)
		return orbit
	}
}

// Provider selection, Horizons tiles, and local star/sky-point reduction.
export class AtlasEphemeris {
	private readonly horizons: EphemerisProvider
	private readonly offline: EphemerisProvider
	private readonly horizonsTiles: HorizonsEphemerisProvider
	private readonly breaker: HorizonsCircuitBreaker

	// `options.observer` replaces the NASA client; `options.horizons` / `options.offline` replace the
	// providers used by `position` so selection can be tested without models or NASA.
	constructor(options?: AtlasEphemerisOptions) {
		this.horizonsTiles = new HorizonsEphemerisProvider(options?.observer ?? horizonsObserver, options?.cacheLimit ?? ATLAS_EPHEMERIS_CACHE_LIMIT, options?.horizonsTimeoutMs ?? HORIZONS_TIMEOUT_MS)
		this.horizons = options?.horizons ?? this.horizonsTiles
		this.offline = options?.offline ?? new OfflineEphemerisProvider()
		this.breaker = new HorizonsCircuitBreaker(options?.now ?? Date.now)
	}

	// BodyPosition for `target` at `req`. `fast` prefers offline when it supports the target; otherwise
	// Horizons is used. Stars, sky points, and cheap offline models are evaluated at the requested utc.
	// Horizons is interpolated at that utc inside the noon-to-noon tile; it is never extrapolated.
	// Omitted BodyPositionFlags compute every field; a true flag materializes only that output.
	// `signal` cancels this call. A shared Horizons tile stays in flight until every waiter has aborted.
	async position(target: EphemerisTarget, req: PositionOfBody, signal?: AbortSignal): Promise<BodyPosition> {
		const series = await this.resolve(target, req, true, signal)
		if (series.source === 'horizons') return withEphemerisOrigin(horizonsPositionAt(series.samples, req), series)
		const sample = series.samples.get(sampleKey(target, req.time.utc, series.source))
		if (!sample) throw new Error(`ephemeris not found for ${target.type} at ${formatTemporal(req.time.utc, undefined, 0)}`)
		return withEphemerisOrigin(sample, series)
	}

	// Noon-to-noon Horizons tile, or the single offline sample, for `target` at `req`.
	// Does not fall back to a one-sample offline series: charts need the 1441-point tile.
	series(target: EphemerisTarget, req: PositionOfBody, signal?: AbortSignal): Promise<EphemerisSampleSeries> {
		return this.resolve(target, { ...req, fast: false }, false, signal)
	}

	// 1441 altitudes (radians) at 1 min for `target`. Horizons uses the noon-to-noon tile 1:1.
	async chart(target: EphemerisTarget, req: PositionOfBody, signal?: AbortSignal): Promise<number[]> {
		const series = await this.series(target, req, signal)
		return altitudesFromSeries(series, req)
	}

	// Apparent BodyPosition at the civil minute of `req.time.utc`, from a noon-to-noon Horizons series.
	// Ignores `fast`: this path is the Horizons tile used by charts and twilight.
	positionFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody, signal?: AbortSignal): Promise<BodyPosition> {
		return this.position(targetFromHorizonsInput(input), { ...req, fast: false }, signal)
	}

	// 1441 altitudes (radians) at 1 min from the cached noon-to-noon Horizons series for `input` at `req`.
	chartFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody): number[] {
		return this.horizonsTiles.chartFromHorizons(input, req)
	}

	// Cached Horizons series for `input` at `req`'s observer and noon-to-noon window, or undefined.
	cachedPositions(input: HorizonsEphemerisInput, req: PositionOfBody): HorizonsSampleMap | undefined {
		return this.horizonsTiles.cachedPositions(input, req)
	}

	// 1441 altitudes (radians) at 1 min for a catalog object, computed locally noon-to-noon.
	chartOfSkyObject(req: PositionOfBody, object: SkyObject, signal?: AbortSignal): number[] {
		signal?.throwIfAborted()
		let [startTime] = computeStartAndEndTime(req.time)
		const data = new Array<number>(1441)
		let ebpv: PositionAndVelocity | undefined

		for (let i = 0; i < data.length; i++) {
			if ((i & 31) === 0) signal?.throwIfAborted()
			const time = makeTime(startTime, req.location)

			if (i === 0 || i === 720 || i === 1440) ebpv = vsop.earth(time)

			if (object.pmRA && object.pmDEC) {
				const parallax = object.distance > 0 ? 1 / object.distance : 0
				data[i] = observeStar({ ...object, parallax }, time, ebpv!).altitude
			} else {
				data[i] = icrsToObserved([object.rightAscension, object.declination], time, ebpv!).altitude
			}

			startTime += 60000
		}

		return data
	}

	// Local noon-to-noon window containing `time`, as UTC milliseconds.
	computeStartAndEndTime(time: UTCTime): readonly [Temporal, Temporal] {
		return computeStartAndEndTime(time)
	}

	// One hop: `fast` prefers offline; otherwise Horizons if it supports the target, else offline.
	// Transient Horizons failures fall back to a local model when one exists. Semantic Horizons
	// errors do not. `allowOfflineFallback` is false for series/chart: those need a noon-to-noon
	// Horizons tile, not a single offline sample.
	private resolve(target: EphemerisTarget, req: PositionOfBody, allowOfflineFallback = true, signal?: AbortSignal): Promise<EphemerisSampleSeries> {
		signal?.throwIfAborted()
		const [start, end] = computeStartAndEndTime(req.time)
		const point = target.type === 'star' || target.type === 'skyPoint'
		const request: EphemerisSampleRequest = {
			target,
			location: req.location,
			start: point ? req.time.utc : start,
			end: point ? req.time.utc : end,
			stepSize: HORIZONS_STEP_SIZE_SECONDS,
			flags: bodyPositionFlagsOf(req),
			signal,
		}

		const mode: EphemerisMode = req.fast ? 'fast' : 'accurate'
		const useOffline = this.offline.supports(target)
		const useHorizons = this.horizons.supports(target)

		if (mode === 'fast') {
			if (useOffline) return this.offline.samples(pointRequest(request, req.time.utc))
			if (useHorizons) return this.fetchHorizonsOrFallback(request, req.time.utc, false, false)
			throw new EphemerisUnavailableError()
		}

		if (useHorizons) return this.fetchHorizonsOrFallback(request, req.time.utc, allowOfflineFallback && useOffline, true)
		if (useOffline) return this.offline.samples(pointRequest(request, req.time.utc))
		throw new EphemerisUnavailableError()
	}

	// Horizons tile, with at most one offline hop on a transient failure when `useOffline`.
	// `skipWhenOpen` is true for accurate mode: an open breaker uses offline immediately or throws
	// without waiting. Fast Horizons-only targets still call Horizons while the breaker is open.
	private async fetchHorizonsOrFallback(request: EphemerisSampleRequest, utc: number, useOffline: boolean, skipWhenOpen: boolean): Promise<EphemerisSampleSeries> {
		request.signal?.throwIfAborted()

		if (this.breaker.isOpen()) {
			if (useOffline) {
				console.info('ephemerisFallback', request.target.type, 'offline', 'breakerOpen')
				return withFallbackReason(await this.offline.samples(pointRequest(request, utc)), 'breakerOpen')
			}
			if (skipWhenOpen) throw new HorizonsEphemerisError('horizons circuit breaker open')
		}

		try {
			const series = await this.horizons.samples(request)
			this.breaker.recordSuccess()
			return series
		} catch (error) {
			if (request.signal?.aborted) throw error
			const kind = classifyHorizonsFailure(error)

			if (kind === 'transient') {
				this.breaker.recordTransient(retryAfterMsOf(error))

				if (useOffline) {
					console.info('ephemerisFallback', request.target.type, 'offline', error instanceof Error ? error.name : 'transient')
					return withFallbackReason(await this.offline.samples(pointRequest(request, utc)), fallbackReasonFromError(error))
				}

				throw new EphemerisUnavailableError('horizons unavailable', { cause: error })
			}

			if (error instanceof HorizonsEphemerisError) throw error
			throw new HorizonsEphemerisError(error instanceof Error ? error.message : 'horizons ephemeris failed', { cause: error })
		}
	}
}

// Local noon-to-noon window containing `time`, as UTC milliseconds.
//
// Noon is 12:00 at `time.offset` (minutes east of UTC). If the local hour is before 12, the window
// starts at the previous local noon. The returned instants are UTC; they are 720 − offset minutes
// after local midnight.
function computeStartAndEndTime(time: UTCTime): readonly [Temporal, Temporal] {
	const { utc, offset } = time
	const local = temporalAdd(utc, offset, 'm')
	const hour = temporalGet(local, 'h')

	let startTime = temporalStartOfDay(local)
	// if not passed noon, go to the previous day
	if (hour < 12) startTime = temporalSubtract(startTime, 1, 'd')
	// set to UTC noon + local offset (if enabled)
	startTime = temporalAdd(startTime, 720 - offset, 'm')
	// set end time to noon of the next day
	const endTime = temporalAdd(startTime, 1, 'd')

	return [startTime, endTime]
}

// Lookup key in a series: exact utc for offline (including stars/sky points), truncated civil minute
// for Horizons tiles.
function sampleKey(target: EphemerisTarget, utc: number, source?: EphemerisSource): number {
	if (source === 'offline' || target.type === 'star' || target.type === 'skyPoint') return utc
	return Math.trunc(temporalSet(utc, 0, 's') / 1000)
}

// Copies `source` and `fallbackReason` onto a BodyPosition. Cached samples stay unmarked; the stamp
// belongs to this response, not the tile.
function withEphemerisOrigin(position: BodyPosition, series: EphemerisSampleSeries): BodyPosition {
	if (position.source === series.source && position.fallbackReason === series.fallbackReason) return position
	return series.fallbackReason === undefined ? { ...position, source: series.source } : { ...position, source: series.source, fallbackReason: series.fallbackReason }
}

// Marks a series as an accurate-path fallback so position() can expose why Horizons was not used.
function withFallbackReason(series: EphemerisSampleSeries, fallbackReason: EphemerisFallbackReason): EphemerisSampleSeries {
	return { ...series, fallbackReason }
}

// Maps a transient Horizons failure onto the public fallback reason.
function fallbackReasonFromError(error: unknown): EphemerisFallbackReason {
	if (error instanceof HorizonsTimeoutError || isAbortOrTimeoutError(error)) return 'timeout'
	if (error instanceof HorizonsHttpError) return 'http'
	return 'network'
}

// Single-instant sample request at `utc`. Cheap offline models do not build a noon-to-noon tile.
function pointRequest(request: EphemerisSampleRequest, utc: number): EphemerisSampleRequest {
	if (request.start === utc && request.end === utc) return request
	return { ...request, start: utc, end: utc }
}

// EphemerisTarget for a Horizons COMMAND string or TLE, used by the leftover Horizons-shaped API.
function targetFromHorizonsInput(input: HorizonsEphemerisInput): EphemerisTarget {
	if (typeof input === 'string') return planetTargetFromCode(input)
	return { type: 'satellite', satellite: { id: input.id, line1: input.line1, line2: input.line2, name: '', groups: [] } }
}

// Horizons COMMAND or TLE payload for a target Horizons supports.
function horizonsInputFromTarget(target: EphemerisTarget): HorizonsEphemerisInput {
	switch (target.type) {
		case 'sun':
			return '10'
		case 'moon':
			return '301'
		case 'planet':
			return target.code
		case 'pluto':
			return '999'
		case 'naturalSatellite':
			return target.code
		case 'minorBody':
			return target.command || ';'
		case 'horizons':
			return target.command
		case 'satellite':
			return { id: target.satellite.id, line1: target.satellite.line1, line2: target.satellite.line2 }
		case 'star':
		case 'skyPoint':
			throw new HorizonsEphemerisError(`horizons does not support ${target.type}`)
	}
}

// Physical cache identity of a Horizons noon-to-noon tile. Units: start/end ms, step seconds, angles rad, elevation m.
function horizonsSeriesKey(input: HorizonsEphemerisInput, location: GeographicCoordinate, startTime: number, endTime: number): string {
	const { longitude, latitude, elevation } = location
	return `horizons|horizons-observer|${horizonsFingerprint(input)}|${startTime}|${endTime}|${HORIZONS_STEP_SIZE_SECONDS}|${longitude}|${latitude}|${elevation}`
}

// Target fingerprint: trimmed COMMAND, or `TLE:` plus NORAD id and a hash of both TLE lines.
function horizonsFingerprint(input: HorizonsEphemerisInput): string {
	if (typeof input === 'string') return input.trim()
	return `TLE:${input.id}:${hashString(input.line1 + input.line2)}`
}

// FNV-1a 32-bit fingerprint of `value`, as an unsigned base-36 string.
function hashString(value: string): string {
	let hash = 2166136261
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}

// BodyPosition for `req` from a frozen Horizons sample. Coordinate tuples and derived frames are new
// objects; the cached sample is not written. Unrequested flags stay at the BodyPosition zeros.
// Constellation is the Horizons CSV value, not recomputed.
function projectHorizonsPosition(sample: BodyPosition, req: PositionOfBody): BodyPosition {
	const want = resolveBodyPositionFlags(req)
	const time = makeTime(req.time.utc, req.location)
	const derived = derivedFrames(time, req.location.longitude, { rightAscension: sample.equatorial[0], declination: sample.equatorial[1] }, sample.equatorialJ2000, { ...want, constellation: false })

	return bodyPositionWithFlags(want, {
		magnitude: sample.magnitude,
		distance: sample.distance,
		illuminated: sample.illuminated,
		elongation: sample.elongation,
		leading: sample.leading,
		names: sample.names,
		equatorial: sample.equatorial,
		equatorialJ2000: sample.equatorialJ2000,
		horizontal: sample.horizontal,
		...derived,
		constellation: sample.constellation,
	})
}

// Noon-to-noon altitude-chart spacing used to turn a refined crossing into a sample index.
const CROSSING_STEP_MS = 60_000

// Time-axis tolerance for brentRoot on Unix milliseconds: 1 ms is below anything the UI can show.
const CROSSING_TIME_TOLERANCE_MS = 1

// Function-value tolerance for brentRoot on `value(position)`, in the same units as `value`.
const CROSSING_VALUE_TOLERANCE = 1e-10

// First sign change of `value` in [start, end], refined with Brent on interpolated samples.
//
// The coarse scan walks the sampled instants already in `samples`; it does not assume a uniform
// grid. `value` is evaluated on frozen samples for bracketing and on horizonsPositionAt interpolants
// while refining. No crossing, or a window with fewer than two samples, returns undefined.
// `index` is floor((time - origin) / stepMs) so a dusk band still starts on the last chart sample
// on the incoming side of the zero. Polar / no-event windows stay undefined.
//
// - samples: Horizons (or interpolated) series keyed by Unix seconds.
// - req: observer used by interpolation; only `location` and `time.offset` are read besides flags.
// - start: search window start, Unix milliseconds, inclusive.
// - end: search window end, Unix milliseconds, inclusive of a sample sitting on `end`.
// - value: scalar whose zero is the event; typical twilight use is `p => p.horizontal[1] - threshold`.
// - options.origin: chart origin for `index`. Defaults to `start`.
// - options.stepMs: chart spacing. Defaults to 60 s.
// - options.signal: cancels the coarse scan.
export function findCrossing(samples: ReadonlyMap<number, BodyPosition>, req: PositionOfBody, start: number, end: number, value: (position: BodyPosition) => number, options: FindCrossingOptions = {}): EphemerisCrossing | undefined {
	options.signal?.throwIfAborted()
	const stepMs = options.stepMs ?? CROSSING_STEP_MS
	const origin = options.origin ?? start
	const startSec = Math.trunc(start / 1000)
	const endSec = Math.trunc(end / 1000)
	const interpolateReq: PositionOfBody = { ...req, horizontal: true }

	const times: number[] = []
	for (const time of samples.keys()) {
		if (time >= startSec && time <= endSec) times.push(time)
	}
	times.sort((a, b) => a - b)

	for (let i = 0; i < times.length - 1; i++) {
		options.signal?.throwIfAborted()
		const t0 = times[i]
		const t1 = times[i + 1]
		const a = samples.get(t0)
		const b = samples.get(t1)
		if (!a || !b) continue

		const v0 = value(a)
		const v1 = value(b)
		if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue

		const t0ms = t0 * 1000
		if (v0 === 0) return { time: t0ms, index: Math.floor((t0ms - origin) / stepMs) }
		if (v0 * v1 > 0) continue
		if (v1 === 0) return { time: t1 * 1000, index: Math.floor((t1 * 1000 - origin) / stepMs) }

		try {
			const root = brentRoot((utc) => value(horizonsPositionAt(samples, { ...interpolateReq, time: { utc, offset: req.time.offset } })), t0ms, t1 * 1000, { tolerance: CROSSING_TIME_TOLERANCE_MS, functionTolerance: CROSSING_VALUE_TOLERANCE })
			return { time: root.root, index: Math.floor((root.root - origin) / stepMs) }
		} catch {
			return { time: t0ms, index: Math.floor((t0ms - origin) / stepMs) }
		}
	}

	return undefined
}

// Horizons BodyPosition at `req.time.utc`. On a sample instant this is the frozen tile plus LST/frames;
// between samples, apparent RA/Dec and J2000 are linearly interpolated with unwrap, scalars are
// lerped, and Az/El are lerped with angle unwrap. Out of range throws EphemerisInterpolationError.
export function horizonsPositionAt(samples: ReadonlyMap<number, BodyPosition>, req: PositionOfBody): BodyPosition {
	const utcSec = req.time.utc / 1000
	const bracket = bracketingHorizonsSamples(samples, utcSec)

	if (!('t1' in bracket)) {
		const sample = samples.get(bracket.t0)
		if (!sample) throw new EphemerisInterpolationError(`ephemeris not found at ${formatTemporal(req.time.utc, undefined, 0)}`)
		return projectHorizonsPosition(sample, req)
	}

	const a = samples.get(bracket.t0)
	const b = samples.get(bracket.t1)
	if (!a || !b) throw new EphemerisInterpolationError(`ephemeris not found at ${formatTemporal(req.time.utc, undefined, 0)}`)

	try {
		return interpolateHorizonsSamples(a, b, bracket.t0, bracket.t1, req)
	} catch (error) {
		if (error instanceof RangeError) throw new EphemerisInterpolationError(error.message, { cause: error })
		throw error
	}
}

// Nearest sample keys that enclose `utcSec`. A lone `t0` is an exact hit. Throws when the instant is
// outside the sampled tile (no extrapolation, no nearest-neighbor).
function bracketingHorizonsSamples(samples: ReadonlyMap<number, BodyPosition>, utcSec: number): { t0: number } | { t0: number; t1: number } {
	if (Number.isInteger(utcSec) && samples.has(utcSec)) return { t0: utcSec }

	let t0 = Number.NEGATIVE_INFINITY
	let t1 = Number.POSITIVE_INFINITY

	for (const key of samples.keys()) {
		if (key <= utcSec && key > t0) t0 = key
		if (key >= utcSec && key < t1) t1 = key
	}

	if (t0 === utcSec && samples.has(t0)) return { t0 }
	if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 === Number.POSITIVE_INFINITY || t0 === Number.NEGATIVE_INFINITY || t0 === t1) {
		throw new EphemerisInterpolationError('ephemeris interpolation out of range')
	}

	return { t0, t1 }
}

// Linear interpolation of two Horizons samples onto `req.time.utc`. RA/Dec use EphemerisInterpolator
// with outOfRange throw; Az uses shortest-arc unwrap. Unrequested flags skip unused interpolators.
function interpolateHorizonsSamples(a: BodyPosition, b: BodyPosition, t0: number, t1: number, req: PositionOfBody): BodyPosition {
	const want = resolveBodyPositionFlags(req)
	const query = timeUnix(req.time.utc / 1000)
	const tA = timeUnix(t0)
	const tB = timeUnix(t1)
	const options = { outOfRange: 'throw' } as const
	const frac = (req.time.utc / 1000 - t0) / (t1 - t0)
	const time = makeTime(req.time.utc, req.location)
	const nearer = frac < 0.5 ? a : b
	const wantApparent = want.equatorial || want.ecliptic || want.constellation || want.lst
	const wantJ2000 = want.equatorialJ2000 || want.galactic

	let rightAscension = 0
	let declination = 0
	let rightAscensionJ2000 = 0
	let declinationJ2000 = 0
	let azimuth = 0
	let altitude = 0

	if (wantApparent) {
		const apparent = linearInterpolator(
			[
				{ time: tA, rightAscension: a.equatorial[0], declination: a.equatorial[1] },
				{ time: tB, rightAscension: b.equatorial[0], declination: b.equatorial[1] },
			],
			options,
		)
		;[rightAscension, declination] = apparent.compute(query)
	}

	if (wantJ2000) {
		const j2000 = linearInterpolator(
			[
				{ time: tA, rightAscension: a.equatorialJ2000[0], declination: a.equatorialJ2000[1] },
				{ time: tB, rightAscension: b.equatorialJ2000[0], declination: b.equatorialJ2000[1] },
			],
			options,
		)
		;[rightAscensionJ2000, declinationJ2000] = j2000.compute(query)
	}

	if (want.horizontal) {
		azimuth = lerpAngle(a.horizontal[0], b.horizontal[0], frac)
		altitude = lerp(a.horizontal[1], b.horizontal[1], frac)
	}

	const derived = derivedFrames(time, req.location.longitude, wantApparent ? { rightAscension, declination } : undefined, wantJ2000 ? [rightAscensionJ2000, declinationJ2000] : undefined, want)

	return bodyPositionWithFlags(want, {
		magnitude: a.magnitude && b.magnitude && lerp(a.magnitude, b.magnitude, frac),
		distance: lerp(a.distance, b.distance, frac),
		illuminated: lerp(a.illuminated, b.illuminated, frac),
		elongation: lerp(a.elongation, b.elongation, frac),
		leading: nearer.leading,
		equatorial: [rightAscension, declination],
		equatorialJ2000: [rightAscensionJ2000, declinationJ2000],
		horizontal: [azimuth, altitude],
		...derived,
	})
}

// Shortest-arc interpolation of an angle, normalized to 0..TAU.
function lerpAngle(a: Angle, b: Angle, t: number) {
	return normalizeAngle(a + normalizePI(b - a) * t)
}

// 1441 altitudes from a noon-to-noon series whose samples sit on the 60 s grid.
function altitudesFromSeries(series: EphemerisSampleSeries, req: PositionOfBody): number[] {
	const [startTime] = computeStartAndEndTime(req.time)
	const seconds = Math.trunc(startTime / 1000)
	const chart = new Array<number>(1441)

	for (let i = 0; i <= 1440; i++) {
		const position = series.samples.get(seconds + i * 60)
		if (!position) throw new Error(`ephemeris not found at chart index ${i}`)
		chart[i] = position.horizontal[1]
	}

	return chart
}

// Apparent place of a catalog object at `req.time.utc`. Proper motion uses observeStar; otherwise
// J2000 → CIRS → observed. Names are catalog metadata and are left to the handler. Constellation is
// the catalog value. Unrequested flags stay at the BodyPosition zeros.
function positionOfStar(dso: SkyObject, req: PositionOfBody): BodyPosition {
	const want = resolveBodyPositionFlags(req)
	const time = makeTime(req.time.utc, req.location)
	const equatorialJ2000 = [dso.rightAscension, dso.declination] as const
	const wantApparent = want.equatorial || want.horizontal || want.ecliptic || want.lst

	const horizontal: Writable<BodyPosition['horizontal']> = [0, 0]
	const equatorial: Writable<BodyPosition['equatorial']> = [0, 0]

	if (wantApparent) {
		if (dso.pmRA && dso.pmDEC) {
			const ebpv = vsop.earth(time)
			const parallax = dso.distance > 0 ? 1 / dso.distance : 0
			const ob = observeStar({ ...dso, parallax }, time, ebpv)
			equatorial[0] = ob.rightAscension
			equatorial[1] = ob.declination
			horizontal[0] = ob.azimuth
			horizontal[1] = ob.altitude
		} else {
			Object.assign(equatorial, equatorialFromJ2000(dso.rightAscension, dso.declination, time))

			if (want.horizontal) {
				const { azimuth, altitude } = cirsToObserved(equatorial, time)
				horizontal[0] = azimuth
				horizontal[1] = altitude
			}
		}
	}

	const derived = derivedFrames(time, req.location.longitude, wantApparent ? { rightAscension: equatorial[0], declination: equatorial[1] } : undefined, equatorialJ2000, { ...want, constellation: false })

	return bodyPositionWithFlags(want, {
		magnitude: dso.magnitude,
		distance: dso.distance,
		illuminated: 0,
		elongation: 0,
		leading: false,
		equatorial,
		equatorialJ2000,
		horizontal,
		...derived,
		constellation: CONSTELLATION_LIST[dso.constellation],
	})
}

// Apparent place of an equatorial CIRS sky point at `req.time.utc`. `rightAscension`/`declination`
// are radians; RA is the equinox-of-date value the caller already parsed. Unrequested flags stay at
// the BodyPosition zeros.
function positionOfSkyPoint(rightAscension: Angle, declination: Angle, req: PositionOfBody): BodyPosition {
	const want = resolveBodyPositionFlags(req)
	const time = makeTime(req.time.utc, req.location)
	const equatorial = [rightAscension, declination] as const
	const wantJ2000 = want.equatorialJ2000 || want.galactic
	const equatorialJ2000 = wantJ2000 ? equatorialToJ2000(rightAscension, declination, time) : undefined
	const horizontal: Writable<BodyPosition['horizontal']> = [0, 0]

	if (want.horizontal) {
		const { azimuth, altitude } = cirsToObserved(eraS2p(rightAscension, declination, ONE_KILOPARSEC), time)
		horizontal[0] = azimuth
		horizontal[1] = altitude
	}

	const derived = derivedFrames(time, req.location.longitude, { rightAscension, declination }, equatorialJ2000, want)

	return bodyPositionWithFlags(want, {
		magnitude: 99,
		distance: 0,
		illuminated: 0,
		elongation: 0,
		leading: false,
		equatorial,
		equatorialJ2000,
		horizontal,
		...derived,
	})
}

// Parses a Horizons observer CSV into `output`, keyed by Unix seconds on a uniform 1 min grid.
//
// The first row's calendar date (YYYY-MMM-DD HH:mm) is the origin; row i is origin + i minutes. Light
// time is converted to AU with `SPEED_OF_LIGHT * 0.06 / AU_KM` (light-time minutes × c). An empty
// table throws. Each sample is frozen so a later request cannot mutate the tile.
function makeBodyPositionFromHorizons(ephemeris: CsvRow[], output: Map<number, BodyPosition>) {
	if (ephemeris.length === 0) throw new Error('empty ephemeris')

	const seconds = Math.trunc(parseTemporal(ephemeris[0][0], 'YYYY-MMM-DD HH:mm') / 1000)

	for (let i = 0; i < ephemeris.length; i++) {
		const e = ephemeris[i]
		const lightTime = Number.parseFloat(e[11]) || 0
		const distance = lightTime * ((SPEED_OF_LIGHT * 0.06) / AU_KM) // AU

		const position = {
			equatorial: [parseAngle(e[5])!, parseAngle(e[6])!],
			equatorialJ2000: [parseAngle(e[3])!, parseAngle(e[4])!],
			horizontal: [parseAngle(e[7])!, parseAngle(e[8])!],
			magnitude: e[9] === 'n.a.' ? null : Number.parseFloat(e[9]),
			constellation: e[15].toUpperCase() as never,
			distance,
			illuminated: Number.parseFloat(e[12]),
			elongation: parseAngle(e[13])!,
			leading: e[14] === '/L',
			galactic: [0, 0],
			ecliptic: [0, 0],
			pierSide: 'NEITHER',
			lst: 0,
			meridianTimeIn: 0,
		} satisfies BodyPosition

		output.set(seconds + i * 60, position)
	}
}
