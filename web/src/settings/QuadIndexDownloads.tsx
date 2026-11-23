import type { QuadIndexBandItem, QuadIndexSource } from 'api'
import { toArcmin, toDeg } from 'nebulosa/src/math/units/angle'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { formatByteSize, formatCount } from '../format'
import { PanelSection } from '../shell/ContextualPanel'
import { Button } from '../ui/Button'
import { ConfirmButton } from '../ui/ConfirmButton'
import { DataRow } from '../ui/DataRow'
import { Notice } from '../ui/Notice'
import { ProgressBar } from '../ui/ProgressBar'
import { StatusBadge, type StatusTone } from '../ui/StatusBadge'
import { changeQuadIndex, quadIndexesState, refreshQuadIndexes } from './quadindexes'

// Downloadable quad index bands of the built-in plate solver, in its settings: the default index folder they are
// installed into and whether the solver searches it, then each source with where its stars come from, and each of its
// bands with the quad sizes it holds, the fields of view it suits and is searched for, its sizes, its state, and the
// action that downloads, cancels, or removes it. A download runs on the server and outlives the tab; its progress
// arrives through the store.

export interface QuadIndexDownloadsProps {
	// Index Folder of the draft of the settings.
	readonly indexDirectory: string
	// Empties the Index Folder of the draft, so the solver searches the default index folder once saved.
	readonly onUseDefault: () => void
}

// Returns an angle in radians as a field or quad size: arcminutes below a degree ("11.3′"), else degrees ("1.9°").
function formatSize(angle: number) {
	const arcmin = toArcmin(angle)
	return arcmin < 59.95 ? `${arcmin.toFixed(1)}′` : `${toDeg(angle).toFixed(1)}°`
}

// State of a band in words and tone.
function bandState(band: QuadIndexBandItem): { readonly label: string; readonly tone: StatusTone } {
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
	return band.published ? { label: 'Not Installed', tone: 'neutral' } : { label: 'Not Shared Yet', tone: 'muted' }
}

// One band: its quads, the fields it suits, its sizes, state, and action.
function Band({ band }: { readonly band: QuadIndexBandItem }) {
	const state = useSnapshot(quadIndexesState)
	const { label, tone } = bandState(band)
	const pending = state.pending[band.id] === true
	const active = band.job !== undefined && band.job.state !== 'failed'
	const [shortest, longest] = band.bestShortSide
	const tiles = band.tileNside === 0 ? 'One whole-sky file' : `${formatCount(band.files)} tiles of the whole sky`
	const installedSize = band.installed === 'partial' ? ` · ${formatCount(band.installedFiles)} of ${formatCount(band.files)} files installed` : ''
	const progress = band.job?.state === 'downloading' ? `${formatByteSize(band.job.bytes)} of ${formatByteSize(band.job.totalBytes)}` : undefined
	const error = state.errors[band.id] ?? band.job?.error

	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
				<span className="font-medium text-ink-100">
					Quads of {formatSize(band.scaleLower)} to {formatSize(band.scaleUpper)}
				</span>
				<StatusBadge tone={tone} label={label} />
			</div>
			<p className="m-0 text-pretty">
				Best for images whose shorter side is {formatSize(shortest)} to {formatSize(longest)}. Searched for fields from a diagonal of {formatSize(band.minDiagonal)} up to a shorter side of {formatSize(band.maxShortSide)}.
			</p>
			<p className="m-0 text-xs text-ink-300">
				{tiles} · {formatByteSize(band.archiveBytes)} to download · {formatByteSize(band.bytes)} on disk{installedSize}
			</p>
			{active && <ProgressBar fraction={band.job?.state === 'downloading' ? band.job.bytes / band.job.totalBytes : undefined} />}
			{progress && <p className="m-0 text-xs text-ink-300">{progress}</p>}
			<div className="flex flex-wrap items-center gap-2">
				{active ? (
					<Button variant="secondary" disabled={pending} onClick={() => void changeQuadIndex(quadIndexesState, band.id, 'cancel')}>
						Cancel
					</Button>
				) : (
					band.installed !== 'installed' && (
						<Button variant="secondary" disabled={pending || !band.published} title={band.published ? undefined : 'This band is not shared yet'} onClick={() => void changeQuadIndex(quadIndexesState, band.id, 'download')}>
							{band.job?.state === 'failed' ? 'Try Again' : band.installed === 'partial' ? 'Download Again' : 'Download'}
						</Button>
					)
				)}
				{!active && band.installedFiles > 0 && (
					<ConfirmButton
						title="Remove this band?"
						message={`The ${formatCount(band.installedFiles)} installed ${band.installedFiles === 1 ? 'file' : 'files'} of the quads of ${formatSize(band.scaleLower)} to ${formatSize(band.scaleUpper)} are deleted from the server, freeing ${formatByteSize(band.installedBytes)}. Images it suits are no longer solved without a hint until it is downloaded again.`}
						confirmLabel="Remove"
						destructive
						disabled={pending}
						onConfirm={() => void changeQuadIndex(quadIndexesState, band.id, 'remove')}
					>
						Remove
					</ConfirmButton>
				)}
			</div>
			{error && <Notice error>{error}</Notice>}
		</div>
	)
}

// Bands of one source, after where its stars come from.
function Source({ source, bands }: { readonly source: QuadIndexSource; readonly bands: readonly QuadIndexBandItem[] }) {
	const installed = bands.filter((band) => band.installed === 'installed')

	return (
		<PanelSection title={`Index Bands · ${source.name}`}>
			<Notice>{source.description}</Notice>
			<DataRow label="Installed">
				{installed.length} of {bands.length} bands · {formatByteSize(bands.reduce((sum, band) => sum + band.installedBytes, 0))}
			</DataRow>
			<ul className="m-0 flex list-none flex-col gap-4 p-0">
				{bands.map((band) => (
					<li key={band.id}>
						<Band band={band} />
					</li>
				))}
			</ul>
		</PanelSection>
	)
}

// Downloadable bands of the built-in solver.
export function QuadIndexDownloads({ indexDirectory, onUseDefault }: QuadIndexDownloadsProps) {
	const { snapshot, loadError } = useSnapshot(quadIndexesState)

	// The installed files are read again whenever the settings open, since files may be copied by hand.
	useEffect(() => void refreshQuadIndexes(quadIndexesState), [])

	if (!snapshot) {
		return (
			<PanelSection title="Index Bands">
				<Notice error={loadError !== undefined}>{loadError ?? 'Loading the index bands…'}</Notice>
			</PanelSection>
		)
	}

	return (
		<>
			<PanelSection title="Index Downloads">
				<DataRow label="Default index folder">{snapshot.directory}</DataRow>
				<Notice>Download the bands whose quads suit the fields of view of your images: a solve searches only the bands that fit its field, and reads from disk only the tiles it needs. Each band is installed in its own source folder once its download is checked complete.</Notice>
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
			{snapshot.sources.map((source) => (
				<Source key={source.id} source={source} bands={snapshot.bands.filter((band) => band.source === source.id)} />
			))}
		</>
	)
}
