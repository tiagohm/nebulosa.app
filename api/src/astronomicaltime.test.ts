import { describe, expect, test } from 'bun:test'
import { rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { dut1 as sharedDut1, iersab } from 'nebulosa/src/astronomy/time/iers'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { type AstronomicalTimeInput, type AstronomicalTimeReference, type AstronomicalTimeRequest, type AstronomicalTimeResult, AstronomicalTimeService, createAstronomicalTimeRoutes } from './astronomicaltime'
import { EarthOrientationData, type EarthOrientationOptions } from './astronomicaltime.eop'

const SITE = { latitude: -22, longitude: -45, elevation: 850 }
const NOW = Date.UTC(2026, 9, 31, 12)
const DAY = 86_400_000

// Values of astropy 7.1.1 and pyerfa 2.0.1.5 for 2024-03-15T06:00:00 UTC at SITE, with erfa.gmst06 and erfa.gst06a.
const GOLDEN = {
	input: { kind: 'calendar', year: 2024, month: 3, day: 15, hour: 6, minute: 0, second: 0, reference: { kind: 'scale', scale: 'UTC' } } as AstronomicalTimeInput,
	withoutEop: { gmst: 4.596096517041777, gast: 4.596075751863016, lmst: 3.8106983536443284, last: 3.810677588465568 },
	withEop: { dut1: -0.0123, gmst: 4.596095620111602, gast: 4.596074854932842, lmst: 3.810697456714154, last: 3.8106766915353933 },
	scales: { tai: '2460384.750428241', tt: '2460384.750800741', tdb: '2460384.750800759', tcg: '2460384.750812756', tcb: '2460384.751068073' },
	julian: 2024.2019186878597,
	besselian: 2024.2037131310267,
}

// One row of finals2000A, with its fixed columns, for a day of a constant UT1-UTC.
function finalsRow(mjd: number, dut1: number) {
	return `       ${mjd.toFixed(2).padStart(8)}   ${(0.1).toFixed(6).padStart(9)}          ${(0.2).toFixed(6).padStart(9)}            ${dut1.toFixed(7).padStart(10)}`.padEnd(188)
}

// Serves finals2000A rows for the days around an instant, and fails for every other table.
function fakeDownload(center: number, dut1: number, requests: string[] = []): NonNullable<EarthOrientationOptions['fetch']> {
	const mjd = Math.floor(center / DAY) + 40587
	const rows = Array.from({ length: 21 }, (_, i) => finalsRow(mjd + i - 10, dut1)).join('\n')

	return (url) => {
		requests.push(url)
		return Promise.resolve(url.includes('finals2000A') ? new Response(rows) : new Response('', { status: 503 }))
	}
}

// Returns a converter on an empty directory of its own, with its clock at `now`, and removes the directory afterwards.
async function withService(run: (service: AstronomicalTimeService, eop: EarthOrientationData) => Promise<void>, options: EarthOrientationOptions = {}, now: number = NOW) {
	const directory = join(tmpdir(), `nebulosa-iers-${crypto.randomUUID()}`)
	const eop = new EarthOrientationData({ directory, fetch: () => Promise.reject(new Error('offline')), now: () => now, ...options })

	try {
		await run(new AstronomicalTimeService(eop, () => now), eop)
		await eop.settled()
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

// Converts through the route, returning the status and the body.
async function post(service: AstronomicalTimeService, request: Partial<AstronomicalTimeRequest>) {
	const { POST } = createAstronomicalTimeRoutes(service)['/api/astronomical-time/convert']
	const response = await POST(new Request('http://localhost/api/astronomical-time/convert', { method: 'POST', body: JSON.stringify({ timeZone: 'UTC', ...request }) }) as Bun.BunRequest<'/api/astronomical-time/convert'>)
	return { status: response.status, body: (await response.json()) as AstronomicalTimeResult & { code: string; earlier: number; later: number } }
}

async function converted(service: AstronomicalTimeService, input: AstronomicalTimeInput, rest: Partial<AstronomicalTimeRequest> = {}) {
	const { status, body } = await post(service, { input, ...rest })
	expect(status).toBe(200)
	return body
}

const utcCalendar = (year: number, month: number, day: number, hour: number, minute: number, second: number): AstronomicalTimeInput => ({ kind: 'calendar', year, month, day, hour, minute, second, reference: { kind: 'scale', scale: 'UTC' } })

describe('scales', () => {
	test('reads a Julian date in its own scale', () =>
		withService(async (service) => {
			const { scales } = await converted(service, { kind: 'jd', value: '2451545.0', scale: 'TT' })
			expect(scales.TT).toEqual({ calendar: '2000-01-01T12:00:00.000', jd: '2451545.000000000', mjd: '51544.500000000' })
			expect(scales.UTC.calendar).toBe('2000-01-01T11:58:55.816')
		}))

	test('TT leads TAI by exactly 32.184 s', () =>
		withService(async (service) => {
			const { scales } = await converted(service, utcCalendar(2024, 3, 15, 6, 0, 0))
			expect(scales.TAI.calendar).toBe('2024-03-15T06:00:37.000')
			expect(scales.TT.calendar).toBe('2024-03-15T06:01:09.184')
		}))

	test('matches the golden scales, with a topocentric TDB', () =>
		withService(async (service) => {
			const { scales, epochs } = await converted(service, GOLDEN.input, { observer: SITE })
			expect(scales.TAI.jd).toBe(GOLDEN.scales.tai)
			expect(scales.TT.jd).toBe(GOLDEN.scales.tt)
			expect(scales.TDB.jd).toBe(GOLDEN.scales.tdb)
			expect(scales.TCG.jd).toBe(GOLDEN.scales.tcg)
			expect(scales.TCB.jd).toBe(GOLDEN.scales.tcb)
			expect(epochs.julian).toBeCloseTo(GOLDEN.julian, 9)
			expect(epochs.besselian).toBeCloseTo(GOLDEN.besselian, 9)
		}))

	test('keeps the digits of a long Julian date', () =>
		withService(async (service) => {
			const { scales } = await converted(service, { kind: 'jd', value: '2460384.123456789', scale: 'TDB' })
			expect(scales.TDB.jd).toBe('2460384.123456789')
			expect(scales.TDB.mjd).toBe('60383.623456789')
		}))

	test('formats a Modified Julian Date before its origin', () =>
		withService(async (service) => {
			const { scales } = await converted(service, { kind: 'mjd', value: '-1.25', scale: 'TT' })
			expect(scales.TT.mjd).toBe('-1.250000000')
			expect(scales.TT.jd).toBe('2399999.250000000')
		}))

	test('round trips between input forms', () =>
		withService(async (service) => {
			const first = await converted(service, utcCalendar(2026, 10, 31, 23, 59, 59.5))
			const fromJd = await converted(service, { kind: 'jd', value: first.scales.UTC.jd, scale: 'UTC' })
			const fromMjd = await converted(service, { kind: 'mjd', value: first.scales.TT.mjd, scale: 'TT' })
			const fromUnix = await converted(service, { kind: 'unix', seconds: first.civil.unixMillis! / 1000 })
			expect(fromJd.scales.UTC.calendar).toBe(first.scales.UTC.calendar)
			expect(fromMjd.scales.UTC.calendar).toBe(first.scales.UTC.calendar)
			expect(fromUnix.scales.UTC.calendar).toBe(first.scales.UTC.calendar)
			expect(first.scales.UTC.calendar).toBe('2026-10-31T23:59:59.500')
		}))

	test('reads epochs in TT', () =>
		withService(async (service) => {
			const julian = await converted(service, { kind: 'julianEpoch', value: 2000 })
			expect(julian.scales.TT.jd).toBe('2451545.000000000')
			const besselian = await converted(service, { kind: 'besselianEpoch', value: 1950 })
			expect(besselian.scales.TT.jd).toBe('2433282.423459050')
			expect(besselian.epochs.besselian).toBeCloseTo(1950, 9)
		}))

	test('numbers the days of the year', () =>
		withService(async (service) => {
			expect((await converted(service, utcCalendar(2024, 12, 31, 12, 0, 0))).epochs.dayOfYear).toBe(366)
			expect((await converted(service, utcCalendar(2023, 1, 1, 0, 0, 0))).epochs.dayOfYear).toBe(1)
		}))

	test('reads years below 100 and before the common era', () =>
		withService(async (service) => {
			expect((await converted(service, utcCalendar(50, 6, 15, 12, 0, 0), { timeZone: 'America/Sao_Paulo' })).scales.UTC.calendar).toBe('0050-06-15T12:00:00.000')
			expect((await converted(service, { kind: 'jd', value: '0.0', scale: 'TT' })).scales.TT.calendar).toBe('-4713-11-24T12:00:00.000')
		}))
})

describe('leap seconds', () => {
	test('keeps an inserted second, which POSIX cannot represent', () =>
		withService(async (service) => {
			const { civil, scales, offsets } = await converted(service, utcCalendar(2016, 12, 31, 23, 59, 60), { timeZone: 'America/Sao_Paulo' })
			expect(scales.UTC.calendar).toBe('2016-12-31T23:59:60.000')
			expect(civil.leapSecond).toBeTrue()
			expect(civil.unixMillis).toBeUndefined()
			expect(civil.local).toBe('2016-12-31T21:59:60.000')
			expect(scales.TAI.calendar).toBe('2017-01-01T00:00:36.000')
			expect(offsets.taiMinusUtc).toBe(36)
		}))

	test('keeps an inserted second given with an offset', () =>
		withService(async (service) => {
			const { scales } = await converted(service, { kind: 'calendar', year: 2016, month: 12, day: 31, hour: 21, minute: 59, second: 60, reference: { kind: 'offset', minutes: -120 } })
			expect(scales.UTC.calendar).toBe('2016-12-31T23:59:60.000')
		}))

	test('refuses a :60 on any other day or minute', () =>
		withService(async (service) => {
			expect(await post(service, { input: utcCalendar(2017, 1, 1, 23, 59, 60) })).toMatchObject({ status: 422, body: { code: 'nonexistentTime' } })
			expect(await post(service, { input: utcCalendar(2016, 12, 31, 12, 0, 60) })).toMatchObject({ status: 422, body: { code: 'nonexistentTime' } })
			expect(await post(service, { input: { kind: 'calendar', year: 2016, month: 12, day: 31, hour: 23, minute: 59, second: 60, reference: { kind: 'scale', scale: 'TT' } } })).toMatchObject({ status: 422 })
		}))

	test('states what it knows of leap seconds', () =>
		withService(async (service) => {
			expect((await converted(service, utcCalendar(2016, 1, 1, 0, 0, 0))).quality.leapSeconds).toBe('tabulated')
			expect((await converted(service, utcCalendar(2030, 1, 1, 0, 0, 0))).quality.leapSeconds).toBe('assumed')
			const old = await converted(service, utcCalendar(1950, 1, 1, 0, 0, 0))
			expect(old.quality.leapSeconds).toBe('beforeUtc')
			expect(old.offsets.taiMinusUtc).toBeUndefined()
		}))
})

describe('time zones', () => {
	const zoned = (hour: number, minute: number, day: number, month: number, fold?: 'earlier' | 'later'): AstronomicalTimeInput => ({ kind: 'calendar', year: 2026, month, day, hour, minute, second: 0, reference: { kind: 'zone', timeZone: 'America/New_York', fold } })

	test('resolves an ordinary reading', () =>
		withService(async (service) => {
			const { scales, civil } = await converted(service, zoned(12, 30, 15, 7), { timeZone: 'America/New_York' })
			expect(scales.UTC.calendar).toBe('2026-07-15T16:30:00.000')
			expect(civil.local).toBe('2026-07-15T12:30:00.000')
			expect(civil.offsetSeconds).toBe(-4 * 3600)
		}))

	test('answers both instants of a repeated reading and takes the one chosen', () =>
		withService(async (service) => {
			const { status, body } = await post(service, { input: zoned(1, 30, 1, 11) })
			expect(status).toBe(422)
			expect(body.code).toBe('ambiguousLocalTime')
			expect(body.earlier).toBe(Date.UTC(2026, 10, 1, 5, 30))
			expect(body.later).toBe(Date.UTC(2026, 10, 1, 6, 30))
			expect((await converted(service, zoned(1, 30, 1, 11, 'earlier'))).scales.UTC.calendar).toBe('2026-11-01T05:30:00.000')
			expect((await converted(service, zoned(1, 30, 1, 11, 'later'))).scales.UTC.calendar).toBe('2026-11-01T06:30:00.000')
		}))

	test('refuses a reading the clocks skip', () =>
		withService(async (service) => {
			expect(await post(service, { input: zoned(2, 30, 8, 3) })).toMatchObject({ status: 422, body: { code: 'nonexistentTime' } })
		}))

	test('a numeric offset is never ambiguous', () =>
		withService(async (service) => {
			const { scales } = await converted(service, { kind: 'calendar', year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0, reference: { kind: 'offset', minutes: -240 } })
			expect(scales.UTC.calendar).toBe('2026-11-01T05:30:00.000')
		}))
})

describe('sidereal time', () => {
	test('matches the golden values without EOP, marked as such', () =>
		withService(async (service) => {
			const { sidereal, offsets, quality } = await converted(service, GOLDEN.input, { observer: SITE })
			expect(sidereal.gmst).toBeCloseTo(GOLDEN.withoutEop.gmst, 11)
			expect(sidereal.gast).toBeCloseTo(GOLDEN.withoutEop.gast, 11)
			expect(sidereal.lmst!).toBeCloseTo(GOLDEN.withoutEop.lmst, 11)
			expect(sidereal.last!).toBeCloseTo(GOLDEN.withoutEop.last, 11)
			expect(quality.eop.status).toBe('notLoaded')
			expect(offsets.dut1).toBeUndefined()
			expect(offsets.ttMinusUt1).toBeUndefined()
		}))

	test('matches the golden values with EOP', () =>
		withService(
			async (service, eop) => {
				await eop.prepare()
				await eop.settled()
				const { sidereal, offsets, quality, scales } = await converted(service, GOLDEN.input, { observer: SITE })
				expect(quality.eop).toMatchObject({ status: 'covered', source: 'iersA' })
				expect(offsets.dut1!).toBeCloseTo(GOLDEN.withEop.dut1, 9)
				expect(offsets.ttMinusUt1!).toBeCloseTo(69.184 + 0.0123, 6)
				expect(scales.UT1.calendar).toBe('2024-03-15T05:59:59.988')
				expect(sidereal.gmst).toBeCloseTo(GOLDEN.withEop.gmst, 11)
				expect(sidereal.gast).toBeCloseTo(GOLDEN.withEop.gast, 11)
				expect(sidereal.lmst!).toBeCloseTo(GOLDEN.withEop.lmst, 11)
				expect(sidereal.last!).toBeCloseTo(GOLDEN.withEop.last, 11)
			},
			{ fetch: fakeDownload(Date.UTC(2024, 2, 15), GOLDEN.withEop.dut1), now: () => Date.UTC(2024, 2, 15) },
			Date.UTC(2024, 2, 15),
		))

	test('Greenwich values need no observer', () =>
		withService(async (service) => {
			const { sidereal, hourAngle } = await converted(service, GOLDEN.input, { rightAscension: 1 })
			expect(sidereal.gmst).toBeCloseTo(GOLDEN.withoutEop.gmst, 11)
			expect(sidereal.lmst).toBeUndefined()
			expect(sidereal.last).toBeUndefined()
			expect(hourAngle).toBeUndefined()
		}))

	test('longitude is east positive', () =>
		withService(async (service) => {
			const west = await converted(service, GOLDEN.input, { observer: { ...SITE, longitude: 0 } })
			const east = await converted(service, GOLDEN.input, { observer: { ...SITE, longitude: 15 } })
			expect(east.sidereal.last! - west.sidereal.last!).toBeCloseTo(Math.PI / 12, 9)
		}))

	test('wraps the hour angle, positive west of the meridian', () =>
		withService(async (service) => {
			const { sidereal } = await converted(service, GOLDEN.input, { observer: SITE })
			const west = await converted(service, GOLDEN.input, { observer: SITE, rightAscension: sidereal.last! - 0.1 })
			const wrapped = await converted(service, GOLDEN.input, { observer: SITE, rightAscension: sidereal.last! + 2 * Math.PI - 3 })
			expect(west.hourAngle!).toBeCloseTo(0.1, 9)
			expect(wrapped.hourAngle!).toBeCloseTo(3, 9)
		}))
})

describe('now', () => {
	test('uses the clock of the service and rounds nothing', () =>
		withService(async (service) => {
			const { scales, civil } = await converted(service, { kind: 'now' }, { timeZone: 'America/Sao_Paulo' })
			expect(scales.UTC.calendar).toBe('2026-10-31T12:00:00.000')
			expect(civil.unixMillis).toBe(NOW)
			expect(civil.local).toBe('2026-10-31T09:00:00.000')
		}))

	test('samples the real time for the status bar', () =>
		withService(async (service) => {
			const { POST } = createAstronomicalTimeRoutes(service)['/api/astronomical-time/reference']
			const answer = async (observer?: typeof SITE) => (await (await POST(new Request('http://localhost/api/astronomical-time/reference', { method: 'POST', body: JSON.stringify({ observer }) }) as Bun.BunRequest<'/api/astronomical-time/reference'>)).json()) as AstronomicalTimeReference
			const none = await answer()
			expect(none.unixMillis).toBe(NOW)
			expect(none.jd).toBe(2461345)
			expect(none.last).toBeUndefined()
			const { sidereal } = await converted(service, { kind: 'now' }, { observer: SITE })
			const local = await answer(SITE)
			expect(local.last!).toBeCloseTo(sidereal.last!, 12)
			expect(local.lmst!).toBeCloseTo(sidereal.lmst!, 12)
			expect(local.siderealRate * 86164.0905).toBeCloseTo(2 * Math.PI, 9)
		}))
})

describe('Earth orientation data', () => {
	test('never touches the shared tables of the toolkit', () =>
		withService(
			async (service, eop) => {
				await eop.prepare()
				await eop.settled()
				expect((await converted(service, { kind: 'now' })).quality.eop.status).toBe('covered')
				expect(iersab.covers(timeUnix(NOW / 1000))).toBeFalse()
				expect(sharedDut1(timeUnix(NOW / 1000))).toBe(0)
			},
			{ fetch: fakeDownload(NOW, 0.1) },
		))

	test('flags an instant outside its tables and takes DUT1 as 0 there', () =>
		withService(
			async (service, eop) => {
				await eop.prepare()
				await eop.settled()
				const { quality, offsets, scales } = await converted(service, utcCalendar(1900, 1, 1, 0, 0, 0))
				expect(quality.eop.status).toBe('outsideTable')
				expect(offsets.dut1).toBeUndefined()
				expect(scales.UT1.calendar).toBe(scales.UTC.calendar)
			},
			{ fetch: fakeDownload(NOW, 0.5) },
		))

	test('reads the cached table of an earlier refresh, without the network', async () => {
		const directory = join(tmpdir(), `nebulosa-iers-${crypto.randomUUID()}`)

		try {
			const first = new EarthOrientationData({ directory, fetch: fakeDownload(NOW, 0.25), now: () => NOW })
			await first.prepare()
			await first.settled()

			const requests: string[] = []
			const second = new EarthOrientationData({ directory, fetch: fakeDownload(NOW, 0.9, requests), now: () => Date.now() })
			await second.prepare()
			await second.settled()
			const covered = timeUnix(NOW / 1000)
			expect(second.coverage(covered).status).toBe('covered')
			expect(requests).toEqual([])
			expect(second.providers.dut1!(covered)).toBeCloseTo(0.25, 9)
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	})

	test('keeps its table when a download fails or stops short', () =>
		withService(
			async (_, eop) => {
				await eop.prepare()
				await eop.settled()
				expect(eop.coverage(timeUnix(NOW / 1000)).status).toBe('notLoaded')
			},
			{ fetch: fakeDownload(NOW - 200 * DAY, 0.25) },
		))

	test('retries once an hour at most', async () => {
		let now = NOW
		const requests: string[] = []

		await withService(
			async (_, eop) => {
				for (const step of [0, 60_000, 3_600_000]) {
					now += step
					await eop.prepare()
					await eop.settled()
				}

				// Two attempts, of the two URLs of IERS A and the one of IERS B each.
				expect(requests).toHaveLength(6)
			},
			{ fetch: (url) => (requests.push(url), Promise.reject(new Error('offline'))), now: () => now },
		)
	})

	test('answers before a refresh ends', () => {
		const { promise: released, reject: release } = Promise.withResolvers<Response>()

		return withService(
			async (service) => {
				const result = await converted(service, { kind: 'now' })
				expect(result.quality.eop.status).toBe('notLoaded')
				release(new Error('aborted'))
			},
			{ fetch: () => released },
		)
	})
})
