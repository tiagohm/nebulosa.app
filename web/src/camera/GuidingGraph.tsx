import type { GuidingEventRecord, GuidingSessionSummary, GuidingTelemetrySample } from 'api'
import { useEffect, useRef, useState } from 'react'
import { ticks } from './FocusCurve'

// Guiding graph of a session, drawn under the viewer: the RA and DEC guide errors of the latest guide steps, in
// arcseconds when the pixel scale is known and in guide pixels otherwise, with the corrections issued for each step as
// bars in a band under the plot (pulse durations in ms, drawn solid when a pulse reached its axis maximum), gaps where
// the star was lost, and vertical markers for dithers, pauses, resumes, guiding starts, and lost locks. The horizontal
// axis is the step order, one slot per telemetry sample, not time. Everything comes from the session's telemetry and
// control events as the server published them; nothing is recomputed but the scale.

// Height of the chart, in CSS pixels.
const HEIGHT = 180

// Margins around the plot area for the axis labels, in CSS pixels.
const MARGIN = { top: 10, right: 12, bottom: 34, left: 40 } as const

// Height of the band of the corrections under the plot, in CSS pixels.
const PULSE_BAND = 18

// Guide steps the graph shows, the newest last.
export const GUIDING_GRAPH_SAMPLES = 100

// Stroke of each control event marked on the graph.
const MARKERS: Readonly<Partial<Record<GuidingEventRecord['event']['type'], { readonly stroke: string; readonly label: string }>>> = {
	dithered: { stroke: 'var(--color-accent)', label: 'Dither' },
	paused: { stroke: 'var(--color-ink-300)', label: 'Paused' },
	resumed: { stroke: 'var(--color-ink-300)', label: 'Resumed' },
	guidingStarted: { stroke: 'var(--color-success)', label: 'Guiding started' },
	lockLost: { stroke: 'var(--color-danger)', label: 'Lock lost' },
}

// Returns the polyline segments of one axis error, split where a sample was lost; x of a point is its slot.
export function guidingSegments(samples: readonly GuidingTelemetrySample[], value: (sample: GuidingTelemetrySample) => number): readonly (readonly (readonly [number, number])[])[] {
	const segments: (readonly [number, number])[][] = []
	let current: (readonly [number, number])[] | undefined

	for (const [slot, sample] of samples.entries()) {
		if (sample.lost) {
			current = undefined
			continue
		}

		if (!current) segments.push((current = []))
		current.push([slot, value(sample)])
	}

	return segments
}

// Returns the symmetric error range [-limit, limit] of the samples, at least 1 unit and 15% beyond the largest error.
export function guidingErrorLimit(samples: readonly GuidingTelemetrySample[], scale: number) {
	let largest = 0
	for (const sample of samples) if (!sample.lost) largest = Math.max(largest, Math.abs(sample.raDistance * scale), Math.abs(sample.decDistance * scale))
	return Math.max(1, largest * 1.15)
}

export interface GuidingGraphProps {
	// Summary of the session, for its pixel scale and state.
	readonly session: GuidingSessionSummary
	// Telemetry samples of the session known, in cursor order.
	readonly telemetry?: readonly GuidingTelemetrySample[]
	// Control events of the session known, in sequence order.
	readonly events?: readonly GuidingEventRecord[]
}

// Guiding graph, sized to its container's width.
export function GuidingGraph({ session, telemetry, events }: GuidingGraphProps) {
	const container = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)

	useEffect(() => {
		const element = container.current
		if (!element) return
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const samples = telemetry?.slice(-GUIDING_GRAPH_SAMPLES) ?? []

	return (
		<div ref={container} className="relative w-full" style={{ height: HEIGHT }}>
			{samples.length === 0 || width <= 0 ? <p className="m-0 flex h-full items-center justify-center text-xs text-ink-300">{session.active ? 'Waiting for the first guide steps…' : 'No guide steps.'}</p> : <Chart samples={samples} events={events ?? []} pixelScale={session.pixelScale} width={width} />}
		</div>
	)
}

interface ChartProps {
	// Samples shown, the newest last.
	readonly samples: readonly GuidingTelemetrySample[]
	// Control events of the session.
	readonly events: readonly GuidingEventRecord[]
	// Arcseconds per guide pixel; absent plots pixels.
	readonly pixelScale?: number
	// Width of the chart, in CSS pixels.
	readonly width: number
}

// Plot of the samples.
function Chart({ samples, events, pixelScale, width }: ChartProps) {
	const scale = pixelScale ?? 1
	const unit = pixelScale === undefined ? 'px' : '"'
	const limit = guidingErrorLimit(samples, scale)
	const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right)
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom - PULSE_BAND
	const slot = plotWidth / GUIDING_GRAPH_SAMPLES
	// Samples fill the right end, so the newest is always at the right edge.
	const offset = GUIDING_GRAPH_SAMPLES - samples.length
	const sx = (index: number) => MARGIN.left + (offset + index + 0.5) * slot
	const sy = (value: number) => MARGIN.top + (1 - (value + limit) / (2 * limit)) * plotHeight
	const band = MARGIN.top + plotHeight + 4
	const longest = Math.max(1, ...samples.map((sample) => Math.max(sample.ra.duration, sample.dec.duration)))
	const yTicks = ticks(-limit, limit, 4)
	const first = samples[0].timestamp
	const last = samples.at(-1)!.timestamp
	const markers = events.flatMap((record) => {
		const style = MARKERS[record.event.type]
		if (!style || record.event.timestamp < first || record.event.timestamp > last) return []
		const index = samples.findIndex((sample) => sample.timestamp >= record.event.timestamp)
		return index < 0 ? [] : [{ key: record.sequence, x: sx(index) - slot / 2, ...style }]
	})
	const lines = (value: (sample: GuidingTelemetrySample) => number) => guidingSegments(samples, value).map((segment) => segment.map(([index, y]) => `${sx(index)},${sy(y)}`).join(' '))

	return (
		<svg width={width} height={HEIGHT} className="block text-[10px]">
			<title>{`Guiding graph: RA and DEC errors (${unit}) and corrections (ms) of the latest guide steps`}</title>
			{yTicks.map((y) => (
				<g key={`y${y}`}>
					<line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={sy(y)} y2={sy(y)} stroke={y === 0 ? 'var(--color-line-200)' : 'var(--color-line-100)'} />
					<text x={MARGIN.left - 4} y={sy(y)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
						{String(Number(y.toPrecision(3)))}
					</text>
				</g>
			))}
			{markers.map((marker) => (
				<line key={marker.key} x1={marker.x} x2={marker.x} y1={MARGIN.top} y2={band + PULSE_BAND} stroke={marker.stroke} strokeDasharray="2 3">
					<title>{marker.label}</title>
				</line>
			))}
			{lines((sample) => sample.raDistance * scale).map((points, index) => (
				<polyline key={`ra${index}`} points={points} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} />
			))}
			{lines((sample) => sample.decDistance * scale).map((points, index) => (
				<polyline key={`dec${index}`} points={points} fill="none" stroke="var(--color-success)" strokeWidth={1.5} />
			))}
			{samples.map((sample, index) => {
				const x = sx(index) - slot / 2
				const ra = (sample.ra.duration / longest) * PULSE_BAND
				const dec = (sample.dec.duration / longest) * PULSE_BAND
				return (
					<g key={sample.cursor}>
						<title>{sample.lost ? `#${sample.frameId}: star lost` : `#${sample.frameId}: RA ${sample.ra.duration} ms ${sample.ra.direction ?? ''}, DEC ${sample.dec.duration} ms ${sample.dec.direction ?? ''}, SNR ${sample.snr.toFixed(1)}`}</title>
						{sample.lost && <rect x={x} y={MARGIN.top} width={slot} height={plotHeight} fill="var(--color-danger)" fillOpacity={0.12} />}
						{ra > 0 && <rect x={x + slot * 0.1} y={band + PULSE_BAND - ra} width={slot * 0.4} height={ra} fill="var(--color-accent)" fillOpacity={sample.ra.limited ? 1 : 0.5} />}
						{dec > 0 && <rect x={x + slot * 0.5} y={band + PULSE_BAND - dec} width={slot * 0.4} height={dec} fill="var(--color-success)" fillOpacity={sample.dec.limited ? 1 : 0.5} />}
					</g>
				)
			})}
			<text x={4} y={MARGIN.top} dy="0.7em" fill="var(--color-ink-300)">
				{unit}
			</text>
			<text x={MARGIN.left} y={HEIGHT - 2} fill="var(--color-ink-300)">
				<tspan fill="var(--color-accent)">RA</tspan> <tspan fill="var(--color-success)">DEC</tspan>
				{` error and corrections (up to ${longest} ms), latest ${samples.length} steps`}
			</text>
		</svg>
	)
}
