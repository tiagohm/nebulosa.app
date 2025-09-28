import Elysia from 'elysia'
import { deg, PARSE_HOUR_ANGLE, parseAngle } from 'nebulosa/src/angle'
import { cirsToObserved, icrsToObserved } from 'nebulosa/src/astrometry'
import { AU_KM, DAYSEC, DEG2RAD, MOON_SYNODIC_DAYS, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import type { CsvRow } from 'nebulosa/src/csv'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { precessFk5FromJ2000 } from 'nebulosa/src/fk5'
import { observer, type Quantity } from 'nebulosa/src/horizons'
import { localSiderealTime } from 'nebulosa/src/location'
import { nearestLunarEclipse, nearestLunarPhase } from 'nebulosa/src/moon'
import { observeStar } from 'nebulosa/src/star'
import { nearestSolarEclipse, season } from 'nebulosa/src/sun'
import { daysInMonth, parseTemporal, type Temporal, temporalAdd, temporalFromTime, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract, temporalToDate } from 'nebulosa/src/temporal'
import { timeUnix, timeYMDHMS, toUnixMillis } from 'nebulosa/src/time'
import { join } from 'path'
import sharp from 'sharp'
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
// biome-ignore format: too long!
import { type BodyPosition, type ChartOfBody, expectedPierSide, type FindNextLunarEclipse, type FindNextSolarEclipse, type LunarPhaseTime, type NextLunarEclipse, type NextSolarEclipse, type PositionOfBody, SATELLITE_GROUP_TYPES, type Satellite, type SatelliteGroupType, type SearchSatellite, type SearchSkyObject, type SkyObject, type SkyObjectSearchItem, SOLAR_IMAGE_SOURCE_URLS, type SolarImageSource, type SolarSeasons, type Twilight, type UTCTime } from '../shared/types'
import type { CacheManager } from './cache'

const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

const NAUTICAL_ALTITUDE = -6 * DEG2RAD
const ASTRONOMICAL_ALTITUDE = -12 * DEG2RAD
const NIGHT_ALTITUDE = -18 * DEG2RAD

// The "b" parameter to make background color from 0 to 24 (#181818)
const SOLAR_IMAGE_CONTRAST = 0.8125 // (128 - 24) / 128

const SATELLITE_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP='

export class AtlasManager {
	private readonly ephemeris: Record<string, Map<number, BodyPosition>> = {}
	private satellites: Satellite[] = []

	constructor(readonly cache: CacheManager) {}

	async imageOfSun(source: SolarImageSource) {
		const file = Bun.file(`/dev/shm/sun-${source}.jpg`)
		if (!(await file.exists())) await this.refreshImageOfSun(source)
		return file
	}

	async refreshImageOfSun(source?: SolarImageSource) {
		for (const [s, url] of Object.entries(SOLAR_IMAGE_SOURCE_URLS)) {
			if (source && s !== source) continue

			// Fetch and process the image

			try {
				const response = await fetch(url)
				const bytes = await response.arrayBuffer()
				await sharp(bytes)
					.linear(SOLAR_IMAGE_CONTRAST, -(128 * SOLAR_IMAGE_CONTRAST) + 128)
					.toFile(`/dev/shm/sun-${s}.jpg`)
			} catch (e) {
				console.error(e)
				break
			}
		}
	}

	positionOfSun(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('10', req)
	}

	chartOfSun(req: ChartOfBody) {
		return this.computeChart('10', req.time, 1)
	}

	seasons(req: PositionOfBody): SolarSeasons {
		const [year] = temporalToDate(req.time.utc)
		const spring = toUnixMillis(season(year, 'SPRING')) // Autumn in southern hemisphere
		const summer = toUnixMillis(season(year, 'SUMMER')) // Winter in southern hemisphere
		const autumn = toUnixMillis(season(year, 'AUTUMN')) // Spring in southern hemisphere
		const winter = toUnixMillis(season(year, 'WINTER')) // Summer in southern hemisphere
		return { spring, summer, autumn, winter }
	}

	async twilight(req: PositionOfBody) {
		await this.positionOfSun(req)

		const [startTime, endTime] = this.computeStartAndEndTime(req.time)
		const offset = req.time.offset * 60000
		const sun = this.ephemeris['10']!

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
				const { altitude } = position

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

	solarEclipses(req: FindNextSolarEclipse) {
		const location = this.cache.geographicCoordinate(req.location)
		let time = this.cache.time(req.time.utc, location)
		const eclipses: NextSolarEclipse[] = []

		while (req.count-- > 0) {
			const { maximalTime, ...eclipse } = nearestSolarEclipse(time, true)
			;(eclipse as NextSolarEclipse).time = temporalFromTime(maximalTime)
			eclipses.push(eclipse as never)
			time = maximalTime
		}

		return eclipses
	}

	positionOfMoon(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('301', req)
	}

	chartOfMoon(req: ChartOfBody) {
		return this.computeChart('301', req.time, 1)
	}

	moonPhases(req: PositionOfBody) {
		const date = temporalToDate(req.time.utc)
		const startTime = timeYMDHMS(date[0], date[1], 1, 0, 0, 0)
		const endTime = toUnixMillis(startTime) + daysInMonth(date[0], date[1]) * (DAYSEC * 1000)

		const phases: LunarPhaseTime[] = []

		for (let i = 0; i < 4; i++) {
			const time = toUnixMillis(nearestLunarPhase(startTime, i, true))
			phases.push([i, time])
		}

		phases.sort((a, b) => a[1] - b[1])

		if (phases[3][1] + (MOON_SYNODIC_DAYS / 4) * DAYSEC * 1000 < endTime) {
			const phase = (phases[3][0] + 1) % 4
			const time = toUnixMillis(nearestLunarPhase(timeUnix(endTime / 1000), phase, false))
			phases.push([phase, time])
		}

		return phases
	}

	moonEclipses(req: FindNextLunarEclipse) {
		const location = this.cache.geographicCoordinate(req.location)
		let time = this.cache.time(req.time.utc, location)
		const eclipses: NextLunarEclipse[] = []

		while (req.count-- > 0) {
			const { type, firstContactPenumbraTime, lastContactPenumbraTime, maximalTime } = nearestLunarEclipse(time, true)
			time = maximalTime
			eclipses.push({ type, startTime: temporalFromTime(firstContactPenumbraTime), endTime: temporalFromTime(lastContactPenumbraTime), time: temporalFromTime(maximalTime) })
		}

		return eclipses
	}

	positionOfPlanet(code: string, req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt(code, req)
	}

	chartOfPlanet(code: string, req: ChartOfBody) {
		return this.computeChart(code, req.time, 1)
	}

	searchMinorPlanet() {}

	closeApproachesForMinorPlanets() {}

	searchSkyObject(req: SearchSkyObject) {
		const limit = 5
		const offset = Math.max(0, (req.page ?? 0) - 1) * limit
		const where = []
		const joinWhere = ['n.dsoId = d.id']

		if (req.types.length) where.push(`d.type IN (${req.types.join(',')})`)
		if (req.constellations.length) where.push(`d.constellation IN (${req.constellations.map((e) => CONSTELLATION_LIST.indexOf(e)).join(',')})`)
		if (req.nameType >= 0) joinWhere.push(`n.type = ${req.nameType}`)
		if (req.magnitudeMin > -30) where.push(`d.magnitude >= ${req.magnitudeMin}`)
		if (req.magnitudeMax < 30) where.push(`d.magnitude <= ${req.magnitudeMax}`)

		const name = req.name.trim()

		if (name)
			if (name.startsWith('=')) joinWhere.push(`n.name = '${name.substring(1).trim()}'`)
			else if (name.includes('%')) joinWhere.push(`n.name LIKE '${name}'`)
			else joinWhere.push(`n.name LIKE '%${name}%'`)

		if (req.radius > 0 && req.rightAscension && req.declination) {
			const rightAscension = parseAngle(req.rightAscension, PARSE_HOUR_ANGLE)!
			const declination = parseAngle(req.declination)!

			where.push(`(acos(sin(d.declination) * ${Math.sin(declination)} + cos(d.declination) * ${Math.cos(declination)} * cos(d.rightAscension - ${rightAscension})) <= ${deg(req.radius)})`)
		}

		if (req.visible && req.visibleAbove >= 0) {
			const location = this.cache.geographicCoordinate(req.location)
			const time = this.cache.time(req.time.utc, location)
			const lst = localSiderealTime(time, location, true)

			where.push(`(asin(sin(d.declination) * ${Math.sin(location.latitude)} + cos(d.declination) * ${Math.cos(location.latitude)} * cos(${lst} - d.rightAscension)) >= ${deg(req.visibleAbove)})`)
		}

		if (!where.length) where.push('1 = 1')

		const sortDirection = req.sort.direction === 'ascending' ? 'ASC' : 'DESC'

		const q = `SELECT DISTINCT d.id, d.magnitude, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ${req.nameType >= 0 ? `AND n.type = ${req.nameType}` : 'ORDER BY n.type'} LIMIT 1) as name FROM dsos d ${joinWhere.length > 1 ? `JOIN names n ON ${joinWhere.join(' AND ')}` : ''} WHERE ${where.join(' AND ')} ORDER BY d.${req.sort.column} ${sortDirection} LIMIT ${limit} OFFSET ${offset}`

		return nebulosa.query(q).all() as SkyObjectSearchItem[]
	}

	positionOfSkyObject(req: PositionOfBody, id: string | number | SkyObject): BodyPosition {
		const dso = typeof id === 'object' ? id : (nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObject)
		const names = nebulosa.query(`SELECT (n.type || ':' || n.name) as name FROM names n WHERE n.dsoId = ${id}`).all() as { name: string }[]

		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)

		let azimuth = 0
		let altitude = 0
		let rightAscension = 0
		let declination = 0

		if (dso.pmRa && dso.pmDec) {
			const ebpv = this.cache.earth(time)
			const parallax = dso.distance > 0 ? 1 / dso.distance : 0
			const ob = observeStar({ ...dso, parallax }, time, ebpv)
			;({ azimuth, altitude, rightAscension, declination } = ob)
		} else {
			const cirs = precessFk5FromJ2000(eraS2c(dso.rightAscension, dso.declination), time)
			;({ azimuth, altitude } = cirsToObserved(cirs, time))
			;[rightAscension, declination] = eraC2s(...cirs)
		}

		return {
			magnitude: dso.magnitude,
			constellation: CONSTELLATION_LIST[dso.constellation],
			distance: dso.distance,
			illuminated: 0,
			elongation: 0,
			leading: false,
			rightAscension,
			declination,
			rightAscensionJ2000: dso.rightAscension,
			declinationJ2000: dso.declination,
			azimuth,
			altitude,
			names: names.map((n) => n.name),
			pierSide: expectedPierSide(rightAscension, declination, localSiderealTime(time, location, true)),
		}
	}

	chartOfSkyObject(req: ChartOfBody, id: string) {
		let [startTime] = this.computeStartAndEndTime(req.time)

		const dso = nebulosa.query(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get() as SkyObject
		const location = this.cache.geographicCoordinate(req.location)
		const data = new Array<number>(1441)

		// Generate chart data for each minute
		for (let i = 0; i < data.length; i++) {
			const time = this.cache.time(startTime, location)

			const ebpv = this.cache.earth(time)

			if (dso.pmRa && dso.pmDec) {
				const parallax = dso.distance > 0 ? 1 / dso.distance : 0
				data[i] = observeStar({ ...dso, parallax }, time, ebpv).altitude
			} else {
				data[i] = icrsToObserved([dso.rightAscension, dso.declination], time, ebpv).altitude
			}

			startTime += 60000
		}

		return data
	}

	async refreshSatellites() {
		const groups = new Set(Object.keys(SATELLITE_GROUP_TYPES) as SatelliteGroupType[])
		const now = Date.now()
		const satellites = new Map<number, Satellite>()

		async function download(group: SatelliteGroupType) {
			try {
				const type = SATELLITE_GROUP_TYPES[group].type
				const response = await fetch(SATELLITE_TLE_URL + type)

				if (response.ok) {
					const text = await response.text()
					const path = join(Bun.env.satellitesDir, `${now}.${group}.tle`)
					await Bun.write(path, text)
					groups.delete(group)
					readTLE(text, group)
				}
			} catch (e) {
				console.error(e)
			}
		}

		const readTLE = (text: string, group: SatelliteGroupType) => {
			const lines = text.split('\n')

			for (let i = 0; i < lines.length - 2; i += 3) {
				const a = lines[i + 1]
				const b = lines[i + 2]

				if (a && b) {
					const id = +a.substring(2, 7)
					const satellite = satellites.get(id)

					if (satellite) {
						if (!satellite.groups.includes(group)) satellite.groups.push(group)
					} else {
						const name = lines[i].trim()
						satellites.set(id, { id, name, tle: { line1: name, line2: a, line3: b }, groups: [group] })
					}
				}
			}
		}

		this.satellites.length = 0

		// Update TLE files if older than 2 days

		for await (const file of new Bun.Glob('*.tle').scan({ cwd: Bun.env.satellitesDir })) {
			const date = +file.substring(0, 13)
			const group = file.substring(14, file.length - 4) as SatelliteGroupType

			if (now - date > 86400 * 1000 * 2) {
				if (groups.has(group)) {
					await download(group)
				}
			} else {
				const path = join(Bun.env.satellitesDir, `${date}.${group}.tle`)
				const text = await Bun.file(path).text()
				groups.delete(group)
				readTLE(text, group)
			}
		}

		// Create TLE files for missing groups

		for (const group of groups) {
			await download(group)
		}

		console.info(`loaded ${satellites.size} satellites`)

		this.satellites = Array.from(satellites.values()).sort((a, b) => a.id - b.id)
	}

	searchSatellites(req: SearchSatellite) {
		const { lastId, text, groups, limit = 5 } = req
		const search = text.trim().toUpperCase()
		const noSearch = search.length === 0
		const noGroups = groups.length === 0

		if (noSearch && noGroups && lastId === 0) return this.satellites.slice(0, limit)

		let count = 0

		function filter(e: Satellite) {
			if (count >= limit) return false
			const found = e.id > lastId && (noSearch || e.name.includes(search)) && (noGroups || e.groups.some((e) => groups.includes(e)))
			if (found) count++
			return found
		}

		return this.satellites.filter(filter)
	}

	positionOfSatellite(req: PositionOfBody, id: number | Satellite) {
		const satellite = typeof id === 'number' ? this.satellites.find((e) => e.id === id) : id
		if (!satellite) throw new Error(`satellite not found: ${id}`)
		return this.computeFromHorizonsPositionAt(satellite, req)
	}

	chartOfSatellite(req: ChartOfBody, id: number | Satellite) {
		const satellite = typeof id === 'number' ? this.satellites.find((e) => e.id === id) : id
		if (!satellite) throw new Error(`satellite not found: ${id}`)
		return this.computeChart(satellite.id.toFixed(0), req.time, 1)
	}

	async computeFromHorizonsPositionAt(input: string | Pick<Satellite, 'id' | 'tle'>, req: PositionOfBody) {
		const key = Math.trunc(temporalSet(req.time.utc, 0, 's') / 1000)

		const id = typeof input === 'string' ? input : input.id.toFixed(0)

		let position = this.ephemeris[id]?.get(key)

		if (!position) {
			const [startTime, endTime] = this.computeStartAndEndTime(req.time)
			const code = typeof input === 'string' ? input : input.tle
			const { longitude, latitude, elevation } = req.location
			const horizons = await observer(code, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1 })
			const positions = makeBodyPositionFromHorizons(horizons!)
			const map = this.ephemeris[id] ?? new Map()
			positions.forEach((e) => map.set(e[0], e[1]))
			this.ephemeris[id] = map
			position = map.get(key)!
		}

		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)
		position.pierSide = expectedPierSide(position.rightAscension, position.declination, localSiderealTime(time, location, true))

		return position
	}

	computeChart(code: string, time: UTCTime, stepSizeInMinutes: number) {
		const positions = this.ephemeris[code]!

		const [startTime] = this.computeStartAndEndTime(time)
		const seconds = temporalSet(startTime, 0, 's') / 1000
		const chart: number[] = []

		chart.push(positions.get(seconds)!.altitude)

		for (let i = stepSizeInMinutes; i <= 1440 - stepSizeInMinutes; i += stepSizeInMinutes) {
			chart.push(positions.get(seconds + i * 60)!.altitude)
		}

		chart.push(positions.get(seconds + 1440 * 60)!.altitude)

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
}

export function atlas(atlas: AtlasManager) {
	const app = new Elysia({ prefix: '/atlas' })
		// Endpoints!
		// '/minorplanets'
		// '/minorplanets/closeapproaches'
		.get('/sun/image', ({ query }) => atlas.imageOfSun(query.source as never))
		.post('/sun/position', ({ body }) => atlas.positionOfSun(body as never))
		.post('/sun/chart', ({ body }) => atlas.chartOfSun(body as never))
		.post('/sun/seasons', ({ body }) => atlas.seasons(body as never))
		.post('/sun/twilight', ({ body }) => atlas.twilight(body as never))
		.post('/sun/eclipses', ({ body }) => atlas.solarEclipses(body as never))
		.post('/moon/position', ({ body }) => atlas.positionOfMoon(body as never))
		.post('/moon/chart', ({ body }) => atlas.chartOfMoon(body as never))
		.post('/moon/phases', ({ body }) => atlas.moonPhases(body as never))
		.post('/moon/eclipses', ({ body }) => atlas.moonEclipses(body as never))
		.post('/planets/:code/position', ({ params, body }) => atlas.positionOfPlanet(params.code, body as never))
		.post('/planets/:code/chart', ({ params, body }) => atlas.chartOfPlanet(params.code, body as never))
		.post('/skyobjects/search', ({ body }) => atlas.searchSkyObject(body as never))
		.post('/skyobjects/:id/position', ({ params, body }) => atlas.positionOfSkyObject(body as never, params.id))
		.post('/skyobjects/:id/chart', ({ params, body }) => atlas.chartOfSkyObject(body as never, params.id))
		.post('/satellites/search', ({ body }) => atlas.searchSatellites(body as never))
		.post('/satellites/position', ({ body }) => atlas.positionOfSatellite(body as never, body as never))
		.post('/satellites/chart', ({ body }) => atlas.chartOfSatellite(body as never, body as never))

	return app
}

function makeBodyPositionFromHorizons(ephemeris: CsvRow[]): readonly [number, BodyPosition][] {
	const seconds = Math.trunc(parseTemporal(ephemeris[0][0], 'YYYY-MMM-DD HH:mm') / 1000)

	return ephemeris.map((e, i) => {
		const lightTime = parseFloat(e[11]) || 0
		const distance = lightTime * ((SPEED_OF_LIGHT * 0.06) / AU_KM) // AU

		return [
			seconds + i * 60,
			{
				rightAscensionJ2000: parseAngle(e[3]),
				declinationJ2000: parseAngle(e[4]),
				rightAscension: parseAngle(e[5]),
				declination: parseAngle(e[6]),
				azimuth: parseAngle(e[7]),
				altitude: parseAngle(e[8]),
				magnitude: e[9] === 'n.a.' ? null : parseFloat(e[9]),
				constellation: e[15].toUpperCase(),
				distance,
				illuminated: parseFloat(e[12]),
				elongation: parseAngle(e[13]),
				leading: e[14] === '/L',
				pierSide: 'NEITHER',
			} as BodyPosition,
		]
	})
}
