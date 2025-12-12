import Elysia from 'elysia'
import { deg, PARSE_HOUR_ANGLE, parseAngle } from 'nebulosa/src/angle'
import { cirsToObserved, icrsToObserved } from 'nebulosa/src/astrometry'
import { AU_KM, DAYSEC, DEG2RAD, MOON_SYNODIC_DAYS, SPEED_OF_LIGHT } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST } from 'nebulosa/src/constellation'
import { type CsvRow, readCsv } from 'nebulosa/src/csv'
import { eraC2s, eraS2c } from 'nebulosa/src/erfa'
import { precessFk5FromJ2000 } from 'nebulosa/src/fk5'
import { observer, type Quantity } from 'nebulosa/src/horizons'
import { iersb } from 'nebulosa/src/iers'
import type { UTCTime } from 'nebulosa/src/indi.device'
import { readableStreamSource } from 'nebulosa/src/io'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/location'
import { nearestLunarEclipse, nearestLunarPhase } from 'nebulosa/src/moon'
import { closeApproaches, search } from 'nebulosa/src/sbd'
import { observeStar } from 'nebulosa/src/star'
import { nearestSolarEclipse, season } from 'nebulosa/src/sun'
import { daysInMonth, parseTemporal, type Temporal, temporalAdd, temporalFromTime, temporalGet, temporalSet, temporalStartOfDay, temporalSubtract, temporalToDate } from 'nebulosa/src/temporal'
import { Timescale, time, timeToUnixMillis, timeUnix, timeYMDHMS } from 'nebulosa/src/time'
import { binarySearchWithComparator } from 'nebulosa/src/util'
import { join } from 'path'
import sharp from 'sharp'
import besselianElementsOfSolarEclipsesCsv from '../../data/besselian-elements-of-solar-eclipses.csv' with { type: 'file' }
import nebulosa from '../../data/nebulosa.sqlite' with { embed: 'true', type: 'sqlite' }
// biome-ignore format: too long!
import { type BodyPosition, type ChartOfBody, type CloseApproach, DEFAULT_MINOR_PLANET, expectedPierSide, type FindCloseApproaches, type FindNextLunarEclipse, type FindNextSolarEclipse, type LunarPhaseTime, type MinorPlanet, type MinorPlanetParameter, type NextLunarEclipse, type NextSolarEclipse, type PositionOfBody, SATELLITE_GROUP_TYPES, type Satellite, type SatelliteGroupType, type SearchMinorPlanet, type SearchSatellite, type SearchSkyObject, type SkyObject, type SkyObjectSearchItem, SOLAR_IMAGE_SOURCE_URLS, type SolarImageSource, type SolarSeasons, type Twilight } from '../shared/types'
import type { CacheManager } from './cache'
import type { NotificationHandler } from './notification'

const HORIZONS_QUANTITIES: Quantity[] = [1, 2, 4, 9, 21, 10, 23, 29]

const NAUTICAL_ALTITUDE = -6 * DEG2RAD
const ASTRONOMICAL_ALTITUDE = -12 * DEG2RAD
const NIGHT_ALTITUDE = -18 * DEG2RAD

// The "b" parameter to make background color from 0 to 24 (#181818)
const SOLAR_IMAGE_CONTRAST = 0.8125 // (128 - 24) / 128

const SATELLITE_TLE_URL = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP='

const IERSB_URL = 'https://hpiers.obspm.fr/iers/eop/eopc04/eopc04.1962-now'

export class AtlasHandler {
	private readonly ephemeris: Record<string, Map<number, BodyPosition>> & { location?: GeographicPosition } = {}
	private satellites: Satellite[] = []

	constructor(
		readonly cache: CacheManager,
		readonly notification?: NotificationHandler,
	) {}

	async imageOfSun(source: SolarImageSource) {
		const file = Bun.file(`${Bun.env.tmpDir}/sun-${source}.jpg`)
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
					.toFile(`${Bun.env.tmpDir}/sun-${s}.jpg`)
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
		return this.computeChart('10', req.time)
	}

	seasons(req: PositionOfBody): SolarSeasons {
		const [year] = temporalToDate(req.time.utc)
		const spring = timeToUnixMillis(season(year, 'SPRING')) // Autumn in southern hemisphere
		const summer = timeToUnixMillis(season(year, 'SUMMER')) // Winter in southern hemisphere
		const autumn = timeToUnixMillis(season(year, 'AUTUMN')) // Spring in southern hemisphere
		const winter = timeToUnixMillis(season(year, 'WINTER')) // Summer in southern hemisphere
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

	solarEclipsesFromMeeus(req: FindNextSolarEclipse) {
		const location = this.cache.geographicCoordinate(req.location)
		let time = this.cache.time(temporalStartOfDay(temporalAdd(req.time.utc, req.time.offset, 'm')), location)
		const eclipses: NextSolarEclipse[] = []

		while (req.count-- > 0) {
			const { maximalTime, ...eclipse } = nearestSolarEclipse(time, true)
			;(eclipse as NextSolarEclipse).time = temporalFromTime(maximalTime)
			eclipses.push(eclipse as never)
			time = maximalTime
		}

		return eclipses
	}

	private readonly solarEclipses: NextSolarEclipse[] = []

	// https://eclipse.gsfc.nasa.gov/SEcat5/beselm.html
	// https://eclipse.gsfc.nasa.gov/eclipse_besselian_from_mysqldump2.csv
	async solarEclipsesFromNasa(req: FindNextSolarEclipse) {
		const eclipses = new Array<NextSolarEclipse>(req.count)

		if (this.solarEclipses.length === 0) {
			const csv = readCsv(await Bun.file(besselianElementsOfSolarEclipsesCsv).text())

			for (const row of csv) {
				const [year, month, day, hms, , , type] = row

				if (year[0] === '-') continue

				const time = parseTemporal(`${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${hms}`, 'YYYY-MM-DD HH:mm:ss')

				const eclipse: NextSolarEclipse = {
					time,
					lunation: +row[4],
					magnitude: +row[8],
					gamma: +row[7],
					u: 0,
					type: type === 'T' ? 'TOTAL' : type === 'P' ? 'PARTIAL' : type === 'A' ? 'ANNULAR' : 'HYBRID',
				}

				this.solarEclipses.push(eclipse)
			}
		}

		const time = temporalStartOfDay(temporalAdd(req.time.utc, req.time.offset, 'm'))
		const index = binarySearchWithComparator(this.solarEclipses, (item) => item.time - time, { positive: true })

		for (let i = 0, k = index; i < req.count; i++, k++) {
			eclipses[i] = this.solarEclipses[k]
		}

		return eclipses
	}

	positionOfMoon(req: PositionOfBody) {
		return this.computeFromHorizonsPositionAt('301', req)
	}

	chartOfMoon(req: ChartOfBody) {
		return this.computeChart('301', req.time)
	}

	moonPhases(req: PositionOfBody) {
		const date = temporalToDate(req.time.utc)
		const startTime = timeYMDHMS(date[0], date[1], 1, 0, 0, 0)
		const endTime = timeToUnixMillis(startTime) + daysInMonth(date[0], date[1]) * (DAYSEC * 1000)

		const phases: LunarPhaseTime[] = []

		phases.push(['NEW', timeToUnixMillis(nearestLunarPhase(startTime, 'NEW', true))])
		phases.push(['FIRST_QUARTER', timeToUnixMillis(nearestLunarPhase(startTime, 'FIRST_QUARTER', true))])
		phases.push(['FULL', timeToUnixMillis(nearestLunarPhase(startTime, 'FULL', true))])
		phases.push(['LAST_QUARTER', timeToUnixMillis(nearestLunarPhase(startTime, 'LAST_QUARTER', true))])

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
		return this.computeChart(code, req.time)
	}

	async searchMinorPlanet(req: SearchMinorPlanet): Promise<MinorPlanet | undefined> {
		const result = await search(req.text)

		if ('list' in result) {
			return { ...DEFAULT_MINOR_PLANET, list: result.list }
		} else if ('message' in result) {
			this.notification?.send({ body: result.message, severity: 'error' })
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
		const result = await closeApproaches('now', `${req.days}d`, req.distance)

		const ai = result.fields.indexOf('des')
		const bi = result.fields.indexOf('dist')
		const ci = result.fields.indexOf('jd')

		return result.data.map((e) => {
			const jd = time(+e[ci], 0, Timescale.TDB, false)
			return { name: e[ai], distance: +e[bi] * (AU_KM / 384399), date: temporalFromTime(jd) } as CloseApproach
		})
	}

	searchSkyObject(req: SearchSkyObject) {
		const offset = Math.max(0, (req.page ?? 0) - 1) * req.limit
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

		const q = `SELECT DISTINCT d.id, d.magnitude, d.type, d.constellation, (SELECT n.type || ':' || n.name FROM names n WHERE n.dsoId = d.id ${req.nameType >= 0 ? `AND n.type = ${req.nameType}` : 'ORDER BY n.type'} LIMIT 1) as name FROM dsos d ${joinWhere.length > 1 ? `JOIN names n ON ${joinWhere.join(' AND ')}` : ''} WHERE ${where.join(' AND ')} ORDER BY d.${req.sort.column} ${sortDirection} LIMIT ${req.limit} OFFSET ${offset}`

		return nebulosa.query<SkyObjectSearchItem, []>(q).all()
	}

	positionOfSkyObject(req: PositionOfBody, id: string | number | SkyObject): BodyPosition {
		const dso = typeof id === 'object' ? id : nebulosa.query<SkyObject, []>(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get()!
		const names = nebulosa.query<{ name: string }, []>(`SELECT (n.type || ':' || n.name) as name FROM names n WHERE n.dsoId = ${id}`).all()

		const location = this.cache.geographicCoordinate(req.location)
		const time = this.cache.time(req.time.utc, location)
		const lst = localSiderealTime(time, location, true)

		let azimuth = 0
		let altitude = 0
		let rightAscension = 0
		let declination = 0

		if (dso.pmRa && dso.pmDec) {
			const ebpv = this.cache.earth(time)
			const parallax = dso.distance > 0 ? 1 / dso.distance : 0
			const ob = observeStar({ ...dso, parallax }, time, ebpv)
			;({ azimuth, altitude, rightAscension, declination } = ob)
			// rightAscension -= ob.equationOfOrigins // RA CIO -> RA equinox
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
			pierSide: expectedPierSide(rightAscension, declination, lst),
		}
	}

	chartOfSkyObject(req: ChartOfBody, id: string) {
		let [startTime] = this.computeStartAndEndTime(req.time)

		const dso = nebulosa.query<SkyObject, []>(`SELECT d.* FROM dsos d WHERE d.id = ${id}`).get()!
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
		console.info('loading satellites...')

		const groups = new Set(Object.keys(SATELLITE_GROUP_TYPES) as SatelliteGroupType[])
		const now = Date.now()
		const satellites = new Map<number, Satellite>()

		async function download(group: SatelliteGroupType) {
			console.info(`downloading satellite TLE for group ${group}...`)

			try {
				const signal = AbortSignal.timeout(5000)
				const type = SATELLITE_GROUP_TYPES[group].type
				const response = await fetch(SATELLITE_TLE_URL + type, { signal })

				if (response.ok) {
					const text = await response.text()
					const path = join(Bun.env.satellitesDir, `${now}.${group}.tle`)
					await Bun.write(path, text)
					groups.delete(group)
					readTLE(text, group, false)
					return true
				}
			} catch (e) {
				console.error(`failed to download satellite TLE for group ${group}`)
			}

			return false
		}

		const readTLE = (text: string, group: SatelliteGroupType, outOfDate: boolean) => {
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
						satellites.set(id, { id, name, tle: { line1: name, line2: a, line3: b }, groups: [group], outOfDate })
					}
				}
			}
		}

		this.satellites.length = 0

		// Update TLE files if older than 2 days

		for await (const file of new Bun.Glob('*.tle').scan({ cwd: Bun.env.satellitesDir })) {
			const date = +file.substring(0, 13)
			const group = file.substring(14, file.length - 4) as SatelliteGroupType
			const outOfDate = now - date > 86400 * 1000 * 2

			if (outOfDate) {
				const path = join(Bun.env.satellitesDir, file)
				await Bun.file(path).delete()

				if (groups.has(group)) {
					if (await download(group)) continue
				}
			}

			if (groups.has(group)) {
				const path = join(Bun.env.satellitesDir, `${date}.${group}.tle`)
				const text = await Bun.file(path).text()
				groups.delete(group)
				readTLE(text, group, outOfDate)
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
		const { lastId, text, category, limit = 4 } = req
		const search = text.trim().toUpperCase()
		const groups = category.length === 0 ? [] : req.groups.filter((e) => category.includes(SATELLITE_GROUP_TYPES[e].category))
		const noSearch = search.length === 0

		let count = 0

		function filter(e: Satellite) {
			if (count >= limit) return false
			const found = e.id > lastId && (noSearch || e.name.includes(search)) && groups.length && e.groups.some((e) => groups.includes(e))
			if (found) count++
			return found
		}

		return this.satellites.filter(filter)
	}

	positionOfSatellite(id: number, req: PositionOfBody) {
		const satellite = this.satellites.find((e) => e.id === id)
		if (!satellite) throw new Error(`satellite not found: ${id}`)
		return this.computeFromHorizonsPositionAt(satellite, req)
	}

	chartOfSatellite(id: number, req: ChartOfBody) {
		return this.computeChart(id.toFixed(0), req.time)
	}

	async computeFromHorizonsPositionAt(input: string | Pick<Satellite, 'id' | 'tle'>, req: PositionOfBody) {
		const key = Math.trunc(temporalSet(req.time.utc, 0, 's') / 1000)
		const id = typeof input === 'string' ? input : input.id.toFixed(0)
		const location = this.cache.geographicCoordinate(req.location)

		let position = this.ephemeris[id]?.get(key)

		if (!position || location !== this.ephemeris.location) {
			const [startTime, endTime] = this.computeStartAndEndTime(req.time)
			const code = typeof input === 'string' ? input : input.tle
			const { longitude, latitude, elevation } = req.location
			console.info(`fetching ephemeris for ${code} at time [${startTime} - ${endTime}] and location [${latitude}, ${longitude}, ${elevation}]`)
			const horizons = await observer(code, 'coord', [longitude, latitude, elevation], startTime, endTime, HORIZONS_QUANTITIES, { stepSize: 1 })
			const positions = makeBodyPositionFromHorizons(horizons!)
			const map = this.ephemeris[id] ?? new Map()
			positions.forEach((e) => map.set(e[0], e[1]))
			this.ephemeris[id] = map
			this.ephemeris.location = location
			position = map.get(key)!
		}

		const time = this.cache.time(req.time.utc, location)
		const lst = localSiderealTime(time, location, true)

		position.pierSide = expectedPierSide(position.rightAscension, position.declination, lst)

		return position
	}

	computeChart(code: string, time: UTCTime) {
		const positions = this.ephemeris[code]

		if (!positions) throw new Error(`object not found: ${code}`)

		const [startTime] = this.computeStartAndEndTime(time)
		const seconds = Math.trunc(temporalSet(startTime, 0, 's') / 1000)
		const chart = new Array<number>(1441)

		for (let i = 0; i <= 1440; i++) {
			chart[i] = positions.get(seconds + i * 60)!.altitude
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
					iersb.load(readableStreamSource(data.stream()))
					await Bun.write(path, data)
					console.info('IERS B loaded')
				} else {
					console.error('failed to download IERS B', await response.text())
				}
			} catch (e) {
				console.error('failed to download IERS B', e)
			}
		} else {
			iersb.load(readableStreamSource(file.stream()))
			console.info('IERS B loaded from cache')
		}
	}
}

export function atlas(atlas: AtlasHandler) {
	const app = new Elysia({ prefix: '/atlas' })
		// Endpoints!
		.get('/sun/image', ({ query }) => atlas.imageOfSun(query.source as never))
		.post('/sun/position', ({ body }) => atlas.positionOfSun(body as never))
		.post('/sun/chart', ({ body }) => atlas.chartOfSun(body as never))
		.post('/sun/seasons', ({ body }) => atlas.seasons(body as never))
		.post('/sun/twilight', ({ body }) => atlas.twilight(body as never))
		.post('/sun/eclipses', ({ body }) => atlas.solarEclipsesFromNasa(body as never))
		.post('/moon/position', ({ body }) => atlas.positionOfMoon(body as never))
		.post('/moon/chart', ({ body }) => atlas.chartOfMoon(body as never))
		.post('/moon/phases', ({ body }) => atlas.moonPhases(body as never))
		.post('/moon/eclipses', ({ body }) => atlas.moonEclipses(body as never))
		.post('/minorplanets/search', ({ body }) => atlas.searchMinorPlanet(body as never))
		.post('/minorplanets/closeapproaches', ({ body }) => atlas.findCloseApproaches(body as never))
		.post('/planets/:code/position', ({ params, body }) => atlas.positionOfPlanet(params.code, body as never))
		.post('/planets/:code/chart', ({ params, body }) => atlas.chartOfPlanet(params.code, body as never))
		.post('/skyobjects/search', ({ body }) => atlas.searchSkyObject(body as never))
		.post('/skyobjects/:id/position', ({ params, body }) => atlas.positionOfSkyObject(body as never, params.id))
		.post('/skyobjects/:id/chart', ({ params, body }) => atlas.chartOfSkyObject(body as never, params.id))
		.post('/satellites/search', ({ body }) => atlas.searchSatellites(body as never))
		.post('/satellites/:id/position', ({ params, body }) => atlas.positionOfSatellite(+params.id, body as never))
		.post('/satellites/:id/chart', ({ params, body }) => atlas.chartOfSatellite(+params.id, body as never))

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
