import type { PlanetaryEventSeries } from 'api'
import { useEffect, useRef, useState } from 'react'
import { ticks } from '../../camera/FocusCurve'
import { QUANTITY_LABELS, QUANTITY_UNITS, quantityValue } from './planetaryevents.format'

// Small line chart of the server's sampled curves around an event, against days from the event. The event is marked at
// its solved instant, never at a sample's minimum or crossing; the samples are for display only. A magnitude axis runs
// upward toward brighter (smaller) values. It is drawn at the width of its frame, one SVG unit to a CSS pixel, so its
// labels keep the caption size at every width; the y axis names its unit when every curve shares one.

// Narrowest width the chart is drawn at, CSS pixels.
const MIN_WIDTH = 240

// Height of the chart, CSS pixels.
const HEIGHT = 168

// Margins around the plot, CSS pixels.
const MARGIN = { top: 18, right: 10, bottom: 22, left: 46 }

// Size of the labels, CSS pixels: the caption size.
const FONT_SIZE = 10.5

// Colours of the curves, as CSS variables.
const COLORS = ['--color-accent', '--color-warning']

// Chart of the curves of one event.
export function PlanetaryEventChart({ series }: { readonly series: PlanetaryEventSeries }) {
	const frame = useRef<HTMLDivElement>(null)
	const [measured, setMeasured] = useState(0)
	const width = Math.max(MIN_WIDTH, measured)

	// Follows the width of the frame.
	useEffect(() => {
		const element = frame.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => setMeasured(entry.contentRect.width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const days = series.times.map((t) => (t - series.time) / 86_400_000)
	const curves = series.curves.map((curve) => ({ quantity: curve.quantity, values: curve.values.map((v) => (v === null ? undefined : quantityValue(curve.quantity, v))) }))
	const inverted = curves.length === 1 && curves[0].quantity === 'magnitude'

	let low = Infinity
	let high = -Infinity
	for (const { values } of curves) for (const value of values) if (value !== undefined && Number.isFinite(value)) [low, high] = [Math.min(low, value), Math.max(high, value)]
	if (!Number.isFinite(low)) return null
	const units = new Set(curves.map((curve) => QUANTITY_UNITS[curve.quantity]))
	const unit = units.size === 1 ? [...units][0] : undefined
	if (high === low) [low, high] = [low - 1, high + 1]
	const pad = (high - low) * 0.05
	low -= pad
	high += pad

	const x = (day: number) => MARGIN.left + ((day - days[0]) / (days.at(-1)! - days[0] || 1)) * (width - MARGIN.left - MARGIN.right)
	const y = (value: number) => {
		const fraction = (value - low) / (high - low)
		return MARGIN.top + (inverted ? fraction : 1 - fraction) * (HEIGHT - MARGIN.top - MARGIN.bottom)
	}

	const path = (values: readonly (number | undefined)[]) => {
		let d = ''
		let pen = 'M'
		for (let i = 0; i < values.length; i++) {
			const value = values[i]
			if (value === undefined || !Number.isFinite(value)) {
				pen = 'M'
				continue
			}
			d += `${pen}${x(days[i]).toFixed(1)},${y(value).toFixed(1)}`
			pen = 'L'
		}
		return d
	}

	return (
		<figure className="m-0 flex flex-col gap-1">
			<div ref={frame} className="w-full">
				<svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} className="block max-w-full">
					{unit && (
						<text x={MARGIN.left - 6} y={10} textAnchor="end" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
							{unit}
						</text>
					)}
					<text x={x(0)} y={10} textAnchor="middle" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
						event
					</text>
					{ticks(low, high, 6).map((value) => (
						<g key={value}>
							<line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(value)} y2={y(value)} stroke="var(--color-line-100)" strokeWidth={0.5} />
							<text x={MARGIN.left - 6} y={y(value) + 3.5} textAnchor="end" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
								{Number(value.toPrecision(4))}
							</text>
						</g>
					))}
					{ticks(days[0], days.at(-1)!, 6).map((day) => (
						<text key={day} x={x(day)} y={HEIGHT - 6} textAnchor="middle" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
							{Number(day.toPrecision(3))}
						</text>
					))}
					<line x1={x(0)} x2={x(0)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} stroke="var(--color-ink-300)" strokeDasharray="2 2" strokeWidth={0.75} />
					{curves.map((curve, i) => (
						<path key={curve.quantity} d={path(curve.values)} fill="none" stroke={`var(${COLORS[i % COLORS.length]})`} strokeWidth={1.25} />
					))}
				</svg>
			</div>
			<figcaption className="flex flex-wrap gap-x-3 text-xs text-ink-300">
				{curves.map((curve, i) => (
					<span key={curve.quantity} className="flex items-center gap-1">
						<span className="inline-block h-0.5 w-3" style={{ background: `var(${COLORS[i % COLORS.length]})` }} />
						{QUANTITY_LABELS[curve.quantity]}
					</span>
				))}
				<span>against days from the event</span>
			</figcaption>
		</figure>
	)
}
