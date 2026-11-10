import type { CaptureFrameOrigin, CaptureFrameSummary, ImageAcquisition, ImageInfo, ImageProvenance, LiveStackingProvenanceStack, RenderResult, StarDetectionOrigin } from 'api'
import { useSnapshot } from 'valtio'
import { autoFocusFrameFocus, autoFocusRuntime } from '../camera/autofocus'
import { DARV_AXIS_LABELS, DARV_DIRECTION_LABELS, DARV_STATUS_LABELS, darvFrameMeasurement, darvRuntime, formatDarvDrift } from '../camera/darv'
import { ipolarFrameRole, ipolarRuntime } from '../camera/ipolar'
import { liveAcquisitionLabel, liveCalibrationLabel } from '../camera/livestacking'
import { tppaFrameRole, tppaRuntime } from '../camera/tppa'
import { connectionState } from '../connection/connection'
import { formatDuration, formatFixed, formatPixelLength, formatTemperature, MISSING, formatZonedDateTime } from '../format'
import { useActiveTimeZone } from '../location/useLocation'
import { CollapsibleSection } from '../shell/CollapsibleSection'
import { EmptyState } from '../shell/WorkspaceLayout'
import { type ImageQualityStatus, imageQuality } from '../stars/quality'
import { PROVIDER_LABELS, starsState } from '../stars/stars'
import { Button } from '../ui/Button'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import type { CameraFrameSelection } from './cameratabs'
import { connectionLabel, frameUnavailableReason } from './captureframes'
import { operationLabel, operationSummary } from './imageprocessing.catalog'
import { documentPath, type ImageDocument } from './images'
import { ImageStatisticsSection } from './ImageStatisticsSection'
import type { ImageToolPanelProps } from './tools'

// Image Inspector, the default contextual tool of the Images workspace: properties, the provenance and save state of a
// derived image (saved from the viewer toolbar), the camera, origin, session, and storage of the frame a camera tab
// shows (with the focuser position of an Auto Focus frame when its session recorded it), the quality the measurements already made
// on the image give (never measured here), acquisition data, the parameters of the current rendering, the histogram and
// statistics of its original samples (ImageStatisticsSection, measured only while expanded), and the header of the active
// document. The display settings are changed from the viewer toolbar (DisplayToolbar).

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
	['Sensor temp. (°C)', (a) => (a.temperature === undefined ? undefined : formatFixed(a.temperature, 1))],
	['Binning', (a) => a.binning && `${a.binning.x}×${a.binning.y}`],
	['Camera', (a) => a.camera],
	['Telescope', (a) => a.telescope],
	['Focal length (mm)', (a) => a.focalLength?.toString()],
]

// Inspector of the active image document.
export function ImageInspector({ document, view, onOpen }: ImageToolPanelProps) {
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
			<CollapsibleSection id="images.inspector.properties" title="Properties">
				<DataRow label="Name">{document.name}</DataRow>
				{!document.camera && (
					<DataRow label="Folder">
						{path ? (
							<span title={path} className="block truncate">
								{directoryOf(path)}
							</span>
						) : (
							<span className="text-accent">Not saved</span>
						)}
					</DataRow>
				)}
				{info ? (
					<>
						<DataRow label="Format">{info.origin === 'derived' ? 'Derived' : info.format.toUpperCase()}</DataRow>
						<DataRow label="Size">
							{info.width} × {info.height} px
						</DataRow>
						<DataRow label="Channels">{info.channels === 3 ? 'RGB' : info.bayer ? `Mono (CFA ${info.bayer})` : 'Mono'}</DataRow>
					</>
				) : (
					<Notice>{document.status === 'loading' ? 'Opening…' : 'Unavailable'}</Notice>
				)}
			</CollapsibleSection>
			{document.camera?.shown && !document.camera.live && <CapturedFrame frame={document.camera.shown.frame} selection={document.camera.selection.kind} />}
			{info && <Quality imageId={info.id} />}
			{info?.origin === 'derived' && <Derivation document={document} provenance={info.provenance} />}
			{info && <Acquisition info={info} />}
			{view?.rendering && <AppliedDisplay result={view.rendering.result} />}
			<ImageStatisticsSection document={document} view={view} />
			{info && <Header info={info} />}
		</>
	)
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

// Labels of the states of the write of a frame's file.
const FILE_STATE_LABELS: Readonly<Record<NonNullable<CaptureFrameSummary['file']>, string>> = { saving: 'Saving', saved: 'Saved', failed: 'Save failed' }

// Labels of why a camera tab shows its frame.
const SELECTION_LABELS: Readonly<Record<CameraFrameSelection['kind'], string>> = { latest: 'Latest frame', saved: 'Saved frame', inspect: 'Held for analysis', liveStack: 'Live stack' }

interface CapturedFrameProps {
	// Frame shown.
	readonly frame: CaptureFrameSummary
	// Why the camera tab shows it.
	readonly selection: CameraFrameSelection['kind']
}

// Labels of the operations that take frames.
const ORIGIN_LABELS: Readonly<Record<CaptureFrameOrigin, string>> = {
	capture: 'Acquisition',
	autofocus: 'Auto Focus',
	tppa: 'TPPA',
	ipolar: 'iPolar',
	mountPointing: 'Pointing Model',
	targetCentering: 'Target Centering',
	darv: 'DARV',
	flatWizard: 'Flat Wizard',
	darkLibraryWizard: 'Dark Library Wizard',
	guiding: 'Guiding',
}

// Camera, origin, session, and storage of the frame a camera tab shows, as the capture frame registry describes it,
// and, for an Auto Focus frame, its measurement and the focuser position its session recorded, for a TPPA or iPolar
// frame, the step of its session it was taken for, and for a DARV frame, the settings and outcome of its measurement.
function CapturedFrame({ frame, selection }: CapturedFrameProps) {
	const timeZone = useActiveTimeZone()
	const connections = useSnapshot(connectionState)
	const autoFocus = useSnapshot(autoFocusRuntime)
	const unavailable = frameUnavailableReason(frame)
	const focus = frame.origin === 'autofocus' ? autoFocusFrameFocus(autoFocus.details[frame.sessionId], frame) : undefined
	const tppa = useSnapshot(tppaRuntime)
	const role = frame.origin === 'tppa' ? tppaFrameRole(tppa.details[frame.sessionId], frame) : undefined
	const ipolar = useSnapshot(ipolarRuntime)
	const ipolarRole = frame.origin === 'ipolar' ? ipolarFrameRole(ipolar.details[frame.sessionId], frame) : undefined
	const darv = useSnapshot(darvRuntime)
	const drift =
		frame.origin === 'darv'
			? darvFrameMeasurement(
					Object.values(darv.sessions).find((session) => session.sessionId === frame.sessionId),
					frame,
				)
			: undefined

	return (
		<>
			<CollapsibleSection id="images.inspector.capture" title="Capture">
				<DataRow label="Camera">{frame.cameraName}</DataRow>
				<DataRow label="Connection">{connectionLabel(frame.connectionId, connections.servers, connections.connections)}</DataRow>
				<DataRow label="Origin">{ORIGIN_LABELS[frame.origin]}</DataRow>
				{frame.origin === 'autofocus' && (
					<>
						<DataRow label="Auto Focus session">
							<span title={frame.sessionId} className="block truncate">
								{frame.sessionId}
							</span>
						</DataRow>
						<DataRow label="Measurement">{focus?.verification ? 'Verification' : `#${frame.generation}`}</DataRow>
						<DataRow label="Focuser position">{focus ? `${focus.position} steps` : MISSING}</DataRow>
					</>
				)}
				{frame.origin === 'tppa' && (
					<>
						<DataRow label="TPPA session">
							<span title={frame.sessionId} className="block truncate">
								{frame.sessionId}
							</span>
						</DataRow>
						<DataRow label="Step">{role ? (role.point !== undefined ? `Point ${role.point}/3` : role.refinement ? 'Refinement' : 'Rejected candidate') : MISSING}</DataRow>
					</>
				)}
				{frame.origin === 'ipolar' && (
					<>
						<DataRow label="iPolar session">
							<span title={frame.sessionId} className="block truncate">
								{frame.sessionId}
							</span>
						</DataRow>
						<DataRow label="Step">{ipolarRole ? (ipolarRole.pose === 1 ? 'Reference pose' : ipolarRole.pose === 2 ? 'Second pose' : ipolarRole.refinement ? 'Refinement' : 'Rejected candidate') : MISSING}</DataRow>
					</>
				)}
				{frame.origin === 'mountPointing' && (
					<DataRow label="Pointing session">
						<span title={frame.sessionId} className="block truncate">
							{frame.sessionId}
						</span>
					</DataRow>
				)}
				{frame.origin === 'darv' && (
					<>
						<DataRow label="DARV session">
							<span title={frame.sessionId} className="block truncate">
								{frame.sessionId}
							</span>
						</DataRow>
						<DataRow label="Measurement">{drift ? `${DARV_AXIS_LABELS[drift.request.axis]}, ${DARV_DIRECTION_LABELS[drift.request.direction]} first, ${drift.request.legDuration} s legs` : MISSING}</DataRow>
						<DataRow label="Result">{drift?.result ? (drift.result.driftMagnitude !== undefined ? formatDarvDrift(drift.result.driftMagnitude) : DARV_STATUS_LABELS[drift.result.status]) : MISSING}</DataRow>
					</>
				)}
				<DataRow label="Frame of session">#{frame.generation}</DataRow>
				<DataRow label="Frame type">{frame.frameType}</DataRow>
				<DataRow label="Captured">{formatZonedDateTime(frame.time, timeZone)}</DataRow>
				<DataRow label="Frame ID">
					<span title={frame.frameId} className="block truncate">
						{frame.frameId}
					</span>
				</DataRow>
				<DataRow label="Shown as">{SELECTION_LABELS[selection]}</DataRow>
			</CollapsibleSection>
			<CollapsibleSection id="images.inspector.storage" title="Storage">
				<DataRow label="State">{frame.file ? FILE_STATE_LABELS[frame.file] : 'Temporary (preview only)'}</DataRow>
				{frame.fileName && (
					<DataRow label="File">
						<span title={frame.fileName} className="block truncate">
							{frame.fileName}
						</span>
					</DataRow>
				)}
				<DataRow label="Availability">{unavailable ? <span className="text-danger">{unavailable}</span> : frame.availability === 'memory' ? 'In memory' : 'Saved file'}</DataRow>
			</CollapsibleSection>
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
		<CollapsibleSection id="images.inspector.quality" title="Quality">
			<DataRow label="State">{quality.status === 'failed' ? <span className="text-danger">{QUALITY_LABELS.failed}</span> : QUALITY_LABELS[quality.status]}</DataRow>
			{measured && <DataRow label="HFD">{formatPixelLength(quality.hfdPx)}</DataRow>}
			{measured && <DataRow label="Stars (accepted / detected)">{`${quality.acceptedStars ?? 0} / ${quality.detectedStars ?? 0}`}</DataRow>}
			{quality.provider && <DataRow label="Detector">{PROVIDER_LABELS[quality.provider]}</DataRow>}
			{quality.origin && <DataRow label="Measured by">{MEASURED_BY_LABELS[quality.origin]}</DataRow>}
			{quality.error && <Notice error>{quality.error}</Notice>}
			{quality.status === 'not-measured' && <Notice>Run Star Detection to measure the HFD of this image.</Notice>}
		</CollapsibleSection>
	)
}

interface InfoProps {
	// Opened image.
	readonly info: ImageInfo
}

// Acquisition data read from the image header.
function Acquisition({ info }: InfoProps) {
	return (
		<CollapsibleSection id="images.inspector.acquisition" title="Acquisition">
			{ACQUISITION_FIELDS.map(([label, format]) => {
				const value = format(info.acquisition)

				return (
					<DataRow key={label} label={label}>
						{value ? value : <span className="text-ink-300">{MISSING}</span>}
					</DataRow>
				)
			})}
		</CollapsibleSection>
	)
}

interface DerivationProps {
	// Derived document.
	readonly document: ImageDocument
	// Where the image was derived from.
	readonly provenance: ImageProvenance
}

// Provenance and persistence of a derived image: its source, when it was derived, the processing steps of the pipeline
// that derived it, or the frames and stacks of the live stack it is a snapshot of, and whether it is saved (from the Save
// control of the viewer toolbar).
function Derivation({ document, provenance }: DerivationProps) {
	const timeZone = useActiveTimeZone()
	return (
		<CollapsibleSection id="images.inspector.derived-image" title="Derived Image">
			<DataRow label="Source">{provenance.sourceName}</DataRow>
			<DataRow label="Created">{formatZonedDateTime(Date.parse(provenance.createdAt), timeZone)}</DataRow>
			{provenance.kind === 'liveStacking' ? (
				<>
					<DataRow label="Live stack">{provenance.frames} accepted frames</DataRow>
					{provenance.stacks.map((stack) => (
						<LiveStack key={`${stack.field}:${stack.filter}:${liveAcquisitionLabel(stack)}:${liveCalibrationLabel(stack)}`} stack={stack} />
					))}
				</>
			) : (
				<ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
					{provenance.steps.map(({ id, operation }, i) => (
						<li key={id} className="flex min-w-0 gap-2">
							<span className="flex-none text-ink-300 tabular-nums">{i + 1}.</span>
							<span className="min-w-0 truncate text-ink-100" title={operationSummary(operation)}>
								{operationLabel(operation.type)}
								<span className="text-ink-300"> · {operationSummary(operation)}</span>
							</span>
						</li>
					))}
				</ol>
			)}
			<DataRow label="State">{document.unsaved ? <span className="text-accent">Unsaved</span> : 'Saved'}</DataRow>
		</CollapsibleSection>
	)
}

// A stack of a live stack snapshot as it was when the snapshot was taken: its filter and field, its accepted frames with
// their total exposure, the acquisition settings its frames share, its masters, and the sensor temperatures of its frames.
function LiveStack({ stack }: { readonly stack: LiveStackingProvenanceStack }) {
	return (
		<div className="flex flex-col border-l border-line-200 pl-2">
			<DataRow label="Filter">
				{stack.filter} · field {stack.field}
			</DataRow>
			<DataRow label="Frames">
				{stack.accepted} · {formatDuration(stack.exposure)}
			</DataRow>
			<DataRow label="Acquisition">{liveAcquisitionLabel(stack)}</DataRow>
			<DataRow label="Calibration">{liveCalibrationLabel(stack)}</DataRow>
			{stack.temperature && <DataRow label="Temperature">{`${formatFixed(stack.temperature[0], 1)} to ${formatTemperature(stack.temperature[1])}`}</DataRow>}
		</div>
	)
}

interface AppliedDisplayProps {
	// Parameters of the current rendering.
	readonly result: RenderResult
}

// Parameters the server applied to the current rendering, such as the values an auto stretch computed.
function AppliedDisplay({ result }: AppliedDisplayProps) {
	return (
		<CollapsibleSection id="images.inspector.applied-display" title="Applied Display" defaultOpen={false}>
			<DataRow label="Debayer">{result.cfa ?? 'Off'}</DataRow>
			<DataRow label="Channels">{result.channels === 3 ? 'RGB' : 'Mono'}</DataRow>
			{result.stretch.map((stretch, i) => (
				<DataRow key={i} label={`Stretch${result.stretch.length === 3 ? ` ${CHANNEL_NAMES[i]}` : ''}`}>
					{stretch.shadow.toFixed(4)} - {stretch.highlight.toFixed(4)} | {stretch.midtone.toFixed(4)}
				</DataRow>
			))}
		</CollapsibleSection>
	)
}

// Every header keyword of the image, collapsed by default.
function Header({ info }: InfoProps) {
	const cards = Object.entries(info.header)

	return (
		<CollapsibleSection id="images.inspector.header" title="Header" summary={`${cards.length} keywords`} defaultOpen={false}>
			<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
				{cards.map(([keyword, value]) => (
					<div key={keyword} className="contents">
						<dt className="text-ink-300">{keyword}</dt>
						<dd className="m-0 break-all text-ink-100">{String(value ?? '')}</dd>
					</div>
				))}
			</dl>
		</CollapsibleSection>
	)
}
