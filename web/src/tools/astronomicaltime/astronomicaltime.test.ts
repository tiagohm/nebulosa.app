import { describe, expect, test } from 'bun:test'
import type { AstronomicalTimeRequest, AstronomicalTimeResult } from 'api'
import { proxy } from 'valtio'
import { routePath, type RouteState } from '../../shell/route'
import { setSkyTime, skyClock, type SkyClock } from '../../sky/clock'
// oxfmt-ignore
import { applyToSky, type AstronomicalTimeState, conversionRequest, type ConverterIo, effectiveObserver, effectiveTimeZone, entryText, followConversion, initialAstronomicalTimeState, type InputFormat, openAstronomicalTimeConverter, parseEntry, parseRightAscension, qualityNotes, setConverterMode, setEntryText, setInputFormat, takeSkyTime } from './astronomicaltime'

const OBSERVER = { latitude: -22, longitude: -45, elevation: 850, timeZone: 'America/Sao_Paulo' }

const RESULT = {
	civil: { local: '2026-10-31T09:00:00.000', offsetSeconds: -10800, unixMillis: 1793448000000, leapSecond: false, leapSecondDay: false },
	scales: Object.fromEntries(['UT1', 'UTC', 'TAI', 'TT', 'TCG', 'TDB', 'TCB'].map((scale) => [scale, { calendar: `2026-10-31T12:00:00.000-${scale}`, jd: `2461345.0-${scale}`, mjd: `61344.5-${scale}` }])),
	sidereal: { gmst: 1, gast: 1 },
	offsets: { tdbMinusTt: 0 },
	epochs: { julian: 2026.83, besselian: 2026.84, dayOfYear: 304 },
	quality: { eop: { status: 'notLoaded' }, leapSeconds: 'tabulated' },
} as unknown as AstronomicalTimeResult

const entry = (format: InputFormat, text: string) => ({ ...initialAstronomicalTimeState(), format, text })

// Waits for timers and answers of the conversion to run.
const settled = (ms: number) => Bun.sleep(ms)

// Answers every conversion, recording the requests.
function fakeIo(answer: () => Response = () => Response.json(RESULT), visible: () => boolean = () => true) {
	const requests: AstronomicalTimeRequest[] = []
	const io: ConverterIo = {
		visible,
		fetch: (_, init) => {
			requests.push(JSON.parse(init?.body as string) as AstronomicalTimeRequest)
			return Promise.resolve(answer())
		},
	}
	return { requests, io }
}

describe('entries', () => {
	test('reads a calendar in the zone or in a timescale', () => {
		expect(parseEntry(entry('calendar', '2026-10-31 21:30:15.5'), 'America/Sao_Paulo')).toEqual({ kind: 'calendar', year: 2026, month: 10, day: 31, hour: 21, minute: 30, second: 15.5, reference: { kind: 'zone', timeZone: 'America/Sao_Paulo', fold: undefined } })
		expect(parseEntry({ ...entry('calendar', '2000-01-01T12:00'), read: 'TT' }, 'UTC')).toEqual({ kind: 'calendar', year: 2000, month: 1, day: 1, hour: 12, minute: 0, second: 0, reference: { kind: 'scale', scale: 'TT' } })
		expect(parseEntry({ ...entry('calendar', '2026-11-01 01:30'), fold: 'later' }, 'America/New_York')).toMatchObject({ reference: { fold: 'later' } })
	})

	test('refuses calendar dates that do not exist', () => {
		for (const text of ['2026-02-29 12:00', '2026-13-01 12:00', '2026-01-01 24:00', '2026-01-01 12:60', '2026-01-01', '10000-01-01 00:00', '-4713-01-01 00:00', 'noon', '2026-10-31 12:00:00Z']) expect(parseEntry(entry('calendar', text), 'UTC')).toBeString()
		expect(parseEntry(entry('calendar', '2024-02-29 12:00'), 'UTC')).toBeObject()
	})

	test('lets a :60 through, which only the server can judge', () => {
		expect(parseEntry(entry('iso', '2016-12-31T23:59:60Z'), 'UTC')).toMatchObject({ second: 60, reference: { kind: 'offset', minutes: 0 } })
	})

	test('reads the offset of an ISO 8601 time and refuses a time without one', () => {
		expect(parseEntry(entry('iso', '2026-10-31T12:00:00-03:00'), 'UTC')).toMatchObject({ hour: 12, reference: { kind: 'offset', minutes: -180 } })
		expect(parseEntry(entry('iso', '2026-10-31T12:00:00+0530'), 'UTC')).toMatchObject({ reference: { kind: 'offset', minutes: 330 } })
		expect(parseEntry(entry('iso', '2026-10-31T12:00:00+05'), 'UTC')).toMatchObject({ reference: { kind: 'offset', minutes: 300 } })
		expect(parseEntry(entry('iso', '2026-10-31T12:00:00'), 'UTC')).toInclude('Z or an offset')
	})

	test('keeps the text of a Julian date, so no digit is lost', () => {
		expect(parseEntry({ ...entry('jd', ' 2460384.1234567890123 '), scale: 'TDB' }, 'UTC')).toEqual({ kind: 'jd', value: '2460384.1234567890123', scale: 'TDB' })
		expect(parseEntry(entry('mjd', '-1.25'), 'UTC')).toEqual({ kind: 'mjd', value: '-1.25', scale: 'UTC' })
		for (const text of ['1e6', '-1', '99999999', '12,5']) expect(parseEntry(entry('jd', text), 'UTC')).toBeString()
	})

	test('reads Unix time and epochs within the supported years', () => {
		expect(parseEntry(entry('unix', '946684800.5'), 'UTC')).toEqual({ kind: 'unix', seconds: 946684800.5 })
		expect(parseEntry(entry('unix', '1e12'), 'UTC')).toBeString()
		expect(parseEntry(entry('unix', '999999999999'), 'UTC')).toBeString()
		expect(parseEntry(entry('julianEpoch', '2000'), 'UTC')).toEqual({ kind: 'julianEpoch', value: 2000 })
		expect(parseEntry(entry('besselianEpoch', '1950.5'), 'UTC')).toEqual({ kind: 'besselianEpoch', value: 1950.5 })
		expect(parseEntry(entry('julianEpoch', '12000'), 'UTC')).toBeString()
	})

	test('asks for an empty entry', () => {
		expect(parseEntry(entry('jd', '  '), 'UTC')).toBe('Enter a Julian Date.')
	})

	test('reads a right ascension in hours', () => {
		expect(parseRightAscension('6')).toBeCloseTo(Math.PI / 2, 12)
		expect(parseRightAscension('06 00 00')).toBeCloseTo(Math.PI / 2, 12)
		expect(parseRightAscension('06h30m')).toBeCloseTo(((6.5 * 15) / 180) * Math.PI, 12)
		expect(parseRightAscension('abc')).toBeUndefined()
		expect(parseRightAscension('25')).toBeUndefined()
	})
})

describe('request', () => {
	test('the zone chosen wins, then the observer, then the browser', () => {
		expect(effectiveTimeZone({ timeZone: 'Asia/Tokyo' }, OBSERVER)).toBe('Asia/Tokyo')
		expect(effectiveTimeZone({}, OBSERVER)).toBe('America/Sao_Paulo')
		expect(effectiveTimeZone({ timeZone: '' }, OBSERVER)).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone)
		expect(effectiveTimeZone({}, undefined)).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone)
	})

	test('a location of the tool replaces the observer and leaves the profile alone', () => {
		expect(effectiveObserver({}, OBSERVER)).toEqual({ latitude: -22, longitude: -45, elevation: 850 })
		expect(effectiveObserver({ place: { source: 'manual', latitude: 10, longitude: 20 } }, OBSERVER)).toEqual({ latitude: 10, longitude: 20, elevation: 0 })
		expect(effectiveObserver({}, undefined)).toBeUndefined()
	})

	test('asks for the current time with the observer and the zone', () => {
		expect(conversionRequest(initialAstronomicalTimeState(), OBSERVER)).toEqual({ request: { input: { kind: 'now' }, observer: { latitude: -22, longitude: -45, elevation: 850 }, timeZone: 'America/Sao_Paulo' } })
	})

	test('sends the right ascension only with a valid one', () => {
		expect(conversionRequest({ ...initialAstronomicalTimeState(), rightAscension: '12' }, OBSERVER)).toMatchObject({ request: { rightAscension: Math.PI } })
		expect(conversionRequest({ ...initialAstronomicalTimeState(), rightAscension: 'x' }, OBSERVER)).toHaveProperty('error')
	})
})

describe('conversions', () => {
	test('asks for a custom instant once, after the edits settle', async () => {
		const state = proxy<AstronomicalTimeState>(initialAstronomicalTimeState())
		const { requests, io } = fakeIo()
		const stop = followConversion(state, { request: { input: { kind: 'unix', seconds: 0 }, timeZone: 'UTC' } }, io)
		await settled(20)
		expect(requests).toHaveLength(0)
		await settled(300)
		expect(requests).toHaveLength(1)
		expect(state.result?.epochs.dayOfYear).toBe(304)
		stop()
	})

	test('an edit before the request cancels it', async () => {
		const { requests, io } = fakeIo()
		followConversion(proxy<AstronomicalTimeState>(initialAstronomicalTimeState()), { request: { input: { kind: 'unix', seconds: 0 }, timeZone: 'UTC' } }, io)()
		await settled(300)
		expect(requests).toHaveLength(0)
	})

	test('follows the current time until it stops, asking nothing while hidden', async () => {
		let visible = false
		const { requests, io } = fakeIo(undefined, () => visible)
		const stop = followConversion(proxy<AstronomicalTimeState>(initialAstronomicalTimeState()), { request: { input: { kind: 'now' }, timeZone: 'UTC' } }, io)
		await settled(20)
		expect(requests).toHaveLength(0)
		visible = true
		await settled(1100)
		expect(requests).toHaveLength(1)
		stop()
		await settled(1100)
		expect(requests).toHaveLength(1)
	})

	test('inputs that cannot be sent clear the old result', () => {
		const state = proxy<AstronomicalTimeState>({ ...initialAstronomicalTimeState(), result: RESULT, error: 'old' })
		followConversion(state, { error: 'Enter a Julian Date.' })
		expect(state.result).toBeUndefined()
		expect(state.error).toBeUndefined()
		expect(state.inputError).toBe('Enter a Julian Date.')
	})

	test('a repeated reading offers both occurrences, and no old result stands for it', async () => {
		const state = proxy<AstronomicalTimeState>({ ...initialAstronomicalTimeState(), result: RESULT })
		const { io } = fakeIo(() => Response.json({ error: 'twice', code: 'ambiguousLocalTime', earlier: 1, later: 2 }, { status: 422 }))
		followConversion(state, { request: { input: { kind: 'now' }, timeZone: 'UTC' } }, io)()
		const stop = followConversion(state, { request: { input: { kind: 'unix', seconds: 0 }, timeZone: 'UTC' } }, io)
		await settled(300)
		expect(state.ambiguous).toEqual({ earlier: 1, later: 2 })
		expect(state.result).toBeUndefined()
		expect(state.error).toBeUndefined()
		stop()
	})

	test('shows the message of any other refusal', async () => {
		const state = proxy<AstronomicalTimeState>(initialAstronomicalTimeState())
		const { io } = fakeIo(() => Response.json({ error: 'That reading does not exist on this date', code: 'nonexistentTime' }, { status: 422 }))
		const stop = followConversion(state, { request: { input: { kind: 'unix', seconds: 0 }, timeZone: 'UTC' } }, io)
		await settled(300)
		expect(state.error).toBe('That reading does not exist on this date')
		stop()
	})

	test('a failed request says so', async () => {
		const state = proxy<AstronomicalTimeState>({ ...initialAstronomicalTimeState(), result: RESULT })
		const io: ConverterIo = { visible: () => true, fetch: () => Promise.reject(new Error('offline')) }
		const stop = followConversion(state, { request: { input: { kind: 'unix', seconds: 0 }, timeZone: 'UTC' } }, io)
		await settled(300)
		expect(state.error).toBe('offline')
		expect(state.result).toBeUndefined()
		stop()
	})
})

describe('entry text', () => {
	test('writes the instant shown in each form', () => {
		expect(entryText({ format: 'calendar', scale: 'UTC', read: 'zone' }, RESULT)).toBe('2026-10-31T09:00:00.000')
		expect(entryText({ format: 'calendar', scale: 'UTC', read: 'TT' }, RESULT)).toBe('2026-10-31T12:00:00.000-TT')
		expect(entryText({ format: 'iso', scale: 'UTC', read: 'zone' }, RESULT)).toBe('2026-10-31T12:00:00.000-UTCZ')
		expect(entryText({ format: 'jd', scale: 'TDB', read: 'zone' }, RESULT)).toBe('2461345.0-TDB')
		expect(entryText({ format: 'mjd', scale: 'TT', read: 'zone' }, RESULT)).toBe('61344.5-TT')
		expect(entryText({ format: 'unix', scale: 'UTC', read: 'zone' }, RESULT)).toBe('1793448000')
		expect(entryText({ format: 'julianEpoch', scale: 'UTC', read: 'zone' }, RESULT)).toBe('2026.830000000')
	})

	test('a custom instant starts at the instant shown, and a new format keeps it', () => {
		const state = { ...initialAstronomicalTimeState(), result: RESULT }
		setConverterMode(state, 'custom')
		expect(state.text).toBe('2026-10-31T09:00:00.000')
		setInputFormat(state, 'jd')
		expect(state.text).toBe('2461345.0-UTC')
	})

	test('an edit forgets the occurrence chosen', () => {
		const state: AstronomicalTimeState = { ...initialAstronomicalTimeState(), fold: 'later' }
		setEntryText(state, '2026-11-01 01:31')
		expect(state.fold).toBeUndefined()
	})
})

describe('Sky clock', () => {
	const clock = (): SkyClock => ({ mode: 'now', anchor: 0, startedAt: 0, rate: 1 })

	test('takes the simulated instant once, as a custom instant', () => {
		const simulation = clock()
		setSkyTime(simulation, 1000_000, 0)
		const state = initialAstronomicalTimeState()
		takeSkyTime(state, simulation, 5000)
		expect(state).toMatchObject({ mode: 'custom', format: 'unix', text: '1000' })
	})

	test('sends the instant shown to the Sky and nothing else', () => {
		const simulation = clock()
		applyToSky({ result: RESULT }, simulation)
		expect(simulation).toMatchObject({ mode: 'fixed', anchor: 1793448000000 })
		expect(skyClock.mode).toBe('now')
	})

	test('a leap second has no instant for the Sky', () => {
		const simulation = clock()
		applyToSky({ result: { ...RESULT, civil: { ...RESULT.civil, unixMillis: undefined } } }, simulation)
		expect(simulation.mode).toBe('now')
	})
})

test('opening from outside always shows the current time at the observer', () => {
	const state: AstronomicalTimeState = { ...initialAstronomicalTimeState(), mode: 'custom', place: { source: 'manual', latitude: 1, longitude: 2 } }
	const route: RouteState = { route: { workspace: 'images' } }
	const paths: (string | URL | null | undefined)[] = []
	openAstronomicalTimeConverter(state, route, { pushState: (_, __, path) => paths.push(path) })
	expect(state.mode).toBe('now')
	expect(state.place).toBeUndefined()
	expect(paths).toEqual(['/tools/astronomical-time-converter'])
	expect(routePath(route.route)).toBe('/tools/astronomical-time-converter')

	state.mode = 'custom'
	openAstronomicalTimeConverter(state, route, { pushState: (_, __, path) => paths.push(path) })
	expect(state).toMatchObject({ mode: 'now' })
	expect(paths).toHaveLength(1)
})

test('states what is approximate and why', () => {
	expect(qualityNotes({ eop: { status: 'covered', source: 'iersA' }, leapSeconds: 'tabulated' })).toEqual(['Earth orientation from IERS Bulletin A.'])
	expect(qualityNotes({ eop: { status: 'notLoaded' }, leapSeconds: 'tabulated' })[0]).toInclude('approximate')
	expect(qualityNotes({ eop: { status: 'outsideTable' }, leapSeconds: 'beforeUtc' })).toHaveLength(2)
	expect(qualityNotes({ eop: { status: 'covered', source: 'iersB' }, leapSeconds: 'assumed' })[1]).toInclude('future')
})
