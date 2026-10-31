import type { SaveFormat } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { AnnotationOverlay, shownAnnotations } from '../annotations/AnnotationOverlay'
import { annotationMatchesWcs, annotationPlateSolveJobId } from '../annotations/annotations'
import { mergeProjections, pickAnnotation, projectAnnotations } from '../annotations/geometry'
import { useAnnotationResult } from '../annotations/useAnnotationResult'
import { AUTO_FOCUS_STATE_LABELS, autoFocusRuntime } from '../camera/autofocus'
import { cameraKey, captureCount, captureRuntime, captureRunning, captureStatus, FILE_STATE_LABELS, fileState } from '../camera/capture'
import { DarvOverlay, useDarvOverlay } from '../camera/DarvOverlay'
import { FocusCurve } from '../camera/FocusCurve'
import { GUIDING_STATE_LABELS, guidingRuntime, selectGuidingTarget } from '../camera/guiding'
import { GuidingGraph } from '../camera/GuidingGraph'
import { GuidingOverlay, useGuidingOverlay } from '../camera/GuidingOverlay'
import { useTargetCenteringOverlay } from '../camera/targetcentering.overlay'
import { TppaOverlay, useTppaOverlay } from '../camera/TppaOverlay'
import { FileExplorerModal } from '../files/FileExplorerModal'
import { IMAGE_EXTENSIONS } from '../files/files'
import { MOUNT_POINTING_STATE_LABELS, mountPointingRuntime } from '../mountpointing/mountpointing'
import { PointingMapView } from '../mountpointing/PointingMapView'
import { ASTROMETRY_MODES, type AstrometryMode } from '../platesolving/measurement'
import { usePlateSolution } from '../platesolving/usePlateSolution'
import { WcsAidsOverlay } from '../platesolving/WcsAidsOverlay'
import { WcsCursorStatus } from '../platesolving/WcsCursorStatus'
import { WcsGridOverlay } from '../platesolving/WcsGridOverlay'
import { WcsOverlay } from '../platesolving/WcsOverlay'
import { activeProfile, imageAstrometrySettings, profileState, setLastImageDirectory, starProfileSettings } from '../profile/profile'
import { EmptyState, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { StarOverlay } from '../stars/StarOverlay'
import { inspectStar, starProfileOf } from '../stars/starprofile'
import { StarProfileOverlay } from '../stars/StarProfileOverlay'
import { pickStar } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { StreakOverlay } from '../streaks/StreakOverlay'
import { pickStreak } from '../streaks/streaks'
import { useStreakResult } from '../streaks/useStreakResult'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { Modal } from '../ui/Modal'
import { moveIndex } from '../ui/navigation'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { Reticle } from '../viewer/Reticle'
import { FIT_VIEW, pixelAt, type Point } from '../viewer/transform'
import { useAstrometryTool } from './astrometryTool'
import { useCameraOperationContext } from './cameracontext'
import { holdCameraFrame, selectCameraFrame } from './cameratabs'
import { captureFramesState, frameSourceKey } from './captureframes'
import { CaptureFramesCarousel } from './CaptureFramesCarousel'
import { DisplayToolbar } from './DisplayToolbar'
import { ImageInspector } from './ImageInspector'
import { ImageMenu } from './ImageMenu'
import {
	activeDocument,
	activeTool,
	addMarker,
	activeView,
	closeImage,
	documentPath,
	type ImageDocument,
	type ImageViewState,
	imagesState,
	isClosable,
	isMosaic,
	openImage,
	selectAnnotation,
	selectImage,
	selectImageTool,
	selectStar,
	selectStreak,
	setImageView,
	shownRendering,
	toggleImageOverlays,
	toggleOriginal,
} from './images'
import { MeasurementOverlay } from './MeasurementOverlay'
import { SaveImageModal } from './SaveImageModal'
import { SaveImagePopover } from './SaveImagePopover'
import { TargetOffsetOverlay } from './TargetOffsetOverlay'
import { IMAGE_TOOL_DEFINITIONS, imageToolGroup, imageToolsFor, imageToolUnavailable } from './tools'

// Images workspace: a permanent camera tab for each connected camera of the watched connection, showing the frames
// its camera takes, then FITS and XISF images opened from the server, one closable tab each, shown in the shared
// viewer, with the contextual tool each document selected (the Image Inspector at first) in the contextual panel. It
// works without any connection or equipment; only the camera operations of a camera tab command its camera, and the
// toolbar of a camera tab shows the state of its capture whatever tool is selected, and its bottom area the Focus
// Curve of its Auto Focus or the graph of its guiding on request; while Guiding is the tool, a click on the session's
// current guide frame selects the star nearest it. Documents, with their own zoom,
// pan, display settings, and tool, stay open while the tab lives, across document and workspace switches; a camera
// tab follows the latest frame of its camera until a saved frame is selected or a manual analysis holds the frame
// shown, and Return to Latest follows it again.
// The viewer toolbar switches a document between its adjusted rendering and its original one, and holds its display
// controls (DisplayToolbar), whose popups close when another document is shown, and its Save control
// (SaveImagePopover), which downloads a copy of any document or writes one to a server file chosen in the file
// explorer (SaveImageModal). The star
// markers of the latest detection of the document's image are drawn over it while shown, and a click
// selects a star while the Star Detection tool is open. Closing
// an unsaved derived image asks first (cancel, discard, or Save As FITS and then close).
// With a solution of the image shown, its grid, centre, passive aids (crosshair, orientation, scale bar), and the
// coordinates under the pointer are drawn from that solution, and the measure mode of the toolbar draws measurements
// (astrometryTool.ts). Clicks go to the first owner of: a Guiding star pick (which disables the measure modes), a measure
// mode, the Plate Solver tool (selecting and editing measurements), then Star Detection, the Star Profile Inspector
// (measuring the star at the click, a star detected there if any), Streak Detection, and
// Annotation. The toolbar hides every overlay of a document and shows them again as they were; while hidden only the
// Guiding star pick stays, so a click or a measure never acts on what cannot be seen.

// Distance from the pointer a click looks for a star within, in screen pixels.
const STAR_PICK_RADIUS = 8

// Distance from the pointer a click looks for a streak line within, in screen pixels.
const STREAK_PICK_RADIUS = 8

// Distance from the pointer a click looks for an annotation marker within, in screen pixels.
const ANNOTATION_PICK_RADIUS = 8

// Names of the measure modes of the viewer toolbar.
const MODE_LABELS: Readonly<Record<AstrometryMode, string>> = { pan: 'No measure', distance: 'Distance', rectangle: 'Rectangle', circle: 'Circle', marker: 'Marker' }

// Images workspace.
export function ImagesWorkspace() {
	const state = useSnapshot(imagesState)
	const profiles = useSnapshot(profileState)
	const [choosing, setChoosing] = useState(false)
	// Whether camera tabs show their bottom area (frames carousel or Focus Curve); collapsing it keeps the selection.
	const [framesShown, setFramesShown] = useState(true)
	// View of the bottom area of each camera tab, by document key; the frames carousel when absent.
	const [bottomViews, setBottomViews] = useState<Readonly<Record<string, BottomView>>>({})
	// Camera tabs whose viewer draws the central reticle, by document key; a presentation choice of the tab only.
	const [reticles, setReticles] = useState<Readonly<Record<string, boolean>>>({})
	// Unsaved document whose closing waits for a confirmation.
	const [closing, setClosing] = useState<string>()
	// Document being saved, whether it closes once saved, and the format of its file.
	const [saving, setSaving] = useState<{ readonly key: string; readonly closeAfter: boolean; readonly format: SaveFormat }>()
	// Context menu of the image shown: the document, the image point, and the client point it opened at.
	const [menu, setMenu] = useState<{ readonly key: string; readonly point: Point; readonly client: Point }>()
	// Why the latest action of the context menu failed.
	const [menuStatus, setMenuStatus] = useState<string>()
	const closeMenu = useCallback(() => setMenu(undefined), [])
	// Measure mode of each document, by document key; Pan when absent. A presentation choice of the tab only.
	const [modes, setModes] = useState<Readonly<Record<string, AstrometryMode>>>({})
	const document = activeDocument(state)
	const view = activeView(state)
	const shown = view && shownRendering(view)
	const tool = activeTool(state)?.tool ?? 'inspector'
	const definition = IMAGE_TOOL_DEFINITIONS[tool]
	const Panel = definition.panel ?? ImageInspector
	const { result: stars } = useStarResult(document?.info?.id)
	const markers = view?.stars.visible && stars ? stars : undefined
	const { result: streaks } = useStreakResult(document?.info?.id)
	const lines = view?.streaks.visible && streaks ? streaks : undefined
	const selectedStreak = lines && view?.streaks.selected?.jobId === lines.jobId ? view.streaks.selected.index : undefined
	const plateSolution = usePlateSolution(document?.info?.id, view?.plateSolving.selected)
	const { solution } = plateSolution
	const { result: annotated } = useAnnotationResult(document?.info?.id)
	const { result: searched } = useAnnotationResult(document?.info?.id, 'solarSystemBodies')
	const localProjection = useMemo(() => annotated && projectAnnotations(annotated), [annotated])
	const minorProjection = useMemo(() => searched && projectAnnotations(searched), [searched])
	// The annotation and the solar-system search are drawn only with the WCS they were computed with, so another
	// solution shown hides them.
	const annotationJobId = annotationPlateSolveJobId(plateSolution)
	const annotationResults = [annotated, searched].filter((result) => result !== undefined && annotationMatchesWcs(result, annotationJobId))
	const localShown = annotated !== undefined && annotationResults.includes(annotated)
	const minorShown = searched !== undefined && annotationResults.includes(searched)
	const annotation = useMemo(() => mergeProjections(localShown ? localProjection : undefined, minorShown ? minorProjection : undefined), [localShown, localProjection, minorShown, minorProjection])
	const selectedAnnotation = annotationResults.some((result) => result?.jobId === view?.annotation.selected?.jobId) ? view?.annotation.selected?.id : undefined
	const astrometry = imageAstrometrySettings(activeProfile(profiles).settings)
	const centered = solution && (view?.plateSolving.overlay || astrometry.orientation === 'center') ? solution : undefined
	const grid = view?.plateSolving.grid ? solution : undefined
	const camera = useCameraOperationContext(document)
	const guide = useTppaOverlay(document)
	const centering = useTargetCenteringOverlay(document)
	const trails = useDarvOverlay(document)
	const guiding = useGuidingOverlay(document)
	// A star is picked only on the session's current frame, and only while the guide output is not held.
	const picking = tool === 'guiding' && guiding && !guiding.session.guideOutputHeld ? guiding.session : undefined
	const mode = (document && modes[document.key]) ?? 'pan'
	const imageInfo = document?.info
	const reticle = !!document?.camera && reticles[document.key] === true
	const starProfiling = tool === 'star-profile'
	const starProfile = starProfiling ? starProfileOf(view, imageInfo?.id) : undefined
	const profileSettings = starProfileSettings(activeProfile(profiles).settings)
	const hasOverlays = [markers, lines, solution, annotation, reticle, guide, centering, trails, guiding, starProfile].some(Boolean)
	const overlaysHidden = view?.overlaysHidden === true
	const astrometryTool = useAstrometryTool({
		documentKey: document?.key,
		imageId: document?.info?.id,
		image: document?.info,
		solution,
		astrometry: view?.astrometry,
		mode,
		onModeChange: (next) => document && setModes((current) => ({ ...current, [document.key]: next })),
		enabled: !!solution && !picking && !overlaysHidden,
		editable: tool === 'plate-solver',
	})
	const toolSelector = <Select options={imageToolsFor(document)} value={tool} disabled={!document} format={(t) => IMAGE_TOOL_DEFINITIONS[t].label} group={imageToolGroup} disabledReason={imageToolUnavailable} onChange={(t) => document && selectImageTool(imagesState, document.key, t)} className="w-52 max-sm:w-40" />
	const openButton = <IconButton icon="folder" onClick={() => setChoosing(true)} label="Open file" />
	const waiting = document?.camera && !document.info

	// Closes a document, asking first when it is unsaved.
	function requestClose(key: string) {
		if (state.documents.find((d) => d.key === key)?.unsaved) setClosing(key)
		else closeImage(imagesState, key)
	}

	const closingDocument = state.documents.find((d) => d.key === closing)
	const savingDocument = state.documents.find((d) => d.key === saving?.key)

	return (
		<WorkspaceLayout workspace="images" title="Images" actions={openButton} context={toolSelector} panel={{ title: definition.panelTitle, content: <Panel key={document?.key} document={document} view={view} camera={camera} onOpen={() => setChoosing(true)} /> }}>
			<div className="flex h-full flex-col">
				{state.documents.length > 0 && <DocumentTabs documents={state.documents} activeKey={state.activeKey} onClose={requestClose} />}
				<div className="min-h-0 flex-1">
					<ImageViewer
						view={view?.view ?? FIT_VIEW}
						onViewChange={(next) => document && setImageView(imagesState, document.key, next)}
						image={shown && document?.info ? { url: shown.url, width: document.info.width, height: document.info.height } : undefined}
						loading={document?.status === 'loading' || view?.renderPending || !!document?.camera?.requested}
						error={document?.error ?? document?.camera?.error ?? view?.error}
						toolbar={
							document &&
							view && (
								<>
									<OriginalToggle documentKey={document.key} view={view} mosaic={!!document.info && isMosaic(document.info)} />
									<IconButton icon="layers" label={overlaysHidden ? 'Show overlays' : 'Hide overlays'} pressed={hasOverlays && !overlaysHidden} disabled={!hasOverlays} onClick={() => toggleImageOverlays(imagesState, document.key)} />
									<span className="mx-1 h-5 w-px bg-line-100" />
									<DisplayToolbar key={document.key} documentKey={document.key} info={document.info} view={view} />
									<span className="mx-1 h-5 w-px bg-line-100" />
									<SaveImagePopover document={document} view={view} onSaveToServer={(format) => setSaving({ key: document.key, closeAfter: false, format })} />
									<span className="mx-1 h-5 w-px bg-line-100" />
									{solution && <Select options={ASTROMETRY_MODES} value={mode} format={(option) => MODE_LABELS[option]} disabled={!!picking || overlaysHidden} onChange={(next) => setModes((current) => ({ ...current, [document.key]: next }))} className="w-36 max-sm:w-28" />}
									{document.camera && <CameraControls document={document} framesShown={framesShown} onToggleFrames={() => setFramesShown(!framesShown)} reticle={reticle} onToggleReticle={() => setReticles({ ...reticles, [document.key]: !reticle })} />}
								</>
							)
						}
						overlays={
							hasOverlays && view && !overlaysHidden
								? (size, overlay, cursor) => (
										<>
											{reticle && <Reticle {...size} />}
											{grid && <WcsGridOverlay solution={grid} image={size} view={overlay} settings={astrometry.grid} />}
											{centered && <WcsOverlay solution={centered} image={size} view={overlay} marker={view.plateSolving.overlay} arrows={astrometry.orientation === 'center'} />}
											{annotation && <AnnotationOverlay projection={annotation} view={overlay} state={view.annotation} selected={selectedAnnotation} />}
											{guide && <TppaOverlay geometry={guide} view={overlay} />}
											{trails && <DarvOverlay trails={trails} view={overlay} />}
											{guiding && <GuidingOverlay overlay={guiding.overlay} view={overlay} />}
											{lines && <StreakOverlay result={lines} view={overlay} labels={view.streaks.labels} selected={selectedStreak} />}
											{markers && <StarOverlay result={markers} view={overlay} acceptedOnly={view.stars.acceptedOnly} selected={view.stars.selected?.jobId === markers.jobId ? view.stars.selected.index : undefined} />}
											{starProfile && <StarProfileOverlay state={starProfile} view={overlay} settings={profileSettings} />}
											{solution && document?.info && <MeasurementOverlay solution={solution} imageId={document.info.id} image={size} view={overlay} astrometry={view.astrometry} />}
											{solution && view.astrometry.target && <TargetOffsetOverlay solution={solution} image={size} view={overlay} target={view.astrometry.target} markers={view.astrometry.markers} />}
											{centering && <TargetOffsetOverlay solution={centering.solution} image={size} view={overlay} target={centering.target} markers={[]} />}
											{solution && <WcsAidsOverlay solution={solution} image={size} view={overlay} cursor={cursor} crosshair={astrometry.crosshair} corner={astrometry.orientation === 'corner'} scaleBar={astrometry.scaleBar} />}
										</>
									)
								: undefined
						}
						status={solution ? (cursor) => <WcsCursorStatus solution={solution} cursor={cursor} style={astrometry.coordinates} /> : undefined}
						interaction={astrometryTool.interaction}
						onImageContextMenu={
							solution && document && imageInfo
								? (point, client) => {
										if (!pixelAt(imageInfo, point)) return false
										setMenu({ key: document.key, point, client })
										setMenuStatus(undefined)
										return true
									}
								: undefined
						}
						onImageClick={
							picking
								? (point) => void selectGuidingTarget(guidingRuntime, picking, [point.x - 0.5, point.y - 0.5])
								: overlaysHidden
									? undefined
									: (astrometryTool.select ??
										(markers && view && document && tool === 'star-detection'
											? (point, overlay) => {
													const index = pickStar(markers, point, STAR_PICK_RADIUS / overlay.scale, view.stars.acceptedOnly)
													selectStar(imagesState, document.key, index === undefined ? undefined : { jobId: markers.jobId, index })
												}
											: starProfiling && document && imageInfo
												? (point, overlay) => {
														if (!pixelAt(imageInfo, point)) return
														const index = stars && pickStar(stars, point, STAR_PICK_RADIUS / overlay.scale, true)
														const star = index === undefined ? undefined : stars?.stars[index]
														// A frame the camera would replace stays shown while its star is looked at.
														holdCameraFrame(imagesState, document.key)
														void inspectStar(imagesState, document.key, imageInfo.id, star ? { x: star.x, y: star.y } : { x: point.x - 0.5, y: point.y - 0.5 }, star?.hfd, profileSettings)
													}
												: lines && document && tool === 'streak-detection'
													? (point, overlay) => {
															const index = pickStreak(lines, point, STREAK_PICK_RADIUS / overlay.scale, selectedStreak)
															selectStreak(imagesState, document.key, index === undefined ? undefined : { jobId: lines.jobId, index })
														}
													: annotation && view && document && tool === 'annotation'
														? (point, overlay) => {
																const id = pickAnnotation(shownAnnotations(annotation, view.annotation), point, ANNOTATION_PICK_RADIUS / overlay.scale)
																const owner = id === undefined ? undefined : annotationResults.find((result) => result?.objects.some((object) => object.id === id))
																selectAnnotation(imagesState, document.key, owner && id !== undefined ? { jobId: owner.jobId, id } : undefined)
															}
														: undefined))
						}
						empty={
							waiting ? (
								<EmptyState title="No captured image available" description="Take a frame with Camera Acquisition: the next frame of this camera appears here." />
							) : (
								<EmptyState title="No image open" description="Open a FITS or XISF image from the server, or connect a camera to follow its frames." action={openButton} />
							)
						}
					/>
				</div>
				{document?.camera && framesShown && <CameraBottom document={document} view={bottomViews[document.key] ?? 'frames'} onView={(next) => setBottomViews({ ...bottomViews, [document.key]: next })} />}
			</div>
			{menu && solution && document?.info && menu.key === document.key && (
				<ImageMenu
					point={menu.point}
					client={menu.client}
					solution={solution}
					image={document.info}
					style={astrometry.coordinates}
					status={menuStatus}
					onStatus={setMenuStatus}
					onClose={closeMenu}
					unavailable={picking ? 'Guiding is picking a guide star.' : overlaysHidden ? 'The overlays are hidden.' : undefined}
					onAddMarker={(point) => addMarker(imagesState, document.key, { point, visible: true })}
					onMeasureFrom={astrometryTool.measureFrom}
				/>
			)}
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
			<SaveImageModal
				document={savingDocument}
				format={saving?.format ?? 'fits'}
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
							if (closing) setSaving({ key: closing, closeAfter: true, format: 'fits' })
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

interface CameraControlsProps {
	// Camera tab.
	readonly document: ImageDocument
	// Whether the capture frames carousel is shown.
	readonly framesShown: boolean
	// Shows or hides the carousel.
	readonly onToggleFrames: () => void
	// Whether the central reticle is drawn over the frame.
	readonly reticle: boolean
	// Shows or hides the reticle.
	readonly onToggleReticle: () => void
}

// Labels of the selections of a camera tab, as its toolbar shows them.
const SELECTION_LABELS: Readonly<Record<NonNullable<ImageDocument['camera']>['selection']['kind'], string>> = { latest: 'Latest', saved: 'Saved frame', inspect: 'Held for analysis' }

// Frame a camera tab shows, Return to Latest while it does not follow the latest frame, and the toggles of the bottom
// area and of the central reticle (for Mount Nudge or framing). None commands the camera: they only change which frame
// the tab shows and how.
function CameraControls({ document, framesShown, onToggleFrames, reticle, onToggleReticle }: CameraControlsProps) {
	const frames = useSnapshot(captureFramesState)
	const camera = document.camera
	if (!camera || document.source.kind !== 'camera') return null

	const source = frames.sources[frameSourceKey(document.source.connectionId, document.source.deviceId)]
	const following = camera.selection.kind === 'latest'
	const restored = following && source?.latestRestored && !!camera.shown

	return (
		<>
			<span className="h-5 w-px bg-line-100" />
			<span title={camera.error} className={cn('px-1 text-xs', camera.error ? 'text-danger' : following ? 'text-success' : 'text-accent')}>
				{restored ? 'Latest saved' : SELECTION_LABELS[camera.selection.kind]}
				{camera.shown && ` · #${camera.shown.frame.generation}`}
			</span>
			{!following && <IconButton icon="skipToEnd" label="Return to Latest" onClick={() => void selectCameraFrame(imagesState, document.key, { kind: 'latest' }, captureFramesState)} />}
			<IconButton icon="images" label={framesShown ? 'Hide frames and focus curve' : 'Show frames and focus curve'} pressed={framesShown} onClick={onToggleFrames} />
			<IconButton icon="reticle" label={reticle ? 'Hide reticle' : 'Show reticle'} pressed={reticle} onClick={onToggleReticle} />
			<CaptureStatus connectionId={document.source.connectionId} deviceId={document.source.deviceId} />
		</>
	)
}

interface CaptureStatusProps {
	// Id of the connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
}

// Compact state of the capture of a camera tab's camera, whatever tool is selected: what it does (with the time left
// of an exposure or delay), its frame count, and the file state of its latest frame while it runs, or why it failed.
// Nothing is shown for a camera that never captured or whose capture ended normally.
function CaptureStatus({ connectionId, deviceId }: CaptureStatusProps) {
	const runtime = useSnapshot(captureRuntime)
	const key = cameraKey(connectionId, deviceId)
	const session = runtime.sessions[key]
	if (!session) return null

	const running = captureRunning(session)
	const failed = session.phase === 'failed' || session.phase === 'aborted'
	if (!running && !failed) return null

	const frame = runtime.frames[key]
	const file = running && frame?.sessionId === session.sessionId && frame.file ? FILE_STATE_LABELS[fileState(frame)] : undefined
	const status = captureStatus(session)

	return (
		<>
			<span className="h-5 w-px bg-line-100" />
			<span title={status} className={cn('max-w-72 truncate px-1 text-xs tabular-nums', failed ? 'text-danger' : 'text-ink-100')}>
				{status}
				{running && ` · ${captureCount(session)}`}
				{file && ` · ${file}`}
			</span>
		</>
	)
}

// View of the bottom area of a camera tab: the capture frames carousel, the Focus Curve of its camera's Auto Focus, the
// graph of its camera's guiding, or the Pointing Map of its camera's mount pointing session.
type BottomView = 'frames' | 'curve' | 'guiding' | 'pointing'

// Views of the bottom area, in display order.
const BOTTOM_VIEWS: readonly BottomView[] = ['frames', 'curve', 'guiding', 'pointing']

// Label of each view of the bottom area.
const BOTTOM_VIEW_LABELS: Readonly<Record<BottomView, string>> = { frames: 'Captured Frames', curve: 'Focus Curve', guiding: 'Guiding Graph', pointing: 'Pointing Map' }

interface CameraBottomProps {
	// Camera tab.
	readonly document: ImageDocument
	// View chosen for the tab.
	readonly view: BottomView
	// Chooses the view of the tab.
	readonly onView: (view: BottomView) => void
}

// Bottom area of a camera tab: the capture frames carousel, and, once its camera has an Auto Focus, a guiding, or a mount
// pointing session, a switch to the Focus Curve, the guiding graph, or the Pointing Map of that session. They belong to the session, never to the frame
// selected, so they keep updating whatever frame or tool is shown; choosing a view never changes the selection. A view
// whose session is gone shows the carousel.
function CameraBottom({ document, view: chosen, onView }: CameraBottomProps) {
	const autoFocus = useSnapshot(autoFocusRuntime)
	const guidingState = useSnapshot(guidingRuntime)
	const mountPointing = useSnapshot(mountPointingRuntime)
	if (document.source.kind !== 'camera') return null

	const key = cameraKey(document.source.connectionId, document.source.deviceId)
	const session = autoFocus.sessions[key]
	const guiding = guidingState.sessions[key]
	const pointing = mountPointing.sessions[key]
	const available = BOTTOM_VIEWS.filter((option) => option === 'frames' || (option === 'curve' && session) || (option === 'guiding' && guiding) || (option === 'pointing' && pointing))
	if (available.length === 1) return <CaptureFramesCarousel document={document} />
	const view = available.includes(chosen) ? chosen : 'frames'

	const views = (
		<span className="flex gap-3">
			{available.map((option) => (
				<button
					key={option}
					type="button"
					onClick={() => onView(option)}
					className={cn('cursor-pointer border-0 bg-transparent p-0 font-mono text-[11px] tracking-wide uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', option === view ? 'text-accent' : 'text-ink-300 hover:text-ink-100')}
				>
					{BOTTOM_VIEW_LABELS[option]}
				</button>
			))}
		</span>
	)

	if (view === 'frames') return <CaptureFramesCarousel document={document} title={views} />

	return (
		<div className="flex-none border-t border-line-100 bg-base-100">
			<div className="flex items-center justify-between px-3 pt-1.5 font-mono text-[11px] tracking-wide text-ink-300 uppercase">
				{views}
				<span>{view === 'pointing' && pointing ? MOUNT_POINTING_STATE_LABELS[pointing.state] : view === 'guiding' && guiding ? (guiding.active ? GUIDING_STATE_LABELS[guiding.state] : 'Stopped') : session && AUTO_FOCUS_STATE_LABELS[session.state]}</span>
			</div>
			<div className="px-2 pb-2">
				{view === 'pointing' && pointing ? (
					<PointingMapView session={pointing} />
				) : view === 'guiding' && guiding ? (
					<GuidingGraph session={guiding} telemetry={guidingState.telemetry[guiding.sessionId]} events={guidingState.events[guiding.sessionId]} />
				) : (
					session && <FocusCurve summary={session} session={autoFocus.details[session.sessionId]} />
				)}
			</div>
		</div>
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

// Returns the tooltip of a document tab: where its file is, where it was derived from, or which camera and frame it
// shows.
function documentTooltip(document: ImageDocument): string {
	if (document.camera) return `Frames of ${document.name}${document.camera.shown ? `, showing frame #${document.camera.shown.frame.generation}` : ''}`
	const path = documentPath(document)
	if (path) return path
	return document.source.kind === 'derived' ? `Derived from ${document.source.sourceName}, not saved` : document.name
}

// Tab strip of the open documents. Arrow keys move between tabs, Delete closes the focused one; an
// unsaved document is marked with an accent dot. A camera tab has a camera icon and no way to close it.
function DocumentTabs({ documents, activeKey, onClose }: DocumentTabsProps) {
	const stripRef = useRef<HTMLDivElement>(null)

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const index = documents.findIndex((d) => d.key === activeKey)
		const next = moveIndex(index, documents.length, e.key === 'ArrowUp' || e.key === 'ArrowDown' ? '' : e.key)

		if (next !== undefined) {
			e.preventDefault()
			selectImage(imagesState, documents[next].key)
			stripRef.current?.querySelectorAll<HTMLElement>('[data-tab]')[next]?.focus()
		} else if (e.key === 'Delete' && index >= 0 && isClosable(documents[index])) {
			e.preventDefault()
			onClose(documents[index].key)
		}
	}

	return (
		<div ref={stripRef} onKeyDown={handleKeyDown} className="flex h-9 flex-none items-end gap-px overflow-x-auto border-b border-line-100 bg-base-100 px-2">
			{documents.map((document) => {
				const active = document.key === activeKey
				const closable = isClosable(document)

				return (
					<div key={document.key} className={cn('group flex h-8 max-w-56 flex-none items-center rounded-t-sm border border-b-0', active ? 'border-line-100 bg-base-000 text-ink-100' : 'border-transparent text-ink-300 hover:bg-base-200 hover:text-ink-100')}>
						<button
							type="button"
							data-tab
							tabIndex={active ? 0 : -1}
							title={documentTooltip(document)}
							onClick={() => selectImage(imagesState, document.key)}
							onAuxClick={(e) => e.button === 1 && closable && onClose(document.key)}
							className={cn('flex h-full min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent pl-3 font-mono text-xs text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', closable ? 'pr-1' : 'pr-3')}
						>
							{document.camera && <Icon name="camera" className="size-3.5 flex-none" />}
							{document.status === 'error' && <span className="size-1.5 flex-none rounded-full bg-danger" />}
							{document.unsaved && <span title="Not saved" className="size-1.5 flex-none rounded-full bg-accent" />}
							<span className="truncate">{document.name}</span>
						</button>
						{closable && (
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
						)}
					</div>
				)
			})}
		</div>
	)
}
