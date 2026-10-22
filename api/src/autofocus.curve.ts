import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { Regression } from 'nebulosa/src/math/numerical/regression'
import type { AutoFocus, AutoFocusFittingMode } from 'nebulosa/src/observation/focus/autofocus'

// Presentation of the focus curve of an Auto Focus run: the fitted curves of the toolkit's AutoFocus machine,
// sampled with their own predict functions over the sampled focuser range, so a chart draws exactly what the
// machine fitted without any curve math of its own. Positions are focuser steps; HFD is in pixels. Only the
// curves the fitting mode uses for its best focus are drawn. Each call allocates its series.

// Points of each drawn series; enough for a smooth curve on a panel-wide chart.
export const FOCUS_CURVE_SAMPLES = 64

// Curve of a focus curve chart: one side of the trend lines, the parabola, or the hyperbola.
export type FocusCurveSeriesKind = 'trendLeft' | 'trendRight' | 'parabolic' | 'hyperbolic'

// Fitted curve sampled for a chart.
export interface FocusCurveSeries {
	// Which fitted curve the points belong to.
	readonly kind: FocusCurveSeriesKind
	// Points of the curve in ascending position: x in steps, y as HFD in pixels; non-finite values are left out.
	readonly points: readonly Point[]
}

// Parameters of the trend lines: y = slope·x + intercept on each side, HFD in pixels over steps.
export interface FocusCurveTrendLines {
	// Line through the samples left of the minimum.
	readonly left: { readonly slope: number; readonly intercept: number }
	// Line through the samples right of the minimum.
	readonly right: { readonly slope: number; readonly intercept: number }
	// Where the two lines cross, when they do.
	readonly intersection?: Point
}

// Parameters of the parabola: coefficients ascending (coefficients[k] multiplies x^k), and its vertex.
export interface FocusCurveParabola {
	// Polynomial coefficients, constant term first.
	readonly coefficients: readonly number[]
	// Vertex: x in steps, y as HFD in pixels; NaN when the parabola opens downwards.
	readonly minimum: Point
}

// Parameters of the hyperbola y = b·sqrt(1 + ((x − c)/a)²): a in steps, b in pixels, c in steps.
export interface FocusCurveHyperbola {
	readonly a: number
	readonly b: number
	readonly c: number
	// Vertex (c, b).
	readonly minimum: Point
}

// Focus curve of a run as its machine fitted it so far.
export interface FocusCurve {
	// Fitting mode of the run.
	readonly fittingMode: AutoFocusFittingMode
	// Sampled curves the fitting mode uses.
	readonly series: readonly FocusCurveSeries[]
	// Trend lines, when the mode uses them and they are fitted.
	readonly trendLine?: FocusCurveTrendLines
	// Parabola, when the mode uses it and it is fitted.
	readonly parabolic?: FocusCurveParabola
	// Hyperbola, when the mode uses it and it is fitted.
	readonly hyperbolic?: FocusCurveHyperbola
}

// Whether a fitting mode places its best focus with the trend lines.
function usesTrendLines(mode: AutoFocusFittingMode) {
	return mode === 'TRENDLINES' || mode === 'TREND_PARABOLIC' || mode === 'TREND_HYPERBOLIC'
}

// Samples a regression with its own predict function over [from, to] (steps), leaving out non-finite values.
function sample(regression: Pick<Regression, 'predict'>, from: number, to: number, count: number): Point[] {
	const points: Point[] = []
	if (!(to >= from)) return points
	const step = count > 1 ? (to - from) / (count - 1) : 0

	for (let i = 0; i < count; i++) {
		const x = i === count - 1 ? to : from + i * step
		const y = regression.predict(x)
		if (Number.isFinite(y)) points.push({ x, y })
	}

	return points
}

// Returns the focus curve the machine of a run fitted so far, sampled over its sampled range with count points
// per curve; undefined before two positions were sampled.
export function focusCurve(autoFocus: AutoFocus, fittingMode: AutoFocusFittingMode, count: number = FOCUS_CURVE_SAMPLES): FocusCurve | undefined {
	const from = autoFocus.minimum?.x
	const to = autoFocus.maximum?.x
	if (from === undefined || to === undefined || !(to > from)) return undefined

	const series: FocusCurveSeries[] = []
	let trendLine: FocusCurveTrendLines | undefined
	let parabolic: FocusCurveParabola | undefined
	let hyperbolic: FocusCurveHyperbola | undefined

	const fitted = autoFocus.trendLine

	if (usesTrendLines(fittingMode) && fitted) {
		const { left, right, intersection } = fitted
		// Each line is drawn on its side of the crossing; without one, over the whole range.
		const split = intersection && Number.isFinite(intersection.x) ? Math.min(Math.max(intersection.x, from), to) : undefined
		series.push({ kind: 'trendLeft', points: sample(left, from, split ?? to, count) }, { kind: 'trendRight', points: sample(right, split ?? from, to, count) })
		trendLine = { left: { slope: left.slope, intercept: left.intercept }, right: { slope: right.slope, intercept: right.intercept }, ...(intersection && { intersection: { x: intersection.x, y: intersection.y } }) }
	}

	if ((fittingMode === 'PARABOLIC' || fittingMode === 'TREND_PARABOLIC') && autoFocus.parabolic) {
		const { coefficients, minimum } = autoFocus.parabolic
		series.push({ kind: 'parabolic', points: sample(autoFocus.parabolic, from, to, count) })
		parabolic = { coefficients: [...coefficients], minimum: { x: minimum.x, y: minimum.y } }
	}

	if ((fittingMode === 'HYPERBOLIC' || fittingMode === 'TREND_HYPERBOLIC') && autoFocus.hyperbolic) {
		const { a, b, c, minimum } = autoFocus.hyperbolic
		series.push({ kind: 'hyperbolic', points: sample(autoFocus.hyperbolic, from, to, count) })
		hyperbolic = { a, b, c, minimum: { x: minimum.x, y: minimum.y } }
	}

	return { fittingMode, series, ...(trendLine && { trendLine }), ...(parabolic && { parabolic }), ...(hyperbolic && { hyperbolic }) }
}
