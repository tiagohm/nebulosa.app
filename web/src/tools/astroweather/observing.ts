import type { AstroWeatherForecast, AstroWeatherNight, MeteorologySample, SevenTimerClass, TimeSpan } from 'api'
import type { AstroWeatherMode } from '../../profile/schema'

// Reading of a forecast by the Astro Weather tool: pure and deterministic, with no request and no score. Every hour of a
// night gets a qualitative outlook with the reasons behind it, so what the tool says can always be explained, and the
// continuous windows worth recommending are found from them. The limits are planning heuristics to tune, not scientific or
// equipment limits: nothing here decides anything for a device. Unknown is never favorable, and a known hazard is never
// offset by another good value. Times are Unix milliseconds.

// One hour in milliseconds.
const HOUR_MS = 3_600_000

// Total cloud cover below which the sky counts as open, in percent.
const CLOUD_FAVORABLE = 20

// Total cloud cover above which the sky counts as closed, in percent.
const CLOUD_UNFAVORABLE = 50

// Chance of precipitation below which it is dismissed, in percent; a chance, not a measurement.
const RAIN_FAVORABLE = 10

// Chance of precipitation above which it is a hazard, in percent.
const RAIN_UNFAVORABLE = 30

// Gust from which wind is a caution, in km/h; mounts and enclosures vary, so this is not a limit of any instrument.
const GUST_CAUTION = 15

// Gust from which wind is a hazard, in km/h.
const GUST_UNFAVORABLE = 30

// Margin between air and dew point at or below which dew is likely, in degrees Celsius. Surfaces cool below the air.
const DEW_HIGH_MARGIN = 2

// Margin at or below which dew is a moderate risk, in degrees Celsius.
const DEW_MODERATE_MARGIN = 4

// Largest 7Timer! class that counts as good, for seeing and transparency alike.
const CLASS_FAVORABLE = 3

// Largest 7Timer! class that is still only a caution; above it the class is poor.
const CLASS_VARIABLE = 5

// Illuminated fraction of the Moon from which it limits faint targets, [0, 1]; generic, since no target is known.
const BRIGHT_MOON = 0.5

// Largest distance at which a 7Timer! sample stands for an hour, in milliseconds (90 minutes, half of its 3 hour step).
const SAMPLE_REACH_MS = 90 * 60_000

// Shortest continuous window recommended, in milliseconds (2 hours).
const MINIMUM_WINDOW_MS = 2 * HOUR_MS

// Qualitative reading of a forecast.
export type Outlook = 'favorable' | 'variable' | 'unfavorable' | 'unavailable'

// Why an hour reads as it does.
export type OutlookReason = 'heavyCloud' | 'someCloud' | 'rain' | 'possibleRain' | 'strongGusts' | 'moderateGusts' | 'dewLikely' | 'dewRisk' | 'poorSeeing' | 'fairSeeing' | 'poorTransparency' | 'fairTransparency' | 'brightMoon' | 'moonUp' | 'noDarkness'

// What an hour needed and did not have.
export type MissingMetric = 'weather' | 'seeing' | 'transparency'

// Reading of one hour.
export interface OutlookSegment {
	// First instant of the hour.
	readonly start: number
	// First instant after the hour.
	readonly end: number
	// Reading in the observing mode.
	readonly outlook: Outlook
	// Reading of the weather alone, which needs no seeing or transparency.
	readonly weather: Outlook
	// Reasons, most severe first.
	readonly reasons: readonly OutlookReason[]
	// Metrics the mode needs that the forecast does not have.
	readonly missing: readonly MissingMetric[]
	// Seeing of the nearest 7Timer! sample within reach.
	readonly seeing?: SevenTimerClass
	// Transparency of the nearest 7Timer! sample within reach.
	readonly transparency?: SevenTimerClass
}

// Continuous interval of hours of one reading.
export interface ObservingWindow extends TimeSpan {
	// Cautions along the interval, without repeats.
	readonly reasons: readonly OutlookReason[]
}

// Why a recommendation is not made.
export type WindowBlock = 'noCoverage' | 'staleForecast' | 'noDarkness' | 'noNight' | 'noWindow'

// Reading of a night in one observing mode.
export interface NightEvaluation {
	// Hours of the display window, in time order.
	readonly segments: readonly OutlookSegment[]
	// Hours of the part of the night that suits the mode and has not passed yet, or every hour without one.
	readonly scope: readonly OutlookSegment[]
	// Outlook of the part of the night that suits the mode and has not passed yet.
	readonly outlook: Outlook
	// Weather alone over the same part of the night.
	readonly weather: Outlook
	// Reasons over the same part of the night, most decisive first.
	readonly reasons: readonly OutlookReason[]
	// Metrics missing over the same part of the night.
	readonly missing: readonly MissingMetric[]
	// Longest favorable window, ties going to fewer cautions; absent without a recommendation.
	readonly best?: ObservingWindow
	// Longest variable window, marginal at best, offered only when there is no best window.
	readonly marginal?: ObservingWindow
	// Why there is no best window.
	readonly block?: WindowBlock
}

// Reasons from the most to the least decisive, so a summary leads with what actually limits the night.
const REASON_ORDER: readonly OutlookReason[] = ['rain', 'heavyCloud', 'strongGusts', 'noDarkness', 'poorSeeing', 'poorTransparency', 'possibleRain', 'someCloud', 'moderateGusts', 'brightMoon', 'dewLikely', 'fairSeeing', 'fairTransparency', 'dewRisk', 'moonUp']

// Severity of each reading, the worst deciding.
const SEVERITY: Readonly<Record<Exclude<Outlook, 'unavailable'>, number>> = { favorable: 0, variable: 1, unfavorable: 2 }

// Returns the worse of two known readings.
function worse(a: Exclude<Outlook, 'unavailable'>, b: Exclude<Outlook, 'unavailable'>) {
	return SEVERITY[a] >= SEVERITY[b] ? a : b
}

// Findings of an hour so far.
interface Findings {
	// Worst reading.
	outlook: Exclude<Outlook, 'unavailable'>
	// Reasons found.
	readonly reasons: OutlookReason[]
}

// Records a reading with its reason.
function note(findings: Findings, outlook: Exclude<Outlook, 'unavailable'>, reason: OutlookReason) {
	findings.outlook = worse(findings.outlook, outlook)
	findings.reasons.push(reason)
}

// Reads the hazards of the weather of an hour from its instantaneous sample and the sample ending it, which holds its
// precipitation and gusts. Returns undefined when cloud or precipitation are not forecast, since neither can be assumed.
function readWeather(sample: MeteorologySample, ending: MeteorologySample | undefined, mode: AstroWeatherMode): Findings | undefined {
	const cloud = sample.cloudCover
	const chance = ending?.precipitationProbability
	const amount = ending?.precipitation
	const gust = ending?.windGust
	if (cloud === undefined || (chance === undefined && amount === undefined)) return undefined

	const findings: Findings = { outlook: 'favorable', reasons: [] }

	if (cloud > CLOUD_UNFAVORABLE) note(findings, 'unfavorable', 'heavyCloud')
	else if (cloud >= CLOUD_FAVORABLE) note(findings, 'variable', 'someCloud')

	if ((amount ?? 0) > 0 || (chance ?? 0) > RAIN_UNFAVORABLE) note(findings, 'unfavorable', 'rain')
	else if ((chance ?? 0) >= RAIN_FAVORABLE) note(findings, 'variable', 'possibleRain')

	if (gust !== undefined && gust >= GUST_UNFAVORABLE) note(findings, mode === 'visual' ? 'variable' : 'unfavorable', 'strongGusts')
	else if (gust !== undefined && gust >= GUST_CAUTION) note(findings, 'variable', 'moderateGusts')

	const { temperature, dewPoint } = sample

	if (temperature !== undefined && dewPoint !== undefined) {
		const margin = temperature - dewPoint
		if (margin <= DEW_HIGH_MARGIN) note(findings, 'variable', 'dewLikely')
		else if (margin <= DEW_MODERATE_MARGIN) findings.reasons.push('dewRisk')
	}

	return findings
}

// Returns the sample of the nearest instant to `time` within reach, or undefined past the coverage of the forecast.
function nearestSample<T extends { readonly time: number }>(samples: readonly T[], time: number): T | undefined {
	let nearest: T | undefined

	for (const sample of samples) {
		if (Math.abs(sample.time - time) <= SAMPLE_REACH_MS && (nearest === undefined || Math.abs(sample.time - time) < Math.abs(nearest.time - time))) nearest = sample
	}

	return nearest
}

// Whether an instant falls in one of some intervals.
function within(spans: readonly TimeSpan[], time: number) {
	return spans.some(({ start, end }) => start <= time && time < end)
}

// Whether an interval overlaps one of some intervals.
function overlaps(spans: readonly TimeSpan[], from: number, to: number) {
	return spans.some(({ start, end }) => from < end && to > start)
}

// Reads a class of seeing or transparency that the mode depends on.
function readClass(findings: Findings, value: SevenTimerClass, poor: OutlookReason, fair: OutlookReason) {
	if (value > CLASS_VARIABLE) note(findings, 'unfavorable', poor)
	else if (value > CLASS_FAVORABLE) note(findings, 'variable', fair)
}

// Reads one hour in a mode.
function readHour(start: number, sample: MeteorologySample | undefined, ending: MeteorologySample | undefined, forecast: AstroWeatherForecast, night: AstroWeatherNight, mode: AstroWeatherMode): OutlookSegment {
	const end = start + HOUR_MS
	const middle = start + HOUR_MS / 2
	const astronomy = nearestSample(forecast.astronomy.samples, middle)
	const seeing = astronomy?.seeing
	const transparency = astronomy?.transparency
	const hazards = sample && readWeather(sample, ending, mode)
	const missing: MissingMetric[] = []

	if (!hazards) missing.push('weather')
	if (mode === 'planetary' && seeing === undefined) missing.push('seeing')
	if (mode === 'deepSky' && transparency === undefined) missing.push('transparency')

	const weather = hazards?.outlook ?? 'unavailable'
	const findings: Findings = { outlook: hazards?.outlook ?? 'favorable', reasons: [...(hazards?.reasons ?? [])] }

	if (mode === 'planetary' && seeing !== undefined) readClass(findings, seeing, 'poorSeeing', 'fairSeeing')
	if (mode === 'visual' && transparency !== undefined && transparency > CLASS_FAVORABLE) findings.reasons.push(transparency > CLASS_VARIABLE ? 'poorTransparency' : 'fairTransparency')

	if (mode === 'deepSky') {
		if (transparency !== undefined) readClass(findings, transparency, 'poorTransparency', 'fairTransparency')
		if (within(night.moon.above, middle) && night.moon.illuminatedFraction >= BRIGHT_MOON) note(findings, 'variable', 'brightMoon')
		if (!overlaps(night.sun.darkness, start, end)) note(findings, 'unfavorable', 'noDarkness')
	}

	if (mode === 'visual' && within(night.moon.above, middle) && night.moon.illuminatedFraction >= BRIGHT_MOON) findings.reasons.push('moonUp')

	// A known hazard stands whatever else is missing; otherwise what the mode needs must be known.
	const outlook = findings.outlook === 'unfavorable' || missing.length === 0 ? findings.outlook : 'unavailable'
	return { start, end, outlook, weather, reasons: findings.reasons, missing, seeing, transparency }
}

// Returns the part of a night a mode can use: astronomical darkness for deep sky, between the civil twilights for visual
// observing, and between sunset and sunrise for planets, whose brightness needs no full darkness.
export function usableSpans(night: AstroWeatherNight, mode: AstroWeatherMode): readonly TimeSpan[] {
	const { sun, display } = night
	if (mode === 'deepSky') return sun.darkness
	const edges = mode === 'visual' ? { start: sun.civil.dusk, end: sun.civil.dawn, state: sun.civil.state } : { start: sun.sunset, end: sun.sunrise, state: sun.daylight }
	if (edges.state === 'continuousAbove') return []
	return [{ start: edges.start ?? display.start, end: edges.end ?? display.end }]
}

// Returns the longest continuous run of the hours accepted, clipped to a span, ties going to fewer cautions.
function longestRun(segments: readonly OutlookSegment[], span: TimeSpan, accept: (segment: OutlookSegment) => boolean, best?: ObservingWindow): ObservingWindow | undefined {
	let result = best
	let run: OutlookSegment[] = []

	function close() {
		if (run.length === 0) return
		const start = Math.max(run[0].start, span.start)
		const end = Math.min(run.at(-1)!.end, span.end)
		const reasons = [...new Set(run.flatMap((segment) => segment.reasons))]
		const duration = end - start
		const current = result ? result.end - result.start : -1
		if (duration > current || (duration === current && result && reasons.length < result.reasons.length)) result = { start, end, reasons }
		run = []
	}

	for (const segment of segments) {
		if (segment.end > span.start && segment.start < span.end && accept(segment)) run.push(segment)
		else close()
	}

	close()
	return result
}

// Returns the outlook of some hours: unavailable without any, the worst when one is unfavorable, otherwise what most say.
function overall(outlooks: readonly Outlook[]): Outlook {
	if (outlooks.length === 0) return 'unavailable'
	const count = (outlook: Outlook) => outlooks.filter((e) => e === outlook).length
	if (count('favorable') * 2 > outlooks.length) return 'favorable'
	if (count('unfavorable') * 2 > outlooks.length) return 'unfavorable'
	if (count('unavailable') * 2 > outlooks.length) return 'unavailable'
	return 'variable'
}

// Returns the reasons of some hours, most decisive first.
function decisiveReasons(segments: readonly OutlookSegment[]) {
	const found = new Set(segments.flatMap((segment) => segment.reasons))
	return REASON_ORDER.filter((reason) => found.has(reason))
}

// Range of a value over some hours; absent when none of them has it.
export interface FactRange {
	// Smallest value.
	readonly min: number
	// Largest value.
	readonly max: number
}

// Forecast over some hours, each value absent when no hour has it.
export interface NightFacts {
	// Total cloud cover in percent.
	readonly cloudCover?: FactRange
	// Seeing classes.
	readonly seeing?: FactRange
	// Transparency classes.
	readonly transparency?: FactRange
	// Highest chance of precipitation in an hour, in percent.
	readonly precipitationChance?: number
	// Modeled precipitation of the hours together, in millimeters.
	readonly precipitation?: number
	// Strongest gust in km/h.
	readonly windGust?: number
	// Smallest margin between air and dew point in degrees Celsius.
	readonly dewMargin?: number
}

// Returns the range of some values, or undefined without any.
function factRange(values: readonly (number | undefined)[]): FactRange | undefined {
	const known = values.filter((value) => value !== undefined)
	return known.length > 0 ? { min: Math.min(...known), max: Math.max(...known) } : undefined
}

// Summarizes the forecast over some hours; precipitation and gusts come from the samples ending them.
export function nightFacts(forecast: AstroWeatherForecast, hours: readonly OutlookSegment[]): NightFacts {
	const byTime = new Map(forecast.meteorology.samples.map((sample) => [sample.time, sample]))
	const starting = hours.map((hour) => byTime.get(hour.start))
	const ending = hours.map((hour) => byTime.get(hour.end))
	const amounts = ending.map((sample) => sample?.precipitation).filter((value) => value !== undefined)
	const margins = starting.map((sample) => (sample?.temperature !== undefined && sample.dewPoint !== undefined ? sample.temperature - sample.dewPoint : undefined))

	return {
		cloudCover: factRange(starting.map((sample) => sample?.cloudCover)),
		seeing: factRange(hours.map((hour) => hour.seeing)),
		transparency: factRange(hours.map((hour) => hour.transparency)),
		precipitationChance: factRange(ending.map((sample) => sample?.precipitationProbability))?.max,
		precipitation: amounts.length > 0 ? amounts.reduce((sum, value) => sum + value, 0) : undefined,
		windGust: factRange(ending.map((sample) => sample?.windGust))?.max,
		dewMargin: factRange(margins)?.min,
	}
}

// Reads a night in a mode, from the hours of its display window. `now` keeps windows out of the past. Stale forecasts are
// read and shown, but only a fresh one is recommended from.
export function evaluateNight(forecast: AstroWeatherForecast, night: AstroWeatherNight, mode: AstroWeatherMode, now: number): NightEvaluation {
	const { samples } = forecast.meteorology
	const byTime = new Map(samples.map((sample) => [sample.time, sample]))
	const first = Math.floor(night.display.start / HOUR_MS) * HOUR_MS
	const segments: OutlookSegment[] = []

	for (let start = first; start < night.display.end; start += HOUR_MS) segments.push(readHour(start, byTime.get(start), byTime.get(start + HOUR_MS), forecast, night, mode))

	const spans = usableSpans(night, mode).flatMap(({ start, end }) => {
		const from = Math.max(start, now)
		return from < end ? [{ start: from, end }] : []
	})
	const usable = segments.filter((segment) => overlaps(spans, segment.start, segment.end))
	const scope = usable.length > 0 ? usable : segments
	const stale = forecast.meteorology.source.state !== 'fresh' || (mode !== 'visual' && forecast.astronomy.source.state !== 'fresh')

	let best: ObservingWindow | undefined
	let marginal: ObservingWindow | undefined

	for (const span of spans) {
		best = longestRun(segments, span, (segment) => segment.outlook === 'favorable', best)
		marginal = longestRun(segments, span, (segment) => segment.outlook === 'favorable' || segment.outlook === 'variable', marginal)
	}

	const recommended = best && best.end - best.start >= MINIMUM_WINDOW_MS ? best : undefined
	const offered = !recommended && marginal && marginal.end - marginal.start >= MINIMUM_WINDOW_MS ? marginal : undefined
	const base = { segments, scope, outlook: overall(scope.map((e) => e.outlook)), weather: overall(scope.map((e) => e.weather)), reasons: decisiveReasons(scope), missing: [...new Set(scope.flatMap((e) => e.missing))] }

	if (spans.length === 0) return { ...base, block: mode === 'deepSky' && night.sun.darkness.length === 0 ? 'noDarkness' : 'noNight' }
	if (scope.every((segment) => segment.missing.length > 0)) return { ...base, block: 'noCoverage' }
	if (stale) return { ...base, block: 'staleForecast' }
	return recommended ? { ...base, best: recommended } : { ...base, marginal: offered, block: 'noWindow' }
}
