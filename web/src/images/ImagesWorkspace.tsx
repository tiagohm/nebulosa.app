import type { ImageInfo, SaveFormat } from 'api'
import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { AnnotationOverlay, shownAnnotations } from '../annotations/AnnotationOverlay'
import { annotationMatchesWcs, annotationPlateSolveJobId } from '../annotations/annotations'
import { mergeProjections, pickAnnotation, projectAnnotations } from '../annotations/geometry'
import { useAnnotationResult } from '../annotations/useAnnotationResult'
import { AUTO_FOCUS_STATE_LABELS, autoFocusRunning, autoFocusRuntime } from '../camera/autofocus'
import { cameraKey, captureCount, captureRuntime, captureRunning, captureStatus, FILE_STATE_LABELS, fileState } from '../camera/capture'
import { DarvOverlay, useDarvOverlay } from '../camera/DarvOverlay'
import { FocusCurve } from '../camera/FocusCurve'
import { GUIDING_STATE_LABELS, guidingRuntime, selectGuidingTarget } from '../camera/guiding'
import { GuidingGraphs } from '../camera/GuidingGraphs'
import { GuidingOverlay, useGuidingOverlay } from '../camera/GuidingOverlay'
import { IPolarOverlay, useIPolarOverlay } from '../camera/IPolarOverlay'
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
import { activeProfile, cameraFramesShown, imageAstrometrySettings, profileState, setCameraFramesShown, setLastImageDirectory, starProfileSettings } from '../profile/profile'
import { NARROW_SCREEN, useMediaQuery } from '../shell/useMediaQuery'
import { EmptyState, useWorkspacePanel, WorkspaceLayout } from '../shell/WorkspaceLayout'
import { StarOverlay } from '../stars/StarOverlay'
import { inspectStar, starProfileOf, TAP_SEARCH_DISTANCE, tapSearchRadius } from '../stars/starprofile'
import { StarProfileOverlay } from '../stars/StarProfileOverlay'
import { pickStar } from '../stars/stars'
import { useStarResult } from '../stars/useStarResult'
import { StreakOverlay } from '../streaks/StreakOverlay'
import { pickStreak } from '../streaks/streaks'
import { useStreakResult } from '../streaks/useStreakResult'
import { Button } from '../ui/Button'
import { Icon, type IconName } from '../ui/Icon'
import { IconButton } from '../ui/IconButton'
import { moveIndex } from '../ui/navigation'
import { Popover } from '../ui/Popover'
import { Select } from '../ui/Select'
import { ImageViewer } from '../viewer/ImageViewer'
import { Reticle } from '../viewer/Reticle'
import { FIT_VIEW, pixelAt, type Point } from '../viewer/transform'
import { useFullscreen } from '../viewer/useFullscreen'
import { useAstrometryTool } from './astrometryTool'
import { BOTTOM_VIEWS, type BottomView, cameraBottomViews, chooseBottomView, followAutoFocus } from './bottomview'
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
	differsFromOriginal,
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
import { ImageToolBar } from './ImageToolBar'
import { MeasurementOverlay } from './MeasurementOverlay'
import { PixelCursorStatus } from './PixelCursorStatus'
import { pixelInspection } from './pixeltiles'
import { SaveImageModal } from './SaveImageModal'
import { SaveImagePopover } from './SaveImagePopover'
import { stopAreaSelection, useStatisticsAreaTool } from './statisticsArea'
import { StatisticsAreaOverlay } from './StatisticsAreaOverlay'
import { TargetOffsetOverlay } from './TargetOffsetOverlay'
import { IMAGE_TOOL_DEFINITIONS, type ImageToolId, imageToolsFor } from './tools'

// Images workspace: a permanent camera tab for each connected camera of the watched connection, showing the frames
// its camera takes, then FITS and XISF images opened from the server, one closable tab each, shown in the shared
// viewer, with the contextual tool each document selected (the Image Inspector at first) in the contextual panel, a
// sheet under the viewer on narrow screens for a tool that asks for one (Star Detection, Streak Detection, Mount Nudge, Guiding), which hides the bottom area while
// open so the frame stays in sight. It works without any connection or equipment; only the camera operations of a
// camera tab command its camera, and the
// toolbar of a camera tab shows the state of its capture whatever tool is selected, and its bottom area the Focus
// Curve of its Auto Focus or the graph of its guiding on request; while Guiding is the tool, a click on the session's
// current guide frame selects the star nearest it. Documents, with their own zoom,
// pan, display settings, and tool, stay open while the tab lives, across document and workspace switches; a camera
// tab follows the latest frame of its camera until a saved frame is selected or Hold for analysis
// holds the frame shown, and Return to Latest follows it again.
// The viewer toolbar fills the screen with the tabs, the viewer, and the bottom area (Full screen), switches a document
// between its adjusted rendering and its original one while they differ, and holds its display
// controls (DisplayToolbar), whose popups close when another document is shown, and its Save control
// (SaveImagePopover), which downloads a copy of any document or writes one to a server file chosen in the file
// explorer (SaveImageModal). The star
// markers of the latest detection of the document's image are drawn over it while shown, and a click
// selects a star while the Star Detection tool is open.
// With a solution of the image shown, its grid, centre, passive aids (crosshair, orientation, scale bar), and the
// coordinates under the pointer are drawn from that solution, and the measure mode of the toolbar draws measurements
// (astrometryTool.ts). With the Image Inspector shown, Select Area of its statistics takes the presses over the image to
// draw the area measured (statisticsArea.ts), which is drawn while the Inspector is shown; while it does, a bar over the
// viewer says so with Cancel, and the panel, when it is a drawer over the image, closes until the area is drawn. Clicks
// go to the first owner of: a Guiding star pick (which disables the measure modes), the area selection, a measure mode, the Plate Solver tool
// (selecting and editing measurements), then Star Detection, the Star Profile Inspector (measuring the star at the
// click, a star detected there if any), Streak Detection, and Annotation. The toolbar hides every overlay of a document
// and shows them again as they were; while hidden only the Guiding star pick stays, so a click or a measure never acts
// on what cannot be seen. With Inspect Pixels of the viewer toolbar on, the status line adds the native samples under
// the pointer (PixelCursorStatus) after the sky coordinates of a solution.

// Distance from the pointer a click looks for a star within, in screen pixels.
const STAR_PICK_RADIUS = 8

// Distance from the pointer a click looks for a streak line within, in screen pixels: about a fingertip, so a tap on a
// phone finds a line one pixel wide; the closest line wins, so a wide reach never picks past a nearer one.
const STREAK_PICK_RADIUS = TAP_SEARCH_DISTANCE

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
	const framesShown = cameraFramesShown(activeProfile(profiles).settings)
	// View of the bottom area of each camera tab, by document key; the frames carousel when absent.
	// Camera tabs whose viewer draws the central reticle, by document key; a presentation choice of the tab only.
	const [reticles, setReticles] = useState<Readonly<Record<string, boolean>>>({})
	// Document being saved and the format of its file.
	const [saving, setSaving] = useState<{ readonly key: string; readonly format: SaveFormat }>()
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
	const ipolar = useIPolarOverlay(document)
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
	const overlaysHidden = view?.overlaysHidden === true
	const inspectPixels = useSnapshot(pixelInspection).enabled
	const inspecting = tool === 'inspector'
	const areaTool = useStatisticsAreaTool({ documentKey: document?.key, imageId: imageInfo?.id, image: imageInfo, enabled: inspecting && !!imageInfo && !overlaysHidden })
	const statisticsArea = inspecting && imageInfo && (view?.statistics.area || areaTool) ? imageInfo.id : undefined
	const hasOverlays = [markers, lines, solution, annotation, reticle, guide, ipolar, centering, trails, guiding, starProfile, statisticsArea].some(Boolean)
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
	// Column of the tabs, the viewer, and the bottom area of a camera tab, which fills the screen on request.
	const viewerRef = useRef<HTMLDivElement>(null)
	const { active: fullscreen, supported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen(viewerRef)
	const narrow = useMediaQuery(NARROW_SCREEN)
	const panelState = useWorkspacePanel('images')
	const { setOpen: setPanelOpen } = panelState
	const panelRequested = state.panelRequested === true
	const selectingArea = !!areaTool
	// Whether the area selection is in progress, as last seen, and whether it closed the drawer to uncover the image.
	const areaSelection = useRef({ selecting: false, closedDrawer: false })
	// Whether the panel is open as a sheet under the viewer on a narrow screen; the bottom area then yields its room to the
	// viewer, so the frame the tool changes stays in sight.
	const sheetOpen = definition.sheet === true && !panelState.docked && panelState.open

	// Opens the panel on the tool just chosen, from the tool bar, a panel, or another page, as a drawer on narrow screens
	// as well as docked.
	useEffect(() => {
		if (!panelRequested) return
		imagesState.panelRequested = false
		setPanelOpen(true)
	}, [panelRequested, setPanelOpen])

	// Closes the drawer over the image while an area is drawn, and opens it again once the selection ends, so the operator
	// sees the image to draw on and then the statistics of what was drawn. A docked panel stays as it is.
	useEffect(() => {
		const current = areaSelection.current
		if (selectingArea === current.selecting) return
		current.selecting = selectingArea

		if (selectingArea) {
			if (!panelState.docked && panelState.open) {
				current.closedDrawer = true
				setPanelOpen(false)
			}
		} else if (current.closedDrawer) {
			current.closedDrawer = false
			if (!panelState.docked) setPanelOpen(true)
		}
	}, [selectingArea, panelState.docked, panelState.open, setPanelOpen])

	const toolBar = <ImageToolBar tools={imageToolsFor(document)} selected={tool} disabled={!document} onSelect={pickTool} />
	const openButton = <IconButton icon="folder" onClick={() => setChoosing(true)} label="Open file" />
	const waiting = document?.camera && !document.info

	// Selects a tool of the active document; picking the selected tool opens its panel again.
	function pickTool(id: ImageToolId) {
		if (document) selectImageTool(imagesState, document.key, id)
	}

	const savingDocument = state.documents.find((d) => d.key === saving?.key)

	return (
		<WorkspaceLayout
			workspace="images"
			title="Images"
			actions={openButton}
			context={toolBar}
			contextFill
			panelState={panelState}
			panel={{ title: definition.panelTitle, content: <Panel key={document?.key} document={document} view={view} camera={camera} onOpen={() => setChoosing(true)} />, sheet: definition.sheet }}
		>
			<div ref={viewerRef} className="flex h-full flex-col bg-base-000">
				{state.documents.length > 0 && <DocumentTabs documents={state.documents} activeKey={state.activeKey} onClose={(key) => closeImage(imagesState, key)} />}
				<div className="relative min-h-0 flex-1">
					<ImageViewer
						view={view?.view ?? FIT_VIEW}
						onViewChange={(next) => document && setImageView(imagesState, document.key, next)}
						image={shown && document?.info ? { url: shown.url, width: document.info.width, height: document.info.height } : undefined}
						loading={document?.status === 'loading' || view?.renderPending || !!document?.camera?.requested}
						error={document?.error ?? document?.camera?.error ?? view?.error}
						toolbar={
							document &&
							view && (
								<ViewerToolbar
									document={document}
									view={view}
									narrow={narrow}
									fullscreen={{ active: fullscreen, supported: fullscreenSupported, toggle: toggleFullscreen }}
									overlays={{ available: hasOverlays, hidden: overlaysHidden }}
									inspectPixels={inspectPixels}
									reticle={reticle}
									onToggleReticle={() => setReticles({ ...reticles, [document.key]: !reticle })}
									measure={solution ? { mode, disabled: !!picking || overlaysHidden, onChange: (next) => setModes((current) => ({ ...current, [document.key]: next })) } : undefined}
									onSaveToServer={(format) => setSaving({ key: document.key, format })}
								/>
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
											{ipolar && <IPolarOverlay overlay={ipolar.overlay} stale={ipolar.stale} view={overlay} />}
											{trails && <DarvOverlay trails={trails} view={overlay} />}
											{guiding && <GuidingOverlay overlay={guiding.overlay} view={overlay} />}
											{lines && <StreakOverlay result={lines} view={overlay} labels={view.streaks.labels} selected={selectedStreak} />}
											{markers && <StarOverlay result={markers} view={overlay} acceptedOnly={view.stars.acceptedOnly} selected={view.stars.selected?.jobId === markers.jobId ? view.stars.selected.index : undefined} />}
											{starProfile && <StarProfileOverlay state={starProfile} view={overlay} settings={profileSettings} />}
											{solution && document?.info && <MeasurementOverlay solution={solution} imageId={document.info.id} image={size} view={overlay} astrometry={view.astrometry} />}
											{solution && view.astrometry.target && <TargetOffsetOverlay solution={solution} image={size} view={overlay} target={view.astrometry.target} markers={view.astrometry.markers} />}
											{centering && <TargetOffsetOverlay solution={centering.solution} image={size} view={overlay} target={centering.target} markers={[]} />}
											{statisticsArea && <StatisticsAreaOverlay area={view.statistics.area} imageId={statisticsArea} view={overlay} />}
											{solution && <WcsAidsOverlay solution={solution} image={size} view={overlay} cursor={cursor} crosshair={astrometry.crosshair} corner={astrometry.orientation === 'corner'} scaleBar={astrometry.scaleBar} />}
										</>
									)
								: undefined
						}
						status={
							solution || (inspectPixels && imageInfo)
								? (cursor) => (
										<>
											{solution && <WcsCursorStatus solution={solution} cursor={cursor} style={astrometry.coordinates} />}
											{inspectPixels && imageInfo && <PixelCursorStatus imageId={imageInfo.id} image={imageInfo} cursor={cursor} />}
										</>
									)
								: undefined
						}
						interaction={areaTool ?? astrometryTool.interaction}
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
								: overlaysHidden || areaTool
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
														void inspectStar(imagesState, document.key, imageInfo.id, star ? { x: star.x, y: star.y } : { x: point.x - 0.5, y: point.y - 0.5 }, !!star, profileSettings, tapSearchRadius(overlay.scale))
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
					{selectingArea && (
						<div className="absolute inset-x-0 bottom-9 z-10 flex justify-center px-3">
							<div className="flex max-w-full items-center gap-3 rounded-md border border-line-100 bg-base-200 py-1.5 pr-1.5 pl-3 text-sm leading-5 text-ink-200 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
								<span className="min-w-0">Drag over the image to choose the area measured.</span>
								<Button variant="secondary" onClick={stopAreaSelection}>
									Cancel
								</Button>
							</div>
						</div>
					)}
				</div>
				{document?.camera && !sheetOpen && <CameraBottom document={document} expanded={framesShown} onToggle={() => setCameraFramesShown(profileState, !framesShown)} />}
				{/* Inside the column, so the menu stays visible while it fills the screen. */}
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
			<SaveImageModal document={savingDocument} format={saving?.format ?? 'fits'} onClose={() => setSaving(undefined)} />
		</WorkspaceLayout>
	)
}

interface OriginalToggleProps {
	// Key of the document.
	readonly documentKey: string
	// View state of the document.
	readonly view: ImageViewState
	// Server description of its image; absent until it has one.
	readonly info?: ImageInfo
}

// Show Original toggle of the viewer toolbar, with the name of what the original shows while it is on. It is offered
// only while the original differs from the applied rendering (differsFromOriginal), or while it is shown.
function OriginalToggle({ documentKey, view, info }: OriginalToggleProps) {
	const on = view.display.showOriginal
	const { applied } = view.display
	if (!on && !(info && applied && differsFromOriginal(info, applied))) return null
	const mosaic = !!info && isMosaic(info)

	return (
		<>
			<IconButton icon="original" label={on ? 'Show adjusted' : 'Show original'} pressed={on} disabled={!view.rendering || view.renderPending} onClick={() => void toggleOriginal(imagesState, documentKey)} />
			{on && <span className="px-1 text-xs text-accent">{mosaic ? 'Raw CFA / Mosaic' : 'Original'}</span>}
		</>
	)
}

// Full screen of the viewer column, as useFullscreen reports it.
interface FullscreenControl {
	// Whether the column fills the screen.
	readonly active: boolean
	// Whether the browser can show an element in full screen.
	readonly supported: boolean
	// Enters or leaves full screen.
	readonly toggle: () => void
}

// Measure mode of a document with a plate solution.
interface MeasureControl {
	// Mode chosen.
	readonly mode: AstrometryMode
	// Whether the mode cannot be changed, as while Guiding picks a star or the overlays are hidden.
	readonly disabled: boolean
	// Chooses a mode.
	readonly onChange: (mode: AstrometryMode) => void
}

interface ViewerToolbarProps {
	// Document shown.
	readonly document: ImageDocument
	// View state of the document.
	readonly view: ImageViewState
	// Whether the screen is a phone's, where the toolbar keeps one row.
	readonly narrow: boolean
	// Full screen of the viewer column.
	readonly fullscreen: FullscreenControl
	// Whether the document has overlays to show, and whether they are hidden.
	readonly overlays: { readonly available: boolean; readonly hidden: boolean }
	// Whether Inspect Pixels is on.
	readonly inspectPixels: boolean
	// Whether the central reticle is drawn, on a camera tab.
	readonly reticle: boolean
	// Shows or hides the reticle.
	readonly onToggleReticle: () => void
	// Measure mode, while the document has a plate solution.
	readonly measure?: MeasureControl
	// Opens the save dialog of the document in a format.
	readonly onSaveToServer: (format: SaveFormat) => void
}

// Controls of the viewer toolbar of a document, after the zoom controls of the viewer: the view toggles, the display
// controls, Save, the measure mode, and the frame controls of a camera tab. On a phone they keep one row: the display
// controls are one Display popup, and Full Screen, Inspect Pixels, the reticle, and the measure mode a More menu.
function ViewerToolbar({ document, view, narrow, fullscreen, overlays, inspectPixels, reticle, onToggleReticle, measure, onSaveToServer }: ViewerToolbarProps) {
	const fullscreenToggle: MenuToggle = { icon: 'expand', label: fullscreen.active ? 'Exit full screen' : 'Full screen', pressed: fullscreen.active, disabled: !fullscreen.supported, onSelect: fullscreen.toggle }
	const pixelsToggle: MenuToggle = {
		icon: 'pixelInspect',
		label: inspectPixels ? 'Stop inspecting pixels' : 'Inspect pixels',
		title: inspectPixels ? undefined : 'Inspect pixels: the samples under the pointer in the status line',
		pressed: inspectPixels,
		disabled: !document.info,
		onSelect: () => (pixelInspection.enabled = !inspectPixels),
	}
	const reticleToggle: MenuToggle = { icon: 'reticle', label: reticle ? 'Hide reticle' : 'Show reticle', pressed: reticle, onSelect: onToggleReticle }
	const overlaysButton = <IconButton icon="layers" label={overlays.hidden ? 'Show overlays' : 'Hide overlays'} pressed={overlays.available && !overlays.hidden} disabled={!overlays.available} onClick={() => toggleImageOverlays(imagesState, document.key)} />
	const saveButton = <SaveImagePopover document={document} view={view} onSaveToServer={onSaveToServer} />
	const measureSelect = measure && <Select label={narrow ? 'Measure' : undefined} options={ASTROMETRY_MODES} value={measure.mode} format={(option) => MODE_LABELS[option]} disabled={measure.disabled} onChange={measure.onChange} className={narrow ? undefined : 'w-36 flex-none'} />

	if (narrow) {
		return (
			<>
				<OriginalToggle documentKey={document.key} view={view} info={document.info} />
				{overlaysButton}
				<DisplayToolbar key={document.key} documentKey={document.key} info={document.info} view={view} compact />
				{saveButton}
				{document.camera && <CameraFrameButton document={document} />}
				<MoreMenu items={document.camera ? [fullscreenToggle, pixelsToggle, reticleToggle] : [fullscreenToggle, pixelsToggle]}>{measureSelect}</MoreMenu>
			</>
		)
	}

	return (
		<>
			<ToggleButton toggle={fullscreenToggle} />
			<OriginalToggle documentKey={document.key} view={view} info={document.info} />
			{overlaysButton}
			<ToggleButton toggle={pixelsToggle} />
			<span className="mx-1 h-5 w-px bg-line-100" />
			<DisplayToolbar key={document.key} documentKey={document.key} info={document.info} view={view} />
			<span className="mx-1 h-5 w-px bg-line-100" />
			{saveButton}
			<span className="mx-1 h-5 w-px bg-line-100" />
			{measureSelect}
			{document.camera && <CameraControls document={document} reticle={reticleToggle} />}
		</>
	)
}

// Toggle of the viewer toolbar, an icon button on a wide screen and a row of the More menu on a phone.
interface MenuToggle {
	// Icon of the toggle.
	readonly icon: IconName
	// Name of its action in its current state, the row's text and the button's tooltip.
	readonly label: string
	// Longer tooltip, when the label alone does not say what the toggle does.
	readonly title?: string
	// Whether it is on.
	readonly pressed: boolean
	// Whether it cannot be used.
	readonly disabled?: boolean
	// Turns it on or off.
	readonly onSelect: () => void
}

// Icon button of a toggle of the viewer toolbar.
function ToggleButton({ toggle }: { readonly toggle: MenuToggle }) {
	return <IconButton icon={toggle.icon} label={toggle.title ?? toggle.label} pressed={toggle.pressed} disabled={toggle.disabled} onClick={toggle.onSelect} />
}

interface MoreMenuProps {
	// Toggles of the menu, in display order.
	readonly items: readonly MenuToggle[]
	// Controls under the toggles, such as the measure mode.
	readonly children?: ReactNode
}

// More menu of the viewer toolbar on a phone: a row for each toggle, the one on in the selection colour, which closes
// the menu when chosen, then the other controls.
function MoreMenu({ items, children }: MoreMenuProps) {
	const [open, setOpen] = useState(false)

	return (
		<Popover icon="more" label="More" open={open} onOpenChange={setOpen}>
			<div className="-mx-1 flex flex-col">
				{items.map((item) => (
					<button
						key={item.icon}
						type="button"
						title={item.title}
						disabled={item.disabled}
						onClick={() => {
							setOpen(false)
							item.onSelect()
						}}
						className={cn(
							'flex cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2 py-1.5 text-left font-mono text-sm whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-300 motion-reduce:transition-none pointer-coarse:min-h-11',
							item.pressed ? 'bg-accent-subtle text-accent' : 'bg-transparent text-ink-100 hover:bg-base-300',
						)}
					>
						<Icon name={item.icon} className={item.pressed ? undefined : 'text-ink-200'} />
						{item.label}
					</button>
				))}
			</div>
			{children && <div className="border-t border-line-100 pt-2">{children}</div>}
		</Popover>
	)
}

interface CameraControlsProps {
	// Camera tab.
	readonly document: ImageDocument
	// Toggle of the central reticle drawn over the frame.
	readonly reticle: MenuToggle
}

// Labels of the selections of a camera tab, as its toolbar shows them.
const SELECTION_LABELS: Readonly<Record<NonNullable<ImageDocument['camera']>['selection']['kind'], string>> = { latest: 'Latest', saved: 'Saved frame', inspect: 'Held for analysis', liveStack: 'Live stack' }

// Frame a camera tab shows, its Hold for Analysis or Return to Latest (CameraFrameButton), and the toggle of the central
// reticle (for Mount Nudge or framing). None commands the camera: they only change which frame the tab shows and how.
function CameraControls({ document, reticle }: CameraControlsProps) {
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
				{camera.live && ` · ${camera.live.revision} frames`}
			</span>
			<CameraFrameButton document={document} />
			<ToggleButton toggle={reticle} />
			<CaptureStatus connectionId={document.source.connectionId} deviceId={document.source.deviceId} />
		</>
	)
}

// Hold for Analysis while a camera tab follows the latest frame (the only way to keep the frame shown: no tool or
// analysis holds it), and Return to Latest while it does not.
function CameraFrameButton({ document }: { readonly document: ImageDocument }) {
	const camera = document.camera
	if (!camera) return null

	return camera.selection.kind === 'latest' ? (
		<IconButton icon="pin" label="Hold for analysis" disabled={!camera.shown} onClick={() => holdCameraFrame(imagesState, document.key)} />
	) : (
		<IconButton icon="skipToEnd" label="Return to Latest" onClick={() => void selectCameraFrame(imagesState, document.key, { kind: 'latest' }, captureFramesState)} />
	)
}

interface CaptureStatusProps {
	// Id of the connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
}

// Compact state of the capture of a camera tab's camera, whatever tool is selected: what it does (with the time left
// of an exposure or delay), its frame count, and the file state of its latest frame while it runs, or that it was
// aborted or why it failed; only a failure is in the danger colour, since an abort is the operator's own command.
// Nothing is shown for a camera that never captured or whose capture ended normally.
function CaptureStatus({ connectionId, deviceId }: CaptureStatusProps) {
	const runtime = useSnapshot(captureRuntime)
	const key = cameraKey(connectionId, deviceId)
	const session = runtime.sessions[key]
	if (!session) return null

	const running = captureRunning(session)
	const failed = session.phase === 'failed'
	if (!running && !failed && session.phase !== 'aborted') return null

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

// Label of each view of the bottom area.
const BOTTOM_VIEW_LABELS: Readonly<Record<BottomView, string>> = { frames: 'Captured Frames', curve: 'Focus Curve', guiding: 'Guiding Graph', pointing: 'Pointing Map' }

interface CameraBottomProps {
	// Camera tab.
	readonly document: ImageDocument
	// Whether the view is shown under its header; the header stays when it is not.
	readonly expanded: boolean
	// Shows or hides the view.
	readonly onToggle: () => void
}

// Bottom area of a camera tab: a header that collapses it, then the capture frames carousel, or, once its camera has an
// Auto Focus, a guiding, or a mount pointing session, the Focus Curve, the guiding graph, or the Pointing Map of that
// session, chosen in the header. The header stays while the area is collapsed, so the choice and the way back are always
// in sight; choosing a view expands the area. The views belong to the session, never to the frame selected, so they keep
// updating whatever frame or tool is shown; choosing a view never changes the selection. A view whose session is gone
// shows the carousel. The view is kept per camera tab (bottomview.ts), and a new Auto Focus session of the camera shows
// its Focus Curve once.
function CameraBottom({ document, expanded, onToggle }: CameraBottomProps) {
	const autoFocus = useSnapshot(autoFocusRuntime)
	const bottom = useSnapshot(cameraBottomViews)
	const guidingState = useSnapshot(guidingRuntime)
	const mountPointing = useSnapshot(mountPointingRuntime)
	const frames = useSnapshot(captureFramesState)
	const source = document.source.kind === 'camera' ? document.source : undefined
	const key = source ? cameraKey(source.connectionId, source.deviceId) : undefined
	const session = key ? autoFocus.sessions[key] : undefined
	const following = session && autoFocusRunning(session) ? session.sessionId : undefined

	useEffect(() => {
		if (following) followAutoFocus(cameraBottomViews, document.key, following)
	}, [document.key, following])

	if (!key || !source) return null

	const guiding = guidingState.sessions[key]
	const pointing = mountPointing.sessions[key]
	const available = BOTTOM_VIEWS.filter((option) => option === 'frames' || (option === 'curve' && session) || (option === 'guiding' && guiding) || (option === 'pointing' && pointing))
	const chosen = bottom.views[document.key] ?? 'frames'
	const view = available.includes(chosen) ? chosen : 'frames'
	const frameKey = frameSourceKey(source.connectionId, source.deviceId)
	const savedCount = frames.sources[frameKey]?.count ?? frames.frames[frameKey]?.length ?? 0
	const state = view === 'frames' ? `${savedCount} saved` : view === 'pointing' && pointing ? MOUNT_POINTING_STATE_LABELS[pointing.state] : view === 'guiding' && guiding ? (guiding.active ? GUIDING_STATE_LABELS[guiding.state] : 'Stopped') : session && AUTO_FOCUS_STATE_LABELS[session.state]

	// Shows a view, expanding the area when it is collapsed.
	function onView(next: BottomView) {
		chooseBottomView(cameraBottomViews, document.key, next)
		if (!expanded) onToggle()
	}

	return (
		<div className="flex-none border-t border-line-100 bg-base-100">
			<div className="flex min-h-8 items-center gap-3 pr-3 pl-1 font-mono text-xs tracking-wide text-ink-300 uppercase">
				<button
					type="button"
					title={`${expanded ? 'Hide' : 'Show'} ${BOTTOM_VIEW_LABELS[view]}`}
					onClick={onToggle}
					className="flex size-7 flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 text-ink-300 transition-colors duration-150 hover:bg-base-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none pointer-coarse:size-9"
				>
					<Icon name="stepForward" className={cn('size-3.5 transition-transform duration-150 motion-reduce:transition-none', expanded && 'rotate-90')} />
				</button>
				{available.length === 1 ? (
					<span>{BOTTOM_VIEW_LABELS.frames}</span>
				) : (
					<span className="flex min-w-0 gap-3 overflow-x-auto">
						{available.map((option) => (
							<button
								key={option}
								type="button"
								onClick={() => onView(option)}
								className={cn('flex-none cursor-pointer border-0 bg-transparent p-0 font-mono text-xs tracking-wide whitespace-nowrap uppercase focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', option === view ? 'text-accent' : 'text-ink-300 hover:text-ink-100')}
							>
								{BOTTOM_VIEW_LABELS[option]}
							</button>
						))}
					</span>
				)}
				<span className="ml-auto flex-none">{state}</span>
			</div>
			{expanded &&
				(view === 'frames' ? (
					<CaptureFramesCarousel document={document} />
				) : (
					<div className="px-2 pb-2">
						{view === 'pointing' && pointing ? (
							<PointingMapView session={pointing} />
						) : view === 'guiding' && guiding ? (
							<GuidingGraphs session={guiding} telemetry={guidingState.telemetry[guiding.sessionId]} events={guidingState.events[guiding.sessionId]} />
						) : (
							session && <FocusCurve summary={session} session={autoFocus.details[session.sessionId]} />
						)}
					</div>
				))}
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

// Returns the tooltip of a document tab: where its file is, or which camera and frame it shows.
function documentTooltip(document: ImageDocument): string {
	if (document.camera) return `Frames of ${document.name}${document.camera.shown ? `, showing frame #${document.camera.shown.frame.generation}` : ''}`
	return documentPath(document) ?? document.name
}

// Tab strip of the open documents. Arrow keys move between tabs, Delete closes the focused one. A camera tab has a camera icon and no way to close it.
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
							</button>
						)}
					</div>
				)
			})}
		</div>
	)
}
