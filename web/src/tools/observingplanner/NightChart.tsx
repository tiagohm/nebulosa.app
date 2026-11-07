import type { ObservingSample, TargetAnalysis } from 'api'
import type { KeyboardEvent, MouseEvent } from 'react'
import { formatClockTime, formatDegrees } from '../../format'
import { DataList, DataRow } from '../../ui/DataRow'
import { moveIndex } from '../../ui/navigation'
import { type SkyBand, skyBands } from '../astroweather/astroweather'
import { formatScore } from './format'

// Chart of a target over a night: its geometric altitude and the Moon's against time, over bands of how dark the sky is,
// with the windows shaded and the minimum altitude drawn. The lines join the display samples of the server; the windows
// are the exact crossings, never read from the samples. A sample is chosen by a click or with the arrow keys, Home, and
// End, never by hovering, and its values are listed below the chart.

// Size of the drawing, in viewBox units.
const WIDTH = 720
const HEIGHT = 240

// Margins of the plot, in viewBox units.
const MARGIN = { top: 12, right: 12, bottom: 28, left: 36 } as const

// Altitudes of the grid lines, in degrees.
const GRID = [0, 30, 60, 90] as const

// Fill of each band of the sky.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'var(--color-base-300)', twilight: 'var(--color-base-200)', dark: 'var(--color-base-000)' }

// Name of each band of the sky.
const SKY_LABELS: Readonly<Record<SkyBand, string>> = { day: 'Sun up', twilight: 'Twilight', dark: 'Astronomical darkness' }

// Hours between two labels of the time axis.
const LABEL_HOURS = 2

// Milliseconds per hour.
const HOUR_MS = 3_600_000

export interface NightChartProps {
	// Analysis drawn.
	readonly analysis: TargetAnalysis
	// IANA zone the times are labeled in.
	readonly timeZone: string
	// Index of the sample chosen.
	readonly cursor: number
	// Receives the index of a sample chosen.
	readonly onCursor: (index: number) => void
}

// Path through the samples of a quantity, in viewBox units; a sample without the quantity breaks the line.
function linePath(samples: readonly ObservingSample[], x: (time: number) => number, y: (altitude: number) => number, value: (sample: ObservingSample) => number | undefined) {
	let path = ''
	let drawing = false

	for (const sample of samples) {
		const v = value(sample)
		if (v === undefined) {
			drawing = false
			continue
		}

		path += `${drawing ? 'L' : 'M'}${x(sample.time).toFixed(1)},${y(v).toFixed(1)} `
		drawing = true
	}

	return path
}

// Chart of a target over a night.
export function NightChart({ analysis, timeZone, cursor, onCursor }: NightChartProps) {
	const { samples, night, windows, constraints, summary } = analysis
	const { start, end } = night.display
	const span = Math.max(1, end - start)
	const plotWidth = WIDTH - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (time: number) => MARGIN.left + ((time - start) / span) * plotWidth
	// Altitudes from −10° to 90°, so a target just under the horizon still shows its course.
	const y = (altitude: number) => MARGIN.top + ((90 - Math.max(-10, (altitude * 180) / Math.PI)) / 100) * plotHeight
	const firstLabel = Math.ceil(start / (LABEL_HOURS * HOUR_MS)) * LABEL_HOURS * HOUR_MS
	const labels: number[] = []
	for (let time = firstLabel; time < end; time += LABEL_HOURS * HOUR_MS) labels.push(time)
	const sample = samples[cursor]

	// Chooses the sample nearest the point clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const time = start + (((event.clientX - box.left) / box.width) * WIDTH - MARGIN.left) * (span / plotWidth)
		let nearest = 0
		for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].time - time) < Math.abs(samples[nearest].time - time)) nearest = i
		onCursor(nearest)
	}

	// Moves the cursor with the keyboard.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = moveIndex(cursor, samples.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		onCursor(index)
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="overflow-x-auto">
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block h-auto w-full min-w-[480px] cursor-pointer text-[10px] outline-none focus-visible:outline-2 focus-visible:outline-accent">
					<title>{`Altitude of ${analysis.name} and of the Moon over the night; shaded stretches are the observing windows.`}</title>
					<defs>
						<pattern id="observing-window" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
							<line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-success)" strokeWidth="2" />
						</pattern>
					</defs>
					{skyBands(night).map((band) => (
						<rect key={band.start} x={x(band.start)} y={MARGIN.top} width={Math.max(0, x(band.end) - x(band.start))} height={plotHeight} fill={SKY_FILLS[band.band]}>
							<title>{`${SKY_LABELS[band.band]}: ${formatClockTime(band.start, timeZone)}–${formatClockTime(band.end, timeZone)}`}</title>
						</rect>
					))}
					{windows.map((window) => (
						<rect key={window.start} x={x(Math.max(start, window.start))} y={MARGIN.top} width={Math.max(1, x(Math.min(end, window.end)) - x(Math.max(start, window.start)))} height={plotHeight} fill="url(#observing-window)" opacity={0.3}>
							<title>{`Window ${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone)}`}</title>
						</rect>
					))}
					{GRID.map((degrees) => (
						<g key={degrees}>
							<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y((degrees * Math.PI) / 180)} y2={y((degrees * Math.PI) / 180)} stroke="var(--color-line-100)" />
							<text x={MARGIN.left - 4} y={y((degrees * Math.PI) / 180)} dy="0.35em" textAnchor="end" fill="var(--color-ink-300)">
								{degrees}°
							</text>
						</g>
					))}
					<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(constraints.minimumAltitude)} y2={y(constraints.minimumAltitude)} stroke="var(--color-warning)" strokeDasharray="4 3">
						<title>Minimum altitude</title>
					</line>
					{labels.map((time) => (
						<text key={time} x={x(time)} y={HEIGHT - 10} textAnchor="middle" fill="var(--color-ink-300)">
							{formatClockTime(time, timeZone)}
						</text>
					))}
					<path d={linePath(samples, x, y, (e) => e.moonAltitude)} fill="none" stroke="var(--color-ink-300)" strokeWidth={1.5} strokeDasharray="5 4" />
					<path d={linePath(samples, x, y, (e) => e.altitude)} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
					{summary.culminationAt !== undefined && summary.culminationAltitude !== undefined && summary.culminationAt >= start && summary.culminationAt <= end && <circle cx={x(summary.culminationAt)} cy={y(summary.culminationAltitude)} r={3.5} fill="var(--color-accent)" />}
					{sample && <line x1={x(sample.time)} x2={x(sample.time)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
				<span>
					<span className="text-accent">━</span> {analysis.name}
				</span>
				<span>╌ Moon</span>
				<span className="text-warning">╌ minimum altitude</span>
				<span className="text-success">▨ window</span>
				<span>● culmination</span>
			</div>
			{sample && (
				<DataList>
					<DataRow label="Time">{formatClockTime(sample.time, timeZone)}</DataRow>
					<DataRow label="Altitude">{formatDegrees(sample.altitude, 1)}</DataRow>
					<DataRow label="Azimuth">{formatDegrees(sample.azimuth, 1)}</DataRow>
					<DataRow label="Airmass">{sample.airmass === undefined ? 'Below the horizon' : sample.airmass.toFixed(2)}</DataRow>
					<DataRow label="Sun Altitude">{formatDegrees(sample.sunAltitude, 1)}</DataRow>
					<DataRow label="Moon Altitude">{formatDegrees(sample.moonAltitude, 1)}</DataRow>
					<DataRow label="Moon Separation">{formatDegrees(sample.moonSeparation, 1)}</DataRow>
					<DataRow label="Score">{sample.score === undefined ? 'Outside the windows' : formatScore(sample.score)}</DataRow>
				</DataList>
			)}
		</div>
	)
}
