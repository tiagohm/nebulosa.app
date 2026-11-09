import type { MeteorNightSample, MeteorObservingNight } from 'api'
import { type KeyboardEvent, type MouseEvent, useState } from 'react'
import { formatClockTime, formatDegrees } from '../../format'
import { DataList, DataRow } from '../../ui/DataRow'
import { moveIndex } from '../../ui/navigation'
import { type SkyBand, skyBands } from '../astroweather/astroweather'

// Chart of a shower's radiant over a night: its geometric altitude and the Moon's against time, over the bands of how
// dark the sky is, with the observing windows shaded and the lowest radiant altitude drawn. The lines join the server's
// samples; the windows are the exact crossings, never read from the samples. A sample is chosen by a click or with the
// arrow keys, Home, and End, and its values are listed below the chart. It shows geometry only: no rate is drawn.

// Size of the drawing, in viewBox units.
const WIDTH = 720
const HEIGHT = 220

// Margins of the plot, in viewBox units.
const MARGIN = { top: 12, right: 12, bottom: 28, left: 36 } as const

// Altitudes of the grid lines, degrees.
const GRID = [0, 30, 60, 90] as const

// Fill of each band of the sky.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'var(--color-base-300)', twilight: 'var(--color-base-200)', dark: 'var(--color-base-000)' }

// Name of each band of the sky.
const SKY_LABELS: Readonly<Record<SkyBand, string>> = { day: 'Sun up', twilight: 'Twilight', dark: 'Astronomical darkness' }

// Hours between two labels of the time axis, and milliseconds per hour.
const LABEL_HOURS = 2
const HOUR_MS = 3_600_000

export interface MeteorNightChartProps {
	// Night drawn.
	readonly night: MeteorObservingNight
	// Name of the shower.
	readonly name: string
	// Lowest radiant altitude of a window, radians.
	readonly minimumAltitude: number
	// IANA zone the times are labeled in.
	readonly timeZone: string
}

// Path through the samples of a quantity, in viewBox units; a sample without the quantity breaks the line.
function linePath(samples: readonly MeteorNightSample[], x: (time: number) => number, y: (altitude: number) => number, value: (sample: MeteorNightSample) => number | undefined) {
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

// Chart of a radiant over a night.
export function MeteorNightChart({ night, name, minimumAltitude, timeZone }: MeteorNightChartProps) {
	const { samples, windows } = night
	const { start, end } = night.night.display
	const [cursor, setCursor] = useState(0)
	const span = Math.max(1, end - start)
	const plotWidth = WIDTH - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (time: number) => MARGIN.left + ((time - start) / span) * plotWidth
	// Altitudes from −10° to 90°, so a radiant just under the horizon still shows its course.
	const y = (altitude: number) => MARGIN.top + ((90 - Math.max(-10, (altitude * 180) / Math.PI)) / 100) * plotHeight
	const firstLabel = Math.ceil(start / (LABEL_HOURS * HOUR_MS)) * LABEL_HOURS * HOUR_MS
	const labels: number[] = []
	for (let time = firstLabel; time < end; time += LABEL_HOURS * HOUR_MS) labels.push(time)
	const sample = samples[Math.min(cursor, samples.length - 1)]

	// Chooses the sample nearest the point clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		const time = start + (((event.clientX - box.left) / box.width) * WIDTH - MARGIN.left) * (span / plotWidth)
		let nearest = 0
		for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].time - time) < Math.abs(samples[nearest].time - time)) nearest = i
		setCursor(nearest)
	}

	// Moves the cursor with the keyboard.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = moveIndex(cursor, samples.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		setCursor(index)
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="overflow-x-auto">
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block h-auto w-full min-w-[480px] cursor-pointer text-[10px] outline-none focus-visible:outline-2 focus-visible:outline-accent">
					<title>{`Altitude of the radiant of the ${name} and of the Moon over the night; shaded stretches are the observing windows.`}</title>
					<defs>
						<pattern id="meteor-window" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
							<line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-success)" strokeWidth="2" />
						</pattern>
					</defs>
					{skyBands(night.night).map((band) => (
						<rect key={band.start} x={x(band.start)} y={MARGIN.top} width={Math.max(0, x(band.end) - x(band.start))} height={plotHeight} fill={SKY_FILLS[band.band]}>
							<title>{`${SKY_LABELS[band.band]}: ${formatClockTime(band.start, timeZone)}–${formatClockTime(band.end, timeZone)}`}</title>
						</rect>
					))}
					{windows.map((window) => (
						<rect key={window.start} x={x(Math.max(start, window.start))} y={MARGIN.top} width={Math.max(1, x(Math.min(end, window.end)) - x(Math.max(start, window.start)))} height={plotHeight} fill="url(#meteor-window)" opacity={0.3}>
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
					<line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(minimumAltitude)} y2={y(minimumAltitude)} stroke="var(--color-warning)" strokeDasharray="4 3">
						<title>Lowest radiant altitude</title>
					</line>
					{labels.map((time) => (
						<text key={time} x={x(time)} y={HEIGHT - 10} textAnchor="middle" fill="var(--color-ink-300)">
							{formatClockTime(time, timeZone)}
						</text>
					))}
					<path d={linePath(samples, x, y, (e) => e.moonAltitude)} fill="none" stroke="var(--color-ink-300)" strokeWidth={1.5} strokeDasharray="5 4" />
					<path d={linePath(samples, x, y, (e) => e.radiantAltitude)} fill="none" stroke="var(--color-accent)" strokeWidth={2} />
					{windows.map((window) => window.bestTime >= start && window.bestTime <= end && <circle key={window.bestTime} cx={x(window.bestTime)} cy={y(window.maximumRadiantAltitude)} r={3.5} fill="var(--color-accent)" />)}
					{sample && <line x1={x(sample.time)} x2={x(sample.time)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				</svg>
			</div>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
				<span>
					<span className="text-accent">━</span> Radiant
				</span>
				<span>╌ Moon</span>
				<span className="text-warning">╌ lowest radiant altitude</span>
				<span className="text-success">▨ window</span>
				<span>● highest radiant in a window</span>
			</div>
			{sample && (
				<DataList>
					<DataRow label="Time">{formatClockTime(sample.time, timeZone)}</DataRow>
					<DataRow label="Radiant Altitude">{sample.radiantAltitude === undefined ? '—' : formatDegrees(sample.radiantAltitude, 1)}</DataRow>
					<DataRow label="Sun Altitude">{formatDegrees(sample.sunAltitude, 1)}</DataRow>
					<DataRow label="Moon Altitude">{formatDegrees(sample.moonAltitude, 1)}</DataRow>
				</DataList>
			)}
		</div>
	)
}
