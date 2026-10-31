import { describe, expect, test } from 'bun:test'
import type { AstronomicalTimeReference } from 'api'
import { type AstronomicalClockIo, type AstronomicalClockRuntime, clockApproximate, clockFreshness, clockReadingText, clockTitle, effectiveReadings, liveClock, watchAstronomicalClock } from './astronomicalclock'

const MINUTE = 60_000
const OBSERVER = { latitude: -22, longitude: -45, elevation: 850 }

function reference(overrides: Partial<AstronomicalTimeReference> = {}): AstronomicalTimeReference {
	return { unixMillis: Date.UTC(2026, 9, 31, 12), jd: 2461345, lmst: 1, last: 1.001, siderealRate: 7.292e-5, quality: { eop: { status: 'covered', source: 'iersA' }, leapSeconds: 'tabulated' }, ...overrides }
}

// Clock and server under the control of a test.
function fakeIo(answer: () => Promise<Response> = () => Promise.resolve(Response.json(reference()))) {
	const requests: unknown[] = []
	const listeners = new Set<() => void>()
	const clock = { monotonic: 1000, wall: Date.UTC(2026, 9, 31, 12), visible: true }

	const io: AstronomicalClockIo = {
		fetch: (_, init) => {
			requests.push(JSON.parse(init?.body as string))
			return answer()
		},
		monotonic: () => clock.monotonic,
		wall: () => clock.wall,
		visible: () => clock.visible,
		onVisibility: (listener) => {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}

	return { io, clock, requests, listeners }
}

describe('readings', () => {
	test('shows the preference with an observer', () => {
		expect(effectiveReadings({ enabled: true, primary: 'last', secondary: 'none' }, true)).toEqual(['last'])
		expect(effectiveReadings({ enabled: true, primary: 'last', secondary: 'utc' }, true)).toEqual(['last', 'utc'])
	})

	test('shows nothing while disabled', () => {
		expect(effectiveReadings({ enabled: false, primary: 'jd', secondary: 'utc' }, true)).toEqual([])
	})

	test('without an observer, JD (UTC) stands for a sidereal primary and a sidereal secondary leaves', () => {
		expect(effectiveReadings({ enabled: true, primary: 'last', secondary: 'none' }, false)).toEqual(['jd'])
		expect(effectiveReadings({ enabled: true, primary: 'lmst', secondary: 'jd' }, false)).toEqual(['jd'])
		expect(effectiveReadings({ enabled: true, primary: 'utc', secondary: 'last' }, false)).toEqual(['utc'])
		expect(effectiveReadings({ enabled: true, primary: 'utc', secondary: 'mjd' }, false)).toEqual(['utc', 'mjd'])
	})

	test('formats each reading, naming the scale of Julian dates', () => {
		const live = { unixMillis: Date.UTC(2026, 9, 31, 12, 34, 56), jd: 2461345.024259, lmst: Math.PI / 2, last: Math.PI }
		expect(clockReadingText('last', live, 'UTC', true)).toEqual({ label: 'LAST', value: '12:00:00' })
		expect(clockReadingText('lmst', live, 'UTC', false)).toEqual({ label: 'LMST', value: '06:00' })
		expect(clockReadingText('jd', live, 'UTC', true)).toEqual({ label: 'JD(UTC)', value: '2461345.02426' })
		expect(clockReadingText('mjd', live, 'UTC', true)).toEqual({ label: 'MJD(UTC)', value: '61344.52426' })
		expect(clockReadingText('utc', live, 'UTC', true)).toEqual({ label: 'UTC', value: '12:34:56' })
		expect(clockReadingText('utc', live, 'UTC', false)).toEqual({ label: 'UTC', value: '12:34' })
		expect(clockReadingText('local', live, 'America/Sao_Paulo', true)).toEqual({ label: 'Local', value: '09:34:56' })
	})

	test('marks an approximate sidereal time, and only those', () => {
		const live = { unixMillis: 0, jd: 2440587.5, last: Math.PI }
		expect(clockReadingText('last', live, 'UTC', true, true).value).toBe('~12:00:00')
		expect(clockReadingText('utc', live, 'UTC', true, true).value).toBe('00:00:00')
		expect(clockApproximate({ reference: reference({ quality: { eop: { status: 'notLoaded' }, leapSeconds: 'tabulated' } }) })).toBeTrue()
		expect(clockApproximate({ reference: reference() })).toBeFalse()
	})

	test('the title is the full readout, with the site and the way to the converter', () => {
		const live = { unixMillis: Date.UTC(2026, 9, 31, 12, 34, 56), jd: 2461345.024259, lmst: Math.PI / 2, last: Math.PI }
		expect(clockTitle(live, 'America/Sao_Paulo', 'Backyard', ['A note.'], false).split('\n')).toEqual(['UTC 12:34:56', 'Local 09:34:56 (America/Sao_Paulo)', 'JD(UTC) 2461345.02426', 'MJD(UTC) 61344.52426', 'LAST 12:00:00', 'LMST 06:00:00', 'Site Backyard', 'A note.', 'Open Astronomical Time Converter'])
		expect(clockTitle(live, 'UTC', undefined, [], false)).not.toInclude('LAST')
	})

	test('shows absence, never a number, without a clock or an observer', () => {
		expect(clockReadingText('last', undefined, 'UTC', true).value).toBe('--')
		expect(clockReadingText('last', { unixMillis: 0, jd: 2440587.5 }, 'UTC', true).value).toBe('--')
	})
})

describe('extrapolation', () => {
	test('moves a sample on by the monotonic time elapsed', () => {
		const live = liveClock({ reference: reference(), sampledAt: 5000 }, 5000 + 30_000)
		expect(live.unixMillis).toBe(Date.UTC(2026, 9, 31, 12, 0, 30))
		expect(live.jd).toBeCloseTo(2461345 + 30 / 86400, 8)
		expect(live.lmst!).toBeCloseTo(1 + 7.292e-5 * 30, 12)
		expect(live.last!).toBeCloseTo(1.001 + 7.292e-5 * 30, 12)
	})

	test('wraps sidereal time, and leaves it out without an observer', () => {
		const live = liveClock({ reference: reference({ last: 2 * Math.PI - 1e-4, lmst: undefined }), sampledAt: 0 }, 10_000)
		expect(live.last!).toBeCloseTo(7.292e-5 * 10 - 1e-4, 9)
		expect(live.lmst).toBeUndefined()
	})

	test('marks a reading that stopped being renewed, then withdraws it', () => {
		const sample = { sampledAt: 1000 }
		expect(clockFreshness(undefined, 1000)).toBe('none')
		expect(clockFreshness(sample, 1000 + 4 * MINUTE)).toBe('fresh')
		expect(clockFreshness(sample, 1000 + 5 * MINUTE)).toBe('stale')
		expect(clockFreshness(sample, 1000 + 30 * MINUTE)).toBe('expired')
	})
})

describe('sampling', () => {
	const settled = () => Bun.sleep(0)

	test('samples at once for the observer, at the midpoint of the request', async () => {
		const state: AstronomicalClockRuntime = {}
		const { io, clock, requests } = fakeIo()
		const stop = watchAstronomicalClock(state, OBSERVER, io)
		clock.monotonic += 100
		await settled()
		expect(requests).toEqual([{ observer: OBSERVER }])
		expect(state.sample?.sampledAt).toBe(1050)
		stop()
	})

	test('renews the sample when it is shown again after a minute hidden, and asks nothing while hidden', async () => {
		const state: AstronomicalClockRuntime = {}
		const { io, clock, requests, listeners } = fakeIo()
		const stop = watchAstronomicalClock(state, undefined, io)
		await settled()
		clock.visible = false
		clock.monotonic += MINUTE
		clock.wall += MINUTE
		for (const listener of listeners) listener()
		await settled()
		expect(requests).toHaveLength(1)
		clock.visible = true
		for (const listener of listeners) listener()
		await settled()
		expect(requests).toHaveLength(2)
		stop()
		expect(listeners.size).toBe(0)
	})

	test('a hidden page takes no first sample until it is shown', async () => {
		const { io, clock, requests, listeners } = fakeIo()
		clock.visible = false
		const stop = watchAstronomicalClock({}, undefined, io)
		await settled()
		expect(requests).toHaveLength(0)
		clock.visible = true
		for (const listener of listeners) listener()
		await settled()
		expect(requests).toHaveLength(1)
		stop()
	})

	test('a recent sample is not renewed', async () => {
		const state: AstronomicalClockRuntime = {}
		const { io, clock, requests, listeners } = fakeIo()
		const stop = watchAstronomicalClock(state, undefined, io)
		await settled()
		clock.monotonic += 10_000
		clock.wall += 10_000
		for (const listener of listeners) listener()
		await settled()
		expect(requests).toHaveLength(1)
		stop()
	})

	test('a jump of the wall clock renews it, as after a sleep', async () => {
		const state: AstronomicalClockRuntime = {}
		const { io, clock, requests, listeners } = fakeIo()
		const stop = watchAstronomicalClock(state, undefined, io)
		await settled()
		clock.wall += 3_600_000
		for (const listener of listeners) listener()
		await settled()
		expect(requests).toHaveLength(2)
		stop()
	})

	test('a failed request keeps the sample, to age', async () => {
		let online = true
		const state: AstronomicalClockRuntime = {}
		const { io, clock, listeners } = fakeIo(() => (online ? Promise.resolve(Response.json(reference())) : Promise.reject(new Error('offline'))))
		const stop = watchAstronomicalClock(state, undefined, io)
		await settled()
		const sample = state.sample
		online = false
		clock.monotonic += MINUTE
		clock.wall += MINUTE
		for (const listener of listeners) listener()
		await settled()
		expect(state.sample).toBe(sample)
		stop()
	})

	test('drops the sample of another observer, and keeps it for the same one', async () => {
		const state: AstronomicalClockRuntime = {}
		const first = fakeIo()
		watchAstronomicalClock(state, OBSERVER, first.io)()
		state.sample = { reference: reference(), sampledAt: 0, wallAt: 0 }
		watchAstronomicalClock(state, OBSERVER, first.io)()
		expect(state.sample).toBeDefined()
		watchAstronomicalClock(state, { ...OBSERVER, longitude: 10 }, first.io)()
		expect(state.sample).toBeUndefined()
		await settled()
	})

	test('a late answer after it stops is ignored', async () => {
		const state: AstronomicalClockRuntime = {}
		const { promise, resolve } = Promise.withResolvers<Response>()
		const { io } = fakeIo(() => promise)
		const stop = watchAstronomicalClock(state, undefined, io)
		stop()
		resolve(Response.json(reference()))
		await settled()
		expect(state.sample).toBeUndefined()
	})
})
