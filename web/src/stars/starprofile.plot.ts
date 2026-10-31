// Geometry of the plot of a star's cuts, shared by the Star Profile of the Guiding panel and the Star Profile Inspector:
// samples at offsets from the star along the bottom, their intensity upwards, all series over the same scales.

// Size of the plot in its own units; it scales to the width of the panel.
export const PLOT_WIDTH = 240
export const PLOT_HEIGHT = 96

// Inner margin of the plot, in plot units.
export const PLOT_MARGIN = 4

// Samples of one series of a plot.
export interface StarProfileSamples {
	// Position of each sample from the star, in pixels, ascending; not necessarily integers.
	readonly offsets: readonly number[]
	// Value of each sample, in the units of the plot.
	readonly values: readonly number[]
}

// Scales of a plot.
export interface StarProfilePlotScales {
	// Largest value of the plot, positive.
	readonly top: number
	// Returns the plot abscissa of an offset.
	readonly sx: (offset: number) => number
	// Returns the plot ordinate of a value.
	readonly sy: (value: number) => number
}

// Returns the offsets of consecutive samples from the offset of the first one.
export function consecutiveOffsets(from: number, count: number): number[] {
	return Array.from({ length: count }, (_, index) => from + index)
}

// Returns the scales that fit every series, with the zero of the values always in the plot.
export function plotScales(series: readonly StarProfileSamples[]): StarProfilePlotScales {
	const values = series.flatMap((s) => s.values)
	const offsets = series.flatMap((s) => s.offsets)
	const top = Math.max(Number.MIN_VALUE, ...values)
	const bottom = Math.min(0, ...values)
	const first = Math.min(...offsets)
	const last = Math.max(...offsets)
	const sx = (offset: number) => PLOT_MARGIN + ((offset - first) / Math.max(1, last - first)) * (PLOT_WIDTH - 2 * PLOT_MARGIN)
	const sy = (value: number) => PLOT_HEIGHT - PLOT_MARGIN - ((value - bottom) / (top - bottom)) * (PLOT_HEIGHT - 2 * PLOT_MARGIN)
	return { top, sx, sy }
}

// Returns the points attribute of the polyline of a series.
export function plotPoints({ offsets, values }: StarProfileSamples, { sx, sy }: Pick<StarProfilePlotScales, 'sx' | 'sy'>): string {
	return values.map((value, index) => `${sx(offsets[index]).toFixed(1)},${sy(value).toFixed(1)}`).join(' ')
}
