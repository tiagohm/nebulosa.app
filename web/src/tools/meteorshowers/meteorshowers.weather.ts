import type { AstroWeatherForecast, AstroWeatherSource } from 'api'

// Weather of the observing windows of a meteor shower, read from the Astro Weather forecast of the site (the same public
// sources and caches the Astro Weather tool shows): the cloud cover, the chance of precipitation, and the 7Timer!
// transparency class over each window, only within the hours the forecast covers. The assessment is qualitative and
// given only from a fresh forecast; a stale or unavailable source gives none, and nothing here changes a window, a rate,
// or a ranking. A forecast is a forecast, never a measurement of the site.

// Qualitative weather of a window.
export type MeteorWeatherAssessment = 'favorable' | 'variable' | 'unfavorable' | 'notCovered' | 'unassessed'

// Weather over one window.
export interface MeteorWindowWeather {
	// First instant of the window, Unix milliseconds.
	readonly start: number
	// Last instant of the window, Unix milliseconds.
	readonly end: number
	// Mean total cloud cover of the forecast hours in the window, percent; absent without one.
	readonly cloudCover?: number
	// Highest chance of precipitation of the forecast hours in the window, percent; absent without one.
	readonly precipitationProbability?: number
	// Worst 7Timer! transparency class of the samples in the window (1 best, 8 worst); absent without one.
	readonly transparency?: number
	// Qualitative assessment: favorable, variable, or unfavorable from a fresh forecast; notCovered when no forecast hour
	// falls in the window; unassessed when the meteorology source is not fresh.
	readonly assessment: MeteorWeatherAssessment
}

// Highest mean cloud cover of a favorable window, and lowest of an unfavorable one, percent.
const FAVORABLE_CLOUD = 30
const UNFAVORABLE_CLOUD = 70

// Highest chance of precipitation of a favorable window, and lowest of an unfavorable one, percent.
const FAVORABLE_PRECIPITATION = 20
const UNFAVORABLE_PRECIPITATION = 60

// Weather of each window from a forecast.
export function windowsWeather(forecast: AstroWeatherForecast, windows: readonly { readonly start: number; readonly end: number }[]): readonly MeteorWindowWeather[] {
	const fresh = forecast.meteorology.source.state === 'fresh'

	return windows.map(({ start, end }): MeteorWindowWeather => {
		// An hourly sample stands for the hour it starts, so an hour overlapping the window counts.
		const hours = forecast.meteorology.samples.filter((sample) => sample.time + 3600000 > start && sample.time < end)
		const clouds = hours.map((sample) => sample.cloudCover).filter((value) => value !== undefined)
		const rain = hours.map((sample) => sample.precipitationProbability).filter((value) => value !== undefined)
		const transparency = forecast.astronomy.samples.filter((sample) => sample.time + 3 * 3600000 > start && sample.time < end && sample.transparency !== undefined).map((sample) => sample.transparency!)
		let cloudSum = 0
		for (const value of clouds) cloudSum += value
		const cloudCover = clouds.length === 0 ? undefined : cloudSum / clouds.length
		const precipitationProbability = rain.length === 0 ? undefined : Math.max(...rain)
		const worstTransparency = transparency.length === 0 ? undefined : Math.max(...transparency)

		let assessment: MeteorWeatherAssessment
		if (hours.length === 0) assessment = 'notCovered'
		else if (!fresh || cloudCover === undefined) assessment = 'unassessed'
		else if (cloudCover >= UNFAVORABLE_CLOUD || (precipitationProbability ?? 0) >= UNFAVORABLE_PRECIPITATION) assessment = 'unfavorable'
		else if (cloudCover <= FAVORABLE_CLOUD && (precipitationProbability ?? 0) <= FAVORABLE_PRECIPITATION) assessment = 'favorable'
		else assessment = 'variable'

		return { start, end, cloudCover, precipitationProbability, transparency: worstTransparency, assessment }
	})
}

// Short text of the state of a forecast source.
export function sourceStateText(source: AstroWeatherSource): string {
	if (source.state === 'fresh') return 'fresh'
	if (source.state === 'stale') return 'stale: the last good forecast, not updated'
	return 'unavailable'
}
