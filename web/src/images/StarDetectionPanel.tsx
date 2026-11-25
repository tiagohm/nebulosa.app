import type { StarDetectionJob, StarDetectionRequest, StarDetectionResult } from 'api'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { analysisElapsed, isActive } from '../analysis'
import { formatClockTime, formatDuration, formatFixed, formatPixelLength, formatPixelPosition, formatSignificant } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { activeProfile, profileState, setStarDetectionSettings, starDetectionSettings } from '../profile/profile'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { EmptyState } from '../shell/WorkspaceLayout'
import { acceptanceSummary, AcceptanceControls, detectionSummary, DetectorSettingsControls } from '../stars/StarRequestControls'
import { cancelDetection, DEFAULT_STAR_REQUEST, runDetection, sameRequest, starsState } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { Actions } from '../ui/Actions'
import { Button } from '../ui/Button'
import { Checkbox } from '../ui/Checkbox'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { SectionHeading } from '../ui/SectionHeading'
import { useNow } from '../useNow'
import { type ImageStarsState, imagesState, imageUnavailableReason, setStarMarkers } from './images'
import type { ImageToolPanelProps } from './tools'

// Star Detection tool of the Images workspace: runs a detection of the active document on the server with the built-in
// detector, and reads the frame as a focus and seeing gauge: the aggregate HFD of its accepted stars, the star
// selected in the viewer, and how the markers are drawn. The panel has two states: before the image has a detection
// (or after one failed or was cancelled) it is Run Detection above the settings; once one runs or measured, the
// settings fold into one collapsed section and the measurement takes the panel. Settings are the profile's star
// detection request, shared by every document and by the frames of Auto Focus and Guiding, and sent only by Run
// Detection. A result always belongs to the image it measured. The settings are editable before the document has an
// image (a camera tab waiting for its first frame), with Run Detection disabled until it has one.

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

// Sections of the Star Detection panel of a document: Run Detection and the latest job always, then the settings until
// the image has a detection that runs or completed, or the measurement, the selected star, and the markers once it
// has, with the settings folded.
function StarDetection({ documentKey, imageId, stars, unavailable }: StarDetectionProps) {
	const { job, result, resultError } = useStarResult(imageId)
	const { submitErrors } = useSnapshot(starsState)
	const profiles = useSnapshot(profileState)
	const request = starDetectionSettings(activeProfile(profiles).settings)
	const edit = (next: StarDetectionRequest) => setStarDetectionSettings(profileState, next)
	const execution = <Execution imageId={imageId} request={request} job={job} submitError={imageId === undefined ? undefined : submitErrors[imageId]} unavailable={unavailable} />

	if (imageId === undefined || !job || job.state === 'failed' || job.state === 'cancelled') {
		return (
			<>
				{execution}
				<SettingsSections request={request} onChange={edit} />
			</>
		)
	}

	const selected = result && stars?.selected?.jobId === result.jobId ? result.stars[stars.selected.index] : undefined

	return (
		<>
			{execution}
			<DetectionSettings request={request} onChange={edit} />
			{job.summary && <Measurement job={job} result={result} resultError={resultError} />}
			{result && <SelectedStar star={selected} />}
			{result && stars && (
				<CollapsibleSection id="images.star-detection.visualization" title="Visualization">
					<Checkbox label="Show stars" checked={stars.visible} onChange={(visible) => setStarMarkers(imagesState, documentKey, { visible })} />
					<Checkbox label="Accepted stars only" checked={stars.acceptedOnly} disabled={!stars.visible} onChange={(acceptedOnly) => setStarMarkers(imagesState, documentKey, { acceptedOnly })} />
					<Notice>Click a star in the image to inspect it.</Notice>
				</CollapsibleSection>
			)}
		</>
	)
}

interface SettingsProps {
	// Star detection request of the profile.
	readonly request: StarDetectionRequest
	// Called with the edited request.
	readonly onChange: (request: StarDetectionRequest) => void
}

// Settings of an image without a detection, one section each with a summary while collapsed: the settings of the
// detector open, the acceptance collapsed.
function SettingsSections({ request, onChange }: SettingsProps) {
	return (
		<>
			<CollapsibleSection id="images.star-detection.detection" title="Detection" summary={detectionSummary(request)}>
				<DetectorSettingsControls request={request} onChange={onChange} />
				<SharedNotice />
			</CollapsibleSection>
			<CollapsibleSection id="images.star-detection.acceptance" title="Acceptance" summary={acceptanceSummary(request)} defaultOpen={false}>
				<AcceptanceControls request={request} onChange={onChange} />
				<ResetButton onChange={onChange} />
			</CollapsibleSection>
		</>
	)
}

// Settings of an image with a detection, folded into one section collapsed by default, whose summary gives the settings
// of the detector.
function DetectionSettings({ request, onChange }: SettingsProps) {
	return (
		<CollapsibleSection id="images.star-detection.settings" title="Detection Settings" summary={detectionSummary(request)} defaultOpen={false}>
			<SharedNotice />
			<SettingsGroup title="Detection">
				<DetectorSettingsControls request={request} onChange={onChange} />
			</SettingsGroup>
			<SettingsGroup title="Acceptance">
				<AcceptanceControls request={request} onChange={onChange} />
			</SettingsGroup>
			<ResetButton onChange={onChange} />
		</CollapsibleSection>
	)
}

// Says who else uses the settings edited here.
function SharedNotice() {
	return <Notice>These are the profile's settings: Auto Focus measures its frames with them, and Guiding finds its stars with them.</Notice>
}

// Puts the settings of the detector and the acceptance back to their defaults.
function ResetButton({ onChange }: Pick<SettingsProps, 'onChange'>) {
	return (
		<Button variant="secondary" className="self-start" onClick={() => onChange(DEFAULT_STAR_REQUEST)}>
			Reset to Defaults
		</Button>
	)
}

// Titled group of controls inside a section, below a divider.
function SettingsGroup({ title, children }: { readonly title: string; readonly children: ReactNode }) {
	return (
		<div className="mt-1 flex flex-col gap-2 border-t border-line-100 pt-3">
			<SectionHeading>{title}</SectionHeading>
			{children}
		</div>
	)
}

// Returns the outcome of a job in words with the tone that tints it: whether it measured the frame once completed,
// else its state.
function jobStatus(job: Pick<StarDetectionJob, 'state' | 'summary'>): { readonly label: string; readonly tone: 'default' | 'success' | 'warning' | 'danger' } {
	switch (job.state) {
		case 'queued':
			return { label: 'Queued', tone: 'default' }
		case 'running':
			return { label: 'Running', tone: 'default' }
		case 'completed':
			switch (job.summary?.measurement) {
				case 'ok':
					return { label: 'Measured', tone: 'success' }
				case 'noStars':
					return { label: 'No stars', tone: 'warning' }
				case 'unavailable':
					return { label: 'Too few accepted', tone: 'warning' }
				default:
					return { label: 'Completed', tone: 'default' }
			}
		case 'failed':
			return { label: 'Failed', tone: 'danger' }
		case 'cancelled':
			return { label: 'Cancelled', tone: 'default' }
	}
}

interface ExecutionProps {
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

// Run Detection and Cancel, each saying why while disabled, with the outcome of the latest job of the image: its
// state and time while it runs, and whether it measured the frame once it ends.
function Execution({ imageId, request, job, submitError, unavailable }: ExecutionProps) {
	const active = isActive(job)
	const now = useNow(active)
	const changed = job?.state === 'completed' && !sameRequest(job.request, request)
	const reason = imageId === undefined ? (unavailable ?? 'The document has no image yet.') : active ? 'A detection of this image is running.' : undefined
	const status = job && jobStatus(job)

	return (
		<CollapsibleSection id="images.star-detection.analysis" title="Analysis" summary={status?.label}>
			<Actions>
				<Button className="max-sm:min-h-12.5" disabled={reason !== undefined} title={reason} onClick={() => imageId !== undefined && void runDetection(starsState, imageId, request)}>
					Run Detection
				</Button>
				<Button variant="secondary" className="max-sm:min-h-12.5" disabled={!active} title={active ? undefined : 'No detection of this image is running.'} onClick={() => job && void cancelDetection(job.jobId)}>
					Cancel
				</Button>
			</Actions>
			{unavailable && <Notice>{unavailable} The settings apply to the next detection.</Notice>}
			{submitError && <Notice error>{submitError}</Notice>}
			{job && status ? (
				<div className="flex flex-col">
					<DataRow label="Status" tone={status.tone}>
						{status.label}
					</DataRow>
					<DataRow label={active ? 'Elapsed' : 'Duration'}>{formatDuration(analysisElapsed(job, now) / 1000)}</DataRow>
				</div>
			) : (
				imageId !== undefined && <Notice>No detection of this image yet.</Notice>
			)}
			{job?.error && <Notice error>{job.error}</Notice>}
			{changed && <Notice warning>The settings changed since this detection; run it again to apply them.</Notice>}
		</CollapsibleSection>
	)
}

interface MeasurementProps {
	// Completed job of the image.
	readonly job: StarDetectionJob
	// Its result, once fetched.
	readonly result?: StarDetectionResult
	// Why its result could not be fetched.
	readonly resultError?: string
}

// Aggregate HFD of the accepted stars as the one Readout of the panel, then how many stars were accepted and which
// detection measured it.
function Measurement({ job, result, resultError }: MeasurementProps) {
	const timeZone = useActiveTimeZone()
	const summary = job.summary
	if (!summary) return null
	const hfd = summary.measurement === 'ok' && summary.aggregateHfd !== undefined ? formatPixelLength(summary.aggregateHfd) : undefined
	const accepted = `${summary.acceptedCount} of ${summary.detectedCount}`

	return (
		<CollapsibleSection id="images.star-detection.results" title="Measurement" summary={hfd ? `HFD ${hfd} · ${summary.acceptedCount} stars` : jobStatus(job).label}>
			{hfd && (
				<div className="flex flex-wrap items-baseline justify-between gap-x-3">
					<SectionHeading>HFD</SectionHeading>
					<span className="ml-auto text-3xl leading-9 font-semibold tracking-[-0.01em] text-ink-100 tabular-nums">{hfd}</span>
				</div>
			)}
			<DataRow label="Accepted stars">{accepted}</DataRow>
			<Notice>Median HFD of the accepted stars · {formatClockTime(job.queuedAt, timeZone, { seconds: true, named: true })}</Notice>
			{summary.measurement === 'noStars' && <Notice warning>No stars were detected in this image.</Notice>}
			{summary.measurement === 'unavailable' && <Notice warning>Too few stars were accepted for an aggregate HFD. Loosen the acceptance criteria or detect more stars.</Notice>}
			{result?.warnings.map((warning) => (
				<Notice key={warning}>{warning}</Notice>
			))}
			{resultError && <Notice error>{resultError}</Notice>}
		</CollapsibleSection>
	)
}

// Measurements of the star selected in the viewer, summarized while collapsed.
function SelectedStar({ star }: { readonly star?: DetectedStar }) {
	return (
		<CollapsibleSection id="images.star-detection.selected-star" title="Selected Star" summary={star ? `HFD ${formatPixelLength(star.hfd)} · SNR ${formatFixed(star.snr, 1)}` : undefined}>
			{star ? (
				<div className="flex flex-col">
					<DataRow label="Position">{formatPixelPosition(star.x, star.y, 2)}</DataRow>
					<DataRow label="HFD">{formatPixelLength(star.hfd)}</DataRow>
					<DataRow label="SNR">{formatFixed(star.snr, 1)}</DataRow>
					<DataRow label="Flux">{formatSignificant(star.flux)} normalized</DataRow>
				</div>
			) : (
				<Notice>No star selected. Click a star in the image.</Notice>
			)}
		</CollapsibleSection>
	)
}
