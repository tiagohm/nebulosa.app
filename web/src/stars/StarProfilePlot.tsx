import { PLOT_HEIGHT, PLOT_MARGIN, PLOT_WIDTH, plotPoints, plotScales, type StarProfileSamples } from './starprofile.plot'

// Plot of the cuts through a star, shared by the Star Profile of the Guiding panel and the Star Profile Inspector: every
// series over the same scales, the zero of the intensity and of the offsets marked, and a half maximum dashed. It scales
// to the width of its panel.

// One line of a plot.
export interface StarProfileSeries extends StarProfileSamples {
	// Color of the line, a CSS value.
	readonly stroke: string
	// Dash pattern of a line that must read apart from the solid ones without its color.
	readonly dash?: string
}

interface StarProfilePlotProps {
	// Lines of the plot, in drawing order.
	readonly series: readonly StarProfileSeries[]
	// Value of the dashed half maximum, in the units of the series; half the largest value when absent.
	readonly halfMaximum?: number
}

// Plot of one or more series over the same offsets.
export function StarProfilePlot({ series, halfMaximum }: StarProfilePlotProps) {
	const scales = plotScales(series)
	const { top, sx, sy } = scales

	return (
		<svg viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`} className="block h-auto w-full rounded-md border border-line-100 bg-base-100">
			<line x1={PLOT_MARGIN} x2={PLOT_WIDTH - PLOT_MARGIN} y1={sy(0)} y2={sy(0)} stroke="var(--color-line-200)" />
			<line x1={sx(0)} x2={sx(0)} y1={PLOT_MARGIN} y2={PLOT_HEIGHT - PLOT_MARGIN} stroke="var(--color-line-100)" />
			<line x1={PLOT_MARGIN} x2={PLOT_WIDTH - PLOT_MARGIN} y1={sy(halfMaximum ?? top / 2)} y2={sy(halfMaximum ?? top / 2)} stroke="var(--color-ink-300)" strokeDasharray="3 3" />
			{series.map((line) => (
				<polyline key={`${line.stroke}:${line.dash}`} points={plotPoints(line, scales)} fill="none" stroke={line.stroke} strokeWidth={1.5} strokeDasharray={line.dash} />
			))}
		</svg>
	)
}
