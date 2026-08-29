import { observer as horizonsObserver } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { Quantity } from 'nebulosa/src/adapters/ephemeris/horizons'
import { equatorialToEcliptic, equatorialToGalatic } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { formatTemporal, parseTemporal, temporalAdd, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Temporal } from 'nebulosa/src/astronomy/time/temporal'
import { AU_KM, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import { expectedPierSide, meridianTimeIn } from 'nebulosa/src/devices/indi/device'
import type { UTCTime } from 'nebulosa/src/devices/indi/device'
import type { CsvRow } from 'nebulosa/src/io/csv'
import { parseAngle, toDeg } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { BodyPosition, PositionOfBody } from '#/atlas'
import type { Satellite } from '#/satellite'
import { makeTime } from './util'

// Horizons observer table, cache, noon-to-noon window, and chart materialization for the Atlas.
//
// Cached series are immutable and keyed by source, target fingerprint, model, window, step, and
// observer (longitude, latitude, elevation). `fast`, flags, and `time.offset` are not part of the
// physical identity; offset still affects the window through computeStartAndEndTime. Derived frames
// (LST, pier, ecliptic, galactic) are allocated on a new BodyPosition at request time.
//
// Distances are AU. Angles are radians. Instants are Unix milliseconds. The Horizons step is 1 minute
// with an explicit stepSizeUnit so the adapter default of 60 minutes cannot silently apply. The
// requested utc is still truncated to the civil minute.

// Maximum number of noon-to-noon Horizons series retained. Each tile is ~1441 samples; eviction is
// LRU by series, not by sample count.
export const ATLAS_EPHEMERIS_CACHE_LIMIT = 64

// Horizons observer-table sampling interval used by this extraction, in seconds.
const HORIZONS_STEP_SIZE_SECONDS = 60

// Horizons observer() used by the service. Tests inject a mock so they do not need NASA.
export type HorizonsObserver = typeof horizonsObserver

// Construction options. VSOP/ELP/SGP4 are not injected: they are pure functions.
export interface AtlasEphemerisOptions {
	// Horizons observer-table client. Defaults to the nebulosa adapter.
	readonly observer?: HorizonsObserver
	// Maximum cached series. Defaults to ATLAS_EPHEMERIS_CACHE_LIMIT. Tests pass a smaller cap.
	readonly cacheLimit?: number
}

// Horizons observer-table target: a COMMAND string or a TLE (id plus line hash is the fingerprint).
export type HorizonsEphemerisInput = string | Omit<Satellite, 'name' | 'groups'>

// Quantities requested from Horizons: astrometric RA/Dec, apparent RA/Dec, Az/El, visual magnitude,
// one-way light-time, illuminated fraction, solar elongation, and constellation.
const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

// Cached noon-to-noon Horizons samples, keyed by truncated Unix seconds. Entries are frozen.
type HorizonsSampleMap = Map<number, BodyPosition>

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

// Horizons observer-table ephemeris for Sun, Moon, planets, minor bodies by COMMAND, and TLE satellites.
export class AtlasEphemeris {
	private readonly observer: HorizonsObserver
	private readonly cache: SeriesLruCache
	private readonly inflight = new Map<string, Promise<HorizonsSampleMap>>()

	// `options.observer` replaces the NASA client; omitted uses the nebulosa Horizons adapter.
	constructor(options: AtlasEphemerisOptions = {}) {
		this.observer = options.observer ?? horizonsObserver
		this.cache = new SeriesLruCache(options.cacheLimit ?? ATLAS_EPHEMERIS_CACHE_LIMIT)
	}

	// Apparent BodyPosition at the civil minute of `req.time.utc`, from a noon-to-noon Horizons series.
	//
	// `input` is a Horizons COMMAND (`10`, `301`, `599`, `DES=…;`, …) or a TLE. The lookup key is the
	// Unix second of `temporalSet(utc, 0, 's')` truncated, so milliseconds and seconds of the request
	// are ignored. On a cache miss the whole local noon-to-noon window is fetched at 1 min. The
	// returned object is a new BodyPosition; the cached sample is not mutated.
	async positionFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody): Promise<BodyPosition> {
		const key = Math.trunc(temporalSet(req.time.utc, 0, 's') / 1000)
		const samples = await this.horizonsSeries(input, req)
		const position = samples.get(key)
		if (!position) throw new Error(`ephemeris not found for ${horizonsFingerprint(input)} at ${formatTemporal(req.time.utc, undefined, 0)}`)
		return projectHorizonsPosition(position, req)
	}

	// 1441 altitudes (radians) at 1 min from the cached noon-to-noon series for `input` at `req`.
	//
	// The series must already have been fetched for this observer and window; a missing sample throws.
	chartFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody): number[] {
		const [startTime, endTime] = this.computeStartAndEndTime(req.time)
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
	//
	// Keys are truncated Unix seconds. Twilight reads Sun altitudes from this map after a position
	// fetch has populated the tile.
	cachedPositions(input: HorizonsEphemerisInput, req: PositionOfBody): HorizonsSampleMap | undefined {
		const [startTime, endTime] = this.computeStartAndEndTime(req.time)
		return this.cache.get(horizonsSeriesKey(input, req.location, startTime, endTime))
	}

	// Local noon-to-noon window containing `time`, as UTC milliseconds.
	//
	// Noon is 12:00 at `time.offset` (minutes east of UTC). If the local hour is before 12, the window
	// starts at the previous local noon. The returned instants are UTC; they are 720 − offset minutes
	// after local midnight.
	computeStartAndEndTime(time: UTCTime): readonly [Temporal, Temporal] {
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

	// Loads the noon-to-noon Horizons tile for `input` at `req`, sharing in-flight work on the same key.
	private horizonsSeries(input: HorizonsEphemerisInput, req: PositionOfBody): Promise<HorizonsSampleMap> {
		const [startTime, endTime] = this.computeStartAndEndTime(req.time)
		const seriesKey = horizonsSeriesKey(input, req.location, startTime, endTime)
		const cached = this.cache.get(seriesKey)
		if (cached) return Promise.resolve(cached)

		const pending = this.inflight.get(seriesKey)
		if (pending) return pending

		const task = this.fetchHorizonsSeries(input, req.location, startTime, endTime)
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
			equatorial: Object.freeze([parseAngle(e[5])!, parseAngle(e[6])!]) as BodyPosition['equatorial'],
			equatorialJ2000: Object.freeze([parseAngle(e[3])!, parseAngle(e[4])!]) as BodyPosition['equatorialJ2000'],
			horizontal: Object.freeze([parseAngle(e[7])!, parseAngle(e[8])!]) as BodyPosition['horizontal'],
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
