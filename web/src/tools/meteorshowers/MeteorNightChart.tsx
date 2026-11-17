import type { MeteorNightSample, MeteorObservingNight } from 'api'
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react'
import { formatClockTime, formatDegrees } from '../../format'
import { DataList, DataRow } from '../../ui/DataRow'
import { moveIndex } from '../../ui/navigation'
import { type SkyBand, skyBands } from '../astroweather/astroweather'
import { bestWindow } from './meteorshowers.format'

// Chart of a shower's radiant over a night: its geometric altitude and the Moon's above the horizon against time, over the
// bands of how dark the sky is, with the observing windows shaded and the lowest radiant altitude drawn. The lines join the
// server's samples and stop at the horizon; the windows are the exact crossings, never read from the samples. It is drawn
// at the width of its frame, one SVG unit to a CSS pixel, so its labels keep the caption size on a phone. The cursor
// starts at the best instant of the best window, else at now while now is inside the night, else at the middle of the
// darkness; a click or the arrow keys (10 min), Page Up and Page Down (1 h), Home, and End move it, and its values are
// listed below. It shows geometry only: no rate is drawn. The parent keys it by the night, so the cursor starts again.

// Narrowest width the chart is drawn at, CSS pixels.
const MIN_WIDTH = 280

// Height of the chart, CSS pixels.
const HEIGHT = 200

// Margins of the plot, CSS pixels.
const MARGIN = { top: 10, right: 10, bottom: 24, left: 34 } as const

// Size of the labels, CSS pixels: the caption size.
const FONT_SIZE = 10.5

// Altitudes of the grid lines, degrees.
const GRID = [0, 30, 60, 90] as const

// Samples a Page Up or Page Down moves the cursor: an hour of 10-minute samples.
const PAGE_SAMPLES = 6

// Fill of each band of the sky.
const SKY_FILLS: Readonly<Record<SkyBand, string>> = { day: 'var(--color-base-300)', twilight: 'var(--color-base-200)', dark: 'var(--color-base-000)' }

// Name of each band of the sky.
const SKY_LABELS: Readonly<Record<SkyBand, string>> = { day: 'Sun up', twilight: 'Twilight', dark: 'Astronomical darkness' }

// Colour of the radiant: the meteor radiant hue of the Sky, so the radiant reads the same in both places.
const RADIANT = 'var(--color-map-radiant)'

// Hours between two labels of the time axis on a wide and a narrow chart, and milliseconds per hour.
const LABEL_HOURS = 2
const NARROW_LABEL_HOURS = 4
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

// Path through the samples of an altitude, in CSS pixels; a sample without it or below the horizon breaks the line.
function linePath(samples: readonly MeteorNightSample[], x: (time: number) => number, y: (altitude: number) => number, value: (sample: MeteorNightSample) => number | undefined) {
	let path = ''
	let drawing = false

	for (const sample of samples) {
		const v = value(sample)
		if (v === undefined || v < 0) {
			drawing = false
			continue
		}

		path += `${drawing ? 'L' : 'M'}${x(sample.time).toFixed(1)},${y(v).toFixed(1)} `
		drawing = true
	}

	return path
}

// Index of the sample nearest an instant.
function nearestSample(samples: readonly MeteorNightSample[], time: number) {
	let nearest = 0
	for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].time - time) < Math.abs(samples[nearest].time - time)) nearest = i
	return nearest
}

// Instant the cursor starts at: the best instant of the best window, the answer of the night, else now inside the night,
// else the middle of the darkness, else the middle of the span shown.
function startTime(night: MeteorObservingNight, now: number) {
	const { start, end } = night.night.display
	const best = bestWindow(night.windows)
	if (best) return best.bestTime
	if (now >= start && now <= end) return now
	const dark = night.night.sun.darkness[0]
	return dark ? (dark.start + dark.end) / 2 : (start + end) / 2
}

// A short line of the legend, drawn in the chart's own stroke.
function Swatch({ stroke, dash, width = 2 }: { readonly stroke: string; readonly dash?: string; readonly width?: number }) {
	return (
		<svg width={16} height={8} className="flex-none">
			<line x1={0} x2={16} y1={4} y2={4} stroke={stroke} strokeWidth={width} strokeDasharray={dash} />
		</svg>
	)
}

// Chart of a radiant over a night.
export function MeteorNightChart({ night, name, minimumAltitude, timeZone }: MeteorNightChartProps) {
	const { samples, windows } = night
	const { start, end } = night.night.display
	const [cursor, setCursor] = useState(() => nearestSample(samples, startTime(night, Date.now())))
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

	const span = Math.max(1, end - start)
	const plotWidth = width - MARGIN.left - MARGIN.right
	const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
	const x = (time: number) => MARGIN.left + ((time - start) / span) * plotWidth
	// Altitudes from the horizon to the zenith.
	const y = (altitude: number) => MARGIN.top + ((90 - Math.max(0, (altitude * 180) / Math.PI)) / 90) * plotHeight
	const labelMs = (width < 480 ? NARROW_LABEL_HOURS : LABEL_HOURS) * HOUR_MS
	const labels: number[] = []
	for (let time = Math.ceil(start / labelMs) * labelMs; time < end; time += labelMs) labels.push(time)
	const sample = samples[Math.min(cursor, samples.length - 1)]

	// Chooses the sample nearest the point clicked.
	function onClick(event: MouseEvent<SVGSVGElement>) {
		const box = event.currentTarget.getBoundingClientRect()
		setCursor(nearestSample(samples, start + (((event.clientX - box.left) / box.width) * width - MARGIN.left) * (span / plotWidth)))
	}

	// Moves the cursor with the keyboard: a sample per arrow, an hour per page.
	function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
		const index = event.key === 'PageDown' ? Math.min(samples.length - 1, cursor + PAGE_SAMPLES) : event.key === 'PageUp' ? Math.max(0, cursor - PAGE_SAMPLES) : moveIndex(cursor, samples.length, event.key)
		if (index === undefined) return
		event.preventDefault()
		setCursor(index)
	}

	return (
		<figure className="m-0 flex flex-col gap-2">
			<div ref={frame} className="w-full">
				<svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} className="block max-w-full cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
					<title>{`Altitude of the radiant of the ${name} and of the Moon over the night; shaded stretches are the observing windows. Arrow keys move the cursor 10 minutes, Page Up and Page Down an hour.`}</title>
					<defs>
						<pattern id="meteor-window" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
							<line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-ink-200)" strokeWidth="1.5" />
						</pattern>
					</defs>
					{skyBands(night.night).map((band) => (
						<rect key={band.start} x={x(band.start)} y={MARGIN.top} width={Math.max(0, x(band.end) - x(band.start))} height={plotHeight} fill={SKY_FILLS[band.band]}>
							<title>{`${SKY_LABELS[band.band]}: ${formatClockTime(band.start, timeZone)}–${formatClockTime(band.end, timeZone)}`}</title>
						</rect>
					))}
					{windows.map((window) => (
						<rect key={window.start} x={x(Math.max(start, window.start))} y={MARGIN.top} width={Math.max(1, x(Math.min(end, window.end)) - x(Math.max(start, window.start)))} height={plotHeight} fill="url(#meteor-window)" opacity={0.25}>
							<title>{`Window ${formatClockTime(window.start, timeZone)}–${formatClockTime(window.end, timeZone)}`}</title>
						</rect>
					))}
					{GRID.map((degrees) => (
						<g key={degrees}>
							<line x1={MARGIN.left} x2={width - MARGIN.right} y1={y((degrees * Math.PI) / 180)} y2={y((degrees * Math.PI) / 180)} stroke="var(--color-line-100)" />
							<text x={MARGIN.left - 4} y={y((degrees * Math.PI) / 180)} dy="0.35em" textAnchor="end" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
								{degrees}°
							</text>
						</g>
					))}
					<line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(minimumAltitude)} y2={y(minimumAltitude)} stroke="var(--color-ink-300)" strokeDasharray="1 3">
						<title>Lowest radiant altitude</title>
					</line>
					{labels.map((time) => (
						<text key={time} x={x(time)} y={HEIGHT - 7} textAnchor="middle" fontSize={FONT_SIZE} fill="var(--color-ink-300)">
							{formatClockTime(time, timeZone)}
						</text>
					))}
					<path d={linePath(samples, x, y, (e) => e.moonAltitude)} fill="none" stroke="var(--color-ink-300)" strokeWidth={1.5} strokeDasharray="5 4" />
					<path d={linePath(samples, x, y, (e) => e.radiantAltitude)} fill="none" stroke={RADIANT} strokeWidth={2} />
					{windows.map((window) => window.bestTime >= start && window.bestTime <= end && <circle key={window.bestTime} cx={x(window.bestTime)} cy={y(window.maximumRadiantAltitude)} r={3.5} fill={RADIANT} />)}
					{sample && <line x1={x(sample.time)} x2={x(sample.time)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--color-ink-100)" strokeDasharray="1 3" />}
				</svg>
			</div>
			<figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-300">
				<span className="flex items-center gap-1.5">
					<Swatch stroke={RADIANT} />
					Radiant
				</span>
				<span className="flex items-center gap-1.5">
					<Swatch stroke="var(--color-ink-300)" dash="5 4" width={1.5} />
					Moon
				</span>
				<span className="flex items-center gap-1.5">
					<Swatch stroke="var(--color-ink-300)" dash="1 3" width={1} />
					Lowest radiant altitude
				</span>
				<span className="flex items-center gap-1.5">
					<svg width={12} height={10} className="flex-none">
						<rect width={12} height={10} fill="url(#meteor-window)" opacity={0.6} />
					</svg>
					Window
				</span>
			</figcaption>
			{sample && (
				<DataList>
					<DataRow label="Time">{formatClockTime(sample.time, timeZone)}</DataRow>
					<DataRow label="Radiant altitude">{sample.radiantAltitude === undefined ? 'No radiant' : sample.radiantAltitude < 0 ? 'Below the horizon' : formatDegrees(sample.radiantAltitude, 1)}</DataRow>
					<DataRow label="Sun altitude">{formatDegrees(sample.sunAltitude, 1)}</DataRow>
					<DataRow label="Moon altitude">{sample.moonAltitude < 0 ? 'Below the horizon' : formatDegrees(sample.moonAltitude, 1)}</DataRow>
				</DataList>
			)}
		</figure>
	)
}
