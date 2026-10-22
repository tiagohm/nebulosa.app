import type { StarDetectionJob, StarDetectionRequest, StarDetectionResult } from 'api'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { Actions, Notice } from '../equipment-control/parts'
import { externalToolsState } from '../settings/externaltools'
import { summaryOf } from '../settings/ExternalToolStatus'
import { PanelSection } from '../shell/ContextualPanel'
import { navigate, routeState } from '../shell/route'
import { EmptyState } from '../shell/WorkspaceLayout'
import { BUILTIN_STAR_LIMIT, cancelDetection, isActive, PROVIDER_LABELS, PROVIDERS, runDetection, sameRequest, starsState } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { NumberInput } from '../ui/NumberInput'
import { SegmentedControl } from '../ui/SegmentedControl'
import { editStarAcceptance, editStarDetector, type ImageStarsState, imagesState, setStarDetector, setStarMarkers } from './images'
import type { ImageToolPanelProps } from './tools'

// Star Detection tool of the Images workspace: runs a detection of the active document on the server with
// the built-in detector or ASTAP, and shows the outcome, the aggregate HFD, the star selected in the viewer,
// and how the markers are drawn. Settings are edited as the document's pending request and sent only by Run
// Detection; a result always belongs to the image it measured. ASTAP's executable and timeout are not set
// here but in Settings → External Tools, which the detector section links to.

// Text shown for a value the result does not have.
const MISSING = '—'

// Display names of the job states.
const STATE_LABELS: Readonly<Record<StarDetectionJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped' }

// Star Detection panel of the active document.
export function StarDetectionPanel({ document, view, onOpen }: ImageToolPanelProps) {
	if (!document) {
		return (
			<EmptyState
				title="No image open"
				action={
					<Button variant="secondary" onClick={onOpen}>
						Open Image
					</Button>
				}
			/>
		)
	}

	if (!document.info || !view) {
		return (
			<PanelSection title="Star Detection">
				<p className="m-0 text-ink-300">{document.status === 'loading' ? 'Opening…' : 'The image is unavailable.'}</p>
			</PanelSection>
		)
	}

	return <StarDetection documentKey={document.key} imageId={document.info.id} stars={view.stars} />
}

interface StarDetectionProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of its image.
	readonly imageId: string
	// Star detection request and markers of the document.
	readonly stars: ImageStarsState
}

// Sections of the Star Detection panel of an opened image.
function StarDetection({ documentKey, imageId, stars }: StarDetectionProps) {
	const { job, result, resultError } = useStarResult(imageId)
	const { submitErrors } = useSnapshot(starsState)
	const { request } = stars
	const selected = result && stars.selected?.jobId === result.jobId ? result.stars[stars.selected.index] : undefined

	return (
		<>
			<Detector documentKey={documentKey} request={request} />
			<DetectionSettings documentKey={documentKey} request={request} />
			<Acceptance documentKey={documentKey} request={request} />
			<Analysis imageId={imageId} request={request} job={job} submitError={submitErrors[imageId]} />
			<Results job={job} result={result} resultError={resultError} />
			<SelectedStar star={selected} />
			<PanelSection title="Visualization">
				<Checkbox label="Show stars" checked={stars.visible} onChange={(visible) => setStarMarkers(imagesState, documentKey, { visible })} />
				<Checkbox label="Accepted stars only" checked={stars.acceptedOnly} disabled={!stars.visible} onChange={(acceptedOnly) => setStarMarkers(imagesState, documentKey, { acceptedOnly })} />
				<Notice>Click a star in the image to inspect it. Showing or hiding the markers never runs a detection.</Notice>
			</PanelSection>
		</>
	)
}

interface RequestProps {
	// Key of the document.
	readonly documentKey: string
	// Pending request of the document.
	readonly request: StarDetectionRequest
}

// Choice of the detector, with the availability of ASTAP.
function Detector({ documentKey, request }: RequestProps) {
	return (
		<PanelSection title="Detector">
			<SegmentedControl options={PROVIDERS} value={request.detector.provider} format={(provider) => PROVIDER_LABELS[provider]} onChange={(provider) => setStarDetector(imagesState, documentKey, provider)} />
			{request.detector.provider === 'astap' && <AstapAvailability />}
		</PanelSection>
	)
}

// Whether ASTAP can be used, as the server's External Tools settings report it, with a link to them.
export function AstapAvailability() {
	const { tools } = useSnapshot(externalToolsState)
	const astap = tools.find((tool) => tool.id === 'astap')
	const summary = astap && summaryOf(astap)

	return (
		<div className="flex flex-col gap-1">
			<p className="m-0 text-xs leading-4 text-ink-300">
				ASTAP: <span className={summary?.className}>{summary?.label ?? 'Loading…'}</span>
				{astap?.lastCheck && astap.lastCheck.status !== 'available' && ` — ${astap.lastCheck.message}`}
			</p>
			<Button variant="ghost" size="sm" className="self-start px-1" onClick={() => navigate(routeState, { workspace: 'settings', tool: 'astap' })}>
				Settings → External Tools → ASTAP
			</Button>
		</div>
	)
}

// Settings of the selected detector.
function DetectionSettings({ documentKey, request }: RequestProps) {
	const { detector } = request

	return (
		<PanelSection title="Detection Settings">
			{detector.provider === 'builtin' ? (
				<>
					<NumberInput label="Max stars" value={detector.maxStars} min={1} max={BUILTIN_STAR_LIMIT} onChange={(maxStars) => editStarDetector(imagesState, documentKey, { maxStars })} />
					<NumberInput label="Min SNR" value={detector.minSNR} min={0} step={0.5} onChange={(minSNR) => editStarDetector(imagesState, documentKey, { minSNR })} />
					<NumberInput label="Search region" value={detector.searchRegion} min={0} max={500} suffix="px" onChange={(searchRegion) => editStarDetector(imagesState, documentKey, { searchRegion })} />
					<Notice>Search region removes pairs of similar stars closer than it; 0 keeps every star.</Notice>
				</>
			) : (
				<>
					<NumberInput label="Max stars" value={detector.maxStars} min={0} max={100000} onChange={(maxStars) => editStarDetector(imagesState, documentKey, { maxStars })} />
					<NumberInput label="Min SNR" value={detector.minSNR} min={0} max={1000} onChange={(minSNR) => editStarDetector(imagesState, documentKey, { minSNR })} />
					<Notice>Max stars 0 keeps every star ASTAP extracts.</Notice>
				</>
			)}
		</PanelSection>
	)
}

// Criteria of the stars entering the aggregate HFD.
function Acceptance({ documentKey, request }: RequestProps) {
	const { acceptance } = request

	return (
		<PanelSection title="Acceptance">
			<NumberInput label="Min SNR" value={acceptance.minSNR} min={0} step={0.5} onChange={(minSNR) => editStarAcceptance(imagesState, documentKey, { minSNR })} />
			<NumberInput label="Min HFD" value={acceptance.minHfd} min={0} step={0.1} suffix="px" onChange={(minHfd) => editStarAcceptance(imagesState, documentKey, { minHfd })} />
			<NumberInput label="Max HFD" value={acceptance.maxHfd} min={0} step={0.1} suffix="px" onChange={(maxHfd) => editStarAcceptance(imagesState, documentKey, { maxHfd })} />
			<NumberInput label="Edge margin" value={acceptance.edgeMargin} min={0} suffix="px" onChange={(edgeMargin) => editStarAcceptance(imagesState, documentKey, { edgeMargin })} />
			<Notice>Max HFD 0 sets no upper limit. Saturation is not checked.</Notice>
		</PanelSection>
	)
}

interface AnalysisProps {
	// Server id of the image.
	readonly imageId: string
	// Pending request of the document.
	readonly request: StarDetectionRequest
	// Latest job of the image.
	readonly job?: StarDetectionJob
	// Why the latest submission failed.
	readonly submitError?: string
}

// Run and Cancel, with the state of the latest job.
function Analysis({ imageId, request, job, submitError }: AnalysisProps) {
	const { tools } = useSnapshot(externalToolsState)
	const active = isActive(job)
	const now = useNow(active)
	const astapReady = request.detector.provider !== 'astap' || tools.find((tool) => tool.id === 'astap')?.status === 'configured'
	const changed = job && !sameRequest(job.request, request)

	return (
		<PanelSection title="Analysis">
			<Actions>
				<Button disabled={active || !astapReady} onClick={() => void runDetection(starsState, imageId, request)}>
					Run Detection
				</Button>
				<Button variant="secondary" disabled={!active || !job} onClick={() => job && void cancelDetection(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{!astapReady && <Notice error>ASTAP is not configured.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{job ? (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					{job.error && <Notice error>{job.error}</Notice>}
					{changed && <Notice>The settings changed since this detection; run it again to apply them.</Notice>}
				</>
			) : (
				<Notice>No detection of this image yet.</Notice>
			)}
		</PanelSection>
	)
}

interface ResultsProps {
	// Latest job of the image.
	readonly job?: StarDetectionJob
	// Its result, once fetched.
	readonly result?: StarDetectionResult
	// Why its result could not be fetched.
	readonly resultError?: string
}

// Counts and aggregate HFD of the latest completed job.
function Results({ job, result, resultError }: ResultsProps) {
	const summary = job?.summary

	return (
		<PanelSection title="Results">
			{summary ? (
				<>
					<Property label="Detector">{PROVIDER_LABELS[job.request.detector.provider]}</Property>
					<Property label="Detected stars">{summary.detectedCount}</Property>
					<Property label="Accepted stars">{summary.acceptedCount}</Property>
					<Property label="Aggregate HFD">{summary.measurement === 'ok' && summary.aggregateHfd !== undefined ? `${summary.aggregateHfd.toFixed(2)} px` : MISSING}</Property>
					<Property label="Duration">{formatSeconds(summary.elapsed)}</Property>
					{summary.measurement === 'noStars' && <Notice>No stars were detected in this image.</Notice>}
					{summary.measurement === 'unavailable' && <Notice>Too few stars were accepted for an aggregate HFD.</Notice>}
					{result?.warnings.map((warning) => (
						<Notice key={warning}>{warning}</Notice>
					))}
					{resultError && <Notice error>{resultError}</Notice>}
				</>
			) : (
				<Notice>{job && isActive(job) ? 'Detecting…' : 'No results.'}</Notice>
			)}
		</PanelSection>
	)
}

// Measurements of the star selected in the viewer.
function SelectedStar({ star }: { readonly star?: DetectedStar }) {
	return (
		<PanelSection title="Selected Star">
			{star ? (
				<>
					<Property label="X">{star.x.toFixed(2)} px</Property>
					<Property label="Y">{star.y.toFixed(2)} px</Property>
					<Property label="HFD">{star.hfd.toFixed(2)} px</Property>
					<Property label="SNR">{star.snr.toFixed(1)}</Property>
					<Property label="Flux">{formatFlux(star.flux)}</Property>
				</>
			) : (
				<Notice>No star selected.</Notice>
			)}
		</PanelSection>
	)
}

interface PropertyProps {
	// Property name.
	readonly label: string
	// Property value.
	readonly children: ReactNode
}

// Name and value of a property.
function Property({ label, children }: PropertyProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-xs text-ink-300">{label}</span>
			<span className="min-w-0 text-right text-ink-100 tabular-nums">{children}</span>
		</div>
	)
}

// Returns the current time in Unix milliseconds, refreshed every second while running.
function useNow(running: boolean): number {
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		if (!running) return
		setNow(Date.now())
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [running])

	return now
}

// Returns how long a job ran, or has been running, in milliseconds; 0 while it waits.
function elapsedOf(job: StarDetectionJob, now: number): number {
	if (job.summary) return job.summary.elapsed
	if (job.startedAt === undefined) return 0
	return (job.endedAt ?? now) - job.startedAt
}

// Returns a duration in milliseconds as seconds with two decimals below 10 s, one above.
function formatSeconds(milliseconds: number): string {
	const seconds = milliseconds / 1000
	return `${seconds < 10 ? seconds.toFixed(2) : seconds.toFixed(1)} s`
}

// Returns a flux with four significant digits, in exponential notation when large or small.
function formatFlux(flux: number): string {
	return flux !== 0 && (Math.abs(flux) >= 1e5 || Math.abs(flux) < 1e-2) ? flux.toExponential(3) : flux.toPrecision(4)
}
