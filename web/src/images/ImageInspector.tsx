import type { ImageAcquisition, ImageInfo, ImageProvenance, RenderResult } from 'api'
import type { ReactNode } from 'react'
import { PanelSection, PlannedControls } from '../shell/ContextualPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import { DisplayAdjustments } from './DisplayAdjustments'
import { documentPath, downloadUrl, type ImageDocument } from './images'
import type { ImageToolPanelProps } from './tools'

// Image Inspector, the default contextual tool of the Images workspace: properties, the provenance and
// save actions of a derived image, acquisition data, display adjustments with the parameters of the
// current rendering, and the header of the active document, with the statistics section still to come.
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
				<Property label="Folder">
					{path ? (
						<span title={path} className="block truncate">
							{directoryOf(path)}
						</span>
					) : (
						<span className="text-accent">Not saved</span>
					)}
				</Property>
				{info ? (
					<>
						<Property label="Format">{info.origin === 'file' ? info.format.toUpperCase() : 'Derived'}</Property>
						<Property label="Size">
							{info.width} × {info.height} px
						</Property>
						<Property label="Channels">{info.channels === 3 ? 'RGB' : info.bayer ? `Mono (CFA ${info.bayer})` : 'Mono'}</Property>
					</>
				) : (
					<p className="m-0 text-ink-300">{document.status === 'loading' ? 'Opening…' : 'Unavailable'}</p>
				)}
			</PanelSection>
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
