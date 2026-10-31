import { describe, expect, test } from 'bun:test'
import { type AstroWeatherForecast, AstroWeatherService, createAstroWeatherRoutes } from './astroweather'
import { AstroWeatherNights } from './astroweather.night'
import { openMeteoUrl, parseOpenMeteo } from './astroweather.openmeteo'
import { parseSevenTimer, sevenTimerUrl } from './astroweather.seventimer'
import { UpstreamInvalidError, type UpstreamFetch } from './sky/remote'

const LATITUDE = -22.4
const LONGITUDE = -45.45
const SAO_PAULO = { latitude: -22.4, longitude: -45.45, elevation: 850 }

const OPEN_METEO = {
	latitude: -22.390158,
	longitude: -45.46585,
	elevation: 911,
	hourly_units: { time: 'unixtime', cloud_cover: '%', cloud_cover_low: '%', cloud_cover_mid: '%', cloud_cover_high: '%', precipitation_probability: '%', precipitation: 'mm', temperature_2m: '°C', relative_humidity_2m: '%', dew_point_2m: '°C', wind_speed_10m: 'km/h', wind_direction_10m: '°', wind_gusts_10m: 'km/h' },
	hourly: {
		time: [1793404800, 1793408400],
		cloud_cover: [12, null],
		cloud_cover_low: [1, 2],
		cloud_cover_mid: [3, 4],
		cloud_cover_high: [5, 6],
		precipitation_probability: [0, 40],
		precipitation: [0, 0.2],
		temperature_2m: [18.5, 17],
		relative_humidity_2m: [60, 70],
		dew_point_2m: [10.6, 11.4],
		wind_speed_10m: [5, 6],
		wind_direction_10m: [90, 180],
		wind_gusts_10m: [12],
	},
}

const SEVEN_TIMER = {
	product: 'astro',
	init: '2026103106',
	dataseries: [
		{ timepoint: 3, seeing: 3, transparency: 7 },
		{ timepoint: 6, seeing: -9999, transparency: 9 },
	],
}

// Fetch answering each service with `answers`, counting the requests of each.
function upstream(answers: { openMeteo?: () => Response | Promise<Response>; sevenTimer?: () => Response | Promise<Response> } = {}) {
	const calls = { openMeteo: 0, sevenTimer: 0 }
	const fetch: UpstreamFetch = (url) => {
		if (url.includes('open-meteo')) {
			calls.openMeteo++
			return Promise.resolve(answers.openMeteo?.() ?? Response.json(OPEN_METEO))
		}

		calls.sevenTimer++
		return Promise.resolve(answers.sevenTimer?.() ?? new Response(JSON.stringify(SEVEN_TIMER), { headers: { 'Content-Type': 'text/html; charset=UTF-8' } }))
	}
	return { fetch, calls }
}

// Reads the forecast route of a service.
function forecastRoute(service: AstroWeatherService) {
	const routes = createAstroWeatherRoutes(service)
	return routes['/api/astro-weather/forecast'].GET(new Request(`http://localhost/api/astro-weather/forecast?latitude=${LATITUDE}&longitude=${LONGITUDE}`) as never)
}

const unavailable = () => new Response('down', { status: 503 })

describe('Open-Meteo', () => {
	test('the request names fixed units and UTC, and no elevation', () => {
		const url = new URL(openMeteoUrl(LATITUDE, LONGITUDE))
		expect(url.host).toBe('api.open-meteo.com')
		expect(url.searchParams.get('forecast_days')).toBe('8')
		expect(url.searchParams.get('timezone')).toBe('UTC')
		expect(url.searchParams.get('timeformat')).toBe('unixtime')
		expect(url.searchParams.has('elevation')).toBeFalse()
		expect(url.searchParams.get('hourly')).toContain('wind_gusts_10m')
	})

	test('seconds become milliseconds once and absent values stay absent', () => {
		const { grid, samples } = parseOpenMeteo(JSON.stringify(OPEN_METEO))
		expect(grid).toEqual({ latitude: -22.390158, longitude: -45.46585, elevation: 911 })
		expect(samples[0].time).toBe(1793404800000)
		expect(samples[0]).toMatchObject({ cloudCover: 12, precipitation: 0, temperature: 18.5, dewPoint: 10.6, windGust: 12 })
		expect(samples[1].cloudCover).toBeUndefined()
		expect(samples[1].windGust).toBeUndefined()
		expect(samples[1].precipitation).toBe(0.2)
	})

	test('refuses what it cannot read', () => {
		expect(() => parseOpenMeteo('<html>')).toThrow(UpstreamInvalidError)
		expect(() => parseOpenMeteo('{}')).toThrow(UpstreamInvalidError)
		expect(() => parseOpenMeteo(JSON.stringify({ ...OPEN_METEO, hourly_units: { temperature_2m: '°F' } }))).toThrow(UpstreamInvalidError)
	})
})

describe('7Timer!', () => {
	test('the request forces the ASTRO JSON product without altitude correction', () => {
		const url = new URL(sevenTimerUrl(-22.4, -45.5))
		expect(url.host).toBe('www.7timer.info')
		expect(Object.fromEntries(url.searchParams)).toEqual({ lon: '-45.5', lat: '-22.4', product: 'astro', output: 'json', ac: '0' })
	})

	test('instants count from the model run in UTC', () => {
		const { modelRunAt, samples } = parseSevenTimer(JSON.stringify(SEVEN_TIMER))
		expect(modelRunAt).toBe(Date.UTC(2026, 9, 31, 6))
		expect(samples[0]).toEqual({ time: Date.UTC(2026, 9, 31, 9), seeing: 3, transparency: 7 })
	})

	test('-9999 and classes outside 1 to 8 are unknown', () => {
		const { samples } = parseSevenTimer(JSON.stringify(SEVEN_TIMER))
		expect(samples[1].seeing).toBeUndefined()
		expect(samples[1].transparency).toBeUndefined()
	})

	test('refuses what it cannot read', () => {
		expect(() => parseSevenTimer('<html>')).toThrow(UpstreamInvalidError)
		expect(() => parseSevenTimer(JSON.stringify({ dataseries: [] }))).toThrow(UpstreamInvalidError)
		expect(() => parseSevenTimer(JSON.stringify({ init: '2026103106', dataseries: [] }))).toThrow(UpstreamInvalidError)
	})
})

describe('forecast route', () => {
	test('answers both services with their provenance', async () => {
		const { fetch } = upstream()
		const service = new AstroWeatherService({ fetch, now: () => 1000 })
		const body = (await (await forecastRoute(service)).json()) as AstroWeatherForecast
		expect(body.latitude).toBe(LATITUDE)
		expect(body.meteorology.source).toEqual({ provider: 'openMeteo', state: 'fresh', fetchedAt: 1000, validFrom: 1793404800000, validTo: 1793408400000 })
		expect(body.astronomy.source).toMatchObject({ provider: 'sevenTimer', state: 'fresh', modelRunAt: Date.UTC(2026, 9, 31, 6) })
		expect(body.astronomy.cellDegrees).toBeCloseTo(0.1)
		expect(body.meteorology.samples).toHaveLength(2)
		expect(body.astronomy.samples).toHaveLength(2)
	})

	test('a service that fails leaves the other usable', async () => {
		const { fetch } = upstream({ openMeteo: unavailable })
		const response = await forecastRoute(new AstroWeatherService({ fetch }))
		expect(response.status).toBe(200)
		const body = (await response.json()) as AstroWeatherForecast
		expect(body.meteorology.source).toEqual({ provider: 'openMeteo', state: 'unavailable', errorCode: 'upstreamUnavailable' })
		expect(body.meteorology.samples).toEqual([])
		expect(body.astronomy.source.state).toBe('fresh')
	})

	test('a limit and an unreadable answer are named', async () => {
		const { fetch } = upstream({ openMeteo: () => new Response('busy', { status: 429 }), sevenTimer: () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } }) })
		const service = new AstroWeatherService({ fetch })
		const body = await service.forecast(LATITUDE, LONGITUDE)
		expect(body.meteorology.source.errorCode).toBe('rateLimited')
		expect(body.astronomy.source.errorCode).toBe('invalidResponse')
	})

	test('both services down answer 502 with their states', async () => {
		const { fetch } = upstream({ openMeteo: unavailable, sevenTimer: unavailable })
		const response = await forecastRoute(new AstroWeatherService({ fetch }))
		expect(response.status).toBe(502)
		const body = (await response.json()) as { code: string; sources: readonly { state: string }[] }
		expect(body.code).toBe('upstreamUnavailable')
		expect(body.sources.map((e) => e.state)).toEqual(['unavailable', 'unavailable'])
	})

	test('a failure with a previous forecast answers it as stale', async () => {
		let now = 0
		let down = false
		const { fetch } = upstream({ openMeteo: () => (down ? unavailable() : Response.json(OPEN_METEO)) })
		const service = new AstroWeatherService({ fetch, now: () => now })
		await service.forecast(LATITUDE, LONGITUDE)

		down = true
		now = 31 * 60_000
		const body = await service.forecast(LATITUDE, LONGITUDE)
		expect(body.meteorology.source.state).toBe('stale')
		expect(body.meteorology.source.fetchedAt).toBe(0)
		expect(body.meteorology.samples).toHaveLength(2)

		now = 6 * 3_600_000
		expect((await service.forecast(LATITUDE, LONGITUDE)).meteorology.source.state).toBe('unavailable')
	})

	test('concurrent requests share one download of each service', async () => {
		const { fetch, calls } = upstream()
		const service = new AstroWeatherService({ fetch })
		await Promise.all([service.forecast(LATITUDE, LONGITUDE), service.forecast(LATITUDE, LONGITUDE), service.forecast(LATITUDE + 0.001, LONGITUDE)])
		expect(calls).toEqual({ openMeteo: 1, sevenTimer: 1 })
	})

	test('each service has its own time to live and places do not collide', async () => {
		let now = 0
		const { fetch, calls } = upstream()
		const service = new AstroWeatherService({ fetch, now: () => now })
		await service.forecast(LATITUDE, LONGITUDE)

		now = 31 * 60_000
		await service.forecast(LATITUDE, LONGITUDE)
		expect(calls).toEqual({ openMeteo: 2, sevenTimer: 1 })

		await service.forecast(LATITUDE + 1, LONGITUDE)
		expect(calls).toEqual({ openMeteo: 3, sevenTimer: 2 })
	})

	test('a failure is not retried for a minute', async () => {
		let now = 0
		const { fetch, calls } = upstream({ openMeteo: unavailable, sevenTimer: unavailable })
		const service = new AstroWeatherService({ fetch, now: () => now })
		await service.forecast(LATITUDE, LONGITUDE)

		now = 30_000
		await service.forecast(LATITUDE, LONGITUDE)
		expect(calls).toEqual({ openMeteo: 1, sevenTimer: 1 })
	})
})

describe('night route', () => {
	test('answers the local night of an instant without any service', async () => {
		const { fetch, calls } = upstream()
		const routes = createAstroWeatherRoutes(new AstroWeatherService({ fetch }))
		const request = new Request('http://localhost/api/astro-weather/night', { method: 'POST', body: JSON.stringify({ observer: SAO_PAULO, timeZone: 'America/Sao_Paulo', time: Date.UTC(2026, 9, 31, 23) }) })
		const body = (await (await routes['/api/astro-weather/night'].POST(request as never)).json()) as ReturnType<AstroWeatherNights['night']>
		expect(body.sun.localDate).toBe('2026-10-31')
		expect(body.display.start).toBe(body.sun.sunset! - 3_600_000)
		expect(body.display.end).toBe(body.sun.sunrise! + 3_600_000)
		expect(body.moon.illuminatedFraction).toBeGreaterThan(0)
		expect(body.moon.illuminatedFraction).toBeLessThanOrEqual(1)
		expect(calls).toEqual({ openMeteo: 0, sevenTimer: 0 })
	})

	test('a night is kept and found by any of its instants', () => {
		const nights = new AstroWeatherNights()
		const first = nights.night({ observer: SAO_PAULO, timeZone: 'America/Sao_Paulo', time: Date.UTC(2026, 9, 31, 23) })
		expect(nights.night({ observer: SAO_PAULO, timeZone: 'America/Sao_Paulo', time: Date.UTC(2026, 10, 1, 5) })).toBe(first)
		expect(nights.night({ observer: SAO_PAULO, timeZone: 'UTC', time: Date.UTC(2026, 10, 1, 5) })).not.toBe(first)
		expect(nights.night({ observer: SAO_PAULO, timeZone: 'America/Sao_Paulo', time: first.sun.end }).sun.localDate).toBe('2026-11-01')
	})

	test('polar day shows the whole night', () => {
		const nights = new AstroWeatherNights()
		const { sun, display } = nights.night({ observer: { latitude: 69.65, longitude: 18.96, elevation: 0 }, timeZone: 'Europe/Oslo', time: Date.UTC(2026, 5, 21, 20) })
		expect(display).toEqual({ start: sun.start, end: sun.end })
	})
})
