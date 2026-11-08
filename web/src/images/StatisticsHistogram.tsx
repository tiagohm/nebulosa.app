import { type PointerEvent, useState } from 'react'
import { formatCount, formatSampleValue } from '../format'
import { binAt, HISTOGRAM_HEIGHT, HISTOGRAM_MARGIN, HISTOGRAM_WIDTH, type HistogramSeries, histogramPath, histogramRange, histogramScale, valueAt } from './statistics.plot'

// Histogram of the Image Inspector: the step outline of each plane shown over a common axis in source units, linear or
// logarithmic counts. A drag across the plot zooms to the values it spans, a double click returns to the whole range,
// and hovering reads the count of each plane at the value under the pointer. Nothing here measures anything: zoom,
// scale, and hover only redraw the counts already fetched.

// Distance a drag must span to zoom, in SVG units; a shorter one is a click.
const ZOOM_MINIMUM = 3

// One plane drawn.
export interface StatisticsHistogramSeries {
	// Stable key and short label of the plane, such as R or G1.
	readonly label: string
	// Color of the outline, a CSS value.
	readonly stroke: string
	// Dash pattern of an outline that must read apart from a solid one of the same color.
	readonly dash?: string
	// Its histogram.
	readonly histogram: HistogramSeries
}

interface StatisticsHistogramProps {
	// Planes drawn, in drawing order.
	readonly series: readonly StatisticsHistogramSeries[]
	// Whether counts are drawn as log10(1 + count).
	readonly log: boolean
	// Values shown, in source units; the whole range of the series when absent.
	readonly zoom?: readonly [number, number]
	// Called with the values a drag spans, or undefined to show the whole range.
	readonly onZoom: (zoom: readonly [number, number] | undefined) => void
}

// Returns the plot x of a pointer event over the SVG, in SVG units.
function pointerX(event: PointerEvent<SVGSVGElement>) {
	const box = event.currentTarget.getBoundingClientRect()
	return ((event.clientX - box.left) / box.width) * HISTOGRAM_WIDTH
}

// Histogram of one or more planes.
export function StatisticsHistogram({ series, log, zoom, onZoom }: StatisticsHistogramProps) {
	const [hover, setHover] = useState<number>()
	const [drag, setDrag] = useState<readonly [number, number]>()
	const range = zoom ?? histogramRange(series.map((s) => s.histogram))
	const scale = histogramScale(
		series.map((s) => s.histogram),
		range,
		log,
	)
	const hovered = hover === undefined ? undefined : valueAt(hover, scale)

	return (
		<div className="flex flex-col gap-1">
			<svg
				viewBox={`0 0 ${HISTOGRAM_WIDTH} ${HISTOGRAM_HEIGHT}`}
				className="block h-auto w-full cursor-crosshair touch-none rounded-md border border-line-100 bg-base-100 select-none"
				onPointerDown={(event) => {
					event.currentTarget.setPointerCapture(event.pointerId)
					const x = pointerX(event)
					setDrag([x, x])
				}}
				onPointerMove={(event) => {
					const x = pointerX(event)
					setHover(x)
					if (drag) setDrag([drag[0], x])
				}}
				onPointerUp={() => {
					if (drag && Math.abs(drag[1] - drag[0]) >= ZOOM_MINIMUM) {
						const a = valueAt(Math.min(drag[0], drag[1]), scale)
						const b = valueAt(Math.max(drag[0], drag[1]), scale)
						if (b > a) onZoom([a, b])
					}
					setDrag(undefined)
				}}
				onPointerCancel={() => setDrag(undefined)}
				onPointerLeave={() => setHover(undefined)}
				onDoubleClick={() => onZoom(undefined)}
			>
				{series.map((s) => (
					<path key={s.label} d={histogramPath(s.histogram, scale)} fill="none" stroke={s.stroke} strokeWidth={1} strokeDasharray={s.dash} strokeLinejoin="round" />
				))}
				{drag && Math.abs(drag[1] - drag[0]) >= ZOOM_MINIMUM && <rect x={Math.min(drag[0], drag[1])} y={HISTOGRAM_MARGIN} width={Math.abs(drag[1] - drag[0])} height={HISTOGRAM_HEIGHT - 2 * HISTOGRAM_MARGIN} fill="var(--color-accent)" fillOpacity={0.15} />}
				{hover !== undefined && !drag && <line x1={hover} x2={hover} y1={HISTOGRAM_MARGIN} y2={HISTOGRAM_HEIGHT - HISTOGRAM_MARGIN} stroke="var(--color-ink-300)" strokeDasharray="2 2" />}
			</svg>
			<div className="flex justify-between text-xs text-ink-300 tabular-nums">
				<span>{formatSampleValue(range[0])}</span>
				<span>{log ? 'log count' : 'count'}</span>
				<span>{formatSampleValue(range[1])}</span>
			</div>
			<p className="m-0 min-h-4 text-xs text-ink-200 tabular-nums">
				{hovered === undefined
					? 'Drag to zoom, double-click to reset.'
					: `${formatSampleValue(hovered)}: ${series
							.map((s) => {
								const bin = binAt(s.histogram, hovered)
								return `${s.label} ${bin === undefined ? '—' : formatCount(s.histogram.counts[bin])}`
							})
							.join(' · ')}`}
			</p>
		</div>
	)
}
