import type { CaptureFrameSummary } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import { useSnapshot } from 'valtio'
import { Icon } from '../ui/Icon'
import { moveIndex } from '../ui/navigation'
import { captureFramesState, frameSourceKey, frameUnavailableReason, loadRecentFrames } from './captureframes'
import { type CameraFrameSelection, type ImageDocument, imagesState, selectCameraFrame } from './images'

// Capture frames carousel of a camera tab, below the viewer: the Latest card first, the dynamic reference to the latest
// frame of the camera, then a card for each saved frame, newest first, without the one Latest already shows. Selecting
// a card selects what the tab shows; it only opens and renders the frame, and never runs an analysis. Cards show
// metadata only (no pixels are loaded for them), with a reserved area for a future thumbnail. Arrow keys, Home, and
// End move between cards, and Enter or Space selects one. The saved frames of the camera are fetched when its tab is
// shown.

interface CaptureFramesCarouselProps {
	// Camera tab.
	readonly document: ImageDocument
	// Heading of the strip, such as the switch between the views of the bottom area; "Capture Frames" when absent.
	readonly title?: ReactNode
}

// Card of the carousel: the Latest card or a saved frame.
type Card = { readonly kind: 'latest'; readonly frame?: CaptureFrameSummary } | { readonly kind: 'saved'; readonly frame: CaptureFrameSummary }

// Returns the hh:mm:ss UTC time of a Unix time in milliseconds.
function timeOf(time: number): string {
	return new Date(time).toISOString().slice(11, 19)
}

// Returns the tooltip of a frame: its id, time, exposure, size, file, and availability.
function frameTooltip(frame: CaptureFrameSummary): string {
	const lines = [`Frame ${frame.frameId}`, `${new Date(frame.time).toISOString().slice(0, 19).replace('T', ' ')} UTC`]
	if (frame.acquisition?.exposure !== undefined) lines.push(`Exposure ${frame.acquisition.exposure} s`)
	if (frame.width !== undefined && frame.height !== undefined) lines.push(`${frame.width} × ${frame.height} px`)
	if (frame.fileName) lines.push(frame.fileName)
	lines.push(frameUnavailableReason(frame) ?? (frame.availability === 'memory' ? 'In memory' : 'Saved file'))
	return lines.join('\n')
}

// Returns the availability of a frame, for people.
function availabilityLabel(frame: CaptureFrameSummary): string {
	return frameUnavailableReason(frame) ?? (frame.availability === 'memory' ? 'In memory' : 'Saved file')
}

// Carousel of the frames of a camera tab.
export function CaptureFramesCarousel({ document, title }: CaptureFramesCarouselProps) {
	const frames = useSnapshot(captureFramesState)
	const stripRef = useRef<HTMLDivElement>(null)
	const camera = document.camera
	const source = document.source.kind === 'camera' ? document.source : undefined
	const connectionId = source?.connectionId
	const deviceId = source?.deviceId
	const key = connectionId !== undefined && deviceId !== undefined ? frameSourceKey(connectionId, deviceId) : ''

	useEffect(() => {
		if (connectionId === undefined || deviceId === undefined) return
		const fetched = frameSourceKey(connectionId, deviceId)
		if (!captureFramesState.frames[fetched] && !captureFramesState.loading[fetched]) void loadRecentFrames(captureFramesState, connectionId, deviceId)
	}, [connectionId, deviceId])

	if (!camera || !source) return null

	const summary = frames.sources[key]
	const latestId = summary?.latestAvailableFrameId
	const saved = frames.frames[key] ?? []
	const latestFrame = latestId ? (frames.latest[key]?.frameId === latestId ? frames.latest[key] : saved.find((f) => f.frameId === latestId)) : undefined
	const cards: Card[] = [{ kind: 'latest', frame: latestFrame }, ...saved.filter((f) => f.frameId !== latestId).map((frame): Card => ({ kind: 'saved', frame }))]
	// Card the keyboard enters the strip on: the selected one, or Latest when the selection has no card.
	const focusIndex = Math.max(
		0,
		cards.findIndex((card) => isSelected(card, camera.selection)),
	)
	const shownSequence = camera.shown?.frame.sequence ?? 0
	const newer = camera.selection.kind !== 'latest' && !!latestFrame && latestFrame.sequence > shownSequence

	// Selects a card and keeps it visible.
	function choose(index: number) {
		const card = cards[index]
		if (!card || !source) return
		const selection: CameraFrameSelection = card.kind === 'latest' ? { kind: 'latest' } : { kind: 'saved', frameId: card.frame.frameId }
		void selectCameraFrame(imagesState, document.key, selection, captureFramesState)
		const element = stripRef.current?.querySelectorAll<HTMLElement>('[data-card]')[index]
		element?.focus()
		element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	}

	// Moves the focus between cards with the navigation keys, without selecting.
	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const focused = Array.from(stripRef.current?.querySelectorAll<HTMLElement>('[data-card]') ?? []).indexOf(e.target as HTMLElement)
		const next = moveIndex(focused, cards.length, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? '' : e.key)
		if (next === undefined) return
		e.preventDefault()
		const element = stripRef.current?.querySelectorAll<HTMLElement>('[data-card]')[next]
		element?.focus()
		element?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
	}

	return (
		<div className="flex-none border-t border-line-100 bg-base-100">
			<div className="flex items-center justify-between px-3 pt-1.5 font-mono text-[11px] tracking-wide text-ink-300 uppercase">
				{title ?? <span>Capture Frames</span>}
				<span>{summary?.count ?? saved.length} saved</span>
			</div>
			<div ref={stripRef} onKeyDown={handleKeyDown} className="flex gap-2 overflow-x-auto px-3 pt-1.5 pb-2">
				{cards.map((card, index) => (
					<FrameCard
						key={card.kind === 'latest' ? 'latest' : card.frame.frameId}
						card={card}
						selected={isSelected(card, camera.selection)}
						focusable={index === focusIndex}
						loading={!!card.frame && camera.requested === card.frame.frameId}
						error={isSelected(card, camera.selection) ? camera.error : undefined}
						restored={card.kind === 'latest' && summary?.latestRestored === true}
						newer={card.kind === 'latest' && newer}
						onSelect={() => choose(index)}
					/>
				))}
			</div>
		</div>
	)
}

// Returns whether a card is the one a selection names.
function isSelected(card: Card, selection: CameraFrameSelection): boolean {
	return card.kind === 'latest' ? selection.kind === 'latest' : selection.kind !== 'latest' && selection.frameId === card.frame.frameId
}

interface FrameCardProps {
	// Card shown.
	readonly card: Card
	// Whether the tab's selection names it.
	readonly selected: boolean
	// Whether it is the card the keyboard enters the strip on.
	readonly focusable: boolean
	// Whether its frame is being opened.
	readonly loading: boolean
	// Why showing it failed, while it is selected.
	readonly error?: string
	// Whether the Latest card shows a saved frame of an earlier server run.
	readonly restored: boolean
	// Whether the Latest card has a newer frame than the one shown, while another card is selected.
	readonly newer: boolean
	// Selects it.
	readonly onSelect: () => void
}

// Card of a frame: an icon in the area reserved for a thumbnail, its label and number, the time of its acquisition,
// its exposure, and a textual state; the selected card is outlined, not only colored. A saved frame that cannot be
// opened shows why and cannot be selected.
function FrameCard({ card, selected, focusable, loading, error, restored, newer, onSelect }: FrameCardProps) {
	const { frame } = card
	const unavailable = card.kind === 'saved' ? frameUnavailableReason(card.frame) : undefined
	const label = card.kind === 'latest' ? (restored ? 'Latest saved' : 'Latest') : `#${card.frame.generation}`
	const state = error ? 'Error' : loading ? 'Loading…' : selected ? 'Selected' : frame ? availabilityLabel(frame) : 'No frame yet'

	return (
		<button
			type="button"
			data-card
			tabIndex={focusable ? 0 : -1}
			disabled={!!unavailable}
			title={[frame ? frameTooltip(frame) : 'No captured image available', error].filter(Boolean).join('\n')}
			onClick={onSelect}
			className={cn(
				'flex h-[108px] w-36 flex-none cursor-pointer flex-col gap-1 rounded-sm border bg-base-000 p-1.5 text-left font-mono text-[11px] text-ink-200 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60',
				selected ? 'border-accent ring-1 ring-accent' : 'border-line-100 hover:border-line-200',
			)}
		>
			<span className="relative flex min-h-0 flex-1 items-center justify-center rounded-xs bg-base-200 text-ink-300">
				<Icon name={card.kind === 'latest' ? 'camera' : 'images'} className="size-5" />
				{newer && <span className="absolute top-1 right-1 rounded-xs bg-accent px-1 text-[10px] text-on-accent">New</span>}
			</span>
			<span className="flex items-baseline justify-between gap-1 text-ink-100">
				<span className="truncate">{label}</span>
				{card.kind === 'latest' && frame && <span className="text-ink-300">#{frame.generation}</span>}
			</span>
			<span className="flex items-baseline justify-between gap-1 text-ink-300">
				<span>{frame ? timeOf(frame.time) : '—'}</span>
				{frame?.acquisition?.exposure !== undefined && <span>{frame.acquisition.exposure}s</span>}
			</span>
			<span className={cn('truncate', error || unavailable ? 'text-danger' : selected ? 'text-accent' : 'text-ink-300')}>{unavailable ?? state}</span>
		</button>
	)
}
