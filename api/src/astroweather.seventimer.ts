import { UpstreamInvalidError } from './sky/remote'

// 7Timer! ASTRO adapter of Astro Weather: the fixed URL of the seeing and transparency forecast of a place and the reading
// of its answer. The service redirects api.pl to its own script and rounds the place to 0.1° there, despite documenting
// 0.001°. Its samples are discrete instants 3 hours apart, counted in hours from a model run in UTC, and last about 3 days.
// The classes are the service's own categories, never measurements; only they are read, since cloud and precipitation come
// from Open-Meteo.

// Endpoint of the 7Timer! API.
const SEVEN_TIMER_URL = 'https://www.7timer.info/bin/api.pl'

// Smallest class of seeing and transparency, the best.
const MINIMUM_CLASS = 1

// Largest class of seeing and transparency, the worst.
const MAXIMUM_CLASS = 8

// One hour in milliseconds.
const HOUR_MS = 3_600_000

// Decimals of the degrees 7Timer! keeps of a place: it rounds them to a tenth.
export const SEVEN_TIMER_DECIMALS = 1

// Seeing or transparency category of 7Timer!, 1 the best and 8 the worst.
export type SevenTimerClass = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

// Answer of 7Timer! ASTRO, with the fields read here.
interface SevenTimerResponse {
	// Model run, YYYYMMDDHH in UTC.
	readonly init?: string
	// Samples of the forecast.
	readonly dataseries?: readonly {
		// Hours after the model run.
		readonly timepoint?: number
		// Seeing class, or -9999 when undefined.
		readonly seeing?: number
		// Transparency class, or -9999 when undefined.
		readonly transparency?: number
	}[]
}

// One discrete sample of the astronomical forecast. Absent classes are unknown.
export interface AstronomicalSample {
	// Instant of the sample, Unix milliseconds.
	readonly time: number
	// Seeing class; it stands for a band of arcseconds, never one value.
	readonly seeing?: SevenTimerClass
	// Transparency class; it stands for a band of magnitudes per airmass, never one value.
	readonly transparency?: SevenTimerClass
}

// Astronomical forecast of a place.
export interface SevenTimerForecast {
	// Model run, Unix milliseconds.
	readonly modelRunAt: number
	// Samples in time order.
	readonly samples: readonly AstronomicalSample[]
}

// Returns the URL of the ASTRO forecast of a place, with degrees as given.
export function sevenTimerUrl(latitude: number, longitude: number) {
	const url = new URL(SEVEN_TIMER_URL)
	url.search = new URLSearchParams({ lon: `${longitude}`, lat: `${latitude}`, product: 'astro', output: 'json', ac: '0' }).toString()
	return url.toString()
}

// Returns a category of the service, or undefined for -9999 and anything else outside 1 to 8.
function forecastClass(value: number | undefined) {
	return Number.isInteger(value) && value! >= MINIMUM_CLASS && value! <= MAXIMUM_CLASS ? (value as SevenTimerClass) : undefined
}

// Reads a model run in the form YYYYMMDDHH as Unix milliseconds; undefined for any other text.
function modelRun(init: string | undefined) {
	const match = /^(\d{4})(\d{2})(\d{2})(\d{2})$/.exec(init ?? '')
	return match ? Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4]) : undefined
}

// Reads the answer of 7Timer! ASTRO. Rejects with UpstreamInvalidError an answer that is not JSON, or has no model run or
// no samples.
export function parseSevenTimer(text: string): SevenTimerForecast {
	let response: SevenTimerResponse

	try {
		response = JSON.parse(text) as SevenTimerResponse
	} catch (error) {
		throw new UpstreamInvalidError('The 7Timer! forecast is not JSON', { cause: error })
	}

	const modelRunAt = modelRun(response.init)
	if (modelRunAt === undefined) throw new UpstreamInvalidError('The 7Timer! forecast has no model run')
	if (!Array.isArray(response.dataseries) || response.dataseries.length === 0) throw new UpstreamInvalidError('The 7Timer! forecast has no samples')

	const samples: AstronomicalSample[] = []

	for (const { timepoint, seeing, transparency } of response.dataseries) {
		if (typeof timepoint === 'number') samples.push({ time: modelRunAt + timepoint * HOUR_MS, seeing: forecastClass(seeing), transparency: forecastClass(transparency) })
	}

	return { modelRunAt, samples }
}
