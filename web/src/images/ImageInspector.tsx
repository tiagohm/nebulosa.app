import type { ImageInfo } from 'api'
import type { ReactNode } from 'react'
import { PanelSection, PlannedControls } from '../shell/ContextualPanel'
import { EmptyState } from '../shell/WorkspaceLayout'
import { Button } from '../ui/Button'
import type { ImageDocument } from './images'

// Contextual panel of the Images workspace: properties, acquisition data, display parameters, and the
// header of the active document, with the analysis and processing sections still to come. It only
// reads the document.

// Header keywords shown as acquisition data, with their labels, in display order. Only those present in
// the image are shown.
const ACQUISITION_KEYWORDS: readonly (readonly [keyword: string, label: string])[] = [
	['OBJECT', 'Object'],
	['DATE-OBS', 'Date'],
	['EXPTIME', 'Exposure (s)'],
	['EXPOSURE', 'Exposure (s)'],
	['FILTER', 'Filter'],
	['GAIN', 'Gain'],
	['OFFSET', 'Offset'],
	['CCD-TEMP', 'Sensor temp. (°C)'],
	['XBINNING', 'Binning'],
	['INSTRUME', 'Camera'],
	['TELESCOP', 'Telescope'],
	['FOCALLEN', 'Focal length (mm)'],
]

export interface ImageInspectorProps {
	// Active document; absent when none is open.
	readonly document?: ImageDocument
	// Opens the file chooser.
	readonly onOpen: () => void
}

// Inspector of the active image document.
export function ImageInspector({ document, onOpen }: ImageInspectorProps) {
	if (!document) {
		return (
			<EmptyState
				title="No image open"
				action={
					<Button size="sm" variant="secondary" onClick={onOpen}>
						Open Image
					</Button>
				}
			/>
		)
	}

	const { info } = document

	return (
		<>
			<PanelSection title="Properties">
				<Property label="Name">{document.name}</Property>
				<Property label="Path">
					<span className="break-all">{document.source.path}</span>
				</Property>
				{info ? (
					<>
						<Property label="Format">{info.format.toUpperCase()}</Property>
						<Property label="Size">
							{info.width} × {info.height} px
						</Property>
						<Property label="Channels">{info.channels === 3 ? 'RGB' : info.bayer ? `Mono (CFA ${info.bayer})` : 'Mono'}</Property>
					</>
				) : (
					<p className="m-0 text-ink-300">{document.status === 'loading' ? 'Opening…' : 'Unavailable'}</p>
				)}
			</PanelSection>
			{info && <Acquisition info={info} />}
			<PanelSection title="Display">
				{document.rendering ? (
					<>
						<Property label="Stretch">Auto</Property>
						<Property label="Shadow">{document.rendering.result.stretch.shadow.toFixed(4)}</Property>
						<Property label="Midtone">{document.rendering.result.stretch.midtone.toFixed(4)}</Property>
						<Property label="Highlight">{document.rendering.result.stretch.highlight.toFixed(4)}</Property>
					</>
				) : (
					<p className="m-0 text-ink-300">Not rendered yet.</p>
				)}
			</PanelSection>
			<PanelSection title="Histogram and Statistics">
				<PlannedControls items={['Histogram', 'Mean, median, and deviation']} />
			</PanelSection>
			<PanelSection title="Analysis and Processing">
				<PlannedControls items={['Plate solving', 'Star detection', 'Manual stretch and processing']} />
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
	const rows = ACQUISITION_KEYWORDS.filter(([keyword]) => info.header[keyword] !== undefined)

	return (
		<PanelSection title="Acquisition">
			{rows.length > 0 ? (
				rows.map(([keyword, label]) => (
					<Property key={keyword} label={label}>
						{String(info.header[keyword])}
					</Property>
				))
			) : (
				<p className="m-0 text-ink-300">No acquisition data in the header.</p>
			)}
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
