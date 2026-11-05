import { describe, expect, test } from 'bun:test'
import type { AstroWeatherForecast, AstroWeatherNight } from 'api'
import { proxy } from 'valtio'
import { ACTIVE_TOOL_LOCATION, resolveToolLocation } from '../../location/site'
import { DEFAULT_ZONE_OVERRIDE, resolveDisplayZone } from '../../location/zone'
import type { EclipseIo } from '../eclipse/eclipse'
import { type AstroWeatherState, coverage, firstNight, followProfile, followSite, formatClock, formatLength, hasNextNight, loadCurrentNight, loadForecast, loadNight, nightEnded, siteKey, skyBands, stepNight } from './astroweather'

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

function newState(initial: Partial<AstroWeatherState> = {}) {
	return proxy<AstroWeatherState>({ location: ACTIVE_TOOL_LOCATION, zone: DEFAULT_ZONE_OVERRIDE, forecastLoading: false, nightLoading: false, ...initial })
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

// Body of a night request.
function nightBody(init: RequestInit | undefined) {
	return JSON.parse(init!.body as string)
}

describe('location and zone', () => {
	test('a display zone keys nothing and asks for nothing', async () => {
		const state = newState()
		const { io, urls } = answering()
		followSite(state, SITE, io)
		await Bun.sleep(0)
		const key = state.siteKey
		urls.length = 0

		state.zone = { mode: 'utc' }
		followSite(state, SITE, io)
		state.zone = { mode: 'zone', zone: 'Asia/Tokyo' }
		followSite(state, SITE, io)
		await Bun.sleep(0)
		expect(urls).toEqual([])
		expect(state.siteKey).toBe(key)
		expect(siteKey(SITE)).toBe(key!)
		expect(state.night).toBeDefined()
		expect(state.forecast).toBeDefined()
	})

	test('the night is named in the zone of the location even when the times are shown in UTC', () => {
		const state = newState()
		state.zone = { mode: 'utc' }
		expect(resolveDisplayZone('site', state.zone, SITE).zone).toBe('UTC')

		const { io, calls } = deferred()
		followSite(state, { ...SITE, name: 'Home' }, io)
		expect(calls[0].url).toBe('/api/astro-weather/forecast?latitude=-22.4&longitude=-45.45')
		expect(nightBody(calls[1].init)).toEqual({ observer: { latitude: -22.4, longitude: -45.45, elevation: 850 }, timeZone: 'America/Sao_Paulo', time: NOW })
	})

	test('a saved site other than the active one is used with its own zone', () => {
		const sites = [
			{ id: 'home', name: 'Home', latitude: 35.7, longitude: 139.7, elevation: 40, timeZone: 'Asia/Tokyo' },
			{ id: 'dark', name: 'Dark Site', ...SITE },
		]
		const state = newState()
		state.location = { mode: 'saved', siteId: 'dark' }
		const location = resolveToolLocation(state.location, 'home', sites)!
		expect(resolveDisplayZone('site', state.zone, location).zone).toBe('America/Sao_Paulo')

		const { io, calls } = deferred()
		followSite(state, location, io)
		expect(calls[0].url).toBe('/api/astro-weather/forecast?latitude=-22.4&longitude=-45.45')
		expect(nightBody(calls[1].init)).toMatchObject({ observer: { latitude: -22.4, longitude: -45.45, elevation: 850 }, timeZone: 'America/Sao_Paulo' })
	})

	test('coordinates entered keep their zone for the night when the times are shown in the browser zone', () => {
		const state = newState()
		state.location = { mode: 'manual', latitude: 5, longitude: 6, elevation: 120, timeZone: 'UTC' }
		state.zone = { mode: 'browser' }
		const location = resolveToolLocation(state.location, undefined, [])!
		expect(resolveDisplayZone('site', state.zone, location, 'Europe/Berlin').zone).toBe('Europe/Berlin')

		const { io, calls } = deferred()
		followSite(state, location, io)
		expect(nightBody(calls[1].init)).toMatchObject({ observer: { latitude: 5, longitude: 6, elevation: 120 }, timeZone: 'UTC' })
	})

	test('another zone of the location is another night, and clears the values', () => {
		const state = newState()
		const { io, calls } = deferred()
		followSite(state, SITE, io)
		state.night = NIGHT
		followSite(state, { ...SITE, timeZone: 'UTC' }, io)
		expect(state.night).toBeUndefined()
		expect(nightBody(calls.at(-1)!.init).timeZone).toBe('UTC')
	})
})

describe('profile', () => {
	test('another profile forgets the location and zone chosen and the same one keeps them', () => {
		const state = newState({ location: { mode: 'manual', latitude: 5, longitude: 6, elevation: 0, timeZone: 'Asia/Tokyo' }, zone: { mode: 'utc' } })
		followProfile(state, 'a')
		followProfile(state, 'a')
		expect(state.location.mode).toBe('manual')

		followProfile(state, 'b')
		expect(state.location).toEqual(ACTIVE_TOOL_LOCATION)
		expect(state.zone).toEqual(DEFAULT_ZONE_OVERRIDE)
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
		state.night = { ...NIGHT, display: { ...NIGHT.display, end: NOW } }
		urls.length = 0

		followSite(state, SITE, io)
		await Bun.sleep(0)
		expect(urls).toEqual(['/api/astro-weather/night'])
		expect(state.night?.display.end).toBe(NIGHT.display.end)
	})

	test('after the morning window the current night is the next one, before the Sun reaches its transit', async () => {
		const state = newState()
		const next = { ...NIGHT, sun: { ...NIGHT.sun, localDate: '2026-11-01', start: NIGHT.sun.end, end: NIGHT.sun.end + 24 * HOUR }, display: { start: NIGHT.display.start + 24 * HOUR, end: NIGHT.display.end + 24 * HOUR } }
		const times: number[] = []
		const io: EclipseIo = {
			time: () => NIGHT.display.end + HOUR,
			fetch: (_, init) => {
				const { time } = JSON.parse(init!.body as string)
				times.push(time)
				return Promise.resolve(Response.json(time < NIGHT.sun.end ? NIGHT : next))
			},
		}

		await loadCurrentNight(state, SITE, io)
		expect(times).toEqual([NIGHT.display.end + HOUR, NIGHT.sun.end])
		expect(state.night?.sun.localDate).toBe('2026-11-01')
		expect(firstNight(state.night!, io.time(), state.currentNightStart)).toBeTrue()
		expect(firstNight(state.night!, io.time())).toBeFalse()
	})

	test('stepping leaves the current night where it is', async () => {
		const state = newState()
		const { io } = answering()
		state.currentNightStart = NOW - 24 * HOUR
		await loadNight(state, SITE, NOW, io)
		expect(state.currentNightStart).toBe(NOW - 24 * HOUR)
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
		expect(nightEnded(NIGHT, NIGHT.display.end - 1)).toBeFalse()
		expect(nightEnded(NIGHT, NIGHT.display.end)).toBeTrue()
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
