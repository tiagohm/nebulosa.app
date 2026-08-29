import { observer as horizonsObserver } from 'nebulosa/src/adapters/ephemeris/horizons'
import type { Quantity } from 'nebulosa/src/adapters/ephemeris/horizons'
import { equatorialToEcliptic, equatorialToGalatic } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { formatTemporal, parseTemporal, temporalAdd, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Temporal } from 'nebulosa/src/astronomy/time/temporal'
import { AU_KM, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import type { Writable } from 'nebulosa/src/core/types'
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
// This is the first extraction of ephemeris work from AtlasHandler. Behaviour matches the previous
// in-handler path: the requested utc is truncated to the civil minute, Horizons is sampled every 60 s
// over the local noon-to-noon window, and derived frames (LST, pier, ecliptic, galactic) are written
// onto the cached sample. Identity of the cache still uses one shared location; that bug is fixed in a
// later phase.
//
// Distances are AU. Angles are radians. Instants are Unix milliseconds. The Horizons step is 1 minute
// with an explicit stepSizeUnit so the adapter default of 60 minutes cannot silently apply.

// Horizons observer() used by the service. Tests inject a mock so they do not need NASA.
export type HorizonsObserver = typeof horizonsObserver

// Construction options. VSOP/ELP/SGP4 are not injected: they are pure functions.
export interface AtlasEphemerisOptions {
	// Horizons observer-table client. Defaults to the nebulosa adapter.
	readonly observer?: HorizonsObserver
}

// Horizons observer-table target: a COMMAND string or a TLE (id is used only as the cache key).
export type HorizonsEphemerisInput = string | Omit<Satellite, 'name' | 'groups'>

// Quantities requested from Horizons: astrometric RA/Dec, apparent RA/Dec, Az/El, visual magnitude,
// one-way light-time, illuminated fraction, solar elongation, and constellation.
const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

// Cached noon-to-noon Horizons series, keyed by COMMAND or `TLE:${id}` and then by truncated Unix seconds.
// `location` is the observer of the last fetch and is shared by every target (existing identity bug).
type HorizonsEphemerisCache = Record<string, Map<number, BodyPosition>> & { location?: GeographicCoordinate }

// Horizons observer-table ephemeris for Sun, Moon, planets, minor bodies by COMMAND, and TLE satellites.
export class AtlasEphemeris {
	private readonly observer: HorizonsObserver
	private readonly cache: HorizonsEphemerisCache = {}
	private readonly horizonsObserverTasks = new Map<string, Promise<CsvRow[]>>()

	// `options.observer` replaces the NASA client; omitted uses the nebulosa Horizons adapter.
	constructor(options: AtlasEphemerisOptions = {}) {
		this.observer = options.observer ?? horizonsObserver
	}

	// Apparent BodyPosition at the civil minute of `req.time.utc`, from a noon-to-noon Horizons series.
	//
	// `input` is a Horizons COMMAND (`10`, `301`, `599`, `DES=…;`, …) or a TLE. The lookup key is the
	// Unix second of `temporalSet(utc, 0, 's')` truncated, so milliseconds and seconds of the request
	// are ignored. On a cache miss the whole local noon-to-noon window is fetched at 1 min. The
	// returned object aliases the cached sample and is then mutated with LST, pier side, meridian
	// time, ecliptic, and galactic of the current request.
	async positionFromHorizons(input: HorizonsEphemerisInput, req: PositionOfBody): Promise<BodyPosition> {
		const key = Math.trunc(temporalSet(req.time.utc, 0, 's') / 1000)
		const id = horizonsCacheId(input)
		const [startTime, endTime] = this.computeStartAndEndTime(req.time)

		const ephemeris = this.cache[id]
		let position: Writable<BodyPosition> | undefined = ephemeris?.get(key)
		const { longitude, latitude, elevation } = req.location

		if (!ephemeris || !position || latitude !== this.cache.location?.latitude || longitude !== this.cache.location?.longitude || elevation !== this.cache.location?.elevation || !ephemeris.has(Math.trunc(startTime / 1000)) || !ephemeris.has(Math.trunc(endTime / 1000))) {
			const taskId = `${id}${startTime}${endTime}${longitude}${latitude}${elevation}`
			let horizonsObserverTask = this.horizonsObserverTasks.get(taskId)

			if (!horizonsObserverTask) {
				console.info(`fetching ephemeris for ${id} at time [${formatTemporal(startTime, undefined, 0)} - ${formatTemporal(endTime, undefined, 0)}] and location [${toDeg(latitude)}, ${toDeg(longitude)}, ${toMeter(elevation).toFixed(0)}]`)
				horizonsObserverTask = this.observer(input, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1, stepSizeUnit: 'm' })
				this.horizonsObserverTasks.set(taskId, horizonsObserverTask)
				const onCompleted = () => this.horizonsObserverTasks.delete(taskId)
				horizonsObserverTask.then(onCompleted, onCompleted)
			}

			const map = ephemeris ?? new Map()
			makeBodyPositionFromHorizons(await horizonsObserverTask, map)
			this.cache[id] = map
			this.cache.location = req.location
			position = map.get(key)
			if (!position) throw new Error(`ephemeris not found for ${id} at ${formatTemporal(req.time.utc, undefined, 0)}`)
		}

		const time = makeTime(req.time.utc, req.location)
		const lst = localSiderealTime(time, req.location, true)

		const [rightAscension, declination] = position.equatorial
		position.pierSide = expectedPierSide(rightAscension, declination, lst)
		position.meridianTimeIn = meridianTimeIn(rightAscension, lst)
		position.lst = lst
		Object.assign(position.ecliptic, equatorialToEcliptic(rightAscension, declination, time))
		Object.assign(position.galactic, equatorialToGalatic(position.equatorialJ2000[0], position.equatorialJ2000[1]))

		return position
	}

	// 1441 altitudes (radians) at 1 min from the cached noon-to-noon series for `code`.
	//
	// `code` is the same cache id as positionFromHorizons (`10`, `301`, a planet COMMAND, or
	// `TLE:${id}`). The series must already have been fetched; a missing sample throws.
	chartFromHorizons(code: string, time: UTCTime): number[] {
		const positions = this.cache[code]

		if (!positions) throw new Error(`object not found: ${code}`)

		const [startTime, endTime] = this.computeStartAndEndTime(time)
		console.info(`generating chart for ${code} at time [${formatTemporal(startTime, undefined, 0)} - ${formatTemporal(endTime, undefined, 0)}]`)

		const seconds = Math.trunc(startTime / 1000)
		const chart = new Array<number>(1441)

		for (let i = 0; i <= 1440; i++) {
			const position = positions.get(seconds + i * 60)
			if (!position) throw new Error(`ephemeris not found for ${code} at chart index ${i}`)
			chart[i] = position.horizontal[1]
		}

		return chart
	}

	// Cached Horizons series for `id`, or undefined if that target has not been fetched yet.
	//
	// Keys are truncated Unix seconds. Twilight reads Sun altitudes from this map after a position
	// fetch has populated `10`.
	cachedPositions(id: string): Map<number, BodyPosition> | undefined {
		return this.cache[id]
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
}

// Cache key for a Horizons target: the COMMAND string, or `TLE:` plus the NORAD id.
function horizonsCacheId(input: HorizonsEphemerisInput) {
	return typeof input === 'string' ? input : `TLE:${input.id}`
}

// Parses a Horizons observer CSV into `output`, keyed by Unix seconds on a uniform 1 min grid.
//
// The first row's calendar date (YYYY-MMM-DD HH:mm) is the origin; row i is origin + i minutes. Light
// time is converted to AU with `SPEED_OF_LIGHT * 0.06 / AU_KM` (light-time minutes × c). An empty
// table throws. Galactic, ecliptic, LST, pier, and meridian are left at defaults for the caller to
// fill at request time.
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
			// Computed on-demand
			galactic: [0, 0],
			ecliptic: [0, 0],
			pierSide: 'NEITHER',
			lst: 0,
			meridianTimeIn: 0,
		} satisfies BodyPosition

		output.set(seconds + i * 60, position)
	}
}
