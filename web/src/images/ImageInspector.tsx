import type { CaptureFrameOrigin, CaptureFrameSummary, ImageAcquisition, ImageInfo, ImageProvenance, RenderResult, StarDetectionOrigin } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { autoFocusFrameFocus, autoFocusRuntime } from '../camera/autofocus'
import { connectionState } from '../connection/connection'
import { PanelSection, PlannedControls } from '../shell/ContextualPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import { type ImageQualityStatus, imageQuality } from '../stars/quality'
import { PROVIDER_LABELS, starsState } from '../stars/stars'
import { Button } from '../ui/Button'
import type { CameraFrameSelection } from './cameratabs'
import { connectionLabel, frameUnavailableReason } from './captureframes'
import { DisplayAdjustments } from './DisplayAdjustments'
import { documentPath, downloadUrl, type ImageDocument } from './images'
import type { ImageToolPanelProps } from './tools'

// Image Inspector, the default contextual tool of the Images workspace: properties, the provenance and
// save actions of a derived image, the camera, origin, session, and storage of the frame a camera tab shows (with the
// focuser position of an Auto Focus frame when its session recorded it), the quality the measurements already made
// on the image give (never measured here), acquisition data, display adjustments with the parameters of the current
// rendering, and the header of the active document, with the statistics section still to come.
// The display adjustments edit the document's pending display settings and create derived images.

// Text shown for a datum the image does not have.
const MISSING = '—'

// Names of the RGB channels, in the order of a per-channel stretch.
const CHANNEL_NAMES = ['R', 'G', 'B'] as const

// Acquisition fields shown, in display order: label and the formatted value, absent when the image does
// not have it. Every field is always listed, so images can be compared at a glance.
const ACQUISITION_FIELDS: readonly (readonly [label: string, format: (acquisition: ImageAcquisition) => string | undefined])[] = [
	['Object', (a) => a.object],
	['Date (UTC)', (a) => a.date && formatDate(a.date)],
	['Exposure (s)', (a) => a.exposure?.toString()],
	['Filter', (a) => a.filter],
	['Gain', (a) => a.gain?.toString()],
	['Offset', (a) => a.offset?.toString()],
	['Sensor temp. (°C)', (a) => a.temperature?.toFixed(1)],
	['Binning', (a) => a.binning && `${a.binning.x}×${a.binning.y}`],
	['Camera', (a) => a.camera],
	['Telescope', (a) => a.telescope],
	['Focal length (mm)', (a) => a.focalLength?.toString()],
]

// Inspector of the active image document.
export function ImageInspector({ document, view, onOpen, onSaveAs }: ImageToolPanelProps) {
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

	const { info } = document
	const path = documentPath(document)

	return (
		<>
			<PanelSection title="Properties">
				<Property label="Name">{document.name}</Property>
				{!document.camera && (
					<Property label="Folder">
						{path ? (
							<span title={path} className="block truncate">
								{directoryOf(path)}
							</span>
						) : (
							<span className="text-accent">Not saved</span>
						)}
					</Property>
				)}
				{info ? (
					<>
						<Property label="Format">{info.origin === 'derived' ? 'Derived' : info.format.toUpperCase()}</Property>
						<Property label="Size">
							{info.width} × {info.height} px
						</Property>
						<Property label="Channels">{info.channels === 3 ? 'RGB' : info.bayer ? `Mono (CFA ${info.bayer})` : 'Mono'}</Property>
					</>
				) : (
					<p className="m-0 text-ink-300">{document.status === 'loading' ? 'Opening…' : 'Unavailable'}</p>
				)}
			</PanelSection>
			{document.camera?.shown && <CapturedFrame frame={document.camera.shown.frame} selection={document.camera.selection.kind} />}
			{info && <Quality imageId={info.id} />}
			{info?.origin === 'derived' && <Derivation document={document} provenance={info.provenance} infoId={info.id} onSaveAs={onSaveAs} />}
			{info && <Acquisition info={info} />}
			{info && view && <DisplayAdjustments documentKey={document.key} info={info} view={view} />}
			{view?.rendering && <AppliedDisplay result={view.rendering.result} />}
			<PanelSection title="Histogram and Statistics">
				<PlannedControls items={['Histogram', 'Mean, median, and deviation']} />
			</PanelSection>
			{info && <Header info={info} />}
		</>
	)
}

interface PropertyProps {
	// Property name.
	readonly label: string
	// Property value.
	readonly children: ReactNode
}

// Returns the folder of a server path, without its file name; the path itself when it has no folder.
function directoryOf(path: string): string {
	const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
	return index > 0 ? path.slice(0, index) : path
}

// Returns an ISO 8601 UTC date-time as "YYYY-MM-DD hh:mm:ss", in UTC.
function formatDate(date: string): string {
	return date.slice(0, 19).replace('T', ' ')
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

// Labels of the states of the write of a frame's file.
const FILE_STATE_LABELS: Readonly<Record<NonNullable<CaptureFrameSummary['file']>, string>> = { saving: 'Saving', saved: 'Saved', failed: 'Save failed' }

// Labels of why a camera tab shows its frame.
const SELECTION_LABELS: Readonly<Record<CameraFrameSelection['kind'], string>> = { latest: 'Latest frame', saved: 'Saved frame', inspect: 'Held for analysis' }

interface CapturedFrameProps {
	// Frame shown.
	readonly frame: CaptureFrameSummary
	// Why the camera tab shows it.
	readonly selection: CameraFrameSelection['kind']
}

// Labels of the operations that take frames.
const ORIGIN_LABELS: Readonly<Record<CaptureFrameOrigin, string>> = { capture: 'Camera Acquisition', autofocus: 'Auto Focus', tppa: 'TPPA' }

// Camera, origin, session, and storage of the frame a camera tab shows, as the capture frame registry describes it,
// and, for an Auto Focus frame, its measurement and the focuser position its session recorded.
function CapturedFrame({ frame, selection }: CapturedFrameProps) {
	const connections = useSnapshot(connectionState)
	const autoFocus = useSnapshot(autoFocusRuntime)
	const unavailable = frameUnavailableReason(frame)
	const focus = frame.origin === 'autofocus' ? autoFocusFrameFocus(autoFocus.details[frame.sessionId], frame) : undefined

	return (
		<>
			<PanelSection title="Capture">
				<Property label="Camera">{frame.cameraName}</Property>
				<Property label="Connection">{connectionLabel(frame.connectionId, connections.servers, connections.connections)}</Property>
				<Property label="Origin">{ORIGIN_LABELS[frame.origin]}</Property>
				{frame.origin === 'autofocus' && (
					<>
						<Property label="Auto Focus session">
							<span title={frame.sessionId} className="block truncate">
								{frame.sessionId}
							</span>
						</Property>
						<Property label="Measurement">{focus?.verification ? 'Verification' : `#${frame.generation}`}</Property>
						<Property label="Focuser position">{focus ? `${focus.position} steps` : MISSING}</Property>
					</>
				)}
				<Property label="Frame">#{frame.generation}</Property>
				<Property label="Frame type">{frame.frameType}</Property>
				<Property label="Captured (UTC)">{formatDate(new Date(frame.time).toISOString())}</Property>
				<Property label="Frame ID">
					<span title={frame.frameId} className="block truncate">
						{frame.frameId}
					</span>
				</Property>
				<Property label="Shown as">{SELECTION_LABELS[selection]}</Property>
			</PanelSection>
			<PanelSection title="Storage">
				<Property label="State">{frame.file ? FILE_STATE_LABELS[frame.file] : 'Temporary (preview only)'}</Property>
				{frame.fileName && (
					<Property label="File">
						<span title={frame.fileName} className="block truncate">
							{frame.fileName}
						</span>
					</Property>
				)}
				<Property label="Availability">{unavailable ? <span className="text-danger">{unavailable}</span> : frame.availability === 'memory' ? 'In memory' : 'Saved file'}</Property>
			</PanelSection>
		</>
	)
}

// Labels of the states of the quality of an image.
const QUALITY_LABELS: Readonly<Record<ImageQualityStatus, string>> = { 'not-measured': 'Not measured', pending: 'Measuring', measured: 'Measured', failed: 'Failed' }

// Labels of who asked for a star detection.
const MEASURED_BY_LABELS: Readonly<Record<StarDetectionOrigin['kind'], string>> = { manual: 'Star Detection', autofocus: 'Auto Focus' }

interface QualityProps {
	// Id of the image document shown.
	readonly imageId: string
}

// Quality of the image shown, from the latest star detection of its image id: its state, the aggregate HFD (in
// pixels, only when measured), the star counts, the detector, and who measured it. Nothing is measured here.
function Quality({ imageId }: QualityProps) {
	const stars = useSnapshot(starsState)
	const quality = imageQuality(stars, imageId)
	const measured = quality.status === 'measured'

	return (
		<PanelSection title="Quality">
			<Property label="State">{quality.status === 'failed' ? <span className="text-danger">{QUALITY_LABELS.failed}</span> : QUALITY_LABELS[quality.status]}</Property>
			{measured && <Property label="HFD (px)">{quality.hfdPx === undefined ? MISSING : quality.hfdPx.toFixed(2)}</Property>}
			{measured && <Property label="Stars (accepted / detected)">{`${quality.acceptedStars ?? 0} / ${quality.detectedStars ?? 0}`}</Property>}
			{quality.provider && <Property label="Detector">{PROVIDER_LABELS[quality.provider]}</Property>}
			{quality.origin && <Property label="Measured by">{MEASURED_BY_LABELS[quality.origin]}</Property>}
			{quality.error && <p className="m-0 text-xs leading-4 text-danger">{quality.error}</p>}
			{quality.status === 'not-measured' && <p className="m-0 text-xs leading-4 text-ink-300">Run Star Detection to measure the HFD of this image.</p>}
		</PanelSection>
	)
}

interface InfoProps {
	// Opened image.
	readonly info: ImageInfo
}

// Acquisition data read from the image header.
function Acquisition({ info }: InfoProps) {
	return (
		<PanelSection title="Acquisition">
			{ACQUISITION_FIELDS.map(([label, format]) => {
				const value = format(info.acquisition)

				return (
					<Property key={label} label={label}>
						{value ? value : <span className="text-ink-300">{MISSING}</span>}
					</Property>
				)
			})}
		</PanelSection>
	)
}

interface DerivationProps {
	// Derived document.
	readonly document: ImageDocument
	// Where the image was derived from.
	readonly provenance: ImageProvenance
	// Server id of the document, for downloads.
	readonly infoId: string
	// Opens the Save As dialog.
	readonly onSaveAs: () => void
}

// Provenance and persistence of a derived image: its source, when it was derived, whether it is saved,
// and the Save As and download actions.
function Derivation({ document, provenance, infoId, onSaveAs }: DerivationProps) {
	return (
		<PanelSection title="Derived Image">
			<Property label="Source">{provenance.sourceName}</Property>
			<Property label="Created (UTC)">{formatDate(provenance.createdAt)}</Property>
			<Property label="State">{document.unsaved ? <span className="text-accent">Unsaved</span> : 'Saved'}</Property>
			<div className="mt-1 flex flex-wrap items-center gap-2">
				<Button onClick={onSaveAs}>Save As…</Button>
				<a href={downloadUrl({ id: infoId }, 'fits')} download className="text-xs text-accent hover:underline">
					Download FITS
				</a>
				<a href={downloadUrl({ id: infoId }, 'xisf')} download className="text-xs text-accent hover:underline">
					Download XISF
				</a>
			</div>
		</PanelSection>
	)
}

interface AppliedDisplayProps {
	// Parameters of the current rendering.
	readonly result: RenderResult
}

// Parameters the server applied to the current rendering, such as the values an auto stretch computed.
function AppliedDisplay({ result }: AppliedDisplayProps) {
	return (
		<PanelSection title="Applied Display">
			<Property label="Debayer">{result.cfa ?? 'Off'}</Property>
			<Property label="Channels">{result.channels === 3 ? 'RGB' : 'Mono'}</Property>
			{result.stretch.map((stretch, i) => (
				<Property key={i} label={`Stretch${result.stretch.length === 3 ? ` ${CHANNEL_NAMES[i]}` : ''} (S / M / H)`}>
					{stretch.shadow.toFixed(4)} / {stretch.midtone.toFixed(4)} / {stretch.highlight.toFixed(4)}
				</Property>
			))}
		</PanelSection>
	)
}

// Every header keyword of the image, collapsed by default.
function Header({ info }: InfoProps) {
	const cards = Object.entries(info.header)

	return (
		<PanelSection title="Header">
			<details>
				<summary className="cursor-pointer text-ink-200 select-none">{cards.length} keywords</summary>
				<dl className="m-0 mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
					{cards.map(([keyword, value]) => (
						<div key={keyword} className="contents">
							<dt className="text-ink-300">{keyword}</dt>
							<dd className="m-0 break-all text-ink-100">{String(value ?? '')}</dd>
						</div>
					))}
				</dl>
			</details>
		</PanelSection>
	)
}
