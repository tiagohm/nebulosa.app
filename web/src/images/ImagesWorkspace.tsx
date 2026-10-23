import { cn } from 'cn'
import { type KeyboardEvent, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../files/files'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { WcsOverlay } from '../platesolving/WcsOverlay'
import { activeProfile, profileState, setLastImageDirectory } from '../profile/profile'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { StarOverlay } from '../stars/StarOverlay'
import { pickStar } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal } from '../ui/Modal'
import { moveIndex } from '../ui/navigation'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { FIT_VIEW } from '../viewer/transform'
import { captureFramesState, frameSourceKey } from './captureframes'
import { CaptureFramesModal } from './CaptureFramesModal'
import { ImageInspector } from './ImageInspector'
import { activeDocument, activeTool, activeView, closeImage, documentPath, type ImageDocument, type ImageViewState, imagesState, openImage, pauseLive, pinLive, resumeLive, selectImage, selectImageTool, selectStar, setImageView, shownRendering, toggleOriginal } from './images'
import { SaveImageModal } from './SaveImageModal'
import { IMAGE_TOOL_DEFINITIONS, IMAGE_TOOLS, imageToolUnavailable } from './tools'

// Images workspace: FITS and XISF images opened from the server, and frames captured by Camera Capture opened from
// Capture Frames (a frame of its own, or a live tab following a camera, with Pause, Resume, and Pin), one tab each,
// shown in the shared viewer, with the contextual tool each document selected (the Image Inspector at first) in the
// contextual panel. It works without any connection or equipment. Documents, with their own zoom, pan,
// display settings, and tool, stay open while the tab lives, across document and workspace switches.
// The viewer toolbar switches a document between its adjusted rendering and its original one. The star
// markers of the latest detection of the document's image are drawn over it while shown, and a click
// selects a star while the Star Detection tool is open. Closing
// an unsaved derived image asks first (cancel, discard, or Save As and then close), and Save As writes a
// document to a server file chosen in the file explorer.

// Distance from the pointer a click looks for a star within, in screen pixels.
const STAR_PICK_RADIUS = 8

// Images workspace.
export function ImagesWorkspace() {
	const state = useSnapshot(imagesState)
	const profiles = useSnapshot(profileState)
	const [choosing, setChoosing] = useState(false)
	const [choosingFrame, setChoosingFrame] = useState(false)
	// Unsaved document whose closing waits for a confirmation.
	const [closing, setClosing] = useState<string>()
	// Document being saved, and whether it closes once saved.
	const [saving, setSaving] = useState<{ readonly key: string; readonly closeAfter: boolean }>()
	const document = activeDocument(state)
	const view = activeView(state)
	const shown = view && shownRendering(view)
	const tool = activeTool(state)?.tool ?? 'inspector'
	const definition = IMAGE_TOOL_DEFINITIONS[tool]
	const Panel = definition.panel ?? ImageInspector
	const { result: stars } = useStarResult(document?.info?.id)
	const markers = view?.stars.visible && stars ? stars : undefined
	const { solution } = usePlateSolution(document?.info?.id, view?.plateSolving.selected)
	const wcs = view?.plateSolving.overlay ? solution : undefined
	const toolSelector = <Select options={IMAGE_TOOLS} value={tool} disabled={!document} format={(t) => IMAGE_TOOL_DEFINITIONS[t].label} disabledReason={imageToolUnavailable} onChange={(t) => document && selectImageTool(imagesState, document.key, t)} className="w-52 max-sm:w-40" />
	const openButton = (
		<div className="flex flex-wrap justify-center gap-2">
			<Button variant="secondary" onClick={() => setChoosing(true)}>
				<Icon name="folder" className="size-4" />
				Open File
			</Button>
			<Button variant="secondary" onClick={() => setChoosingFrame(true)}>
				<Icon name="camera" className="size-4" />
				Capture Frames
			</Button>
		</div>
	)
	const waiting = document?.capture?.live && !document.info

	// Closes a document, asking first when it is unsaved.
	function requestClose(key: string) {
		if (state.documents.find((d) => d.key === key)?.unsaved) setClosing(key)
		else closeImage(imagesState, key)
	}

	const closingDocument = state.documents.find((d) => d.key === closing)
	const savingDocument = state.documents.find((d) => d.key === saving?.key)

	return (
		<WorkspaceLayout workspace="images" title="Images" actions={openButton} context={toolSelector} panel={{ title: definition.panelTitle, content: <Panel document={document} view={view} onOpen={() => setChoosing(true)} onSaveAs={() => document && setSaving({ key: document.key, closeAfter: false })} /> }}>
			<div className="flex h-full flex-col">
				{state.documents.length > 0 && <DocumentTabs documents={state.documents} activeKey={state.activeKey} onClose={requestClose} />}
				<div className="min-h-0 flex-1">
					<ImageViewer
						view={view?.view ?? FIT_VIEW}
						onViewChange={(next) => document && setImageView(imagesState, document.key, next)}
						image={shown && document?.info ? { url: shown.url, width: document.info.width, height: document.info.height } : undefined}
						loading={document?.status === 'loading' || view?.renderPending}
						error={document?.error ?? view?.error}
						toolbar={
							document &&
							view && (
								<>
									<OriginalToggle documentKey={document.key} view={view} mosaic={!!document.info && document.info.channels === 1 && !!document.info.bayer} />
									{document.capture?.live && <LiveControls document={document} />}
								</>
							)
						}
						overlays={
							(markers || wcs) && view
								? (size, overlay) => (
										<>
											{wcs && <WcsOverlay solution={wcs} image={size} view={overlay} grid={view.plateSolving.grid} />}
											{markers && <StarOverlay result={markers} view={overlay} acceptedOnly={view.stars.acceptedOnly} selected={view.stars.selected?.jobId === markers.jobId ? view.stars.selected.index : undefined} />}
										</>
									)
								: undefined
						}
						onImageClick={
							markers && view && document && tool === 'star-detection'
								? (point, overlay) => {
										const index = pickStar(markers, point, STAR_PICK_RADIUS / overlay.scale, view.stars.acceptedOnly)
										selectStar(imagesState, document.key, index === undefined ? undefined : { jobId: markers.jobId, index })
									}
								: undefined
						}
						empty={
							waiting ? (
								<EmptyState title="Waiting for first captured frame" description="Images never starts a capture: the next frame Camera Capture takes with this camera appears here." />
							) : (
								<EmptyState title="No image open" description="Open a FITS or XISF image from the server, or a frame captured by a camera." action={openButton} />
							)
						}
					/>
				</div>
			</div>
			<FileExplorerModal
				open={choosing}
				title="Open Image"
				initialPath={activeProfile(profiles).settings.lastImageDirectory}
				extensions={IMAGE_EXTENSIONS}
				onClose={() => setChoosing(false)}
				onChoose={(path, directory) => {
					setChoosing(false)
					setLastImageDirectory(profileState, directory)
					void openImage(imagesState, path)
				}}
			/>
			<CaptureFramesModal open={choosingFrame} onClose={() => setChoosingFrame(false)} />
			<SaveImageModal
				document={savingDocument}
				onClose={() => setSaving(undefined)}
				onSaved={() => {
					if (saving?.closeAfter) closeImage(imagesState, saving.key)
					setSaving(undefined)
				}}
			/>
			<Modal open={!!closingDocument} onClose={() => setClosing(undefined)} title="Close unsaved image?" className="max-w-md">
				<p className="m-0 text-[13px]">{closingDocument?.name} exists only in memory. Closing it discards it.</p>
				<div className="mt-5 flex flex-wrap justify-end gap-2">
					<Button variant="secondary" onClick={() => setClosing(undefined)}>
						Cancel
					</Button>
					<Button
						variant="secondary"
						onClick={() => {
							if (closing) closeImage(imagesState, closing)
							setClosing(undefined)
						}}
					>
						Discard
					</Button>
					<Button
						data-autofocus
						onClick={() => {
							if (closing) setSaving({ key: closing, closeAfter: true })
							setClosing(undefined)
						}}
					>
						Save As…
					</Button>
				</div>
			</Modal>
		</WorkspaceLayout>
	)
}

interface OriginalToggleProps {
	// Key of the document.
	readonly documentKey: string
	// View state of the document.
	readonly view: ImageViewState
	// Whether the original rendering is a raw CFA mosaic.
	readonly mosaic: boolean
}

// Show Original toggle of the viewer toolbar, with the name of what the original shows while it is on.
function OriginalToggle({ documentKey, view, mosaic }: OriginalToggleProps) {
	const on = view.display.showOriginal

	return (
		<>
			<IconButton icon="original" label={on ? 'Show adjusted' : 'Show original'} pressed={on} disabled={!view.rendering || view.renderPending} onClick={() => void toggleOriginal(imagesState, documentKey)} />
			{on && <span className="px-1 text-xs text-accent">{mosaic ? 'Raw CFA / Mosaic' : 'Original'}</span>}
		</>
	)
}

interface LiveControlsProps {
	// Live document.
	readonly document: ImageDocument
}

// State, Pause or Resume, and Pin of a live tab in the viewer toolbar. Neither commands the camera: they only change
// which frame the tab shows.
function LiveControls({ document }: LiveControlsProps) {
	const frames = useSnapshot(captureFramesState)
	const capture = document.capture
	if (!capture?.live || document.source.kind !== 'live') return null

	const source = frames.sources[frameSourceKey(document.source.connectionId, document.source.deviceId)]
	const following = capture.live === 'following'
	const status = capture.error ? 'Frame unavailable' : !capture.frame ? 'Waiting for frame' : capture.live === 'pausedForAnalysis' ? 'Paused for analysis' : !following ? 'Paused' : source && !source.connected ? 'Source offline' : 'Following'

	return (
		<>
			<span className="h-5 w-px bg-line-100" />
			<span title={capture.error} className={cn('px-1 text-xs', capture.error ? 'text-danger' : following ? 'text-success' : 'text-accent')}>
				{status}
				{capture.frame && ` · #${capture.frame.generation}`}
			</span>
			{following ? <IconButton icon="pause" label="Pause" onClick={() => pauseLive(imagesState, document.key)} /> : <IconButton icon="play" label="Resume" onClick={() => void resumeLive(imagesState, document.key, source?.latestAvailableFrameId)} />}
			<IconButton icon="pin" label="Pin as image tab" disabled={!capture.frame || !capture.lease} onClick={() => void pinLive(imagesState, document.key)} />
		</>
	)
}

interface DocumentTabsProps {
	// Open documents in tab order.
	readonly documents: readonly ImageDocument[]
	// Key of the document shown.
	readonly activeKey?: string
	// Asks to close a document.
	readonly onClose: (key: string) => void
}

// Returns the tooltip of a document tab: where its file is, where it was derived from, or which frame or camera it
// shows.
function documentTooltip(document: ImageDocument): string {
	if (document.source.kind === 'live') return `Follows ${document.capture?.frame?.cameraName ?? 'the camera'}${document.capture?.frame ? `, showing frame #${document.capture.frame.generation}` : ''}`
	if (document.source.kind === 'capture') return document.capture?.frame ? `${document.capture.frame.cameraName}, frame #${document.capture.frame.generation}` : document.name
	const path = documentPath(document)
	if (path) return path
	return document.source.kind === 'derived' ? `Derived from ${document.source.sourceName}, not saved` : document.name
}

// Tab strip of the open documents. Arrow keys move between tabs, Delete closes the focused one; an
// unsaved document is marked with an accent dot.
function DocumentTabs({ documents, activeKey, onClose }: DocumentTabsProps) {
	const stripRef = useRef<HTMLDivElement>(null)

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const index = documents.findIndex((d) => d.key === activeKey)
		const next = moveIndex(index, documents.length, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? '' : e.key)

		if (next !== undefined) {
			e.preventDefault()
			selectImage(imagesState, documents[next].key)
			stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]')[next]?.focus()
		} else if (e.key === 'Delete' && activeKey) {
			e.preventDefault()
			onClose(activeKey)
		}
	}

	return (
		<div ref={stripRef} onKeyDown={handleKeyDown} className="flex h-9 flex-none items-end gap-px overflow-x-auto border-b border-line-100 bg-base-100 px-2">
			{documents.map((document) => {
				const active = document.key === activeKey

				return (
					<div key={document.key} className={cn('group flex h-8 max-w-56 flex-none items-center rounded-t-sm border border-b-0', active ? 'border-line-100 bg-base-000 text-ink-100' : 'border-transparent text-ink-300 hover:bg-base-200 hover:text-ink-100')}>
						<button
							type="button"
							data-tab
							tabIndex={active ? 0 : -1}
							title={documentTooltip(document)}
							onClick={() => selectImage(imagesState, document.key)}
							onAuxClick={(e) => e.button === 1 && onClose(document.key)}
							className="flex h-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent pr-1 pl-3 font-mono text-xs text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
						>
							{document.status === 'error' && <span className="size-1.5 flex-none rounded-full bg-danger" />}
							{document.unsaved && <span title="Not saved" className="size-1.5 flex-none rounded-full bg-accent" />}
							<span className="truncate">{document.name}</span>
						</button>
						<button
							type="button"
							tabIndex={-1}
							title={`Close ${document.name}`}
							onClick={() => onClose(document.key)}
							className={cn('mr-1 flex size-5 flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-300 hover:bg-base-300 hover:text-ink-100', active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
						>
							<Icon name="close" className="size-3.5" strokeWidth={2} />
							<span className="sr-only">Close</span>
						</button>
					</div>
				)
			})}
		</div>
	)
}
