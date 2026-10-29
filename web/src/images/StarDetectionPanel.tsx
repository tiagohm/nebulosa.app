import type { StarDetectionJob, StarDetectionRequest, StarDetectionResult } from 'api'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import { type ReactNode, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { isActive } from '../analysis'
import { Actions, Notice } from '../equipment-control/parts'
import { activeProfile, profileState, setStarDetectionSettings, starDetectionSettings } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import { AcceptanceControls, DetectorControls, DetectorSettingsControls, useAstapConfigured } from '../stars/StarRequestControls'
import { cancelDetection, PROVIDER_LABELS, runDetection, sameRequest, starsState } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { useNow } from '../useNow'
import { holdCameraFrame } from './cameratabs'
import { type ImageStarsState, imagesState, imageUnavailableReason, setStarMarkers } from './images'
import type { ImageToolPanelProps } from './tools'

// Star Detection tool of the Images workspace: runs a detection of the active document on the server with
// the built-in detector or ASTAP, and shows the outcome, the aggregate HFD, the star selected in the viewer,
// and how the markers are drawn. Settings are the profile's star detection request, shared by every document and by
// the frames of Auto Focus and Guiding, and sent only by Run Detection; a result always belongs to the image it measured.
// The settings are editable before the document has an image (a camera tab waiting for its first frame), with Run
// Detection disabled until it has one. ASTAP's executable and timeout are not set here but in Settings → External
// Tools, which the detector section links to.

// Text shown for a value the result does not have.
const MISSING = '—'

// Display names of the job states.
const STATE_LABELS: Readonly<Record<StarDetectionJob['state'], string>> = { queued: 'Queued', running: 'Running', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled' }

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

	return <StarDetection documentKey={document.key} imageId={document.info?.id} stars={view?.stars} unavailable={imageUnavailableReason(document)} />
}

interface StarDetectionProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of its image; absent until it has one.
	readonly imageId?: string
	// Star markers of the document; absent without a view.
	readonly stars?: ImageStarsState
	// Why the document has no image yet.
	readonly unavailable?: string
}

// Sections of the Star Detection panel of a document: the settings always, the analysis and the results once it has an
// image.
function StarDetection({ documentKey, imageId, stars, unavailable }: StarDetectionProps) {
	const { job, result, resultError } = useStarResult(imageId)
	const { submitErrors } = useSnapshot(starsState)
	const profiles = useSnapshot(profileState)
	const request = starDetectionSettings(activeProfile(profiles).settings)
	const selected = result && stars?.selected?.jobId === result.jobId ? result.stars[stars.selected.index] : undefined
	const edit = (next: StarDetectionRequest) => setStarDetectionSettings(profileState, next)

	return (
		<>
			<PanelSection title="Detector">
				<DetectorControls request={request} onChange={edit} />
			</PanelSection>
			<PanelSection title="Detection Settings">
				<DetectorSettingsControls request={request} onChange={edit} />
			</PanelSection>
			<PanelSection title="Acceptance">
				<AcceptanceControls request={request} onChange={edit} />
			</PanelSection>
			<Analysis documentKey={documentKey} imageId={imageId} request={request} job={job} submitError={imageId === undefined ? undefined : submitErrors[imageId]} unavailable={unavailable} />
			{imageId !== undefined && (
				<>
					<Results job={job} result={result} resultError={resultError} />
					<SelectedStar star={selected} />
				</>
			)}
			{stars && (
				<PanelSection title="Visualization">
					<Checkbox label="Show stars" checked={stars.visible} onChange={(visible) => setStarMarkers(imagesState, documentKey, { visible })} />
					<Checkbox label="Accepted stars only" checked={stars.acceptedOnly} disabled={!stars.visible} onChange={(acceptedOnly) => setStarMarkers(imagesState, documentKey, { acceptedOnly })} />
					<Notice>Click a star in the image to inspect it. Showing or hiding the markers never runs a detection.</Notice>
				</PanelSection>
			)}
		</>
	)
}

interface AnalysisProps {
	// Key of the document.
	readonly documentKey: string
	// Server id of the image; absent until the document has one.
	readonly imageId?: string
	// Why the document has no image yet.
	readonly unavailable?: string
	// Star detection request of the profile.
	readonly request: StarDetectionRequest
	// Latest job of the image.
	readonly job?: StarDetectionJob
	// Why the latest submission failed.
	readonly submitError?: string
}

// Run and Cancel, with the state of the latest job. Running holds the frame a camera tab shows first, so the frame analyzed stays shown.
function Analysis({ documentKey, imageId, request, job, submitError, unavailable }: AnalysisProps) {
	const active = isActive(job)
	const now = useNow(active)
	const astapReady = useAstapConfigured() || request.detector.provider !== 'astap'
	const changed = job && !sameRequest(job.request, request)

	return (
		<PanelSection title="Analysis">
			<Actions>
				<Button
					disabled={active || !astapReady || imageId === undefined}
					onClick={() => {
						if (imageId === undefined) return
						holdCameraFrame(imagesState, documentKey)
						void runDetection(starsState, imageId, request)
					}}
				>
					Run Detection
				</Button>
				<Button variant="secondary" disabled={!active || !job} onClick={() => job && void cancelDetection(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{!astapReady && <Notice error>ASTAP is not configured.</Notice>}
			{unavailable && <Notice>{unavailable} The settings apply to the next detection.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{job ? (
				<>
					<Property label="Status">{STATE_LABELS[job.state]}</Property>
					<Property label="Elapsed">{formatSeconds(elapsedOf(job, now))}</Property>
					{job.error && <Notice error>{job.error}</Notice>}
					{changed && <Notice>The settings changed since this detection; run it again to apply them.</Notice>}
				</>
			) : (
				imageId !== undefined && <Notice>No detection of this image yet.</Notice>
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
