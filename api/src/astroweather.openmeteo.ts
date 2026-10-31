import { UpstreamInvalidError } from './sky/remote'

// Open-Meteo adapter of Astro Weather: the fixed URL of the hourly forecast of a place and the reading of its answer. The
// model is the service's default best_match, which names no run, and the elevation is left to the service, since the height
// above the ellipsoid of an observer is not the terrain height it expects. Upstream Unix seconds become Unix milliseconds
// here, once. Values the service leaves null are absent, never 0.

// Endpoint of the forecast API.
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast'

// UTC forecast days requested: the dawn after the seventh local evening may fall on the eighth, whatever the time zone.
const FORECAST_DAYS = 8

// Hourly variables requested, with the unit each must be answered in. Requested explicitly, so another unit means the
// service changed, not that a different number can be read as if it were the same.
const HOURLY_UNITS = {
	cloud_cover: '%',
	cloud_cover_low: '%',
	cloud_cover_mid: '%',
	cloud_cover_high: '%',
	precipitation_probability: '%',
	precipitation: 'mm',
	temperature_2m: '°C',
	relative_humidity_2m: '%',
	dew_point_2m: '°C',
	wind_speed_10m: 'km/h',
	wind_direction_10m: '°',
	wind_gusts_10m: 'km/h',
} as const

// Name of an hourly variable.
type HourlyVariable = keyof typeof HOURLY_UNITS

// Answer of the forecast API, with the fields read here.
interface OpenMeteoResponse {
	// Latitude of the grid cell in degrees.
	readonly latitude?: number
	// Longitude of the grid cell in degrees.
	readonly longitude?: number
	// Terrain height the forecast was downscaled to, in meters.
	readonly elevation?: number
	// Unit of each variable as answered.
	readonly hourly_units?: Readonly<Record<string, string>>
	// Instants in Unix seconds, and one array of values per variable.
	readonly hourly?: { readonly time?: readonly number[] } & Readonly<Partial<Record<HourlyVariable, readonly (number | null)[]>>>
}

// One hour of the meteorological forecast. Cloud, temperature, humidity, dew point, and sustained wind are instantaneous
// at `time`; precipitation, its probability, and gusts describe the hour before `time`. Absent when not forecast.
export interface MeteorologySample {
	// Instant of the sample, Unix milliseconds.
	readonly time: number
	// Total cloud cover in percent, [0, 100].
	readonly cloudCover?: number
	// Low cloud cover in percent, [0, 100].
	readonly cloudCoverLow?: number
	// Middle cloud cover in percent, [0, 100].
	readonly cloudCoverMid?: number
	// High cloud cover in percent, [0, 100].
	readonly cloudCoverHigh?: number
	// Chance of more than 0.1 mm of precipitation in the hour before, in percent, [0, 100]; not an occurrence.
	readonly precipitationProbability?: number
	// Modeled precipitation of the hour before, in millimeters.
	readonly precipitation?: number
	// Air temperature at 2 m in degrees Celsius.
	readonly temperature?: number
	// Relative humidity at 2 m in percent, [0, 100].
	readonly relativeHumidity?: number
	// Dew point at 2 m in degrees Celsius.
	readonly dewPoint?: number
	// Sustained wind at 10 m in km/h.
	readonly windSpeed?: number
	// Direction the wind comes from at 10 m, in degrees clockwise from north, [0, 360].
	readonly windDirection?: number
	// Strongest gust at 10 m of the hour before, in km/h.
	readonly windGust?: number
}

// Grid cell the service answered for a place, which is not the place itself.
export interface MeteorologyGrid {
	// Latitude in degrees, north positive.
	readonly latitude?: number
	// Longitude in degrees, east positive.
	readonly longitude?: number
	// Terrain height of the forecast in meters; not the observer's elevation.
	readonly elevation?: number
}

// Hourly forecast of a place.
export interface OpenMeteoForecast {
	// Grid cell of the forecast.
	readonly grid: MeteorologyGrid
	// Samples in time order.
	readonly samples: readonly MeteorologySample[]
}

// Returns the URL of the hourly forecast of a place, with degrees as given.
export function openMeteoUrl(latitude: number, longitude: number) {
	const url = new URL(OPEN_METEO_URL)
	url.search = new URLSearchParams({
		latitude: `${latitude}`,
		longitude: `${longitude}`,
		hourly: Object.keys(HOURLY_UNITS).join(','),
		forecast_days: `${FORECAST_DAYS}`,
		timezone: 'UTC',
		timeformat: 'unixtime',
		temperature_unit: 'celsius',
		wind_speed_unit: 'kmh',
		precipitation_unit: 'mm',
	}).toString()
	return url.toString()
}

// Reads the answer of the forecast API. Rejects with UpstreamInvalidError an answer that is not JSON, has no instants, or
// states another unit; an array shorter than the instants, or a null, only leaves those values absent.
export function parseOpenMeteo(text: string): OpenMeteoForecast {
	let response: OpenMeteoResponse

	try {
		response = JSON.parse(text) as OpenMeteoResponse
	} catch (error) {
		throw new UpstreamInvalidError('The Open-Meteo forecast is not JSON', { cause: error })
	}

	const { hourly, hourly_units: units, latitude, longitude, elevation } = response
	if (!Array.isArray(hourly?.time)) throw new UpstreamInvalidError('The Open-Meteo forecast has no hourly instants')

	for (const [name, unit] of Object.entries(HOURLY_UNITS)) {
		if (units?.[name] !== undefined && units[name] !== unit) throw new UpstreamInvalidError(`Open-Meteo answered ${name} in ${units[name]}`)
	}

	const value = (name: HourlyVariable, index: number) => hourly[name]?.[index] ?? undefined

	const samples = hourly.time.map((seconds, i): MeteorologySample => ({
		time: seconds * 1000,
		cloudCover: value('cloud_cover', i),
		cloudCoverLow: value('cloud_cover_low', i),
		cloudCoverMid: value('cloud_cover_mid', i),
		cloudCoverHigh: value('cloud_cover_high', i),
		precipitationProbability: value('precipitation_probability', i),
		precipitation: value('precipitation', i),
		temperature: value('temperature_2m', i),
		relativeHumidity: value('relative_humidity_2m', i),
		dewPoint: value('dew_point_2m', i),
		windSpeed: value('wind_speed_10m', i),
		windDirection: value('wind_direction_10m', i),
		windGust: value('wind_gusts_10m', i),
	}))

	return { grid: { latitude, longitude, elevation }, samples }
}
