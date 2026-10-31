import { type AstroWeatherNight, type AstroWeatherNightRequest, AstroWeatherNights } from './astroweather.night'
import { type MeteorologyGrid, type MeteorologySample, type OpenMeteoForecast, openMeteoUrl, parseOpenMeteo } from './astroweather.openmeteo'
import { type AstronomicalSample, parseSevenTimer, SEVEN_TIMER_DECIMALS, type SevenTimerForecast, sevenTimerUrl } from './astroweather.seventimer'
import { errorResponse } from './http'
import { fetchUpstream, RemoteCache, type UpstreamFetch, UpstreamInvalidError, UpstreamUnavailableError } from './sky/remote'

// Astro Weather: stateless, read-only forecasts of a place from two fixed public services, Open-Meteo for the weather and
// 7Timer! ASTRO for seeing and transparency, and the local astronomy of a night. Never an operation or an event, and nothing
// here reads or commands a device. Each service is read and cached apart, so a failure of one leaves the other usable, and a
// forecast is never presented as an observation. The cache is shared by every tab of the server, so a tab refreshing never
// reaches a service before its time to live ends. Places are degrees and times Unix milliseconds.

// How long an Open-Meteo forecast is fresh, in milliseconds (30 minutes).
const OPEN_METEO_TTL_MS = 30 * 60_000

// How long a 7Timer! forecast is fresh, in milliseconds (2 hours; its runs are hours apart).
const SEVEN_TIMER_TTL_MS = 2 * 3_600_000

// Age from which an Open-Meteo forecast is no longer answered as stale, in milliseconds (6 hours).
const OPEN_METEO_MAX_STALE_MS = 6 * 3_600_000

// Age from which a 7Timer! forecast is no longer answered as stale, in milliseconds (12 hours).
const SEVEN_TIMER_MAX_STALE_MS = 12 * 3_600_000

// Budget of one download in milliseconds.
const FORECAST_TIMEOUT_MS = 12_000

// Largest forecast accepted, in bytes (they are about 11 KB and 5 KB).
const FORECAST_MAX_BYTES = 1024 * 1024

// Places kept per service.
const FORECAST_CACHE_LIMIT = 128

// Decimals of the degrees of a place sent to Open-Meteo: a hundredth, about 1 km, well inside its grid cells.
const OPEN_METEO_DECIMALS = 2

// Services a forecast comes from.
export type AstroWeatherProvider = 'openMeteo' | 'sevenTimer'

// State of a service: read now, the last good forecast after a failed read, or nothing to show.
export type AstroWeatherSourceState = 'fresh' | 'stale' | 'unavailable'

// Stable codes of why a service gave nothing.
export type AstroWeatherErrorCode = 'upstreamUnavailable' | 'invalidResponse' | 'rateLimited'

// Provenance of the part of a forecast that came from one service.
export interface AstroWeatherSource {
	// Service.
	readonly provider: AstroWeatherProvider
	// State of the service.
	readonly state: AstroWeatherSourceState
	// When the forecast was downloaded, Unix milliseconds.
	readonly fetchedAt?: number
	// Model run of the forecast, Unix milliseconds; absent when the service does not tell it.
	readonly modelRunAt?: number
	// First sample, Unix milliseconds.
	readonly validFrom?: number
	// Last sample, Unix milliseconds.
	readonly validTo?: number
	// Why there is nothing to show; only when unavailable.
	readonly errorCode?: AstroWeatherErrorCode
}

// Hourly weather of a forecast.
export interface AstroWeatherMeteorology {
	// Provenance.
	readonly source: AstroWeatherSource
	// Grid cell the service answered for the place; absent when unavailable.
	readonly grid?: MeteorologyGrid
	// Samples in time order; empty when unavailable.
	readonly samples: readonly MeteorologySample[]
}

// Seeing and transparency of a forecast.
export interface AstroWeatherAstronomy {
	// Provenance.
	readonly source: AstroWeatherSource
	// Degrees of the place the service rounded to; the forecast describes that cell, not the exact place.
	readonly cellDegrees: number
	// Discrete samples in time order; empty when unavailable.
	readonly samples: readonly AstronomicalSample[]
}

// Answer of GET /api/astro-weather/forecast.
export interface AstroWeatherForecast {
	// Latitude asked for, in degrees.
	readonly latitude: number
	// Longitude asked for, in degrees.
	readonly longitude: number
	// When the answer was composed, Unix milliseconds.
	readonly generatedAt: number
	// Weather.
	readonly meteorology: AstroWeatherMeteorology
	// Seeing and transparency.
	readonly astronomy: AstroWeatherAstronomy
}

// Options of the Astro Weather service.
export interface AstroWeatherOptions {
	// Fetch of the services; the global fetch by default.
	readonly fetch?: UpstreamFetch
	// Current time, Unix milliseconds; Date.now by default.
	readonly now?: () => number
}

// Part of a service read for a forecast.
interface SourceRead<T> {
	// Provenance so far.
	readonly source: AstroWeatherSource
	// Forecast read; absent when unavailable.
	readonly value?: T
}

// Returns the code of a failed read.
function failureCode(error: UpstreamUnavailableError): AstroWeatherErrorCode {
	if (error instanceof UpstreamInvalidError) return 'invalidResponse'
	return error.status === 429 ? 'rateLimited' : 'upstreamUnavailable'
}

// Forecasts of the places asked for, read from each service at most once per time to live and place.
export class AstroWeatherService {
	readonly #fetch: UpstreamFetch
	readonly #now: () => number
	readonly #openMeteo: RemoteCache<OpenMeteoForecast>
	readonly #sevenTimer: RemoteCache<SevenTimerForecast>
	readonly #nights = new AstroWeatherNights()

	// Creates the service.
	constructor({ fetch: upstream = (url, init) => fetch(url, init), now = Date.now }: AstroWeatherOptions = {}) {
		this.#fetch = upstream
		this.#now = now
		this.#openMeteo = new RemoteCache(OPEN_METEO_TTL_MS, now, { limit: FORECAST_CACHE_LIMIT, maxStaleMs: OPEN_METEO_MAX_STALE_MS, rememberFailure: true })
		this.#sevenTimer = new RemoteCache(SEVEN_TIMER_TTL_MS, now, { limit: FORECAST_CACHE_LIMIT, maxStaleMs: SEVEN_TIMER_MAX_STALE_MS, rememberFailure: true })
	}

	// Reads a service through its cache. Never rejects for a failure of the service, which is told by the state instead.
	async #read<T>(provider: AstroWeatherProvider, cache: RemoteCache<T>, key: string, load: () => Promise<T>): Promise<SourceRead<T>> {
		try {
			const { value, fetchedAt, stale } = await cache.get(key, load)
			return { source: { provider, state: stale ? 'stale' : 'fresh', fetchedAt }, value }
		} catch (error) {
			if (error instanceof UpstreamUnavailableError) return { source: { provider, state: 'unavailable', errorCode: failureCode(error) } }
			throw error
		}
	}

	// Downloads the text of a forecast. A contentType of '' takes any type, for a service that mislabels its JSON.
	async #download(url: string, contentType: string) {
		const { bytes } = await fetchUpstream(this.#fetch, url, contentType, FORECAST_TIMEOUT_MS, FORECAST_MAX_BYTES)
		return new TextDecoder().decode(bytes)
	}

	// Returns the weather of a place.
	async #meteorology(latitude: number, longitude: number): Promise<AstroWeatherMeteorology> {
		const lat = +latitude.toFixed(OPEN_METEO_DECIMALS)
		const lon = +longitude.toFixed(OPEN_METEO_DECIMALS)
		const { source, value } = await this.#read('openMeteo', this.#openMeteo, `${lat}|${lon}`, async () => parseOpenMeteo(await this.#download(openMeteoUrl(lat, lon), 'application/json')))
		return { source: { ...source, validFrom: value?.samples[0]?.time, validTo: value?.samples.at(-1)?.time }, grid: value?.grid, samples: value?.samples ?? [] }
	}

	// Returns the seeing and transparency of a place.
	async #astronomy(latitude: number, longitude: number): Promise<AstroWeatherAstronomy> {
		const lat = +latitude.toFixed(SEVEN_TIMER_DECIMALS)
		const lon = +longitude.toFixed(SEVEN_TIMER_DECIMALS)
		const { source, value } = await this.#read('sevenTimer', this.#sevenTimer, `${lat}|${lon}`, async () => parseSevenTimer(await this.#download(sevenTimerUrl(lat, lon), '')))
		return { source: { ...source, modelRunAt: value?.modelRunAt, validFrom: value?.samples[0]?.time, validTo: value?.samples.at(-1)?.time }, cellDegrees: 10 ** -SEVEN_TIMER_DECIMALS, samples: value?.samples ?? [] }
	}

	// Returns the forecast of a place, whatever each service managed to give.
	async forecast(latitude: number, longitude: number): Promise<AstroWeatherForecast> {
		const [meteorology, astronomy] = await Promise.all([this.#meteorology(latitude, longitude), this.#astronomy(latitude, longitude)])
		return { latitude, longitude, generatedAt: this.#now(), meteorology, astronomy }
	}

	// Returns the night containing an instant, computed locally.
	night(request: AstroWeatherNightRequest): AstroWeatherNight {
		return this.#nights.night(request)
	}
}

// Creates the Astro Weather routes.
export function createAstroWeatherRoutes(service: AstroWeatherService) {
	return {
		'/api/astro-weather/forecast': {
			// Forecast of ?latitude&longitude (AstroWeatherForecast), a failed service told by its state; 502 upstreamUnavailable
			// with `sources` when neither has anything to show.
			GET: async (req) => {
				const params = new URL(req.url).searchParams
				const forecast = await service.forecast(+params.get('latitude')!, +params.get('longitude')!)
				const sources = [forecast.meteorology.source, forecast.astronomy.source]
				if (sources.every((source) => source.state === 'unavailable')) return errorResponse('No forecast service can be read', 502, 'upstreamUnavailable', { sources })
				return Response.json(forecast)
			},
		},
		'/api/astro-weather/night': {
			// Night containing the instant of the body (AstroWeatherNightRequest), computed locally.
			POST: async (req) => Response.json(service.night((await req.json()) as AstroWeatherNightRequest) satisfies AstroWeatherNight),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
