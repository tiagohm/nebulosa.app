import { Database } from 'bun:sqlite'
import { join } from 'path'
import { deg, parseAngle, toDeg } from 'nebulosa/src/angle'
import { cirsToObserved, icrsToObserved } from 'nebulosa/src/astrometry'
import { AU_KM, DAYSEC, DEG2RAD, MOON_SYNODIC_DAYS, PIOVERTWO, SPEED_OF_LIGHT, TAU } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import { equatorialFromJ2000, equatorialToEcliptic, equatorialToGalatic } from 'nebulosa/src/coordinate'
import type { CsvRow } from 'nebulosa/src/csv'
import { toMeter } from 'nebulosa/src/distance'
import { observer, type Quantity } from 'nebulosa/src/horizons'
import { iersb } from 'nebulosa/src/iers'
import { expectedPierSide, meridianTimeIn, type UTCTime } from 'nebulosa/src/indi.device'
import { readableStreamSource } from 'nebulosa/src/io'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/location'
import { nearestLunarApsis, nearestLunarEclipse, nearestLunarPhase } from 'nebulosa/src/moon'
import { closeApproaches, search } from 'nebulosa/src/sbd'
import { observeStar } from 'nebulosa/src/star'
import { nearestSolarEclipse, season } from 'nebulosa/src/sun'
import { daysInMonth, formatTemporal, parseTemporal, type Temporal, temporalAdd, temporalFromTime, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract, temporalToDate } from 'nebulosa/src/temporal'
import { Timescale, time, timeToUnixMillis, timeUnix, timeYMDHMS, tt, utc, type Time } from 'nebulosa/src/time'
import type { Writable } from 'nebulosa/src/types'
import nebulosa from 'src/data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
// oxfmt-ignore
import { type BodyPosition, type ChartOfBody, type CloseApproach, DEFAULT_MINOR_PLANET, type FindCloseApproaches, type FindNextLunarEclipse, type FindSolarEclipse, type LocationAndTime, type LunarPhaseTime, type MinorPlanet, type MinorPlanetParameter, type NextLunarApsis, type NextLunarEclipse, type NextSolarEclipse, type PositionOfBody, SATELLITE_GROUP_TYPES, type Satellite, type SatelliteGroupType, type SearchMinorPlanet, type SearchSatellite, type SearchSkyObject, type SkyObject, type SkyObjectSearchItem, SOLAR_IMAGE_SOURCE_URLS, type SolarImageSource, type SolarSeasons, type Twilight, type PlanetariumRequest, type SolarEclipseMap, type ComputeSolarEclipseLocalCircumstances, type ComputeSolarEclipseLocalView } from '../shared/types'
import { computeSunMoonPositionAt } from 'nebulosa/src/eclipse'
import * as elpmpp02 from 'nebulosa/src/elpmpp02'
import { PlateCarree } from 'nebulosa/src/projection'
import { computeLocalSolarEclipseCircumstances, computeLocalSolarEclipseViewGeometry } from 'nebulosa/src/sun.eclipse.local'
import { computePolynomialBesselianElements, computeSolarEclipseMapGeometry, solarEclipseMapToSvgPaths, type PolynomialBesselianElements, type SolarEclipseContactPoints, type SolarEclipseGeoPoint, type SolarEclipseMapGeometryOptions } from 'nebulosa/src/sun.eclipse.map'
import * as vsop87e from 'nebulosa/src/vsop87e'
import type { CacheManager } from './cache'
import { type Endpoints, query, response } from './http'
import type { NotificationHandler } from './notification'

const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

type SqlValue = number | string | boolean

const DEFAULT_SOLAR_IMAGE_SOURCE: SolarImageSource = 'HMI_INTENSITYGRAM_FLATTENED'
const MAX_SEARCH_LIMIT = 100
const MAX_EVENT_COUNT = 25

const NAUTICAL_ALTITUDE = -6 * DEG2RAD
const ASTRONOMICAL_ALTITUDE = -12 * DEG2RAD
const NIGHT_ALTITUDE = -18 * DEG2RAD

const SATELLITE_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP='

const IERSB_URL = 'https://hpiers.obspm.fr/iers/eop/eopc04/eopc04.1962-now'

const SATELLITES = new Database(':memory:')
const SATELLITE_GROUPS = new Set(Object.keys(SATELLITE_GROUP_TYPES) as SatelliteGroupType[])

const SOLAR_ECLIPSE_MAP_WIDTH = 2520.631
const SOLAR_ECLIPSE_MAP_HEIGHT = 1260.315
const SOLAR_ECLIPSE_MAP_GEOMETRY_OPTIONS: SolarEclipseMapGeometryOptions = { longitudeStep: 0.5 * DEG2RAD, maxAngularStep: 0.5 * DEG2RAD, includeRiseSetCurves: true, riseSetStep: 600 }
const SOLAR_ECLIPSE_MAP_PROJECTION = new PlateCarree(0, { scale: SOLAR_ECLIPSE_MAP_WIDTH / TAU, falseEasting: SOLAR_ECLIPSE_MAP_WIDTH / 2, falseNorthing: SOLAR_ECLIPSE_MAP_HEIGHT / 2, yAxisDirection: 'southUp', centralMeridian: 0, longitudeWrapMode: 'pi', maxLatitude: PIOVERTWO })

SATELLITES.run('PRAGMA journal_mode = OFF;')
SATELLITES.run('PRAGMA synchronous = OFF;')
SATELLITES.run('PRAGMA temp_store = MEMORY;')
SATELLITES.run('PRAGMA locking_mode = EXCLUSIVE;')
SATELLITES.run('PRAGMA cache_size = -262144;')
SATELLITES.run('PRAGMA mmap_size = 0;')
SATELLITES.run('PRAGMA automatic_index = ON;')
SATELLITES.run('PRAGMA optimize;')
SATELLITES.run('PRAGMA foreign_keys = OFF;')
SATELLITES.run('CREATE TABLE satellites (id INTEGER PRIMARY KEY, name TEXT, line1 TEXT, line2 TEXT);')
SATELLITES.run('CREATE TABLE satelliteGroups (satelliteId INTEGER, name TEXT);')
SATELLITES.run('CREATE INDEX satellitesNameIdx ON satellites (name);')
SATELLITES.run('CREATE INDEX satelliteGroupsSatelliteIdIdx ON satelliteGroups (satelliteId);')
SATELLITES.run('CREATE INDEX satelliteGroupsNameIdx ON satelliteGroups (name);')

// Apparent Sun/Moon position provider from the analytical ERFA/Meeus ephemerides (significantly faster).
export function sunMoonPosition(time: Time) {
	return computeSunMoonPositionAt(time, vsop87e.sun, vsop87e.earth, elpmpp02.moon)
}

export function mapSolarEclipseGeoPoint(point?: SolarEclipseGeoPoint) {
	return point && { x: point.x, y: point.y, time: temporalFromTime(utc(time(point.jd!, 0, Timescale.TT))) }
}

export class AtlasHandler {
	private readonly ephemeris: Record<string, Map<number, BodyPosition>> & { location?: GeographicPosition } = {}
	private readonly horizonsObserverTasks = new Map<string, Promise<CsvRow[]>>()
	private readonly solarEclipsePolynomialBesselianElements = new Map<number, PolynomialBesselianElements>()

	constructor(
		readonly cache: CacheManager,
		readonly notification?: NotificationHandler,
	) {}

	async imageOfSun(source: SolarImageSource = DEFAULT_SOLAR_IMAGE_SOURCE) {
		const file = Bun.file(join(Bun.env.tmpDir, `${source}.jpg`))
		if (!(await file.exists())) await this.refreshImageOfSun(source)
		return file
	}

	async refreshImageOfSun(source?: SolarImageSource) {
		for (const [s, url] of Object.entries(SOLAR_IMAGE_SOURCE_URLS)) {
			if (source && s !== source) continue

			try {
				const response = await fetch(url)

				if (!response.ok) {
					console.error('failed to fetch the sun image', s, response.status, response.statusText)
					continue
				}

				const blob = await response.blob()
				if (blob.size > 0) await Bun.write(join(Bun.env.tmpDir, `${s}.jpg`), blob)
			} catch (e) {
				console.error('failed to fetch the sun image', s, e)
			}
		}
	}

	positionOfSun(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('10', req)
	}

	async chartOfSun(req: ChartOfBody) {
		await this.positionOfSun(req)
		return this.computeChart('10', req.time)
	}

	seasons(req: PositionOfBody): SolarSeasons {
		const [year] = temporalToDate(req.time.utc)
		const spring = timeToUnixMillis(season(year, 'spring')) // Autumn in southern hemisphere
		const summer = timeToUnixMillis(season(year, 'summer')) // Winter in southern hemisphere
		const autumn = timeToUnixMillis(season(year, 'autumn')) // Spring in southern hemisphere
		const winter = timeToUnixMillis(season(year, 'winter')) // Summer in southern hemisphere
		return { spring, summer, autumn, winter }
	}

	async twilight(req: PositionOfBody) {
		await this.positionOfSun(req)

		const [startTime, endTime] = this.computeStartAndEndTime(req.time)
		const offset = req.time.offset * 60000
		const sun = this.ephemeris['10']

		const twilight: Twilight = {
			start: [startTime + offset, 0],
			dawn: {
				civil: [0, 0],
				nautical: [0, 0],
				astronomical: [0, 0],
			},
			dusk: {
				civil: [0, 0],
				nautical: [0, 0],
				astronomical: [0, 0],
			},
			day: [0, 0],
			night: [0, 0],
			end: [endTime + offset, 1441],
		}

		let step = 0

		for (let time = startTime, i = 0; time <= endTime; time += 60000, i++) {
			const position = sun.get(Math.trunc(time / 1000))

			if (position) {
				const altitude = position.horizontal[1]

				if (step === 0) {
					if (altitude >= 0) twilight.dusk.civil = [time + offset, i]
					else step = 1
				} else if (step === 1) {
					if (altitude >= NAUTICAL_ALTITUDE) twilight.dusk.nautical = [time + offset, i]
					else step = 2
				} else if (step === 2) {
					if (altitude >= ASTRONOMICAL_ALTITUDE) twilight.dusk.astronomical = [time + offset, i]
					else step = 3
				} else if (step === 3) {
					if (altitude >= NIGHT_ALTITUDE) twilight.night = [time + offset, i]
					else step = 4
				} else if (step === 4) {
					if (altitude < NIGHT_ALTITUDE) twilight.dawn.astronomical = [time + offset, i]
					else step = 5
				} else if (step === 5) {
					if (altitude < ASTRONOMICAL_ALTITUDE) twilight.dawn.nautical = [time + offset, i]
					else step = 6
				} else if (step === 6) {
					if (altitude < NAUTICAL_ALTITUDE) twilight.dawn.civil = [time + offset, i]
					else step = 7
				} else if (step === 7) {
					if (altitude < 0) twilight.day = [time + offset, i]
					else break
				}
			}
		}

		return twilight
	}

	solarEclipses(req: FindSolarEclipse) {
		const location = this.cache.geographicCoordinate(req.location)
		let time = this.cache.time(temporalStartOfDay(temporalAdd(req.time.utc, req.time.offset, 'm')), location)
		const count = normalizeCount(req.count)
		const eclipses = new Array<NextSolarEclipse>(count)

		for (let i = 0; i < count; i++) {
			const eclipse = nearestSolarEclipse(time, req.next)
			time = eclipse.maximalTime

			const nextEclipse = eclipse as unknown as NextSolarEclipse
			nextEclipse.maximalTime = temporalFromTime(utc(eclipse.maximalTime))

			eclipses[i] = nextEclipse
		}

		return eclipses
	}

	solarEclipseMap(req: NextSolarEclipse): SolarEclipseMap {
		const pbe = this.solarEclipsePolynomialBesselianElements.getOrInsertComputed(req.maximalTime, (time) => computePolynomialBesselianElements(tt(timeUnix(time / 1000)), sunMoonPosition))
		const geometry = computeSolarEclipseMapGeometry(req as never, pbe, SOLAR_ECLIPSE_MAP_GEOMETRY_OPTIONS)
		const paths = solarEclipseMapToSvgPaths(geometry, SOLAR_ECLIPSE_MAP_PROJECTION)

		const time0 = temporalFromTime(pbe.time0)
		const maximumTime = temporalFromTime(pbe.maximumTime)
		const elements = { ...pbe, time0, maximumTime }

		const points: SolarEclipseMap['points'] = {}

		for (const [type, point] of Object.entries(geometry.points) as [keyof SolarEclipseContactPoints, SolarEclipseGeoPoint | undefined][]) {
			if (point) points[type] = mapSolarEclipseGeoPoint(point)
		}

		return { elements, points, paths }
	}

	solarEclipseLocalCircumstances(req: ComputeSolarEclipseLocalCircumstances) {
		const pbe = this.solarEclipsePolynomialBesselianElements.getOrInsertComputed(req.next.maximalTime, (time) => computePolynomialBesselianElements(tt(timeUnix(time / 1000)), sunMoonPosition))
		return computeLocalSolarEclipseCircumstances(pbe, req.location.longitude, req.location.latitude, { sunMoonPosition })
	}

	solarEclipseLocalView(req: ComputeSolarEclipseLocalView) {
		return computeLocalSolarEclipseViewGeometry(req, req.options)
	}

	positionOfMoon(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('301', req)
	}

	async chartOfMoon(req: ChartOfBody) {
		await this.positionOfMoon(req)
		return this.computeChart('301', req.time)
	}

	moonPhases(req: PositionOfBody) {
		const date = temporalToDate(req.time.utc)
		const startTime = timeYMDHMS(date[0], date[1], 1, 0, 0, 0)
		const endTime = timeToUnixMillis(startTime) + daysInMonth(date[0], date[1]) * (DAYSEC * 1000)

		const phases: LunarPhaseTime[] = [
			['NEW', timeToUnixMillis(nearestLunarPhase(startTime, 'NEW', true))],
			['FIRST_QUARTER', timeToUnixMillis(nearestLunarPhase(startTime, 'FIRST_QUARTER', true))],
			['FULL', timeToUnixMillis(nearestLunarPhase(startTime, 'FULL', true))],
			['LAST_QUARTER', timeToUnixMillis(nearestLunarPhase(startTime, 'LAST_QUARTER', true))],
		]

		phases.sort((a, b) => a[1] - b[1])

		if (phases[3][1] + (MOON_SYNODIC_DAYS / 4) * DAYSEC * 1000 < endTime) {
			const phase = phases[3][0] === 'NEW' ? 'FIRST_QUARTER' : phases[3][0] === 'FIRST_QUARTER' ? 'FULL' : phases[3][0] === 'FULL' ? 'LAST_QUARTER' : 'NEW'
			const time = timeToUnixMillis(nearestLunarPhase(timeUnix(endTime / 1000), phase, false))
			phases.push([phase, time])
		}

		return phases
	}

	moonEclipses(req: FindNextLunarEclipse) {
		const location = this.cache.geographicCoordinate(req.location)
		let time = this.cache.time(req.time.utc, location)
		const count = normalizeCount(req.count)
		const eclipses = new Array<NextLunarEclipse>(count)

		for (let i = 0; i < count; i++) {
			const eclipse = nearestLunarEclipse(time, true)
			time = eclipse.maximalTime

			const nextEclipse = eclipse as unknown as NextLunarEclipse
			nextEclipse.firstContactPenumbraTime = temporalFromTime(utc(eclipse.firstContactPenumbraTime))
			nextEclipse.maximalTime = temporalFromTime(utc(eclipse.maximalTime))
			nextEclipse.firstContactPenumbraTime = temporalFromTime(utc(eclipse.firstContactPenumbraTime))
			nextEclipse.firstContactUmbraTime = temporalFromTime(utc(eclipse.firstContactUmbraTime))
			nextEclipse.totalBeginTime = temporalFromTime(utc(eclipse.totalBeginTime))
			nextEclipse.totalEndTime = temporalFromTime(utc(eclipse.totalEndTime))
			nextEclipse.lastContactUmbraTime = temporalFromTime(utc(eclipse.lastContactUmbraTime))
			nextEclipse.lastContactPenumbraTime = temporalFromTime(utc(eclipse.lastContactPenumbraTime))

			eclipses[i] = nextEclipse
		}

		return eclipses
	}

	moonApsis(req: LocationAndTime): readonly [NextLunarApsis, NextLunarApsis] {
		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)

		const apogee = nearestLunarApsis(time, 'APOGEE', true)
		const perigee = nearestLunarApsis(time, 'PERIGEE', true)

		return [
			{ time: temporalFromTime(apogee[0]), distance: apogee[1], diameter: apogee[2] },
			{ time: temporalFromTime(perigee[0]), distance: perigee[1], diameter: perigee[2] },
		]
	}

	positionOfPlanet(code: string, req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt(code, req)
	}

	async chartOfPlanet(code: string, req: ChartOfBody) {
		await this.positionOfPlanet(code, req)
		return this.computeChart(code, req.time)
	}

	async searchMinorPlanet(req: SearchMinorPlanet): Promise<MinorPlanet | undefined> {
		const result = await search(req.text)

		if ('list' in result) {
			return { ...DEFAULT_MINOR_PLANET, list: result.list }
		} else if ('message' in result) {
			this.notification?.send({ title: 'SKY ATLAS', description: result.message, color: 'danger' })
			return undefined
		} else {
			const parameters: MinorPlanetParameter[] = []

			for (const e of result.orbit.elements) {
				parameters.push({ name: e.name, description: e.title, value: `${e.value || ''} ${e.units || ''}`.trim() })
			}

			for (const e of result.phys_par) {
				parameters.push({ name: e.name, description: e.title, value: `${e.value || ''} ${e.units || ''}`.trim() })
			}

			const { fullname: name, spkid: id, kind, pha, neo, orbit_class } = result.object

			return { name, id, kind, pha, neo, orbitType: orbit_class.name, parameters }
		}
	}

	async findCloseApproaches(req: FindCloseApproaches) {
		const days = Math.max(1, Math.min(3650, Math.trunc(finiteNumber(req.days) ? req.days : 1)))
		const distance = Math.max(0, finiteNumber(req.distance) ? req.distance : 0)
		const result = await closeApproaches('now', `${days}d`, distance)

		const ai = result.fields.indexOf('des')
		const bi = result.fields.indexOf('dist')
		const ci = result.fields.indexOf('jd')

		return result.data.map((e) => {
			const jd = time(+e[ci], 0, Timescale.TDB, false)
			return { name: e[ai], distance: +e[bi] * (AU_KM / 384399), date: temporalFromTime(jd) } as CloseApproach
		})
	}

	searchSkyObject(req: SearchSkyObject) {
		const { limit, offset } = normalizePagination(req.page, req.limit)
		const nameType = finiteNumber(req.nameType) ? Math.trunc(req.nameType) : -1
		const radius = finiteNumber(req.radius) ? req.radius : 0
		const visibleAbove = finiteNumber(req.visibleAbove) ? req.visibleAbove : -1
		const where = []
		const joinWhere = ['n.dsoId = d.id']
		const selectParams: SqlValue[] = []
		const joinParams: SqlValue[] = []
		const whereParams: SqlValue[] = []

		const types = (Array.isArray(req.types) ? req.types : []).filter(finiteNumber).map(Math.trunc)
		const constellations = (Array.isArray(req.constellations) ? req.constellations : []).map((e) => CONSTELLATION_LIST.indexOf(e)).filter((e) => e >= 0)

		if (types.length > 0) {
			where.push(`d.type IN (${placeholders(types.length)})`)
			whereParams.push(...types)
		}

		if (constellations.length > 0) {
			where.push(`d.constellation IN (${placeholders(constellations.length)})`)
			whereParams.push(...constellations)
		}

		if (nameType >= 0) {
			selectParams.push(nameType)
			joinWhere.push('n.type = ?')
			joinParams.push(nameType)
		}

		if (finiteNumber(req.magnitudeMin) && req.magnitudeMin > -30) {
			where.push('d.magnitude >= ?')
			whereParams.push(req.magnitudeMin)
		}

		if (finiteNumber(req.magnitudeMax) && req.magnitudeMax < 30) {
			where.push('d.magnitude <= ?')
			whereParams.push(req.magnitudeMax)
		}

		const name = req.name.trim()

		if (name)
			if (name.startsWith('=')) {
				joinWhere.push('n.name = ?')
				joinParams.push(name.slice(1).trim())
			} else {
				joinWhere.push('n.name LIKE ?')
				joinParams.push(name.includes('%') ? name : `%${name}%`)
			}

		if (radius > 0 && req.rightAscension && req.declination) {
			const rightAscension = parseAngle(req.rightAscension, true)
			const declination = parseAngle(req.declination)

			if (rightAscension !== undefined && declination !== undefined) {
				where.push('(acos(sin(d.declination) * ? + cos(d.declination) * ? * cos(d.rightAscension - ?)) <= ?)')
				whereParams.push(Math.sin(declination), Math.cos(declination), rightAscension, deg(radius))
			}
		}

		if (req.visible && visibleAbove >= 0) {
			const location = this.cache.geographicCoordinate(req.location)
			const time = this.cache.time(req.time.utc, location)
			const lst = localSiderealTime(time, location, true)

			where.push('(asin(sin(d.declination) * ? + cos(d.declination) * ? * cos(? - d.rightAscension)) >= ?)')
			whereParams.push(Math.sin(location.latitude), Math.cos(location.latitude), lst, deg(visibleAbove))
		}

		if (where.length === 0) where.push('1 = 1')

		const sortColumn = 'magnitude' // req.sort.column
		const sortDirection = 'ASC' // req.sort.direction === 'ascending' ? 'ASC' : 'DESC'
		const q = `SELECT DISTINCT d.id, d.magnitude, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ${nameType >= 0 ? 'AND n.type = ?' : 'ORDER BY n.type'} LIMIT 1) as name FROM dsos d ${joinWhere.length > 1 ? `JOIN names n ON ${joinWhere.join(' AND ')}` : ''} WHERE ${where.join(' AND ')} ORDER BY d.${sortColumn} ${sortDirection} LIMIT ? OFFSET ?`

		return nebulosa.query<SkyObjectSearchItem, SqlValue[]>(q).all(...selectParams, ...joinParams, ...whereParams, limit, offset)
	}

	positionOfSkyObject(req: PositionOfBody, id: string | number | SkyObject): BodyPosition {
		const dso = typeof id === 'object' ? id : this.skyObject(id)
		const names = nebulosa.query<{ name: string }, [number]>("SELECT (n.type || ':' || n.name) as name FROM names n WHERE n.dsoId = ?").all(dso.id)

		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)
		const lst = localSiderealTime(time, location, true)

		const horizontal: Writable<BodyPosition['horizontal']> = [0, 0]
		const equatorial: Writable<BodyPosition['equatorial']> = [0, 0]
		const equatorialJ2000 = [dso.rightAscension, dso.declination] as const

		if (dso.pmRA && dso.pmDEC) {
			const ebpv = this.cache.earth(time)
			const parallax = dso.distance > 0 ? 1 / dso.distance : 0
			const ob = observeStar({ ...dso, parallax }, time, ebpv)
			equatorial[0] = ob.rightAscension
			equatorial[1] = ob.declination
			horizontal[0] = ob.azimuth
			horizontal[1] = ob.altitude
			// rightAscension -= ob.equationOfOrigins // RA CIO -> RA equinox
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
			names: names.map((n) => n.name),
		}
	}

	chartOfSkyObject(req: ChartOfBody, id: string) {
		let [startTime] = this.computeStartAndEndTime(req.time)

		const dso = this.skyObject(id)
		const location = this.cache.geographicCoordinate(req.location)
		const data = new Array<number>(1441)

		// Generate chart data for each minute
		for (let i = 0; i < data.length; i++) {
			const time = this.cache.time(startTime, location)
			const ebpv = this.cache.earth(time)

			if (dso.pmRA && dso.pmDEC) {
				const parallax = dso.distance > 0 ? 1 / dso.distance : 0
				data[i] = observeStar({ ...dso, parallax }, time, ebpv).altitude
			} else {
				data[i] = icrsToObserved([dso.rightAscension, dso.declination], time, ebpv).altitude
			}

			startTime += 60000
		}

		return data
	}

	planetarium(req: PlanetariumRequest) {
		const q = `SELECT d.id, d.magnitude, d.rightAscension, d.declination, d.pmRA, d.pmDEC, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ORDER BY n.type LIMIT 1) as name FROM dsos d WHERE d.magnitude <= ${req.magnitudeLimit} AND d.type IN (${placeholders(req.types.length)})`

		return nebulosa.query<SkyObject, SqlValue[]>(q).all(...req.types)
	}

	async refreshSatellites() {
		console.info('loading satellites...')

		const groups = new Set(SATELLITE_GROUPS)
		const now = Date.now()
		const satellites = new Set<number>()

		async function download(group: SatelliteGroupType) {
			console.info(`downloading satellite TLE for group ${group}...`)

			try {
				const signal = AbortSignal.timeout(5000)
				const { type } = SATELLITE_GROUP_TYPES[group]
				const response = await fetch(SATELLITE_TLE_URL + type, { signal })

				if (response.ok) {
					const text = await response.text()
					const path = join(Bun.env.satellitesDir, `${now}.${group}.tle`)
					await Bun.write(path, text)
					groups.delete(group)
					readTLE(text, group)
					return true
				}
			} catch (e) {
				console.error(`failed to download satellite TLE for group ${group}`)
			}

			return false
		}

		const readTLE = (text: string, group: SatelliteGroupType) => {
			const lines = text.split('\n')

			for (let i = 0; i < lines.length - 2; i += 3) {
				const a = lines[i + 1]
				const b = lines[i + 2]

				if (a && b) {
					const id = +a.slice(2, 7)
					const satellite = satellites.has(id)

					if (!satellite) {
						const name = lines[i].trim()
						SATELLITES.run('INSERT INTO satellites VALUES (?, ?, ?, ?)', [id, name, a, b])
						satellites.add(id)
					}

					SATELLITES.run('INSERT INTO satelliteGroups VALUES (?, ?)', [id, group])
				}
			}
		}

		SATELLITES.run('BEGIN;')

		try {
			SATELLITES.run('DELETE FROM satelliteGroups;')
			SATELLITES.run('DELETE FROM satellites;')

			// Update TLE files if older than 2 days.
			for await (const file of new Bun.Glob('*.tle').scan({ cwd: Bun.env.satellitesDir })) {
				const date = +file.slice(0, 13)
				const group = file.slice(14, file.length - 4) as SatelliteGroupType
				const outOfDate = now - date > 86400 * 1000 * 2

				if (!SATELLITE_GROUPS.has(group)) continue

				if (outOfDate) {
					if (groups.has(group)) {
						if (await download(group)) {
							const path = join(Bun.env.satellitesDir, file)
							await Bun.file(path).delete()
							continue
						}
					}
				}

				if (groups.has(group)) {
					const path = join(Bun.env.satellitesDir, file)
					const text = await Bun.file(path).text()
					groups.delete(group)
					readTLE(text, group)
				}
			}

			// Create TLE files for missing groups.
			for (const group of groups) {
				await download(group)
			}

			SATELLITES.run('COMMIT;')
		} catch (e) {
			try {
				SATELLITES.run('ROLLBACK;')
			} catch {
				// Keep the original refresh failure as the actionable error.
			}

			throw e
		}

		console.info(`loaded ${satellites.size} satellites`)
	}

	searchSatellites(req: SearchSatellite) {
		const { limit, offset } = normalizePagination(req.page, req.limit)
		const name = req.text.trim().toUpperCase()
		const categories = new Set(Array.isArray(req.category) ? req.category : [])
		const groups = (Array.isArray(req.groups) ? req.groups : []).filter(isSatelliteGroup)
		const searchGroups = categories.size === 0 ? groups : groups.filter((e) => categories.has(SATELLITE_GROUP_TYPES[e].category))

		const where = ['WHERE 1=1']
		const joinWhere = ['sg.satelliteId = s.id']
		const joinParams: SqlValue[] = []
		const whereParams: SqlValue[] = []

		if (name)
			if (name.startsWith('=')) {
				where.push('s.name = ?')
				whereParams.push(name.slice(1).trim())
			} else {
				where.push('s.name LIKE ?')
				whereParams.push(name.includes('%') ? name : `%${name}%`)
			}

		if (searchGroups.length > 0) {
			joinWhere.push(`sg.name IN (${placeholders(searchGroups.length)})`)
			joinParams.push(...searchGroups)
		}

		const sortColumn = 'name' // req.sort.column
		const sortDirection = 'ASC' // req.sort.direction === 'ascending' ? 'ASC' : 'DESC'
		const q = `SELECT DISTINCT s.id, s.name, s.line1, s.line2 FROM satellites s ${joinWhere.length > 1 ? `JOIN satelliteGroups sg ON ${joinWhere.join(' AND ')}` : ''} ${where.join(' AND ')} ORDER BY s.${sortColumn} ${sortDirection} LIMIT ? OFFSET ?`
		const satellites = SATELLITES.query<Satellite, SqlValue[]>(q).all(...joinParams, ...whereParams, limit, offset)
		this.fillSatelliteGroups(satellites)
		return satellites
	}

	positionOfSatellite(id: string | number, req: PositionOfBody) {
		const satellite = this.satellite(id)
		return this.computeFromHorizonsPositionAt(satellite, req)
	}

	async chartOfSatellite(id: string | number, req: ChartOfBody) {
		const satellite = this.satellite(id)
		await this.computeFromHorizonsPositionAt(satellite, req)
		return this.computeChart(`TLE:${satellite.id}`, req.time)
	}

	private skyObject(id: string | number) {
		const normalizedId = normalizeId(id)
		if (normalizedId === undefined) throw new Error(`sky object not found: ${id}`)

		const dso = nebulosa.query<SkyObject, [number]>('SELECT d.* FROM dsos d WHERE d.id = ?').get(normalizedId)
		if (!dso) throw new Error(`sky object not found: ${id}`)
		return dso
	}

	private satellite(id: string | number) {
		const normalizedId = normalizeId(id)
		if (normalizedId === undefined) throw new Error(`satellite not found: ${id}`)

		const satellite = SATELLITES.query<Satellite, [number]>('SELECT s.id, s.name, s.line1, s.line2 FROM satellites s WHERE s.id = ?').get(normalizedId)
		if (!satellite) throw new Error(`satellite not found: ${id}`)
		return satellite
	}

	private fillSatelliteGroups(satellites: Satellite[]) {
		if (satellites.length === 0) return

		const ids = satellites.map((e) => e.id)
		const groups = SATELLITES.query<{ satelliteId: number; name: SatelliteGroupType }, number[]>(`SELECT satelliteId, name FROM satelliteGroups WHERE satelliteId IN (${placeholders(ids.length)}) ORDER BY name`).all(...ids)
		const bySatellite = new Map<number, SatelliteGroupType[]>()

		for (const group of groups) {
			let list = bySatellite.get(group.satelliteId)

			if (!list) {
				list = []
				bySatellite.set(group.satelliteId, list)
			}

			list.push(group.name)
		}

		for (const satellite of satellites) {
			satellite.groups = bySatellite.get(satellite.id) ?? []
		}
	}

	async computeFromHorizonsPositionAt(input: string | Omit<Satellite, 'name' | 'groups'>, req: PositionOfBody) {
		const key = Math.trunc(temporalSet(req.time.utc, 0, 's') / 1000)
		const id = typeof input === 'string' ? input : `TLE:${input.id}`
		const location = this.cache.geographicCoordinate(req.location)
		const [startTime, endTime] = this.computeStartAndEndTime(req.time)

		const ephemeris = this.ephemeris[id]
		let position: Writable<BodyPosition> | undefined = ephemeris?.get(key)

		if (!ephemeris || !position || location !== this.ephemeris.location || !ephemeris.has(Math.trunc(startTime / 1000)) || !ephemeris.has(Math.trunc(endTime / 1000))) {
			const { longitude, latitude, elevation } = location

			const taskId = `${id}${startTime}${endTime}${location.longitude}${location.latitude}${location.elevation}`
			let horizonsObserverTask = this.horizonsObserverTasks.get(taskId)

			if (!horizonsObserverTask) {
				console.info(`fetching ephemeris for ${id} at time [${formatTemporal(startTime, undefined, 0)} - ${formatTemporal(endTime, undefined, 0)}] and location [${toDeg(latitude)}, ${toDeg(longitude)}, ${toMeter(elevation).toFixed(0)}]`)
				horizonsObserverTask = observer(input, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1 })
				this.horizonsObserverTasks.set(taskId, horizonsObserverTask)
				const onCompleted = () => this.horizonsObserverTasks.delete(taskId)
				horizonsObserverTask.then(onCompleted, onCompleted)
			}

			const map = ephemeris ?? new Map()
			makeBodyPositionFromHorizons(await horizonsObserverTask, map)
			this.ephemeris[id] = map
			this.ephemeris.location = location
			position = map.get(key)
			if (!position) throw new Error(`ephemeris not found for ${id} at ${formatTemporal(req.time.utc, undefined, 0)}`)
		}

		const time = this.cache.time(req.time.utc, location)
		const lst = localSiderealTime(time, location, true)

		const [rightAscension, declination] = position.equatorial
		position.pierSide = expectedPierSide(rightAscension, declination, lst)
		position.meridianTimeIn = meridianTimeIn(rightAscension, lst)
		position.lst = lst
		Object.assign(position.ecliptic, equatorialToEcliptic(rightAscension, declination, time))
		Object.assign(position.galactic, equatorialToGalatic(position.equatorialJ2000[0], position.equatorialJ2000[1]))

		return position
	}

	computeChart(code: string, time: UTCTime) {
		const positions = this.ephemeris[code]

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

	async refreshEarthOrientationData() {
		const path = join(Bun.env.appDir, 'eopc04.txt')
		const file = Bun.file(path)

		if (!(await file.exists()) || Date.now() - (await file.stat()).mtimeMs > DAYSEC * 1000) {
			try {
				console.info('downloading IERS B...')
				const signal = AbortSignal.timeout(5000)
				const response = await fetch(IERSB_URL, { signal })

				if (response.ok) {
					const data = await response.blob()
					await iersb.load(readableStreamSource(data.stream()))
					await Bun.write(path, data)
					console.info('IERS B loaded')
				} else {
					console.error('failed to download IERS B:', await response.text())
				}
			} catch (e) {
				console.error('failed to download IERS B:', (e as Error).message)
			}
		} else {
			await iersb.load(readableStreamSource(file.stream()))
			console.info('IERS B loaded from cache')
		}
	}
}

export function atlas(atlas: AtlasHandler) {
	return {
		'/atlas/sun/image': { GET: async (req) => new Response(await atlas.imageOfSun(solarImageSource(query(req).source))) },
		'/atlas/sun/position': { POST: async (req) => response(await atlas.positionOfSun(await req.json())) },
		'/atlas/sun/chart': { POST: async (req) => response(await atlas.chartOfSun(await req.json())) },
		'/atlas/sun/seasons': { POST: async (req) => response(atlas.seasons(await req.json())) },
		'/atlas/sun/twilight': { POST: async (req) => response(await atlas.twilight(await req.json())) },
		'/atlas/sun/eclipses': { POST: async (req) => response(atlas.solarEclipses(await req.json())) },
		'/atlas/sun/eclipses/map': { POST: async (req) => response(atlas.solarEclipseMap(await req.json())) },
		'/atlas/sun/eclipses/local/circumstances': { POST: async (req) => response(atlas.solarEclipseLocalCircumstances(await req.json())) },
		'/atlas/sun/eclipses/local/view': { POST: async (req) => response(atlas.solarEclipseLocalView(await req.json())) },
		'/atlas/moon/position': { POST: async (req) => response(await atlas.positionOfMoon(await req.json())) },
		'/atlas/moon/chart': { POST: async (req) => response(await atlas.chartOfMoon(await req.json())) },
		'/atlas/moon/phases': { POST: async (req) => response(atlas.moonPhases(await req.json())) },
		'/atlas/moon/eclipses': { POST: async (req) => response(atlas.moonEclipses(await req.json())) },
		'/atlas/moon/apsis': { POST: async (req) => response(atlas.moonApsis(await req.json())) },
		'/atlas/minorplanets/search': { POST: async (req) => response(await atlas.searchMinorPlanet(await req.json())) },
		'/atlas/minorplanets/closeapproaches': { POST: async (req) => response(await atlas.findCloseApproaches(await req.json())) },
		'/atlas/planets/:code/position': { POST: async (req) => response(await atlas.positionOfPlanet(req.params.code, await req.json())) },
		'/atlas/planets/:code/chart': { POST: async (req) => response(await atlas.chartOfPlanet(req.params.code, await req.json())) },
		'/atlas/skyobjects/search': { POST: async (req) => response(atlas.searchSkyObject(await req.json())) },
		'/atlas/skyobjects/:id/position': { POST: async (req) => response(atlas.positionOfSkyObject(await req.json(), req.params.id)) },
		'/atlas/skyobjects/:id/chart': { POST: async (req) => response(atlas.chartOfSkyObject(await req.json(), req.params.id)) },
		'/atlas/satellites/search': { POST: async (req) => response(atlas.searchSatellites(await req.json())) },
		'/atlas/satellites/:id/position': { POST: async (req) => response(await atlas.positionOfSatellite(req.params.id, await req.json())) },
		'/atlas/satellites/:id/chart': { POST: async (req) => response(await atlas.chartOfSatellite(req.params.id, await req.json())) },
		'/atlas/planetarium': { POST: async (req) => response(atlas.planetarium(await req.json())) },
	} as const satisfies Endpoints
}

function finiteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function normalizeCount(value: unknown) {
	return Math.max(0, Math.min(MAX_EVENT_COUNT, Math.trunc(finiteNumber(value) ? value : 0)))
}

function normalizeId(value: string | number) {
	if (typeof value === 'string' && !/^\d+$/.test(value)) return undefined

	const id = typeof value === 'number' ? value : Number.parseInt(value, 10)
	return Number.isSafeInteger(id) && id >= 0 ? id : undefined
}

function normalizePagination(page: unknown, limit: unknown) {
	const normalizedLimit = Math.max(0, Math.min(MAX_SEARCH_LIMIT, Math.trunc(finiteNumber(limit) ? limit : 0)))
	const normalizedPage = Math.max(1, Math.trunc(finiteNumber(page) ? page : 1))
	return { limit: normalizedLimit, offset: (normalizedPage - 1) * normalizedLimit } as const
}

function placeholders(count: number) {
	return Array.from({ length: count }, () => '?').join(',')
}

function solarImageSource(source: unknown): SolarImageSource {
	return typeof source === 'string' && source in SOLAR_IMAGE_SOURCE_URLS ? (source as SolarImageSource) : DEFAULT_SOLAR_IMAGE_SOURCE
}

function isSatelliteGroup(value: unknown): value is SatelliteGroupType {
	return typeof value === 'string' && SATELLITE_GROUPS.has(value as SatelliteGroupType)
}

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
