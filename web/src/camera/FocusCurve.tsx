import type { AutoFocusSession, AutoFocusSessionSummary, FocusCurveSeriesKind } from 'api'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { formatPixelLength } from '../format'

// Focus Curve of an Auto Focus session, drawn under the viewer: the HFD measured at each focuser position, the
// curves the server's runner fitted (sampled by the server from its own regressions, never recomputed here),
// the best focus the curve placed, the position the focuser reached, and the HFD verified there. Positions are
// focuser steps on the horizontal axis; HFD is in pixels on the vertical one. A frame without a valid HFD is
// marked at the bottom of its position. Nothing estimated is drawn for a session whose curve was rejected. A legend under
// the chart names every mark it draws and states the best focus in words, so nothing is read from hover alone.

// Height of the chart, in CSS pixels.
const HEIGHT = 168

// Margins around the plot area for the axis labels, in CSS pixels.
const MARGIN = { top: 10, right: 12, bottom: 28, left: 40 } as const

// Stroke of each fitted curve: neutral, since Ember Clay marks only what is chosen or running.
const SERIES_STYLE: Readonly<Record<FocusCurveSeriesKind, { readonly stroke: string; readonly dash?: string }>> = {
	trendLeft: { stroke: 'var(--color-ink-300)', dash: '4 3' },
	trendRight: { stroke: 'var(--color-ink-300)', dash: '4 3' },
	parabolic: { stroke: 'var(--color-ink-200)' },
	hyperbolic: { stroke: 'var(--color-ink-200)' },
}

// Range of the chart: [min, max] of the positions (steps) and of the HFD (pixels).
export interface CurveBounds {
	readonly x: readonly [number, number]
	readonly y: readonly [number, number]
}

// Returns the range of everything a session draws, widened so nothing touches the edges, or undefined before any
// position is known: by 5% of the positions, at least half the step size of the session, and by 15% of the HFD
// span, at least 10% of the HFD, never below zero.
export function curveBounds(session: Pick<AutoFocusSession, 'measurements' | 'curve' | 'estimatedPosition' | 'finalPosition' | 'verifiedHfd' | 'estimatedHfd' | 'request'>): CurveBounds | undefined {
	const xs: number[] = []
	const ys: number[] = []

	for (const { requestedPosition, hfd } of session.measurements) {
		xs.push(requestedPosition)
		if (hfd !== undefined) ys.push(hfd)
	}

	for (const series of session.curve?.series ?? []) {
		for (const { x, y } of series.points) {
			xs.push(x)
			ys.push(y)
		}
	}

	for (const x of [session.estimatedPosition, session.finalPosition]) if (x !== undefined) xs.push(x)
	for (const y of [session.verifiedHfd, session.estimatedHfd]) if (y !== undefined) ys.push(y)
	if (xs.length === 0) return undefined

	const minX = Math.min(...xs)
	const maxX = Math.max(...xs)
	const minY = ys.length > 0 ? Math.min(...ys) : 0
	const maxY = ys.length > 0 ? Math.max(...ys) : 1
	const padX = Math.max(1, (maxX - minX) * 0.05, session.request.stepSize / 2)
	const padY = Math.max((maxY - minY) * 0.15, maxY * 0.1, 0.1)

	return { x: [minX - padX, maxX + padX], y: [Math.max(0, minY - padY), maxY + padY] }
}

export interface FocusCurveProps {
	// Summary of the session, for its state and outcome.
	readonly summary: AutoFocusSessionSummary
	// Complete record of the session, once fetched.
	readonly session?: AutoFocusSession
}

// Focus Curve chart, sized to its container's width.
export function FocusCurve({ summary, session }: FocusCurveProps) {
	const container = useRef<HTMLDivElement>(null)
	const [width, setWidth] = useState(0)

	// Measured before the first paint, so a session with measurements never shows the empty text for a frame.
	useLayoutEffect(() => {
		const element = container.current
		if (!element) return
		setWidth(element.getBoundingClientRect().width)
		const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
		observer.observe(element)
		return () => observer.disconnect()
	}, [])

	const bounds = session && curveBounds(session)

	return (
		<div className="flex flex-col gap-1">
			<div ref={container} className="relative w-full" style={{ height: HEIGHT }}>
				{!bounds ? <p className="m-0 flex h-full items-center justify-center text-xs text-ink-300">{summary.endedAt === undefined ? 'Waiting for the first measurements…' : 'No measurements.'}</p> : width > 0 && <Chart session={session} bounds={bounds} width={width} />}
			</div>
			{session && bounds && <Legend summary={summary} session={session} />}
		</div>
	)
}

// Legend of the chart: the best focus in words, then a swatch and a name for each kind of mark the chart draws now.
function Legend({ summary, session }: { readonly summary: AutoFocusSessionSummary; readonly session: AutoFocusSession }) {
	const { estimatedPosition, finalPosition, verifiedHfd } = session
	const measured = session.measurements.some((measurement) => measurement.hfd !== undefined)
	const missing = session.measurements.some((measurement) => measurement.hfd === undefined)
	const fitted = session.curve?.series.some((series) => series.kind === 'parabolic' || series.kind === 'hyperbolic') === true
	const trends = session.curve?.series.some((series) => series.kind === 'trendLeft' || series.kind === 'trendRight') === true
	const best = summary.state === 'completed' && finalPosition !== undefined ? `Best focus ${finalPosition} steps${verifiedHfd === undefined ? '' : `, ${formatPixelLength(verifiedHfd)} verified`}` : estimatedPosition !== undefined ? `Estimated best ${estimatedPosition} steps` : undefined

	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs leading-4 text-ink-300">
			{best && <span className="text-ink-100 tabular-nums">{best}</span>}
			{measured && (
				<LegendItem label="Sample">
					<circle cx={6} cy={6} r={3.5} fill="var(--color-ink-100)" />
				</LegendItem>
			)}
			{missing && (
				<LegendItem label="No HFD">
					<path d="M3,3l6,6m0,-6l-6,6" stroke="var(--color-danger)" strokeWidth={1.5} />
				</LegendItem>
			)}
			{fitted && (
				<LegendItem label="Fitted curve">
					<line x1={0} x2={12} y1={6} y2={6} stroke="var(--color-ink-200)" strokeWidth={1.5} />
				</LegendItem>
			)}
			{trends && (
				<LegendItem label="Trend lines">
					<line x1={0} x2={12} y1={6} y2={6} stroke="var(--color-ink-300)" strokeWidth={1.5} strokeDasharray="4 3" />
				</LegendItem>
			)}
			{estimatedPosition !== undefined && (
				<LegendItem label="Estimated best">
					<line x1={6} x2={6} y1={0} y2={12} stroke="var(--color-ink-100)" strokeDasharray="2 3" />
				</LegendItem>
			)}
			{finalPosition !== undefined && (
				<LegendItem label="Final position">
					<path d="M6,6l-4,6h8z" fill="var(--color-success)" />
				</LegendItem>
			)}
			{finalPosition !== undefined && verifiedHfd !== undefined && (
				<LegendItem label="Verified HFD">
					<rect x={2} y={2} width={8} height={8} fill="none" stroke="var(--color-success)" strokeWidth={2} />
				</LegendItem>
			)}
		</div>
	)
}

// Swatch of one kind of mark, drawn in a 12 px square, beside its name.
function LegendItem({ label, children }: { readonly label: string; readonly children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-1">
			<svg width={12} height={12} className="block flex-none">
				{children}
			</svg>
			{label}
		</span>
	)
}

interface ChartProps {
	readonly session: AutoFocusSession
	readonly bounds: CurveBounds
	// Width of the chart, in CSS pixels.
	readonly width: number
}

// Plot of a session in its bounds.
function Chart({ session, bounds, width }: ChartProps) {
	const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right)
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const sx = (x: number) => MARGIN.left + ((x - bounds.x[0]) / (bounds.x[1] - bounds.x[0])) * plotWidth
	const sy = (y: number) => MARGIN.top + (1 - (y - bounds.y[0]) / (bounds.y[1] - bounds.y[0])) * plotHeight
	const bottom = MARGIN.top + plotHeight
	const { estimatedPosition, finalPosition, verifiedHfd } = session
	const xTicks = ticks(bounds.x[0], bounds.x[1], Math.max(4, Math.floor(plotWidth / 60)))
	const yTicks = ticks(bounds.y[0], bounds.y[1], 4)

	return (
		<svg width={width} height={HEIGHT} className="block text-xs">
			<title>Focus curve: HFD over focuser position</title>
			{yTicks.map((y) => (
				<g key={`y${y}`}>
					<line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={sy(y)} y2={sy(y)} stroke="var(--color-line-100)" />
					<text x={MARGIN.left - 4} y={sy(y)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
						{formatTick(y)}
					</text>
				</g>
			))}
			{xTicks.map((x) => (
				<text key={`x${x}`} x={sx(x)} y={bottom + 14} textAnchor="middle" fill="var(--color-ink-300)">
					{formatTick(x)}
				</text>
			))}
			<text x={MARGIN.left} y={HEIGHT - 2} fill="var(--color-ink-300)">
				Focuser Position (steps)
			</text>
			<text x={4} y={MARGIN.top} dy="0.7em" fill="var(--color-ink-300)">
				HFD (px)
			</text>
			{estimatedPosition !== undefined && <line x1={sx(estimatedPosition)} x2={sx(estimatedPosition)} y1={MARGIN.top} y2={bottom} stroke="var(--color-ink-100)" strokeDasharray="2 3" />}
			{session.curve?.series.map((series) => {
				const style = SERIES_STYLE[series.kind]
				return <polyline key={series.kind} points={series.points.map((point) => `${sx(point.x)},${sy(point.y)}`).join(' ')} fill="none" stroke={style.stroke} strokeWidth={1.5} strokeDasharray={style.dash} />
			})}
			{session.measurements.map((measurement) =>
				measurement.hfd === undefined ? (
					<path key={measurement.capture} d={`M${sx(measurement.requestedPosition) - 3},${bottom - 6}l6,6m0,-6l-6,6`} stroke="var(--color-danger)" strokeWidth={1.5}>
						<title>{`#${measurement.capture} at ${measurement.requestedPosition}: no HFD`}</title>
					</path>
				) : (
					<circle key={measurement.capture} cx={sx(measurement.requestedPosition)} cy={sy(measurement.hfd)} r={3.5} fill="var(--color-ink-100)">
						<title>{`#${measurement.capture} at ${measurement.requestedPosition}: ${formatPixelLength(measurement.hfd)}, ${measurement.acceptedCount} stars`}</title>
					</circle>
				),
			)}
			{finalPosition !== undefined && verifiedHfd !== undefined && (
				<rect x={sx(finalPosition) - 4.5} y={sy(verifiedHfd) - 4.5} width={9} height={9} fill="none" stroke="var(--color-success)" strokeWidth={2}>
					<title>{`Verified at ${finalPosition}: ${formatPixelLength(verifiedHfd)}`}</title>
				</rect>
			)}
			{finalPosition !== undefined && <path d={`M${sx(finalPosition)},${bottom}l-4,6h8z`} fill="var(--color-success)" />}
		</svg>
	)
}

// Returns about count round values spanning [min, max].
export function ticks(min: number, max: number, count: number): number[] {
	if (!(max > min) || count < 1) return [min]
	const raw = (max - min) / count
	const magnitude = 10 ** Math.floor(Math.log10(raw))
	const step = [1, 2, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? raw
	const values: number[] = []
	for (let value = Math.ceil(min / step) * step; value <= max; value += step) values.push(Number(value.toPrecision(12)))
	return values
}

// Formats a tick value compactly, such as 12500 or 2.5.
function formatTick(value: number) {
	return Math.abs(value) >= 100 ? String(Math.round(value)) : String(Number(value.toPrecision(3)))
}
