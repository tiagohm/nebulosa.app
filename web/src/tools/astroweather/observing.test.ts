import { describe, expect, test } from 'bun:test'
import type { AstronomicalSample, AstroWeatherForecast, AstroWeatherNight, MeteorologySample } from 'api'
import { evaluateNight, nightFacts, usableSpans } from './observing'

const HOUR = 3_600_000
const SUNSET = Date.UTC(2026, 9, 31, 21, 30)
const SUNRISE = Date.UTC(2026, 10, 1, 8, 30)
const DUSK = SUNSET + 90 * 60_000
const DAWN = SUNRISE - 90 * 60_000
const NOW = SUNSET - 2 * HOUR

const NIGHT: AstroWeatherNight = {
	sun: {
		localDate: '2026-10-31',
		start: SUNSET - 6 * HOUR,
		end: SUNRISE + 6 * HOUR,
		sunset: SUNSET,
		sunrise: SUNRISE,
		daylight: 'normal',
		civil: { dusk: SUNSET + 30 * 60_000, dawn: SUNRISE - 30 * 60_000, state: 'normal' },
		nautical: { dusk: SUNSET + HOUR, dawn: SUNRISE - HOUR, state: 'normal' },
		astronomical: { dusk: DUSK, dawn: DAWN, state: 'normal' },
		darkness: [{ start: DUSK, end: DAWN }],
	},
	display: { start: SUNSET - HOUR, end: SUNRISE + HOUR },
	moon: { time: SUNSET + 5 * HOUR, illuminatedFraction: 0.1, phase: 'waxingCrescent', above: [] },
}

const CLEAR = { cloudCover: 5, precipitationProbability: 0, precipitation: 0, temperature: 15, dewPoint: 5, windGust: 8 }

// Hourly samples over the night, `edit` changing the ones it returns.
function hours(edit: (time: number) => Partial<MeteorologySample> = () => ({})) {
	const samples: MeteorologySample[] = []
	for (let time = Math.floor(NIGHT.display.start / HOUR) * HOUR; time <= NIGHT.display.end + HOUR; time += HOUR) samples.push({ time, ...CLEAR, ...edit(time) })
	return samples
}

// 7Timer! samples every 3 hours over the night.
function classes(edit: (time: number) => Partial<AstronomicalSample> = () => ({})) {
	const samples: AstronomicalSample[] = []
	for (let time = NIGHT.display.start - 3 * HOUR; time <= NIGHT.display.end + 3 * HOUR; time += 3 * HOUR) samples.push({ time, seeing: 2, transparency: 2, ...edit(time) })
	return samples
}

function forecast(meteorology: readonly MeteorologySample[] = hours(), astronomy: readonly AstronomicalSample[] = classes(), state: 'fresh' | 'stale' = 'fresh'): AstroWeatherForecast {
	return {
		latitude: -22.4,
		longitude: -45.45,
		generatedAt: NOW,
		meteorology: { source: { provider: 'openMeteo', state }, samples: meteorology },
		astronomy: { source: { provider: 'sevenTimer', state }, cellDegrees: 0.1, samples: astronomy },
	}
}

describe('windows', () => {
	test('a clear night recommends the whole usable part of it in each mode', () => {
		const deep = evaluateNight(forecast(), NIGHT, 'deepSky', NOW)
		expect(deep.outlook).toBe('favorable')
		expect(deep.best).toMatchObject({ start: DUSK, end: DAWN })

		const planetary = evaluateNight(forecast(), NIGHT, 'planetary', NOW)
		expect(planetary.best).toMatchObject({ start: SUNSET, end: SUNRISE })

		const visual = evaluateNight(forecast(), NIGHT, 'visual', NOW)
		expect(visual.best).toMatchObject({ start: NIGHT.sun.civil.dusk, end: NIGHT.sun.civil.dawn })
	})

	test('windows never start in the past', () => {
		const now = DUSK + 3 * HOUR
		expect(evaluateNight(forecast(), NIGHT, 'deepSky', now).best?.start).toBe(now)
	})

	test('a run shorter than two hours is not recommended', () => {
		const middle = DUSK + 3 * HOUR
		const cloudy = hours((time) => (time === middle ? {} : { cloudCover: 90 }))
		const result = evaluateNight(forecast(cloudy), NIGHT, 'deepSky', NOW)
		expect(result.best).toBeUndefined()
		expect(result.block).toBe('noWindow')
	})

	test('an hour that only begins in darkness still opens the window at dusk', () => {
		const dusk = DUSK + 40 * 60_000
		const late: AstroWeatherNight = { ...NIGHT, sun: { ...NIGHT.sun, darkness: [{ start: dusk, end: DAWN }] } }
		expect(evaluateNight(forecast(), late, 'deepSky', NOW).best?.start).toBe(dusk)
	})

	test('the longest window wins and a broken night keeps its pieces apart', () => {
		const start = Math.floor(DUSK / HOUR) * HOUR
		const broken = hours((time) => (time === start + 3 * HOUR ? { cloudCover: 90 } : {}))
		const result = evaluateNight(forecast(broken), NIGHT, 'deepSky', NOW)
		expect(result.best?.start).toBe(start + 4 * HOUR)
		expect(result.best?.end).toBe(DAWN)
	})

	test('only a variable night is offered as marginal, never as a recommendation', () => {
		const result = evaluateNight(forecast(hours(() => ({ cloudCover: 30 }))), NIGHT, 'deepSky', NOW)
		expect(result.best).toBeUndefined()
		expect(result.block).toBe('noWindow')
		expect(result.marginal).toMatchObject({ start: DUSK, end: DAWN })
	})
})

describe('hazards', () => {
	test('heavy cloud, rain, or gusts are not offset by excellent seeing', () => {
		const seeing = classes(() => ({ seeing: 1, transparency: 1 }))
		for (const edit of [{ cloudCover: 80 }, { precipitationProbability: 60 }, { precipitation: 0.2 }, { windGust: 45 }]) {
			const result = evaluateNight(
				forecast(
					hours(() => edit),
					seeing,
				),
				NIGHT,
				'planetary',
				NOW,
			)
			expect(result.outlook).toBe('unfavorable')
			expect(result.best).toBeUndefined()
		}
	})

	test('precipitation and gusts are read from the sample that ends the hour', () => {
		const start = Math.floor(DUSK / HOUR) * HOUR + 2 * HOUR
		const result = evaluateNight(forecast(hours((time) => (time === start + HOUR ? { precipitation: 1 } : {}))), NIGHT, 'deepSky', NOW)
		expect(result.segments.find((e) => e.start === start)?.reasons).toContain('rain')
		expect(result.segments.find((e) => e.start === start + HOUR)?.reasons).not.toContain('rain')
	})

	test('the decisive reason comes first, however rare', () => {
		const start = Math.floor(DUSK / HOUR) * HOUR + 2 * HOUR
		const data = forecast(hours((time) => ({ temperature: 10, dewPoint: 7, cloudCover: time === start ? 80 : 5 })))
		expect(evaluateNight(data, NIGHT, 'deepSky', NOW).reasons).toEqual(['heavyCloud', 'dewRisk'])
	})

	test('dew is told as a risk', () => {
		expect(evaluateNight(forecast(hours(() => ({ temperature: 10, dewPoint: 9 }))), NIGHT, 'deepSky', NOW).reasons).toContain('dewLikely')
		expect(evaluateNight(forecast(hours(() => ({ temperature: 10, dewPoint: 7 }))), NIGHT, 'deepSky', NOW).reasons).toContain('dewRisk')
	})
})

describe('modes', () => {
	const moonlit: AstroWeatherNight = { ...NIGHT, moon: { ...NIGHT.moon, illuminatedFraction: 0.95, phase: 'fullMoon', above: [NIGHT.display] } }

	test('a bright Moon limits deep sky but costs planets nothing', () => {
		const deep = evaluateNight(forecast(), moonlit, 'deepSky', NOW)
		expect(deep.outlook).toBe('variable')
		expect(deep.reasons).toContain('brightMoon')
		expect(deep.best).toBeUndefined()

		const planetary = evaluateNight(forecast(), moonlit, 'planetary', NOW)
		expect(planetary.outlook).toBe('favorable')
		expect(planetary.reasons).not.toContain('brightMoon')
	})

	test('a bright Moon is only noted for visual observing', () => {
		const visual = evaluateNight(forecast(), moonlit, 'visual', NOW)
		expect(visual.outlook).toBe('favorable')
		expect(visual.reasons).toContain('moonUp')
	})

	test('poor seeing matters to planets, poor transparency to deep sky', () => {
		const data = forecast(
			hours(),
			classes(() => ({ seeing: 7, transparency: 7 })),
		)
		expect(evaluateNight(data, NIGHT, 'planetary', NOW).outlook).toBe('unfavorable')
		expect(evaluateNight(data, NIGHT, 'deepSky', NOW).outlook).toBe('unfavorable')
		expect(evaluateNight(data, NIGHT, 'visual', NOW).outlook).toBe('favorable')
		expect(
			evaluateNight(
				forecast(
					hours(),
					classes(() => ({ transparency: 7 })),
				),
				NIGHT,
				'planetary',
				NOW,
			).outlook,
		).toBe('favorable')
	})

	test('deep sky without darkness is never recommended, and says why', () => {
		const summer: AstroWeatherNight = { ...NIGHT, sun: { ...NIGHT.sun, darkness: [], astronomical: { state: 'continuousAbove' } } }
		const deep = evaluateNight(forecast(), summer, 'deepSky', NOW)
		expect(deep.best).toBeUndefined()
		expect(deep.block).toBe('noDarkness')
		expect(evaluateNight(forecast(), summer, 'planetary', NOW).best).toBeDefined()
	})

	test('polar day leaves no usable night', () => {
		const polar: AstroWeatherNight = { ...NIGHT, sun: { ...NIGHT.sun, sunset: undefined, sunrise: undefined, daylight: 'continuousAbove', civil: { state: 'continuousAbove' }, darkness: [] } }
		expect(usableSpans(polar, 'planetary')).toEqual([])
		expect(evaluateNight(forecast(), polar, 'planetary', NOW).block).toBe('noNight')
	})
})

describe('facts', () => {
	test('summarize the hours asked for, leaving out what no hour has', () => {
		const data = forecast(hours((time) => ({ cloudCover: time % (2 * HOUR) === 0 ? 40 : 10, precipitation: 0.5, windGust: 20, temperature: 12, dewPoint: 9 })))
		const { scope } = evaluateNight(data, NIGHT, 'deepSky', NOW)
		const facts = nightFacts(data, scope)
		expect(facts.cloudCover).toEqual({ min: 10, max: 40 })
		expect(facts.seeing).toEqual({ min: 2, max: 2 })
		expect(facts.precipitation).toBeCloseTo(scope.length * 0.5)
		expect(facts.windGust).toBe(20)
		expect(facts.dewMargin).toBe(3)

		const empty = forecast([], [])
		expect(nightFacts(empty, evaluateNight(empty, NIGHT, 'deepSky', NOW).scope)).toEqual({ cloudCover: undefined, seeing: undefined, transparency: undefined, precipitationChance: undefined, precipitation: undefined, windGust: undefined, dewMargin: undefined })
	})
})

describe('what is unknown', () => {
	test('past the coverage of 7Timer! seeing is unknown, not the last value, and blocks only planets', () => {
		const last = DUSK + 3 * HOUR
		const data = forecast(
			hours(),
			classes().filter((e) => e.time <= last),
		)
		const planetary = evaluateNight(data, NIGHT, 'planetary', NOW)
		const after = planetary.segments.at(-1)!
		expect(after.seeing).toBeUndefined()
		expect(after.outlook).toBe('unavailable')
		expect(after.missing).toEqual(['seeing'])
		expect(after.weather).toBe('favorable')
		expect(evaluateNight(data, NIGHT, 'visual', NOW).segments.at(-1)!.outlook).toBe('favorable')
	})

	test('a sample stands for an hour only within reach', () => {
		const lone = forecast(hours(), [{ time: DUSK + 3 * HOUR, seeing: 2, transparency: 2 }])
		const { segments } = evaluateNight(lone, NIGHT, 'planetary', NOW)
		expect(segments.filter((e) => e.seeing !== undefined).length).toBe(4)
	})

	test('without 7Timer! a weather outlook remains but no planetary window', () => {
		const result = evaluateNight(forecast(hours(), []), NIGHT, 'planetary', NOW)
		expect(result.outlook).toBe('unavailable')
		expect(result.weather).toBe('favorable')
		expect(result.best).toBeUndefined()
		expect(result.block).toBe('noCoverage')
		expect(result.missing).toEqual(['seeing'])
	})

	test('without weather nothing is favorable', () => {
		const result = evaluateNight(forecast([], classes()), NIGHT, 'deepSky', NOW)
		expect(result.outlook).toBe('unavailable')
		expect(result.weather).toBe('unavailable')
		expect(result.best).toBeUndefined()
		expect(result.block).toBe('noCoverage')
	})

	test('a missing value of an hour is not read as good weather', () => {
		const result = evaluateNight(forecast(hours(() => ({ cloudCover: undefined }))), NIGHT, 'visual', NOW)
		expect(result.outlook).toBe('unavailable')
		expect(result.best).toBeUndefined()
	})

	test('a stale forecast is shown but recommends nothing', () => {
		const result = evaluateNight(forecast(hours(), classes(), 'stale'), NIGHT, 'deepSky', NOW)
		expect(result.outlook).toBe('favorable')
		expect(result.best).toBeUndefined()
		expect(result.block).toBe('staleForecast')
	})
})
