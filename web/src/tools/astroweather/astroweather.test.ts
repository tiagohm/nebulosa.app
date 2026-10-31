import { describe, expect, test } from 'bun:test'
import type { AstroWeatherForecast, AstroWeatherNight } from 'api'
import { proxy } from 'valtio'
import type { EclipseIo } from '../eclipse/eclipse'
import { type AstroWeatherState, coverage, effectiveSite, firstNight, followProfile, followSite, formatClock, formatLength, hasNextNight, loadForecast, loadNight, skyBands, stepNight } from './astroweather'

const SITE = { latitude: -22.4, longitude: -45.45, elevation: 850, timeZone: 'America/Sao_Paulo' }
const OTHER = { ...SITE, latitude: 10 }
const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 31, 15)

const NIGHT = {
	sun: {
		localDate: '2026-10-31',
		start: Date.UTC(2026, 9, 31, 15),
		end: Date.UTC(2026, 10, 1, 15),
		sunset: Date.UTC(2026, 9, 31, 21),
		sunrise: Date.UTC(2026, 10, 1, 8),
		daylight: 'normal',
		civil: { state: 'normal' },
		nautical: { state: 'normal' },
		astronomical: { state: 'normal' },
		darkness: [{ start: Date.UTC(2026, 9, 31, 23), end: Date.UTC(2026, 10, 1, 6) }],
	},
	display: { start: Date.UTC(2026, 9, 31, 20), end: Date.UTC(2026, 10, 1, 9) },
	moon: { time: 0, illuminatedFraction: 0.5, phase: 'firstQuarter', above: [] },
} as AstroWeatherNight

const FORECAST = {
	latitude: -22.4,
	longitude: -45.45,
	generatedAt: NOW,
	meteorology: { source: { provider: 'openMeteo', state: 'fresh', validFrom: NOW, validTo: NOW + 190 * HOUR }, samples: [] },
	astronomy: { source: { provider: 'sevenTimer', state: 'fresh' }, cellDegrees: 0.1, samples: [] },
} as unknown as AstroWeatherForecast

function newState() {
	return proxy<AstroWeatherState>({ forecastLoading: false, nightLoading: false })
}

// IO whose requests wait until released, recorded in order.
function deferred() {
	const calls: { url: string; init?: RequestInit; resolve: (response: Response) => void; reject: (error: unknown) => void }[] = []
	const io: EclipseIo = {
		time: () => NOW,
		fetch: (url, init) =>
			new Promise((resolve, reject) => {
				calls.push({ url, init, resolve, reject })
			}),
	}
	return { io, calls }
}

// IO answering at once, recording the URLs.
function answering() {
	const urls: string[] = []
	const io: EclipseIo = { time: () => NOW, fetch: (url) => (urls.push(url), Promise.resolve(Response.json(url.includes('forecast') ? FORECAST : NIGHT))) }
	return { io, urls }
}

describe('site', () => {
	test('the Sky observer is the site, with its own zone or the browser one', () => {
		expect(effectiveSite({}, { latitude: 1, longitude: 2, elevation: 3, name: 'Home', timeZone: 'Asia/Tokyo' })).toEqual({ latitude: 1, longitude: 2, elevation: 3, name: 'Home', timeZone: 'Asia/Tokyo' })
		expect(effectiveSite({}, { latitude: 1, longitude: 2, elevation: 3 })?.timeZone).toBeTruthy()
		expect(effectiveSite({}, undefined)).toBeUndefined()
	})

	test('a place typed in is at sea level in UTC until a zone is chosen, whatever the observer', () => {
		const place = { source: 'manual', latitude: 5, longitude: 6 } as const
		const observer = { latitude: 1, longitude: 2, elevation: 3, timeZone: 'Asia/Tokyo' }
		expect(effectiveSite({ place }, observer)).toEqual({ latitude: 5, longitude: 6, elevation: 0, timeZone: 'UTC' })
		expect(effectiveSite({ place, timeZone: 'Asia/Kathmandu' }, observer)?.timeZone).toBe('Asia/Kathmandu')
	})
})

describe('profile', () => {
	test('another profile forgets the place chosen and the same one keeps it', () => {
		const state = newState()
		state.place = { source: 'manual', latitude: 5, longitude: 6 }
		state.timeZone = 'Asia/Tokyo'
		followProfile(state, 'a')
		followProfile(state, 'a')
		expect(state.place).toBeDefined()

		followProfile(state, 'b')
		expect(state.place).toBeUndefined()
		expect(state.timeZone).toBeUndefined()
	})
})

describe('requests', () => {
	test('opening a site reads its forecast and the night of now', async () => {
		const state = newState()
		const { io, urls } = answering()
		followSite(state, SITE, io)
		await Bun.sleep(0)
		expect(urls).toEqual(['/api/astro-weather/forecast?latitude=-22.4&longitude=-45.45', '/api/astro-weather/night'])
		expect(state.forecast?.generatedAt).toBe(NOW)
		expect(state.night?.sun.localDate).toBe('2026-10-31')
		expect(state.forecastLoading).toBeFalse()
	})

	test('coming back to the same site asks for nothing while the forecast is recent', async () => {
		const state = newState()
		const { io, urls } = answering()
		followSite(state, SITE, io)
		await Bun.sleep(0)
		urls.length = 0

		followSite(state, SITE, io)
		await Bun.sleep(0)
		expect(urls).toEqual([])
	})

	test('a night that ended is replaced by the night of now when the tool is opened again', async () => {
		const state = newState()
		const { io, urls } = answering()
		followSite(state, SITE, io)
		await Bun.sleep(0)
		state.night = { ...NIGHT, sun: { ...NIGHT.sun, end: NOW } }
		urls.length = 0

		followSite(state, SITE, io)
		await Bun.sleep(0)
		expect(urls).toEqual(['/api/astro-weather/night'])
		expect(state.night?.sun.end).toBe(NIGHT.sun.end)
	})

	test('stepping a night computes it and reads no forecast', async () => {
		const state = newState()
		const { io, urls } = answering()
		followSite(state, SITE, io)
		await Bun.sleep(0)
		urls.length = 0

		await stepNight(state, SITE, 1, io)
		expect(urls).toEqual(['/api/astro-weather/night'])
	})

	test('stepping asks for an instant just outside the night shown', async () => {
		const state = newState()
		state.night = NIGHT
		const { io, calls } = deferred()
		void stepNight(state, SITE, 1, io)
		void stepNight(state, SITE, -1, io)
		expect(JSON.parse(calls[0].init!.body as string).time).toBe(NIGHT.sun.end)
		expect(JSON.parse(calls[1].init!.body as string).time).toBe(NIGHT.sun.start - 1)
		calls[0].reject(new DOMException('aborted', 'AbortError'))
		calls[1].resolve(Response.json(NIGHT))
		await Bun.sleep(0)
	})

	test('another site forgets the old values at once and a late answer never returns', async () => {
		const state = newState()
		const { io, calls } = deferred()
		followSite(state, SITE, io)
		state.forecast = FORECAST
		state.night = NIGHT
		followSite(state, OTHER, io)
		expect(state.night).toBeUndefined()
		expect(state.forecast).toBeUndefined()

		const [oldForecast, oldNight, newForecast] = calls
		oldForecast.resolve(Response.json({ ...FORECAST, latitude: 1 }))
		oldNight.resolve(Response.json(NIGHT))
		await Bun.sleep(0)
		expect(state.forecast).toBeUndefined()
		expect(state.night).toBeUndefined()

		newForecast.resolve(Response.json(FORECAST))
		await Bun.sleep(0)
		expect(state.forecast?.latitude).toBe(-22.4)
	})

	test('a failed forecast leaves the night, and the reverse', async () => {
		const state = newState()
		const failing: EclipseIo = { time: () => NOW, fetch: () => Promise.resolve(Response.json({ error: 'No forecast service can be read', code: 'upstreamUnavailable' }, { status: 502 })) }
		state.night = NIGHT
		await loadForecast(state, SITE, failing)
		expect(state.forecastError).toBe('No forecast service can be read')
		expect(state.night).toBeDefined()

		state.forecast = FORECAST
		await loadNight(state, SITE, NOW, failing)
		expect(state.nightError).toBeDefined()
		expect(state.forecast).toBeDefined()
	})
})

describe('coverage', () => {
	test('of a night', () => {
		const span = { start: 100, end: 200 }
		expect(coverage(span, 50, 300)).toBe('full')
		expect(coverage(span, 50, 150)).toBe('partial')
		expect(coverage(span, 150, 300)).toBe('partial')
		expect(coverage(span, 250, 300)).toBe('none')
		expect(coverage(span, undefined, undefined)).toBe('none')
	})

	test('limits the nights offered', () => {
		expect(firstNight(NIGHT, NOW)).toBeTrue()
		expect(firstNight(NIGHT, NIGHT.sun.start - 1)).toBeFalse()
		expect(hasNextNight(NIGHT, FORECAST)).toBeTrue()
		expect(hasNextNight({ ...NIGHT, sun: { ...NIGHT.sun, end: NOW + 200 * HOUR } }, FORECAST)).toBeFalse()
		expect(hasNextNight(NIGHT, undefined)).toBeFalse()
	})
})

describe('sky bands', () => {
	test('split the night by how dark it is', () => {
		expect(skyBands(NIGHT).map((e) => e.band)).toEqual(['day', 'twilight', 'dark', 'twilight', 'day'])
		expect(skyBands(NIGHT)[2]).toMatchObject({ start: NIGHT.sun.darkness[0].start, end: NIGHT.sun.darkness[0].end })
	})

	test('polar nights invent no crossing', () => {
		const day = { ...NIGHT, sun: { ...NIGHT.sun, sunset: undefined, sunrise: undefined, daylight: 'continuousAbove', darkness: [] } } as AstroWeatherNight
		expect(skyBands(day).map((e) => e.band)).toEqual(['day'])
		const dark = { ...NIGHT, sun: { ...NIGHT.sun, sunset: undefined, sunrise: undefined, daylight: 'continuousBelow', darkness: [NIGHT.display] } } as AstroWeatherNight
		expect(skyBands(dark).map((e) => e.band)).toEqual(['dark'])
	})
})

describe('formats', () => {
	test('times follow the zone, and the zone tells apart a repeated hour', () => {
		expect(formatClock(Date.UTC(2026, 9, 31, 23, 5), 'America/Sao_Paulo', false, 'en-GB')).toBe('20:05')
		expect(formatClock(Date.UTC(2026, 9, 31, 18, 20), 'Asia/Kathmandu', false, 'en-GB')).toBe('00:05')
		const zone = 'America/New_York'
		expect(formatClock(Date.UTC(2026, 10, 1, 5, 30), zone, true, 'en-US')).not.toBe(formatClock(Date.UTC(2026, 10, 1, 6, 30), zone, true, 'en-US'))
	})

	test('lengths', () => {
		expect(formatLength({ start: 0, end: 5 * HOUR + 7 * 60_000 })).toBe('5h 07m')
	})
})
