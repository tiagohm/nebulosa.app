import { describe, expect, test } from 'bun:test'
import { AutoFocus, type AutoFocusFittingMode, type AutoFocusStep } from 'nebulosa/src/observation/focus/autofocus'
import { FOCUS_CURVE_SAMPLES, focusCurve } from './autofocus.curve'

// Best focus of the synthetic optics, in steps.
const BEST = 25000

// Hyperbolic defocus curve: 2 px at the best focus, 0.01 px per step far from it.
function hfdAt(position: number) {
	return Math.hypot(2, 0.01 * (position - BEST))
}

// Runs the state machine over the synthetic optics from a start position until its terminal step.
function run(fittingMode: AutoFocusFittingMode, hfd: (position: number) => number = hfdAt) {
	const autoFocus = new AutoFocus({ initialOffsetSteps: 4, stepSize: 200, fittingMode, reversed: false, maxPosition: 100000 })
	let position = BEST + 100
	let step: AutoFocusStep = autoFocus.add(position, 0)

	while (step.type === 'MOVE') {
		position = step.absolute ?? position + step.relative!
		step = autoFocus.add(position, hfd(position))
	}

	return { autoFocus, step }
}

describe('focus curve', () => {
	test('is undefined before two positions were sampled', () => {
		const autoFocus = new AutoFocus({ initialOffsetSteps: 4, stepSize: 200, fittingMode: 'HYPERBOLIC', reversed: false, maxPosition: 100000 })
		expect(focusCurve(autoFocus, 'HYPERBOLIC')).toBeUndefined()
		autoFocus.add(25000, 0)
		autoFocus.add(25800, hfdAt(25800))
		expect(focusCurve(autoFocus, 'HYPERBOLIC')).toBeUndefined()
	})

	test('samples the hyperbola of the machine with its own predict over the sampled range', () => {
		const { autoFocus } = run('HYPERBOLIC')
		const curve = focusCurve(autoFocus, 'HYPERBOLIC')!
		const hyperbola = autoFocus.hyperbolic!

		expect(curve.series.map((series) => series.kind)).toEqual(['hyperbolic'])
		const { points } = curve.series[0]
		expect(points).toHaveLength(FOCUS_CURVE_SAMPLES)
		expect(points[0].x).toBe(autoFocus.minimum!.x)
		expect(points.at(-1)!.x).toBe(autoFocus.maximum!.x)
		for (const point of points) expect(point.y).toBe(hyperbola.predict(point.x))
		expect(curve.hyperbolic).toEqual({ a: hyperbola.a, b: hyperbola.b, c: hyperbola.c, minimum: { x: hyperbola.minimum.x, y: hyperbola.minimum.y } })
		expect(Math.abs(curve.hyperbolic!.c - BEST)).toBeLessThan(50)
		expect(curve.parabolic).toBeUndefined()
		expect(curve.trendLine).toBeUndefined()
	})

	test('draws only the curves the mode places its best focus with', () => {
		expect(focusCurve(run('PARABOLIC').autoFocus, 'PARABOLIC')!.series.map((series) => series.kind)).toEqual(['parabolic'])
		expect(focusCurve(run('TRENDLINES').autoFocus, 'TRENDLINES')!.series.map((series) => series.kind)).toEqual(['trendLeft', 'trendRight'])
		expect(focusCurve(run('TREND_PARABOLIC').autoFocus, 'TREND_PARABOLIC')!.series.map((series) => series.kind)).toEqual(['trendLeft', 'trendRight', 'parabolic'])
		expect(focusCurve(run('TREND_HYPERBOLIC').autoFocus, 'TREND_HYPERBOLIC')!.series.map((series) => series.kind)).toEqual(['trendLeft', 'trendRight', 'hyperbolic'])
	})

	test('splits the trend lines at their intersection', () => {
		const { autoFocus } = run('TRENDLINES')
		const curve = focusCurve(autoFocus, 'TRENDLINES')!
		const [left, right] = curve.series
		const { intersection } = autoFocus.trendLine!

		expect(curve.trendLine!.intersection).toEqual({ x: intersection!.x, y: intersection!.y })
		expect(left.points.at(-1)!.x).toBeCloseTo(intersection!.x, 6)
		expect(right.points[0].x).toBeCloseTo(intersection!.x, 6)
		expect(left.points[0].x).toBe(autoFocus.minimum!.x)
		expect(right.points.at(-1)!.x).toBe(autoFocus.maximum!.x)
	})

	test('keeps the curves fitted so far when the machine rejected the run', () => {
		const flat = () => 3
		const { autoFocus, step } = run('HYPERBOLIC', flat)
		const curve = focusCurve(autoFocus, 'HYPERBOLIC')

		expect(step.type).toBe('FAILED')
		for (const series of curve?.series ?? []) for (const point of series.points) expect(Number.isFinite(point.y)).toBeTrue()
	})
})
