import type { ImageRect, ImageStatisticsReport, PlaneStatistics, StatisticsBackground } from 'api'
import { cn } from 'cn'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { isActive } from '../analysis'
import { formatCount, formatFixed, formatPercent, formatSampleValue, MISSING } from '../format'
import { collapsibleSections, sectionOpen } from '../shell/collapsible'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { DataList, DataRow } from '../ui/DataRow'
import { IconButton } from '../ui/IconButton'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { SegmentedControl } from '../ui/SegmentedControl'
import { type ImageDocument, imagesState, type ImageViewState, setStatisticsArea } from './images'
import { cancelStatistics, loadStatisticsResult, runStatistics, statisticsState, statisticsView } from './statistics'
import { startAreaSelection, statisticsAreaSelection, stopAreaSelection } from './statisticsArea'
import { StatisticsHistogram, type StatisticsHistogramSeries } from './StatisticsHistogram'

// Histogram and Statistics section of the Image Inspector: the statistics of the original samples of the document shown,
// whole or of an area drawn over the image, measured by the server (statistics.ts) only while the section is expanded.
// It leads with what is measured (the area, how to choose another, and measuring again), then the histogram of each
// plane (mono, RGB and luminance, or the four phases of a trusted CFA mosaic) over a robust or the full domain, linear or
// logarithmic, with one legend that picks the plane whose statistics and local background are listed and draws the
// others faint or not at all. Levels and dispersions are in ADU or the unit of the source, with the decimals of the
// plane's range; approximate order statistics, numeric limits, and an uncertain background say so. Changing the domain,
// the scale, the plane, or the zoom never measures again; a new image or area does.

// A plane of the statistics: mono, an RGB channel or their luminance, or a CFA phase.
type ImageStatisticsPlane = PlaneStatistics['plane']

// Id of the section, which keys its expanded state.
export const STATISTICS_SECTION = 'images.inspector.histogram-and-statistics'

// Short labels of the planes.
const PLANE_LABELS: Readonly<Record<ImageStatisticsPlane, string>> = { mono: 'Mono', red: 'R', green: 'G', blue: 'B', luminance: 'L', green1: 'G1', green2: 'G2' }

// Outline colors of the planes, and the dash of the second green of a mosaic, which its swatch repeats.
const PLANE_STROKES: Readonly<Record<ImageStatisticsPlane, readonly [stroke: string, dash?: string]>> = {
	mono: ['var(--color-ink-200)'],
	luminance: ['var(--color-ink-200)'],
	red: ['var(--color-channel-red)'],
	green: ['var(--color-channel-green)'],
	green1: ['var(--color-channel-green)'],
	green2: ['var(--color-channel-green)', '4 2'],
	blue: ['var(--color-channel-blue)'],
}

// Classes of the swatch of each plane in the legend: a short line in the color and dash of its outline.
const PLANE_SWATCHES: Readonly<Record<ImageStatisticsPlane, string>> = {
	mono: 'border-ink-200',
	luminance: 'border-ink-200',
	red: 'border-channel-red',
	green: 'border-channel-green',
	green1: 'border-channel-green',
	green2: 'border-channel-green border-dashed',
	blue: 'border-channel-blue',
}

// Histogram domains, with their labels.
type Domain = 'robust' | 'full'
const DOMAINS: readonly Domain[] = ['robust', 'full']
const DOMAIN_LABELS: Readonly<Record<Domain, string>> = { robust: 'Robust', full: 'Full range' }

// Count scales, with their labels.
type CountScale = 'linear' | 'log'
const COUNT_SCALES: readonly CountScale[] = ['linear', 'log']
const COUNT_SCALE_LABELS: Readonly<Record<CountScale, string>> = { linear: 'Linear', log: 'Log' }

// Names of the background states.
const BACKGROUND_STATUS_LABELS: Readonly<Record<StatisticsBackground['status'], string>> = { measured: 'Measured', uncertain: 'Uncertain', unavailable: 'Unavailable' }

// Tones of the background states: an uncertain estimate asks for attention, and only an unavailable one is a failure.
const BACKGROUND_TONES = { measured: 'default', uncertain: 'warning', unavailable: 'danger' } as const satisfies Record<StatisticsBackground['status'], 'default' | 'warning' | 'danger'>

// Meaning of each background warning.
const BACKGROUND_WARNINGS: Readonly<Record<StatisticsBackground['warnings'][number], string>> = {
	insufficientBackground: 'Too few clean background tiles.',
	strongStructure: 'Extended structure or a dense field dominates the area.',
	strongGradient: 'The background varies by many sigmas across the area.',
	heavyClipping: 'Many samples sit at a numeric limit.',
	nonFinite: 'NaN or infinite samples were skipped.',
	constant: 'Every background sample has the same value.',
	quantized: 'The dispersion is below one code: the noise is a lower bound.',
	correlatedNoisePossible: 'Neighboring pixels are correlated (debayered, resampled, or denoised): the noise is underestimated.',
}

// Explanation of the background estimate.
const BACKGROUND_HINT = 'Spatial estimate from local tiles: stars are clipped and a local gradient removed. It is not a read noise, and correlated pixels bias it low.'

export interface ImageStatisticsSectionProps {
	// Document shown.
	readonly document: ImageDocument
	// Its view.
	readonly view?: ImageViewState
}

// Histogram and Statistics section of a document.
export function ImageStatisticsSection({ document, view }: ImageStatisticsSectionProps) {
	const open = sectionOpen(useSnapshot(collapsibleSections), STATISTICS_SECTION, false)
	const state = useSnapshot(statisticsState)
	const selecting = useSnapshot(statisticsAreaSelection).documentKey === document.key
	const imageId = document.status === 'ready' ? document.info?.id : undefined
	const area = view?.statistics.area
	const areaKey = area && `${area.left},${area.top},${area.width},${area.height}`
	const { job, result, error, due } = statisticsView(state, document.key, imageId, area, open)
	const active = isActive(job)
	const [choices, setChoices] = useState<HistogramChoices>(DEFAULT_CHOICES)
	const { info } = document

	// The section measures the image shown once it is expanded, and the next one as soon as the previous scan ends.
	useEffect(() => {
		if (due && imageId) void runStatistics(statisticsState, document.key, imageId, area && { ...area })
	}, [due, imageId, areaKey, document.key])

	useEffect(() => {
		if (open && job?.state === 'completed' && !result) void loadStatisticsResult(statisticsState, job.jobId)
	}, [open, job?.jobId, job?.state, result])

	const summary = job?.summary ? `Median ${formatSampleValue(job.summary.median ?? Number.NaN)} · σ ${formatSampleValue(job.summary.standardDeviation ?? Number.NaN)}` : active ? 'Measuring…' : 'Not measured'
	const recalculate = () => imageId && void runStatistics(statisticsState, document.key, imageId, area && { ...area })

	return (
		<CollapsibleSection id={STATISTICS_SECTION} title="Histogram and Statistics" summary={summary} defaultOpen={false}>
			{!imageId || !info ? (
				<Notice>{document.status === 'loading' ? 'Opening…' : 'The image is unavailable.'}</Notice>
			) : (
				<>
					<DataRow label="Area" actions={active && job ? <IconButton icon="stop" label="Cancel the measurement" onClick={() => void cancelStatistics(job.jobId)} /> : <IconButton icon="refresh" label="Measure again" onClick={recalculate} />}>
						{result ? formatArea(result.area, result.width, result.height) : formatArea(area, info.width, info.height)}
					</DataRow>
					<Actions>
						<Button variant="secondary" disabled={view?.overlaysHidden === true} title={view?.overlaysHidden ? 'Show the overlays to draw an area.' : 'Drag over the image to choose the pixels measured.'} onClick={() => (selecting ? stopAreaSelection() : startAreaSelection(document.key))}>
							{selecting ? 'Cancel Selection' : 'Select Area'}
						</Button>
						<Button variant="secondary" disabled={!area} title={area ? undefined : 'The whole image is measured.'} onClick={() => setStatisticsArea(imagesState, document.key, undefined)}>
							Whole Image
						</Button>
					</Actions>
					{view?.statistics.areaDropped && <Notice>The area was cleared: the frame shown has another size.</Notice>}
					{error && <Notice error>{error}</Notice>}
					{active && <Notice>Measuring{job?.state === 'queued' ? ' (queued)' : ''}…</Notice>}
					{result && <StatisticsBody key={result.jobId} result={result} choices={choices} onChoices={setChoices} />}
				</>
			)}
		</CollapsibleSection>
	)
}

// Returns the area measured as text: the whole image with its size, or the size of a rectangle and its top-left corner,
// in image pixels.
function formatArea(area: ImageRect | undefined, width: number, height: number) {
	if (!area || (area.left === 0 && area.top === 0 && area.width === width && area.height === height)) return `Whole image, ${width} × ${height} px`
	return `${area.width} × ${area.height} px at x ${area.left}, y ${area.top}`
}

// How the histogram and the statistics are shown, kept by the section across results, so a new frame or area keeps them.
interface HistogramChoices {
	// Domain of the histogram.
	readonly domain: Domain
	// Scale of the counts.
	readonly scale: CountScale
	// Whether only the selected plane is drawn; the others are drawn faint otherwise.
	readonly isolated: boolean
	// Plane whose statistics are listed and whose outline stands out; the first plane of a result without it.
	readonly selected?: ImageStatisticsPlane
}

// Choices of a section that was never changed: logarithmic counts, under which the faint wings of the distribution
// stay visible beside the peak of the sky background.
const DEFAULT_CHOICES: HistogramChoices = { domain: 'robust', scale: 'log', isolated: false }

interface StatisticsBodyProps {
	// Result shown.
	readonly result: ImageStatisticsReport
	// How it is shown.
	readonly choices: HistogramChoices
	// Called with changed choices.
	readonly onChoices: (choices: HistogramChoices) => void
}

// Histogram, its legend and options, and the statistics and background of the selected plane of a result. The zoom
// belongs to the result, whose values it spans.
function StatisticsBody({ result, choices, onChoices }: StatisticsBodyProps) {
	const { domain, scale, isolated, selected } = choices
	const [zoom, setZoom] = useState<readonly [number, number]>()
	const plane = result.planes.find((p) => p.plane === selected) ?? result.planes[0]
	const unit = result.unit === 'adu' ? 'ADU' : 'source units'
	const several = result.planes.length > 1
	const series: StatisticsHistogramSeries[] = result.planes.flatMap((p) => {
		const histogram = p.histograms?.[domain]
		const current = p.plane === plane?.plane
		if (!histogram || (isolated && !current)) return []
		const [stroke, dash] = PLANE_STROKES[p.plane]
		return [{ label: PLANE_LABELS[p.plane], stroke, dash, muted: several && !current, histogram }]
	})
	const format = plane ? sampleFormat(plane) : sample

	return (
		<>
			{series.length > 0 ? <StatisticsHistogram series={series} log={scale === 'log'} zoom={zoom} onZoom={setZoom} /> : <Notice>No finite samples to draw.</Notice>}
			{several && plane && (
				<div className="flex items-end gap-2">
					<SegmentedControl
						className="flex-1"
						options={result.planes.map((p) => p.plane)}
						value={plane.plane}
						format={(p) => (
							<span className="inline-flex items-center gap-1.5">
								<span className={cn('w-3 border-t-2', PLANE_SWATCHES[p])} />
								{PLANE_LABELS[p]}
							</span>
						)}
						onChange={(next) => onChoices({ ...choices, selected: next })}
					/>
					<IconButton icon="eyeOff" label={isolated ? 'Draw every plane' : `Draw only ${PLANE_LABELS[plane.plane]}`} pressed={isolated} onClick={() => onChoices({ ...choices, isolated: !isolated })} />
				</div>
			)}
			<div className="flex flex-wrap items-end gap-2">
				<SegmentedControl
					options={DOMAINS}
					value={domain}
					format={(d) => DOMAIN_LABELS[d]}
					onChange={(d) => {
						onChoices({ ...choices, domain: d })
						setZoom(undefined)
					}}
				/>
				<SegmentedControl className="flex-1" options={COUNT_SCALES} value={scale} format={(s) => COUNT_SCALE_LABELS[s]} onChange={(s) => onChoices({ ...choices, scale: s })} />
				{zoom && (
					<Button variant="secondary" onClick={() => setZoom(undefined)}>
						Reset Zoom
					</Button>
				)}
			</div>
			<DataRow label="Unit">{result.rescaled ? `${unit} (rescaled read)` : unit}</DataRow>
			{result.mosaic === 'untrusted' && <Notice>The header names a CFA pattern that is not trusted: the mosaic is measured as one plane, mixing its colors.</Notice>}
			{result.mosaic === 'trusted' && <Notice>Raw mosaic: each photosite phase is measured apart, never debayered.</Notice>}
			{plane && <PlaneRows plane={plane} domain={domain} format={format} />}
			{plane?.background && <BackgroundRows background={plane.background} format={format} />}
		</>
	)
}

// Formats a sample value, or MISSING when it is absent.
type SampleFormat = (value: number | undefined) => string

// Returns a sample value with its significant digits, or MISSING when it is absent.
function sample(value: number | undefined) {
	return value === undefined ? MISSING : formatSampleValue(value)
}

// Returns the format of the sample values of a plane: a fixed number of decimals that keeps six significant digits of
// the largest magnitude of its range, so the levels and dispersions of one plane align on their decimal point; the
// significant digits of each value when that range is empty, not finite, or needs an exponent.
function sampleFormat(plane: PlaneStatistics): SampleFormat {
	const size = Math.max(Math.abs(plane.min ?? 0), Math.abs(plane.max ?? 0))
	if (!Number.isFinite(size) || size === 0 || size >= 1e7 || size < 1e-4) return sample
	const decimals = Math.min(6, Math.max(0, 5 - Math.floor(Math.log10(size))))
	return (value) => (value === undefined ? MISSING : Number.isFinite(value) ? formatFixed(value, decimals).replace(/^-/, '−') : formatSampleValue(value))
}

// Names of the ways the order statistics were obtained.
function quantileLabel({ quantileMethod, quantileSamples }: PlaneStatistics) {
	if (quantileMethod === 'exact') return 'Exact'
	if (quantileMethod === 'binned') return 'Binned to integer codes'
	return `Estimated from ${formatCount(quantileSamples)} samples`
}

interface PlaneRowsProps {
	// Statistics of the plane.
	readonly plane: PlaneStatistics
	// Domain of the histogram shown, whose samples outside it are counted.
	readonly domain: Domain
	// Format of its sample values.
	readonly format: SampleFormat
}

// Statistics of one plane.
function PlaneRows({ plane, domain, format }: PlaneRowsProps) {
	const approximate = plane.quantileMethod !== 'exact' ? '≈ ' : ''
	const histogram = plane.histograms?.[domain]

	return (
		<DataList>
			<DataRow label="Valid samples">{formatCount(plane.finiteCount)}</DataRow>
			{plane.nonFiniteCount > 0 && (
				<DataRow label="NaN or infinite" tone="danger">
					{formatCount(plane.nonFiniteCount)}
				</DataRow>
			)}
			<DataRow label="Min / Max">
				{format(plane.min)} / {format(plane.max)}
			</DataRow>
			<DataRow label="Mean">{format(plane.mean)}</DataRow>
			<DataRow label="Std. deviation">{format(plane.standardDeviation)}</DataRow>
			<DataRow label="Median">
				{approximate}
				{format(plane.median)}
			</DataRow>
			<DataRow label="MAD / Robust σ">
				{approximate}
				{format(plane.mad)} / {format(plane.robustSigma)}
			</DataRow>
			<DataRow label="P1 / P99">
				{approximate}
				{format(plane.p01)} / {format(plane.p99)}
			</DataRow>
			<DataRow label="Median and percentiles">{quantileLabel(plane)}</DataRow>
			{plane.numericLimits && (
				<DataRow label="At numeric limits">
					{formatCount(plane.numericLimits.lowCount)} at {formatSampleValue(plane.numericLimits.low)} · {formatCount(plane.numericLimits.highCount)} at {formatSampleValue(plane.numericLimits.high)}
				</DataRow>
			)}
			{histogram && (histogram.belowDomain > 0 || histogram.aboveDomain > 0) && (
				<DataRow label="Outside the histogram">
					{formatCount(histogram.belowDomain)} below / {formatCount(histogram.aboveDomain)} above
				</DataRow>
			)}
		</DataList>
	)
}

interface BackgroundRowsProps {
	// Local background of the plane.
	readonly background: StatisticsBackground
	// Format of the sample values of the plane.
	readonly format: SampleFormat
}

// Local background of one plane, with what makes its estimate uncertain as one block of short lines.
function BackgroundRows({ background, format }: BackgroundRowsProps) {
	const { status, level, noiseSigma, usedTiles, totalTiles, rejectedFraction, gradientIndicator, warnings } = background

	return (
		<>
			<SectionHeading className="mt-1">Background</SectionHeading>
			<DataList>
				<DataRow label="Estimate" tone={BACKGROUND_TONES[status]}>
					{BACKGROUND_STATUS_LABELS[status]}
				</DataRow>
				<DataRow label="Level">{format(level)}</DataRow>
				<DataRow label="Noise σ">{format(noiseSigma)}</DataRow>
				<DataRow label="Coverage">
					{usedTiles} / {totalTiles} tiles{rejectedFraction === undefined ? '' : `, ${formatPercent(rejectedFraction)} rejected`}
				</DataRow>
				{gradientIndicator !== undefined && <DataRow label="Gradient">{formatSampleValue(gradientIndicator)} σ</DataRow>}
			</DataList>
			{warnings.length > 0 && (
				<div className="flex flex-col gap-0.5 text-sm leading-5 text-pretty text-warning">
					{warnings.map((warning) => (
						<p key={warning} className="m-0">
							{BACKGROUND_WARNINGS[warning]}
						</p>
					))}
				</div>
			)}
			<Notice>{BACKGROUND_HINT}</Notice>
		</>
	)
}
