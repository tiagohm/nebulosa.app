import { observer as horizonsObserver } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { Quantity } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { Planet } from 'nebulosa/src/astronomy/bodies/photometry'
import { observeStar } from 'nebulosa/src/astronomy/bodies/star'
import { cirsToObserved, icrsToObserved } from 'nebulosa/src/astronomy/coordinates/astrometry'
import type { PositionAndVelocity } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { constellation, CONSTELLATION_LIST } from 'nebulosa/src/astronomy/coordinates/constellation'
import { equatorialFromJ2000, equatorialToEcliptic, equatorialToGalatic, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { eraS2p } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { formatTemporal, parseTemporal, temporalAdd, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Temporal } from 'nebulosa/src/astronomy/time/temporal'
import { AU_KM, ONE_KILOPARSEC, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import type { Writable } from 'nebulosa/src/core/types'
import { expectedPierSide, meridianTimeIn } from 'nebulosa/src/devices/indi/device'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import type { CsvRow } from 'nebulosa/src/io/csv'
import { parseAngle, toDeg } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { BodyPosition, PositionOfBody } from '#/atlas'
import type { SkyObject } from '#/galaxy'
import type { Satellite } from '#/satellite'
import { makeTime } from './util'

// Atlas ephemeris service: provider selection, Horizons observer-table tiles, and local star/sky-point
// reduction. VSOP/ELP/SGP4/Kepler models are not wired yet; `fast` only prefers offline when the
// offline provider currently supports the target (stars and sky points).
//
// Cached Horizons series are immutable and keyed by source, target fingerprint, model, window, step,
// and observer. `fast`, flags, and `time.offset` are not part of the physical identity. Distances are
// AU, angles radians, instants Unix milliseconds. Horizons is sampled every 60 s over local
// noon-to-noon; the requested utc is still truncated to the civil minute.

// Maximum number of noon-to-noon Horizons series retained. Each tile is ~1441 samples; eviction is
// LRU by series, not by sample count.
export const ATLAS_EPHEMERIS_CACHE_LIMIT = 64

// Horizons observer-table sampling interval used by this extraction, in seconds.
const HORIZONS_STEP_SIZE_SECONDS = 60

// Horizons COMMAND values for the eight VSOP87E planets. Pluto is not in this set.
export type PlanetHorizonsCode = '199' | '299' | '499' | '599' | '699' | '799' | '899'

// Requested calculation path. `fast` on PositionOfBody maps to `'fast'`; omitted/`false` is `'accurate'`.
export type EphemerisMode = 'fast' | 'accurate'

// Provider that actually produced a series. Distinct from EphemerisMode: a `fast` request may still
// come from Horizons when no local model exists.
export type EphemerisSource = 'offline' | 'horizons'

// Discriminated target. The handler translates route/UI ids; the service does not take opaque strings.
export type EphemerisTarget =
	| { readonly type: 'sun' }
	| { readonly type: 'moon' }
	| { readonly type: 'planet'; readonly code: PlanetHorizonsCode; readonly name: Planet }
	| { readonly type: 'pluto' }
	| { readonly type: 'star'; readonly object: SkyObject }
	| { readonly type: 'skyPoint'; readonly rightAscension: Angle; readonly declination: Angle }
	| { readonly type: 'minorBody'; readonly command?: string }
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
}

// Cached or freshly computed samples for one physical identity. Keys are Unix seconds (Horizons,
// truncated) or the exact utc ms (star / sky point).
export interface EphemerisSampleSeries {
	readonly key: string
	readonly source: EphemerisSource
	readonly samples: ReadonlyMap<number, BodyPosition>
}

// Internal provider. `supports` is a static table, never "try and see if it throws".
export interface EphemerisProvider {
	readonly source: EphemerisSource
	supports(target: EphemerisTarget): boolean
	samples(request: EphemerisSampleRequest): Promise<EphemerisSampleSeries>
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
}

// Horizons observer-table target: a COMMAND string or a TLE (id plus line hash is the fingerprint).
export type HorizonsEphemerisInput = string | Omit<Satellite, 'name' | 'groups'>

// Quantities requested from Horizons: astrometric RA/Dec, apparent RA/Dec, Az/El, visual magnitude,
// one-way light-time, illuminated fraction, solar elongation, and constellation.
const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

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

// Cached noon-to-noon Horizons samples, keyed by truncated Unix seconds. Entries are frozen.
type HorizonsSampleMap = Map<number, BodyPosition>

// No provider accepted the target.
export class EphemerisUnavailableError extends Error {
	constructor(message = 'ephemeris unavailable') {
		super(message)
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

// Interpolation asked for a time outside the sampled tile. Unused until exact-time interpolation lands.
export class EphemerisInterpolationError extends Error {
	constructor(message = 'ephemeris interpolation out of range') {
		super(message)
		this.name = 'EphemerisInterpolationError'
	}
}

// Maps a `/atlas/planets/:code` COMMAND to an EphemerisTarget. `10` and `301` are accepted if someone
// hits those routes. At least one of `code` or future `elements` identifies the body; this phase only
// reads the COMMAND.
export function planetTargetFromCode(code: string): EphemerisTarget {
	if (code === '10') return { type: 'sun' }
	if (code === '301') return { type: 'moon' }
	if (code === '999') return { type: 'pluto' }

	if (isPlanetHorizonsCode(code)) return { type: 'planet', code, name: PLANET_BY_CODE[code] }
	if (NATURAL_SATELLITE_CODES.has(code)) return { type: 'naturalSatellite', code }
	if (isMinorBodyCommand(code)) return { type: 'minorBody', command: code }
	return { type: 'horizons', command: code }
}

// Whether `code` is a VSOP planet COMMAND (`199`…`899`, not Pluto).
function isPlanetHorizonsCode(code: string): code is PlanetHorizonsCode {
	return code in PLANET_BY_CODE
}

// Horizons small-body COMMAND: `DES=…;`, a trailing-semicolon id (`1;`), or `';'` (elements-only).
function isMinorBodyCommand(code: string): boolean {
	return code === ';' || code.startsWith('DES=') || /^\d+;$/.test(code)
}

// LRU of frozen Horizons series. Get promotes; set evicts the oldest when over `limit`.
class SeriesLruCache {
	private readonly entries = new Map<string, HorizonsSampleMap>()

	// `limit` is the maximum number of series, not samples.
	constructor(private readonly limit: number) {}

	// Cached series for `key`, or undefined on miss. A hit becomes most-recently used.
	get(key: string): HorizonsSampleMap | undefined {
		const value = this.entries.get(key)
		if (value === undefined) return undefined
		this.entries.delete(key)
		this.entries.set(key, value)
		return value
	}

	// Stores `value` as most-recently used and evicts the oldest series while size exceeds `limit`.
	set(key: string, value: HorizonsSampleMap) {
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
	readonly source = 'horizons' as const
	private readonly observer: HorizonsObserver
	private readonly cache: SeriesLruCache
	private readonly inflight = new Map<string, Promise<HorizonsSampleMap>>()

	// `observer` is the NASA client; `cacheLimit` caps retained noon-to-noon tiles.
	constructor(observer: HorizonsObserver, cacheLimit: number) {
		this.observer = observer
		this.cache = new SeriesLruCache(cacheLimit)
	}

	// True for every target Horizons can name: Sun, Moon, planets, Pluto, minor bodies, TLE, natural
	// satellites, and opaque COMMANDs. False for catalog stars and sky points.
	supports(target: EphemerisTarget): boolean {
		return target.type !== 'star' && target.type !== 'skyPoint'
	}

	// Noon-to-noon Horizons tile for `request.target` at `request.location`.
	async samples(request: EphemerisSampleRequest): Promise<EphemerisSampleSeries> {
		const input = horizonsInputFromTarget(request.target)
		const samples = await this.horizonsSeries(input, request.location, request.start, request.end)
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

	// Loads the noon-to-noon Horizons tile, sharing in-flight work on the same key.
	private horizonsSeries(input: HorizonsEphemerisInput, location: GeographicCoordinate, startTime: number, endTime: number): Promise<HorizonsSampleMap> {
		const seriesKey = horizonsSeriesKey(input, location, startTime, endTime)
		const cached = this.cache.get(seriesKey)
		if (cached) return Promise.resolve(cached)

		const pending = this.inflight.get(seriesKey)
		if (pending) return pending

		const task = this.fetchHorizonsSeries(input, location, startTime, endTime)
			.then((samples) => {
				this.cache.set(seriesKey, samples)
				return samples
			})
			.finally(() => {
				this.inflight.delete(seriesKey)
			})

		this.inflight.set(seriesKey, task)
		return task
	}

	// Fetches one Horizons observer table and parses it into a frozen sample map. Does not touch the cache.
	private async fetchHorizonsSeries(input: HorizonsEphemerisInput, location: GeographicCoordinate, startTime: Temporal, endTime: Temporal): Promise<HorizonsSampleMap> {
		const { longitude, latitude, elevation } = location
		console.info(`fetching ephemeris for ${horizonsFingerprint(input)} at time [${formatTemporal(startTime, undefined, 0)} - ${formatTemporal(endTime, undefined, 0)}] and location [${toDeg(latitude)}, ${toDeg(longitude)}, ${toMeter(elevation).toFixed(0)}]`)
		const rows = await this.observer(input, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1, stepSizeUnit: 'm' })
		const samples: HorizonsSampleMap = new Map()
		makeBodyPositionFromHorizons(rows, samples)
		return samples
	}
}

// Local models. This phase only computes stars and sky points; solar-system bodies stay Horizons-only
// until the cheap analytical models are wired.
class OfflineEphemerisProvider implements EphemerisProvider {
	readonly source = 'offline' as const

	// True for catalog stars and sky points. Solar-system offline models are not enabled yet.
	supports(target: EphemerisTarget): boolean {
		return target.type === 'star' || target.type === 'skyPoint'
	}

	// One sample at `request.start` (the requested utc). Does not build a noon-to-noon tile.
	samples(request: EphemerisSampleRequest): Promise<EphemerisSampleSeries> {
		const { target, location, start } = request
		const req: PositionOfBody = { location, time: { utc: start, offset: 0 } }
		let position: BodyPosition

		if (target.type === 'star') position = positionOfStar(target.object, req)
		else if (target.type === 'skyPoint') position = positionOfSkyPoint(target.rightAscension, target.declination, req)
		else throw new OfflineEphemerisUnavailableError(`offline ephemeris is not implemented for ${target.type}`)

		const samples = new Map<number, BodyPosition>([[start, position]])
		return Promise.resolve({ key: `offline|${target.type}|${start}`, source: 'offline', samples })
	}
}

// Provider selection, Horizons tiles, and local star/sky-point reduction.
export class AtlasEphemeris {
	private readonly horizons: EphemerisProvider
	private readonly offline: EphemerisProvider
	private readonly horizonsTiles: HorizonsEphemerisProvider

	// `options.observer` replaces the NASA client; `options.horizons` / `options.offline` replace the
	// providers used by `position` so selection can be tested without models or NASA.
	constructor(options: AtlasEphemerisOptions = {}) {
		this.horizonsTiles = new HorizonsEphemerisProvider(options.observer ?? horizonsObserver, options.cacheLimit ?? ATLAS_EPHEMERIS_CACHE_LIMIT)
		this.horizons = options.horizons ?? this.horizonsTiles
		this.offline = options.offline ?? new OfflineEphemerisProvider()
	}

	// BodyPosition for `target` at `req`. `fast` prefers offline when it supports the target; otherwise
	// Horizons is used. Stars and sky points are always offline. Horizons times are truncated to the
	// civil minute; star/sky-point times are the requested utc.
	async position(target: EphemerisTarget, req: PositionOfBody): Promise<BodyPosition> {
		const series = await this.resolve(target, req)
		const key = sampleKey(target, req.time.utc)
		const sample = series.samples.get(key)
		if (!sample) throw new Error(`ephemeris not found for ${target.type} at ${formatTemporal(req.time.utc, undefined, 0)}`)
		if (series.source === 'horizons') return projectHorizonsPosition(sample, req)
		return sample
	}

	// Apparent BodyPosition at the civil minute of `req.time.utc`, from a noon-to-noon Horizons series.
	positionFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody): Promise<BodyPosition> {
		return this.position(targetFromHorizonsInput(input), req)
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
	chartOfSkyObject(req: PositionOfBody, object: SkyObject): number[] {
		let [startTime] = computeStartAndEndTime(req.time)
		const data = new Array<number>(1441)
		let ebpv: PositionAndVelocity | undefined

		for (let i = 0; i < data.length; i++) {
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
	// Transient Horizons fallback is not wired yet.
	private resolve(target: EphemerisTarget, req: PositionOfBody): Promise<EphemerisSampleSeries> {
		const [start, end] = computeStartAndEndTime(req.time)
		const point = target.type === 'star' || target.type === 'skyPoint'
		const request: EphemerisSampleRequest = {
			target,
			location: req.location,
			start: point ? req.time.utc : start,
			end: point ? req.time.utc : end,
			stepSize: HORIZONS_STEP_SIZE_SECONDS,
		}

		const mode: EphemerisMode = req.fast ? 'fast' : 'accurate'
		const offlineOk = this.offline.supports(target)
		const horizonsOk = this.horizons.supports(target)

		if (mode === 'fast') {
			if (offlineOk) return this.offline.samples(request)
			if (horizonsOk) return this.horizons.samples(request)
			throw new EphemerisUnavailableError()
		}

		if (horizonsOk) return this.horizons.samples(request)
		if (offlineOk) return this.offline.samples(request)
		throw new EphemerisUnavailableError()
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

// Lookup key in a series: exact utc for stars/sky points, truncated civil minute otherwise.
function sampleKey(target: EphemerisTarget, utc: number): number {
	if (target.type === 'star' || target.type === 'skyPoint') return utc
	return Math.trunc(temporalSet(utc, 0, 's') / 1000)
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
			return target.command ?? ';'
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
// objects; the cached sample is not written.
function projectHorizonsPosition(sample: BodyPosition, req: PositionOfBody): BodyPosition {
	const time = makeTime(req.time.utc, req.location)
	const lst = localSiderealTime(time, req.location, true)
	const [rightAscension, declination] = sample.equatorial

	return {
		magnitude: sample.magnitude,
		constellation: sample.constellation,
		distance: sample.distance,
		illuminated: sample.illuminated,
		elongation: sample.elongation,
		leading: sample.leading,
		names: sample.names,
		equatorial: [rightAscension, declination],
		equatorialJ2000: [sample.equatorialJ2000[0], sample.equatorialJ2000[1]],
		horizontal: [sample.horizontal[0], sample.horizontal[1]],
		ecliptic: equatorialToEcliptic(rightAscension, declination, time),
		galactic: equatorialToGalatic(sample.equatorialJ2000[0], sample.equatorialJ2000[1]),
		lst,
		pierSide: expectedPierSide(rightAscension, declination, lst),
		meridianTimeIn: meridianTimeIn(rightAscension, lst),
	}
}

// Apparent place of a catalog object at `req.time.utc`. Proper motion uses observeStar; otherwise
// J2000 → CIRS → observed. Names are catalog metadata and are left to the handler.
function positionOfStar(dso: SkyObject, req: PositionOfBody): BodyPosition {
	const time = makeTime(req.time.utc, req.location)
	const lst = localSiderealTime(time, req.location, true)

	const horizontal: Writable<BodyPosition['horizontal']> = [0, 0]
	const equatorial: Writable<BodyPosition['equatorial']> = [0, 0]
	const equatorialJ2000 = [dso.rightAscension, dso.declination] as const

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
		const { azimuth, altitude } = cirsToObserved(equatorial, time)
		horizontal[0] = azimuth
		horizontal[1] = altitude
	}

	return {
		magnitude: dso.magnitude,
		constellation: CONSTELLATION_LIST[dso.constellation],
		distance: dso.distance,
		illuminated: 0,
		elongation: 0,
		leading: false,
		equatorial,
		equatorialJ2000,
		horizontal,
		ecliptic: equatorialToEcliptic(...equatorial, time),
		galactic: equatorialToGalatic(...equatorialJ2000),
		lst,
		meridianTimeIn: meridianTimeIn(equatorial[0], lst),
		pierSide: expectedPierSide(...equatorial, lst),
	}
}

// Apparent place of an equatorial CIRS sky point at `req.time.utc`. `rightAscension`/`declination`
// are radians; RA is the equinox-of-date value the caller already parsed.
function positionOfSkyPoint(rightAscension: Angle, declination: Angle, req: PositionOfBody): BodyPosition {
	const time = makeTime(req.time.utc, req.location)
	const lst = localSiderealTime(time, req.location, true)

	const horizontal: Writable<BodyPosition['horizontal']> = [0, 0]
	const equatorial = [rightAscension, declination] as const
	const equatorialJ2000 = equatorialToJ2000(rightAscension, declination, time)

	const { azimuth, altitude } = cirsToObserved(eraS2p(rightAscension, declination, ONE_KILOPARSEC), time)
	horizontal[0] = azimuth
	horizontal[1] = altitude

	return {
		magnitude: 99,
		constellation: constellation(rightAscension, declination, time),
		distance: 0,
		illuminated: 0,
		elongation: 0,
		leading: false,
		equatorial,
		equatorialJ2000,
		horizontal,
		ecliptic: equatorialToEcliptic(rightAscension, declination, time),
		galactic: equatorialToGalatic(...equatorialJ2000),
		lst,
		meridianTimeIn: meridianTimeIn(equatorial[0], lst),
		pierSide: expectedPierSide(rightAscension, declination, lst),
	}
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
			equatorial: Object.freeze([parseAngle(e[5])!, parseAngle(e[6])!]),
			equatorialJ2000: Object.freeze([parseAngle(e[3])!, parseAngle(e[4])!]),
			horizontal: Object.freeze([parseAngle(e[7])!, parseAngle(e[8])!]),
			magnitude: e[9] === 'n.a.' ? null : Number.parseFloat(e[9]),
			constellation: e[15].toUpperCase() as never,
			distance,
			illuminated: Number.parseFloat(e[12]),
			elongation: parseAngle(e[13])!,
			leading: e[14] === '/L',
			galactic: Object.freeze([0, 0]),
			ecliptic: Object.freeze([0, 0]),
			pierSide: 'NEITHER',
			lst: 0,
			meridianTimeIn: 0,
		} satisfies BodyPosition

		output.set(seconds + i * 60, Object.freeze(position))
	}
}
