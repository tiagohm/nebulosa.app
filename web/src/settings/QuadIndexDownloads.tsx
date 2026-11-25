import type { QuadIndexBandItem, QuadIndexSource } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, formatCount } from '../format'
import { formatFieldSize, missingText } from '../framing/OpticsFields'
import { EQUIPMENT_FRAMING_ID, missingCameraName, type ResolvedFraming, useResolvedFramings } from '../framing/resolve'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { ProgressBar } from '../ui/ProgressBar'
import { StatusBadge, type StatusTone } from '../ui/StatusBadge'
import { bandsForField, changeQuadIndex, formatBandAngle, formatBandRange, quadIndexesState, refreshQuadIndexes } from './quadindexes'

// Downloadable quad index bands of the built-in plate solver, in its settings: the default index folder they are
// installed into and whether the solver searches it; then, for the Equipment Setup and every saved framing, the bands
// that suit its field of view, whether they are installed, and the action that downloads the missing ones; then each
// source with where its stars come from, and each of its bands named by the shorter side of the fields it suits, with
// its quad sizes, its sizes, the framings it suits, its state, and the action that downloads, cancels, or removes it. A
// download runs on the server and outlives the tab; its progress arrives through the store.

export interface QuadIndexDownloadsProps {
	// Index Folder of the draft of the settings.
	readonly indexDirectory: string
	// Empties the Index Folder of the draft, so the solver searches the default index folder once saved.
	readonly onUseDefault: () => void
}

// Whether a band has a download queued or running.
function isDownloading(band: QuadIndexBandItem) {
	return band.job !== undefined && band.job.state !== 'failed'
}

// State of a band in words and tone; undefined for a band that can simply be downloaded, which its Download button says.
function bandState(band: QuadIndexBandItem): { readonly label: string; readonly tone: StatusTone } | undefined {
	switch (band.job?.state) {
		case 'queued':
			return { label: 'Queued', tone: 'active' }
		case 'downloading':
			return { label: 'Downloading', tone: 'active' }
		case 'installing':
			return { label: 'Installing', tone: 'active' }
		case 'failed':
			return { label: 'Failed', tone: 'danger' }
	}

	if (band.installed === 'installed') return { label: 'Installed', tone: 'success' }
	if (band.installed === 'partial') return { label: 'Incomplete', tone: 'warning' }
	return band.published ? undefined : { label: 'Not Shared Yet', tone: 'muted' }
}

// Name of a band for people: the shorter side of the fields it suits.
function bandName(band: QuadIndexBandItem) {
	return `Fields ${formatBandRange(band.bestShortSide[0], band.bestShortSide[1])}`
}

// Names of the bands of a list joined for a sentence: "a", "a and b", or "a, b, and c".
function joinNames(names: readonly string[]) {
	if (names.length <= 2) return names.join(' and ')
	return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`
}

// One band: the fields it suits, its quads and sizes, the framings it suits, its state, and its action.
function Band({ band, suits }: { readonly band: QuadIndexBandItem; readonly suits: readonly string[] }) {
	const state = useSnapshot(quadIndexesState)
	const status = bandState(band)
	const pending = state.pending[band.id] === true
	const active = isDownloading(band)
	const partial = band.installed === 'partial' ? ` · ${formatCount(band.installedFiles)} of ${formatCount(band.files)} files installed` : ''
	const progress = band.job?.state === 'downloading' ? `${formatByteSize(band.job.bytes)} of ${formatByteSize(band.job.totalBytes)}` : undefined
	const error = state.errors[band.id] ?? band.job?.error

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-medium text-ink-100">{bandName(band)}</span>
						{status && <StatusBadge tone={status.tone} label={status.label} />}
					</div>
					<span className="text-xs text-ink-300 tabular-nums">
						Quads {formatBandRange(band.scaleLower, band.scaleUpper)} · {formatByteSize(band.archiveBytes)} download · {formatByteSize(band.bytes)} on disk{partial}
					</span>
					{suits.length > 0 && <span className="text-xs text-ink-200">Suits {joinNames(suits)}</span>}
				</div>
				<div className="flex items-center gap-2">
					{active ? (
						<Button variant="secondary" disabled={pending} onClick={() => void changeQuadIndex(quadIndexesState, band.id, 'cancel')}>
							Cancel
						</Button>
					) : band.installed === 'installed' ? (
						<ConfirmButton
							title="Remove this band?"
							message={`The ${formatCount(band.installedFiles)} installed ${band.installedFiles === 1 ? 'file' : 'files'} of the band for fields ${formatBandRange(band.bestShortSide[0], band.bestShortSide[1])} are deleted from the server, freeing ${formatByteSize(band.installedBytes)}. Images it suits are no longer solved without a hint until it is downloaded again.`}
							confirmLabel="Remove"
							destructive
							disabled={pending}
							onConfirm={() => void changeQuadIndex(quadIndexesState, band.id, 'remove')}
						>
							Remove
						</ConfirmButton>
					) : (
						<Button variant="secondary" disabled={pending || !band.published} title={band.published ? undefined : 'This band is not shared yet'} onClick={() => void changeQuadIndex(quadIndexesState, band.id, 'download')}>
							{band.job?.state === 'failed' ? 'Try Again' : band.installed === 'partial' ? 'Download Again' : 'Download'}
						</Button>
					)}
				</div>
			</div>
			{active && <ProgressBar fraction={band.job?.state === 'downloading' ? band.job.bytes / band.job.totalBytes : undefined} />}
			{progress && <p className="m-0 text-xs text-ink-300 tabular-nums">{progress}</p>}
			{!active && band.installed === 'partial' && (
				<div>
					<ConfirmButton
						title="Remove this band?"
						message={`The ${formatCount(band.installedFiles)} installed ${band.installedFiles === 1 ? 'file' : 'files'} of the band for fields ${formatBandRange(band.bestShortSide[0], band.bestShortSide[1])} are deleted from the server, freeing ${formatByteSize(band.installedBytes)}.`}
						confirmLabel="Remove"
						destructive
						disabled={pending}
						onConfirm={() => void changeQuadIndex(quadIndexesState, band.id, 'remove')}
					>
						Remove
					</ConfirmButton>
				</div>
			)}
			{error && <Notice error>{error}</Notice>}
		</div>
	)
}

// One field of view: the framing, its size, the bands that suit it, whether they are installed, and the action that
// downloads the missing ones.
function FieldBands({ framing, bands }: { readonly framing: ResolvedFraming; readonly bands: readonly QuadIndexBandItem[] }) {
	const { pending } = useSnapshot(quadIndexesState)
	const { field } = framing

	if ('missing' in field) {
		return (
			<li className="flex flex-col gap-0.5 py-2.5">
				<span className="font-medium text-ink-100">{framing.name}</span>
				<span className="text-xs text-ink-300">Set its {missingText(field, missingCameraName(framing.camera)).toLowerCase()} to see the bands it needs.</span>
			</li>
		)
	}

	const suited = bandsForField(bands, field.width, field.height)
	const missing = suited.filter((band) => band.installed !== 'installed' && !isDownloading(band))
	const downloadable = missing.filter((band) => band.published)
	const downloading = suited.some(isDownloading)
	const state: { readonly label: string; readonly tone: StatusTone } = suited.length === 0 ? { label: 'No Band', tone: 'muted' } : downloading ? { label: 'Downloading', tone: 'active' } : missing.length === 0 ? { label: 'Ready', tone: 'success' } : { label: `${missing.length} Missing`, tone: 'warning' }
	const shortest = bands[0]?.bestShortSide[0]
	const longest = bands.at(-1)?.bestShortSide[1]

	async function download() {
		for (const band of downloadable) await changeQuadIndex(quadIndexesState, band.id, 'download')
	}

	return (
		<li className="flex flex-col gap-2 py-2.5">
			<div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
				<div className="flex min-w-0 flex-col gap-0.5">
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
						<span className="font-medium text-ink-100">
							{framing.name} <span className="font-normal text-ink-300 tabular-nums">· {formatFieldSize(field.width, field.height)}</span>
						</span>
						<StatusBadge tone={state.tone} label={state.label} />
					</div>
					<span className="text-xs text-ink-300">
						{suited.length > 0
							? `Bands for fields ${joinNames(suited.map((band) => formatBandRange(band.bestShortSide[0], band.bestShortSide[1])))}.`
							: shortest !== undefined && longest !== undefined
								? `No band suits its shorter side: the bands serve fields from ${formatBandAngle(shortest)} to ${formatBandAngle(longest)}.`
								: 'No band is offered.'}
					</span>
				</div>
				<div className="flex items-center gap-2">
					{missing.length > 0 && (
						<Button variant="secondary" disabled={downloadable.length === 0 || downloadable.some((band) => pending[band.id])} title={downloadable.length === 0 ? 'Its bands are not shared yet' : undefined} onClick={() => void download()}>
							Download {downloadable.length === 1 ? 'Band' : `${formatCount(downloadable.length)} Bands`} · {formatByteSize(downloadable.reduce((sum, band) => sum + band.archiveBytes, 0))}
						</Button>
					)}
				</div>
			</div>
		</li>
	)
}

// Bands each field of view of the Equipment Setup and the saved framings needs.
function YourFields({ framings, bands }: { readonly framings: readonly ResolvedFraming[]; readonly bands: readonly QuadIndexBandItem[] }) {
	return (
		<PanelSection title="For Your Fields">
			<Notice>The bands that suit the field of view of the Equipment Setup and of each framing. Two bands suit a field in general; a solve also searches the other installed bands that fit it.</Notice>
			<ul className="m-0 flex list-none flex-col divide-y divide-line-100 p-0">
				{framings.map((framing) => (
					<FieldBands key={framing.id} framing={framing} bands={bands} />
				))}
			</ul>
		</PanelSection>
	)
}

// Bands of one source, after where its stars come from.
function Source({ source, bands, framings }: { readonly source: QuadIndexSource; readonly bands: readonly QuadIndexBandItem[]; readonly framings: readonly ResolvedFraming[] }) {
	const installed = bands.filter((band) => band.installed === 'installed')
	// Names of the framings each band suits, by band id.
	const suits = new Map<string, string[]>()

	for (const framing of framings) {
		if ('missing' in framing.field) continue
		for (const band of bandsForField(bands, framing.field.width, framing.field.height)) suits.set(band.id, [...(suits.get(band.id) ?? []), framing.name])
	}

	return (
		<PanelSection title={`Index Bands · ${source.name}`}>
			<Notice>{source.description} Each band is named by the shorter side of the images it suits.</Notice>
			<DataRow label="Installed">
				{installed.length} of {bands.length} bands · {formatByteSize(bands.reduce((sum, band) => sum + band.installedBytes, 0))}
			</DataRow>
			<ul className="m-0 flex list-none flex-col divide-y divide-line-100 p-0">
				{bands.map((band) => (
					<li key={band.id} className="py-2.5">
						<Band band={band} suits={suits.get(band.id) ?? []} />
					</li>
				))}
			</ul>
		</PanelSection>
	)
}

// Downloadable bands of the built-in solver.
export function QuadIndexDownloads({ indexDirectory, onUseDefault }: QuadIndexDownloadsProps) {
	const { snapshot, loadError } = useSnapshot(quadIndexesState)
	const framings = useResolvedFramings()

	// The installed files are read again whenever the settings open, since files may be copied by hand.
	useEffect(() => void refreshQuadIndexes(quadIndexesState), [])

	if (!snapshot) {
		return (
			<PanelSection title="Index Bands">
				<Notice error={loadError !== undefined}>{loadError ?? 'Loading the index bands…'}</Notice>
			</PanelSection>
		)
	}

	// The Equipment Setup is listed even when its field of view is not known, so it says what is missing; a framing only
	// once it has one.
	const fields = framings.filter((framing) => framing.id === EQUIPMENT_FRAMING_ID || !('missing' in framing.field))

	return (
		<>
			<PanelSection title="Index Downloads">
				<DataRow label="Default index folder">{snapshot.directory}</DataRow>
				<Notice>A solve searches only the installed bands that fit the field of view of its image, and reads from disk only the tiles it needs. A band is installed once its download is checked complete.</Notice>
				{!snapshot.searched &&
					(indexDirectory.trim() ? (
						<>
							<Notice warning>The Index Folder is set to another folder, so the downloaded bands are not searched. Empty it to search them.</Notice>
							<div>
								<Button variant="secondary" onClick={onUseDefault}>
									Use the Default Folder
								</Button>
							</div>
						</>
					) : (
						<Notice>Save the changes to search the downloaded bands.</Notice>
					))}
			</PanelSection>
			<YourFields framings={fields} bands={snapshot.bands} />
			{snapshot.sources.map((source) => (
				<Source key={source.id} source={source} bands={snapshot.bands.filter((band) => band.source === source.id)} framings={fields} />
			))}
		</>
	)
}
