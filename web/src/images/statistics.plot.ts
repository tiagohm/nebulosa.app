// Geometry of the histogram of the Image Inspector: the step outline of each plane's histogram over a common x range in
// source units, linear or logarithmic counts, and the bin under a value. Pure functions of the counts and the plot box,
// so a change of scale, zoom, or the planes shown never asks the server for anything.

// Width of the plot box, in SVG units; the plot scales to the width of its panel.
export const HISTOGRAM_WIDTH = 240

// Height of the plot box, in SVG units.
export const HISTOGRAM_HEIGHT = 96

// Margin inside the plot box, in SVG units.
export const HISTOGRAM_MARGIN = 2

// Histogram of one plane: equal bins over [min, max] in source units; a single-valued domain has its samples in bin 0.
export interface HistogramSeries {
	// Lower edge of the domain, in source units.
	readonly min: number
	// Upper edge of the domain, in source units.
	readonly max: number
	// Counts of the bins.
	readonly counts: readonly number[]
}

// X range shown and the height of the tallest bar, from which the plot maps values and counts.
export interface HistogramScale {
	// Lowest value shown, in source units.
	readonly x0: number
	// Highest value shown, in source units; greater than x0.
	readonly x1: number
	// Height of the tallest bar shown, in counts or log10(1 + counts); positive.
	readonly top: number
	// Whether bar heights are log10(1 + count).
	readonly log: boolean
}

// Returns the range of values covering every series, widened around a single value so that it is never empty.
export function histogramRange(series: readonly HistogramSeries[]): readonly [number, number] {
	let low = Number.POSITIVE_INFINITY
	let high = Number.NEGATIVE_INFINITY

	for (const { min, max } of series) {
		if (min < low) low = min
		if (max > high) high = max
	}

	if (!(high >= low)) return [0, 1]
	if (high > low) return [low, high]
	const half = Math.abs(low) > 0 ? Math.abs(low) * 1e-3 : 0.5
	return [low - half, high + half]
}

// Returns the bar height of a count.
function height(count: number, log: boolean) {
	return log ? Math.log10(1 + count) : count
}

// Returns the value range [start, end) of bin i of a series, in source units.
export function binRange({ min, max, counts }: HistogramSeries, i: number): readonly [number, number] {
	const width = (max - min) / counts.length
	return [min + i * width, min + (i + 1) * width]
}

// Returns the scale of a plot of series over the range [x0, x1] (x1 > x0): the tallest bar among the bins that overlap it.
export function histogramScale(series: readonly HistogramSeries[], range: readonly [number, number], log: boolean): HistogramScale {
	const [x0, x1] = range
	let top = 0

	for (const item of series) {
		for (let i = 0; i < item.counts.length; i++) {
			const [start, end] = binRange(item, i)
			if (end < x0 || start > x1) continue
			const value = height(item.counts[i], log)
			if (value > top) top = value
		}
	}

	return { x0, x1, top: top > 0 ? top : 1, log }
}

// Returns the plot x of a value.
export function plotX(value: number, { x0, x1 }: HistogramScale): number {
	return HISTOGRAM_MARGIN + ((value - x0) / (x1 - x0)) * (HISTOGRAM_WIDTH - 2 * HISTOGRAM_MARGIN)
}

// Returns the value at a plot x.
export function valueAt(x: number, { x0, x1 }: HistogramScale): number {
	return x0 + ((x - HISTOGRAM_MARGIN) / (HISTOGRAM_WIDTH - 2 * HISTOGRAM_MARGIN)) * (x1 - x0)
}

// Returns the plot y of a count.
function plotY(count: number, { top, log }: HistogramScale): number {
	return HISTOGRAM_HEIGHT - HISTOGRAM_MARGIN - (height(count, log) / top) * (HISTOGRAM_HEIGHT - 2 * HISTOGRAM_MARGIN)
}

// Rounds a plot coordinate to a short text.
function round(value: number) {
	return Math.round(value * 100) / 100
}

// Returns the SVG path of the step outline of a series, clipped to the range of the scale: from the baseline up each
// bin and back down at the end; a single-valued domain is one vertical line at its value.
export function histogramPath(series: HistogramSeries, scale: HistogramScale): string {
	const base = round(HISTOGRAM_HEIGHT - HISTOGRAM_MARGIN)
	const clamp = (x: number) => round(Math.max(HISTOGRAM_MARGIN, Math.min(HISTOGRAM_WIDTH - HISTOGRAM_MARGIN, x)))

	if (!(series.max > series.min)) {
		if (series.min < scale.x0 || series.min > scale.x1) return ''
		const x = clamp(plotX(series.min, scale))
		return `M${x} ${base}V${round(plotY(series.counts[0] ?? 0, scale))}`
	}

	let path = ''

	for (let i = 0; i < series.counts.length; i++) {
		const [start, end] = binRange(series, i)
		if (end < scale.x0 || start > scale.x1) continue
		const y = round(plotY(series.counts[i], scale))
		if (path === '') path = `M${clamp(plotX(start, scale))} ${base}`
		path += `V${y}H${clamp(plotX(end, scale))}`
	}

	return path === '' ? '' : `${path}V${base}`
}

// Returns the index of the bin of a series containing a value, or undefined outside its domain.
export function binAt({ min, max, counts }: HistogramSeries, value: number): number | undefined {
	if (!(value >= min && value <= max) || counts.length === 0) return undefined
	if (!(max > min)) return 0
	return Math.min(counts.length - 1, Math.floor(((value - min) / (max - min)) * counts.length))
}
