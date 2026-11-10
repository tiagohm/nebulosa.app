import type { ImageStatisticsReport, PlaneStatistics, StatisticsBackground } from 'api'
import { useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { isActive } from '../analysis'
import { formatCount, formatPercent, formatSampleValue, MISSING } from '../format'
import { collapsibleSections, sectionOpen } from '../shell/collapsible'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataList, DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { SegmentedControl } from '../ui/SegmentedControl'
import { type ImageDocument, imagesState, type ImageViewState, setStatisticsArea } from './images'
import { pixelInspection } from './pixeltiles'
import { cancelStatistics, loadStatisticsResult, runStatistics, statisticsState, statisticsView } from './statistics'
import { startAreaSelection, statisticsAreaSelection, stopAreaSelection } from './statisticsArea'
import { StatisticsHistogram, type StatisticsHistogramSeries } from './StatisticsHistogram'

// Histogram and Statistics section of the Image Inspector: the statistics of the original samples of the document shown,
// whole or of an area drawn over the image, measured by the server (statistics.ts) only while the section is expanded.
// It shows the histogram of each plane (mono, RGB and luminance, or the four phases of a trusted CFA mosaic) over a
// robust or the full domain, linear or logarithmic, the statistics of one plane, and its local background. Levels and
// dispersions are in ADU or the unit of the source; approximate order statistics, numeric limits, and an uncertain
// background say so. Changing the domain, the scale, the planes drawn, or the zoom never measures again; a new image or
// area does. Inspect Pixels shows the native samples under the pointer in the viewer status line (PixelCursorStatus).

// A plane of the statistics: mono, an RGB channel or their luminance, or a CFA phase.
type ImageStatisticsPlane = PlaneStatistics['plane']

// Id of the section, which keys its expanded state.
export const STATISTICS_SECTION = 'images.inspector.histogram-and-statistics'

// Short labels of the planes.
const PLANE_LABELS: Readonly<Record<ImageStatisticsPlane, string>> = { mono: 'Mono', red: 'R', green: 'G', blue: 'B', luminance: 'L', green1: 'G1', green2: 'G2' }

// Outline colors of the planes, and the dash of the second green of a mosaic.
const PLANE_STROKES: Readonly<Record<ImageStatisticsPlane, readonly [stroke: string, dash?: string]>> = {
	mono: ['var(--color-ink-200)'],
	luminance: ['var(--color-ink-200)'],
	red: ['var(--color-danger)'],
	green: ['var(--color-success)'],
	green1: ['var(--color-success)'],
	green2: ['var(--color-success)', '3 2'],
	blue: ['var(--color-info)'],
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
	const inspectPixels = useSnapshot(pixelInspection).enabled
	const [choices, setChoices] = useState<HistogramChoices>(DEFAULT_CHOICES)

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
			{!imageId ? (
				<Notice>{document.status === 'loading' ? 'Opening…' : 'Unavailable'}</Notice>
			) : (
				<>
					{view?.statistics.areaDropped && <Notice>The area was cleared: the frame shown has another size.</Notice>}
					{error && <Notice error>{error}</Notice>}
					{active && <Notice>Measuring{job?.state === 'queued' ? ' (queued)' : ''}…</Notice>}
					{result && <StatisticsBody key={result.jobId} result={result} choices={choices} onChoices={setChoices} />}
					<Actions>
						<Button variant="secondary" disabled={view?.overlaysHidden === true} title={view?.overlaysHidden ? 'Show the overlays to draw an area.' : 'Drag over the image to choose the pixels measured.'} onClick={() => (selecting ? stopAreaSelection() : startAreaSelection(document.key))}>
							{selecting ? 'Cancel Selection' : 'Select Area'}
						</Button>
						<Button variant="secondary" disabled={!area} onClick={() => setStatisticsArea(imagesState, document.key, undefined)}>
							Whole Image
						</Button>
						{active && job ? (
							<Button variant="secondary" onClick={() => void cancelStatistics(job.jobId)}>
								Cancel
							</Button>
						) : (
							<Button variant="secondary" onClick={recalculate}>
								Recalculate
							</Button>
						)}
					</Actions>
					{selecting && <Notice>Drag over the image to draw the area; Escape cancels.</Notice>}
					<Checkbox label="Inspect pixels: native samples under the pointer in the status line" checked={inspectPixels} onChange={(checked) => (pixelInspection.enabled = checked)} />
				</>
			)}
		</CollapsibleSection>
	)
}

// How the histogram and the statistics are shown, kept by the section across results, so a new frame or area keeps them.
interface HistogramChoices {
	// Domain of the histogram.
	readonly domain: Domain
	// Scale of the counts.
	readonly scale: CountScale
	// Planes left out of the histogram.
	readonly hidden: ReadonlySet<ImageStatisticsPlane>
	// Plane whose statistics are listed; the first plane of a result without it.
	readonly selected?: ImageStatisticsPlane
}

// Choices of a section that was never changed.
const DEFAULT_CHOICES: HistogramChoices = { domain: 'robust', scale: 'linear', hidden: new Set() }

interface StatisticsBodyProps {
	// Result shown.
	readonly result: ImageStatisticsReport
	// How it is shown.
	readonly choices: HistogramChoices
	// Called with changed choices.
	readonly onChoices: (choices: HistogramChoices) => void
}

// Histogram, statistics, and background of a result. The zoom belongs to the result, whose values it spans.
function StatisticsBody({ result, choices, onChoices }: StatisticsBodyProps) {
	const { domain, scale, hidden, selected } = choices
	const [zoom, setZoom] = useState<readonly [number, number]>()
	const setDomain = (next: Domain) => onChoices({ ...choices, domain: next })
	const setScale = (next: CountScale) => onChoices({ ...choices, scale: next })
	const setHidden = (next: ReadonlySet<ImageStatisticsPlane>) => onChoices({ ...choices, hidden: next })
	const setSelected = (next: ImageStatisticsPlane) => onChoices({ ...choices, selected: next })
	const plane = result.planes.find((p) => p.plane === selected) ?? result.planes[0]
	const unit = result.unit === 'adu' ? 'ADU' : 'source units'
	const { area } = result
	const whole = area.left === 0 && area.top === 0 && area.width === result.width && area.height === result.height
	const series: StatisticsHistogramSeries[] = result.planes.flatMap((p) => {
		const histogram = p.histograms?.[domain]
		if (!histogram || hidden.has(p.plane)) return []
		const [stroke, dash] = PLANE_STROKES[p.plane]
		return [{ label: PLANE_LABELS[p.plane], stroke, dash, histogram }]
	})

	return (
		<>
			{series.length > 0 ? <StatisticsHistogram series={series} log={scale === 'log'} zoom={zoom} onZoom={setZoom} /> : <Notice>No finite samples to draw.</Notice>}
			<div className="flex flex-wrap items-end gap-2">
				<SegmentedControl
					options={DOMAINS}
					value={domain}
					format={(d) => DOMAIN_LABELS[d]}
					onChange={(d) => {
						setDomain(d)
						setZoom(undefined)
					}}
				/>
				<SegmentedControl className="flex-1" options={COUNT_SCALES} value={scale} format={(s) => COUNT_SCALE_LABELS[s]} onChange={setScale} />
				{zoom && (
					<Button variant="ghost" onClick={() => setZoom(undefined)}>
						Reset Zoom
					</Button>
				)}
			</div>
			{result.planes.length > 1 && (
				<div className="flex flex-wrap gap-x-3 gap-y-1">
					{result.planes.map((p) => (
						<Checkbox
							key={p.plane}
							label={PLANE_LABELS[p.plane]}
							checked={!hidden.has(p.plane)}
							onChange={(checked) => {
								const next = new Set(hidden)
								if (checked) next.delete(p.plane)
								else next.add(p.plane)
								setHidden(next)
							}}
						/>
					))}
				</div>
			)}
			<DataList>
				<DataRow label="Area">{whole ? `Whole image, ${result.width} × ${result.height} px` : `${area.left}, ${area.top} · ${area.width} × ${area.height} px`}</DataRow>
				<DataRow label="Unit">{result.rescaled ? `${unit} (rescaled read)` : unit}</DataRow>
			</DataList>
			{result.mosaic === 'untrusted' && <Notice>The header names a CFA pattern that is not trusted: the mosaic is measured as one plane, mixing its colors.</Notice>}
			{result.mosaic === 'trusted' && <Notice>Raw mosaic: each photosite phase is measured apart, never debayered.</Notice>}
			{result.planes.length > 1 && <SegmentedControl options={result.planes.map((p) => p.plane)} value={plane.plane} format={(p) => PLANE_LABELS[p]} onChange={setSelected} />}
			{plane && <PlaneRows plane={plane} domain={domain} />}
			{plane?.background && <BackgroundRows background={plane.background} />}
		</>
	)
}

// Returns a sample value, or MISSING when it is absent.
function sample(value: number | undefined) {
	return value === undefined ? MISSING : formatSampleValue(value)
}

// Names of the ways the order statistics were obtained.
function quantileLabel({ quantileMethod, quantileSamples }: PlaneStatistics) {
	if (quantileMethod === 'exact') return 'Exact'
	if (quantileMethod === 'binned') return 'Binned to integer codes'
	return `Estimated from ${formatCount(quantileSamples)} samples`
}

// Statistics of one plane.
function PlaneRows({ plane, domain }: { readonly plane: PlaneStatistics; readonly domain: Domain }) {
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
				{sample(plane.min)} / {sample(plane.max)}
			</DataRow>
			<DataRow label="Mean">{sample(plane.mean)}</DataRow>
			<DataRow label="Std. deviation">{sample(plane.standardDeviation)}</DataRow>
			<DataRow label="Median">
				{approximate}
				{sample(plane.median)}
			</DataRow>
			<DataRow label="MAD / Robust σ">
				{approximate}
				{sample(plane.mad)} / {sample(plane.robustSigma)}
			</DataRow>
			<DataRow label="P1 / P99">
				{approximate}
				{sample(plane.p01)} / {sample(plane.p99)}
			</DataRow>
			<DataRow label="Order statistics">{quantileLabel(plane)}</DataRow>
			{plane.numericLimits && (
				<DataRow label={`At numeric limit (${formatSampleValue(plane.numericLimits.low)} / ${formatSampleValue(plane.numericLimits.high)})`}>
					{formatCount(plane.numericLimits.lowCount)} / {formatCount(plane.numericLimits.highCount)}
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

// Local background of one plane.
function BackgroundRows({ background }: { readonly background: StatisticsBackground }) {
	const { status, level, noiseSigma, usedTiles, totalTiles, rejectedFraction, gradientIndicator, warnings } = background

	return (
		<>
			<span title={BACKGROUND_HINT}>
				<SectionHeading className="mt-1">Background</SectionHeading>
			</span>
			<DataList>
				<DataRow label="Estimate" tone={status === 'measured' ? 'default' : 'danger'}>
					{BACKGROUND_STATUS_LABELS[status]}
				</DataRow>
				<DataRow label="Level">{sample(level)}</DataRow>
				<DataRow label="Noise σ">{sample(noiseSigma)}</DataRow>
				<DataRow label="Coverage">
					{usedTiles} / {totalTiles} tiles{rejectedFraction === undefined ? '' : `, ${formatPercent(rejectedFraction)} rejected`}
				</DataRow>
				{gradientIndicator !== undefined && <DataRow label="Gradient">{formatSampleValue(gradientIndicator)} σ</DataRow>}
			</DataList>
			{warnings.map((warning) => (
				<p key={warning} className="m-0 text-xs text-warning">
					{BACKGROUND_WARNINGS[warning]}
				</p>
			))}
			<Notice>{BACKGROUND_HINT}</Notice>
		</>
	)
}
