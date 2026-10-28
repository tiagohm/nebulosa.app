import type { DisplaySettings, ImageFormat, ImageInfo, PlateSolveRequest, RenderRequest, RenderResult, SaveRequest, SaveResult, Stretch } from 'api'
import { nanoid } from 'nanoid'
import { proxy, ref } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { jsonInit, responseError } from '../http'
import { DEFAULT_PLATE_SOLVE_REQUEST } from '../platesolving/platesolving'
import { activeProfile, imageDisplaySettings, profileCamera, profileState, setImageDisplaySettings } from '../profile/profile'
import { FIT_VIEW, type ViewerView } from '../viewer/transform'
import type { CameraTabState } from './cameratabs'
import { ORIGINAL_DISPLAY_SETTINGS } from './display'
import type { ImageProcessingDraft } from './imageprocessing'
import { DEFAULT_ADDED_OPERATION } from './imageprocessing.catalog'
import type { ImageToolId } from './tools'

// Image documents open in the tab's Images workspace. Each open image is split in three objects under the
// same key: the document (identity, origin, and the server-side image with its metadata), its view state
// (zoom, pan, display settings, and the current rendering, a JPEG held as an object URL), and its tool
// context (the contextual tool it shows, the Image Inspector at first). Two documents never share a view
// or tool, and a future derived image (such as a processing result) can open as a new document with its
// own view while the original stays as it is.
//
// Display settings change only by applying a patch of them (the display controls of the viewer toolbar): the patch
// is merged into the settings being applied, or the applied ones, and that snapshot is sent to the server; only a
// successful rendering makes it the applied settings, which are then saved in the profile (per camera for a camera
// tab, globally for any other document) so the next image of the same kind starts with them. A failure keeps the
// previous rendering and applied settings. A new document starts with the settings its profile saved, fitted to its
// image, or with its defaults. Show Original renders the unprocessed image (no debayering, auto stretch, neutral
// adjustments) once and keeps it beside the applied rendering. Only the latest rendering request of a
// document counts; starting a new one aborts the previous, and an object URL is revoked as soon as a
// newer rendering replaces it or the document closes. Requests belong to the store, not to components,
// so they complete while the panel is collapsed or another document is shown. Everything lives in
// memory only: it survives switching tabs and workspaces but is not restored after a reload.
//
// The star detection of a document keeps how its markers are shown; its request is the profile's, shared by every
// document and sent only by Run Detection. Neither zoom, pan, display settings, nor the markers ever run a detection.
//
// A derived image, computed by an image processing pipeline (imageprocessing.ts), opens as a new document that is
// unsaved until a save to a server file succeeds; the page asks before unloading while one exists, and closing one is
// confirmed by the workspace.
//
// Camera tabs (cameratabs.ts) are documents too, whose image is the frame they show; this module only removes them
// and renders their frames, with the primitives it exports for them.

// Where a document's image comes from: a file of the server, another document it was derived from (by its name), or
// the frames of a camera, for a camera tab.
export type ImageSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'derived'; readonly sourceName: string } | { readonly kind: 'camera'; readonly connectionId: string; readonly deviceId: string }

// Outcome of a save: written, refused because the file exists (a retry may overwrite it), or failed with
// a message, such as a refused target or a write error.
export type SaveImageOutcome = { readonly status: 'saved' } | { readonly status: 'exists' } | { readonly status: 'failed'; readonly error: string }

// Current rendering of a document.
export interface ImageRendering {
	// Object URL of the rendered JPEG, owned by the store.
	readonly url: string
	// Parameters the server applied.
	readonly result: RenderResult
}

// Image document of the tab: what the image is, independent of how it is shown.
export interface ImageDocument {
	// Id of the document in the tab, assigned before the server opens the image.
	readonly key: string
	// Display name: the file name, or the name of a derived image until it is saved.
	name: string
	// Origin of the image.
	readonly source: ImageSource
	// Whether the server is opening the image, has opened it, or failed to.
	status: 'loading' | 'ready' | 'error'
	// Server description of the opened image, including its id and metadata.
	info?: ImageInfo
	// Why opening failed.
	error?: string
	// Whether the image exists only in memory: a derived image not saved yet, lost when it closes.
	unsaved: boolean
	// Absolute path of the server file a derived image was last saved to.
	savedPath?: string
	// Frames of a camera tab; absent for any other document.
	camera?: CameraTabState
}

// Display settings of a document: those of the current rendering, and the original rendering.
export interface ImageDisplayState {
	// Exact settings the current rendering was made with; absent before the first rendering succeeds.
	applied?: DisplaySettings
	// Whether the viewer shows the original rendering instead of the applied one.
	showOriginal: boolean
	// Rendering of the unprocessed image (ORIGINAL_DISPLAY_SETTINGS), made on the first Show Original.
	original?: ImageRendering
}

// Star detection of a document as the tab shows it: how its markers are shown. The request is the profile's.
export interface ImageStarsState {
	// Whether the markers of the latest result are drawn.
	visible: boolean
	// Whether only the accepted stars are drawn.
	acceptedOnly: boolean
	// Selected star: its index in the result of a job, which only counts while that result is shown.
	selected?: { readonly jobId: string; readonly index: number }
}

// Streak detection of a document as the tab shows it: how its lines are shown and which context the next detection
// sends. The settings are the profile's; nothing here runs a detection.
export interface ImageStreaksState {
	// Whether the lines of the latest result are drawn.
	visible: boolean
	// Whether each line is labeled with its number.
	labels: boolean
	// Whether the next detection classifies with the plate solution shown, when it is a completed job of the image.
	useSolution: boolean
	// Whether the next detection classifies with the stars of the latest completed star detection of the image.
	useStars: boolean
	// Selected streak: its index in the result of a job, which only counts while that result is shown.
	selected?: { readonly jobId: string; readonly index: number }
}

// How many labels the annotation of a document places: a few of the most important objects, a balanced number, or many.
export type AnnotationDensity = 'minimal' | 'balanced' | 'detailed'

// Groups of the annotation of a document that can be shown or hidden.
export interface AnnotationLayers {
	// Catalog stars.
	stars: boolean
	// Deep-sky objects.
	deepSky: boolean
	// Sun, Moon, planets, and Pluto.
	solarSystem: boolean
	// Constellation figures.
	constellations: boolean
	// Constellation names.
	constellationLabels: boolean
}

// Annotation of a document as the tab shows it: which groups are drawn, how, the magnitude limit of the next run, and
// the selected object. Showing or hiding anything never runs an annotation.
export interface ImageAnnotationState {
	// Groups drawn.
	layers: AnnotationLayers
	// Whether the objects are labeled.
	labels: boolean
	// Whether the extent of a deep-sky object of known size is drawn as its outline.
	outlines: boolean
	// Whether the predicted motion of a solar-system body during the exposure is drawn.
	motion: boolean
	// How many labels are placed.
	density: AnnotationDensity
	// Faintest magnitude of the next run, and of the objects drawn when fainter than the result's own.
	magnitudeLimit: number
	// Selected object: its id in the result of a job, which only counts while that result is shown.
	selected?: { readonly jobId: string; readonly id: string }
}

// Plate solving of a document as the tab shows it: the request being edited, the solution shown, and its overlay.
export interface ImagePlateSolvingState {
	// Request the next Solve Image sends; editing it never solves.
	request: PlateSolveRequest
	// Solution shown: a job id of the image, 'header' for the WCS of its header, or absent for its latest job. Only a
	// choice of the operator changes it; a job that ends never does.
	selected?: string
	// Whether the centre and the north and east directions of the solution shown are drawn.
	overlay: boolean
	// Whether its right ascension and declination grid is drawn too.
	grid: boolean
}

// How a document is shown: its own zoom, pan, display settings, and rendering.
export interface ImageViewState {
	// Zoom and pan of the viewer.
	view: ViewerView
	// Display settings.
	display: ImageDisplayState
	// Current rendering of the applied settings, kept while a newer one is prepared.
	rendering?: ImageRendering
	// Whether a rendering is in progress.
	renderPending: boolean
	// Why the latest rendering failed.
	error?: string
	// Star detection request and markers.
	stars: ImageStarsState
	// Streak lines and the context of the next streak detection.
	streaks: ImageStreaksState
	// Plate solving request, solution shown, and overlay.
	plateSolving: ImagePlateSolvingState
	// Annotation layers, appearance, and selection.
	annotation: ImageAnnotationState
	// Image processing pipeline being edited and the latest job it submitted.
	processing: ImageProcessingDraft
}

// Contextual tool of a document.
export interface ImageToolContext {
	// Tool shown in the contextual panel.
	tool: ImageToolId
}

// Image documents of the tab.
export interface ImagesState {
	// Open documents in tab order.
	documents: ImageDocument[]
	// View state of each open document, by document key.
	views: Record<string, ImageViewState>
	// Tool context of each open document, by document key.
	tools: Record<string, ImageToolContext>
	// Key of the document shown; absent when none is open.
	activeKey?: string
}

// Browser services the store uses, replaced in tests.
export interface ImagesIo {
	// Performs HTTP requests to the API.
	readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
	// Creates an object URL for a rendered JPEG.
	readonly createObjectURL: (blob: Blob) => string
	// Releases an object URL.
	readonly revokeObjectURL: (url: string) => void
	// Returns the display settings the profile saved for the documents of a source: those of its camera for a camera
	// tab, the global ones for any other document; undefined when none were saved.
	readonly loadDisplay: (source: ImageSource) => DisplaySettings | undefined
	// Saves in the profile the display settings just applied to a document of a source, as loadDisplay reads them.
	readonly saveDisplay: (source: ImageSource, settings: DisplaySettings) => void
}

// Response header with the RenderResult of a rendering (RENDER_HEADER of the API).
const RENDER_HEADER = 'X-Image-Render'

// Image documents of the tab.
export const imagesState = proxy<ImagesState>({ documents: [], views: {}, tools: {} })

// Returns where the active profile keeps the display settings of a source: the camera of a camera tab of its watched
// connection (like the forms of its camera operations), or undefined for the global settings of any other document;
// null for a camera of another connection, whose settings are neither read nor saved.
function displayScope(source: ImageSource) {
	if (source.kind !== 'camera') return undefined
	return deviceState.watched === source.connectionId ? (profileCamera(activeProfile(profileState), source.deviceId) ?? null) : null
}

// Browser implementation of ImagesIo, keeping display settings in the active profile.
export const browserIo: ImagesIo = {
	fetch: (input, init) => fetch(input, init),
	createObjectURL: (blob) => URL.createObjectURL(blob),
	revokeObjectURL: (url) => URL.revokeObjectURL(url),
	loadDisplay: (source) => {
		const scope = displayScope(source)
		return scope === null ? undefined : imageDisplaySettings(activeProfile(profileState).settings, scope)
	},
	saveDisplay: (source, settings) => {
		const scope = displayScope(source)
		if (scope !== null) setImageDisplaySettings(profileState, scope, settings)
	},
}

// Pending rendering request of each document, by document key.
const renders = new Map<string, AbortController>()

// Display settings each document is applying, by document key, while their rendering is in progress. The next frame
// a camera tab shows meanwhile aborts that rendering and is rendered with them instead, so they become applied.
const applies = new Map<string, DisplaySettings>()

// Returns the display settings of an image nothing was saved for: the unprocessed settings, debayered with the
// image's own pattern when it is a CFA mosaic with a trusted one.
export function defaultDisplaySettings(info: ImageInfo): DisplaySettings {
	return { ...ORIGINAL_DISPLAY_SETTINGS, ...(info.cfa && { debayer: { enabled: true, pattern: 'auto' } }) }
}

// Returns whether debayering applies to an image: a mono image whose header names a CFA pattern (BAYERPAT), trusted
// or not; an untrusted one can only be debayered with an explicit pattern.
export function isMosaic(info: Pick<ImageInfo, 'channels' | 'bayer'>): boolean {
	return info.channels === 1 && !!info.bayer
}

// Returns the display settings a new document of an image starts with: those its profile saved, with debayering
// turned off for a mono image it does not apply to (no CFA pattern in its header) or cannot be resolved for (the
// image's own pattern without a trusted one), or the image's defaults when nothing was saved.
export function initialDisplaySettings(info: ImageInfo, saved: DisplaySettings | undefined): DisplaySettings {
	if (!saved) return defaultDisplaySettings(info)
	const unresolved = saved.debayer.enabled && info.channels === 1 && (!info.bayer || (saved.debayer.pattern === 'auto' && !info.cfa))
	return copySettings(unresolved ? { ...saved, debayer: { enabled: false } } : saved)
}

// Returns the server file of a document: the file it was opened from, or the one a derived image was
// last saved to; undefined for a derived image never saved and for a camera tab, whose server paths are not
// exposed.
export function documentPath(document: Pick<ImageDocument, 'source' | 'savedPath'>): string | undefined {
	return document.source.kind === 'file' ? document.source.path : document.savedPath
}

// Returns whether any document exists only in memory, so leaving the page would lose it.
export function hasUnsavedImages(state: { readonly documents: readonly Pick<ImageDocument, 'unsaved'>[] }): boolean {
	return state.documents.some((d) => d.unsaved)
}

// Returns the format a file name designates by its extension: XISF for .xisf, FITS otherwise.
export function formatOfFileName(name: string): ImageFormat {
	return /\.xisf$/i.test(name) ? 'xisf' : 'fits'
}

// Returns the URL that downloads a document as a file of a format.
export function downloadUrl(info: Pick<ImageInfo, 'id'>, format: ImageFormat): string {
	return `/api/images/${encodeURIComponent(info.id)}/file?format=${format}`
}

// Returns a plain deep copy of settings, detached from any proxy.
export function copySettings(settings: DisplaySettings): DisplaySettings {
	return JSON.parse(JSON.stringify(settings)) as DisplaySettings
}

// Returns a single stretch summarizing the stretch a rendering applied: the stretch itself, or the mean
// of the per-channel stretches of an unlinked auto stretch. Used to start a manual stretch from it.
export function summaryStretch(result: RenderResult): Stretch {
	const n = result.stretch.length
	const mean = (pick: (s: Stretch) => number) => result.stretch.reduce((sum, s) => sum + pick(s), 0) / n
	return { midtone: mean((s) => s.midtone), shadow: mean((s) => s.shadow), highlight: mean((s) => s.highlight) }
}

// Returns the document with key, if still open.
export function documentOf(state: ImagesState, key: string): ImageDocument | undefined {
	return state.documents.find((d) => d.key === key)
}

// Returns the document shown, if any.
export function activeDocument(state: { readonly documents: readonly ImageDocument[]; readonly activeKey?: string }): ImageDocument | undefined {
	return state.documents.find((d) => d.key === state.activeKey)
}

// Returns why a document has no image to work on yet, for the tools that edit their settings meanwhile and run once it
// has one: it is opening, its camera has not sent a frame, or its image could not be read; undefined once it has one.
export function imageUnavailableReason(document: Pick<ImageDocument, 'status' | 'info' | 'camera'>): string | undefined {
	if (document.info) return undefined
	if (document.status === 'loading') return 'Opening the image…'
	return document.camera ? 'Waiting for the first frame of the camera.' : 'The image is unavailable.'
}

// Returns the view state of the document shown, if any.
export function activeView<T extends ImageViewState>(state: { readonly views: Readonly<Record<string, T>>; readonly activeKey?: string }): T | undefined {
	return state.activeKey === undefined ? undefined : state.views[state.activeKey]
}

// Returns the tool context of the document shown, if any.
export function activeTool<T extends ImageToolContext>(state: { readonly tools: Readonly<Record<string, T>>; readonly activeKey?: string }): T | undefined {
	return state.activeKey === undefined ? undefined : state.tools[state.activeKey]
}

// Returns the message of an unknown failure.
export function message(error: unknown): string {
	return error instanceof Error ? error.message : 'Unable to reach the server'
}

// Asks the server to release an image, ignoring failures: the document is already gone from the tab.
function release(id: string, io: ImagesIo) {
	void io.fetch(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
}

// Opens a server file as a new active document, fitted to the viewer and shown with the Image
// Inspector, and renders it once with the display settings it starts with (initialDisplaySettings), which
// become its applied settings. A document closed before the server answers is released on the server.
export async function openImage(state: ImagesState, path: string, io: ImagesIo = browserIo) {
	const key = nanoid()
	const name = path.split(/[\\/]/).at(-1) || path
	const source: ImageSource = { kind: 'file', path }
	addDocument(state, { key, name, source, status: 'loading', unsaved: false })

	try {
		const response = await io.fetch('/api/images', jsonInit('POST', { path }))
		const document = documentOf(state, key)

		if (!response.ok) {
			if (document) Object.assign(document, { status: 'error', error: await responseError(response) })
			return
		}

		const info = (await response.json()) as ImageInfo

		if (!document) {
			release(info.id, io)
			return
		}

		document.info = ref(info)
		document.status = 'ready'
		await renderDisplay(state, key, initialDisplaySettings(info, io.loadDisplay(source)), io)
	} catch (error) {
		const document = documentOf(state, key)
		if (document) Object.assign(document, { status: 'error', error: message(error) })
	}
}

// Faintest magnitude an annotation keeps by default: the stars of the catalog and the brighter deep-sky objects.
export const DEFAULT_ANNOTATION_MAGNITUDE_LIMIT = 12

// Returns the view state of a document just opened: fitted to the viewer, with nothing rendered yet.
export function newView(): ImageViewState {
	return {
		view: FIT_VIEW,
		display: { showOriginal: false },
		renderPending: false,
		stars: { visible: true, acceptedOnly: false },
		streaks: { visible: true, labels: true, useSolution: true, useStars: true },
		plateSolving: { request: { ...DEFAULT_PLATE_SOLVE_REQUEST }, overlay: true, grid: false },
		annotation: { layers: { stars: true, deepSky: true, solarSystem: true, constellations: true, constellationLabels: false }, labels: true, outlines: true, motion: true, density: 'balanced', magnitudeLimit: DEFAULT_ANNOTATION_MAGNITUDE_LIMIT },
		processing: { steps: [], expanded: [], adding: DEFAULT_ADDED_OPERATION },
	}
}

// Adds a document, fitted to the viewer and shown with the Image Inspector. It becomes the active one unless activate is false and another one is shown.
function addDocument(state: ImagesState, document: ImageDocument, activate = true) {
	state.documents.push(document)
	state.views[document.key] = newView()
	state.tools[document.key] = { tool: 'inspector' }
	if (activate || state.activeKey === undefined) state.activeKey = document.key
}

// Opens a derived image the server already created from a document named sourceName as a new unsaved document, rendered
// with the display settings it starts with (initialDisplaySettings, the global ones, like a file). It becomes the
// active one unless activate is false, so a result arriving while the operator looks at another document does not
// take the view from it.
export async function openDerivedImage(state: ImagesState, info: ImageInfo, sourceName: string, activate: boolean, io: ImagesIo = browserIo) {
	const key = nanoid()
	const source: ImageSource = { kind: 'derived', sourceName }
	addDocument(state, { key, name: info.name, source, status: 'ready', info: ref(info), unsaved: true }, activate)
	await renderDisplay(state, key, initialDisplaySettings(info, io.loadDisplay(source)), io)
}

// Saves a document to a file of the server in a format. An existing file is only replaced with
// overwrite. Once the server confirms the write, the document is saved: no longer unsaved, named after
// the file, with the path remembered. A failure leaves the document as it was, so the save can be retried.
export async function saveImage(state: ImagesState, key: string, path: string, format: ImageFormat, overwrite: boolean, io: ImagesIo = browserIo): Promise<SaveImageOutcome> {
	const id = documentOf(state, key)?.info?.id
	if (!id) return { status: 'failed', error: 'The image is not open' }

	try {
		const request: SaveRequest = { path, format, overwrite }
		const response = await io.fetch(`/api/images/${encodeURIComponent(id)}/save`, jsonInit('POST', request))

		if (response.status === 409) {
			const body = (await response.json()) as { readonly error: string; readonly code: string }
			return body.code === 'exists' ? { status: 'exists' } : { status: 'failed', error: body.error }
		}

		if (!response.ok) return { status: 'failed', error: await responseError(response) }
		const { path: saved } = (await response.json()) as SaveResult
		const document = documentOf(state, key)

		if (document) {
			document.unsaved = false
			document.savedPath = saved
			document.name = saved.split(/[\\/]/).at(-1) || saved
		}

		return { status: 'saved' }
	} catch (error) {
		return { status: 'failed', error: message(error) }
	}
}

// Renders the image id for a document with settings, aborting the previous rendering request of the document. The
// image is the document's own, or the next frame of a camera tab, rendered before it is shown. Resolves to the new
// rendering, whose object URL the caller then owns, or to undefined when the request was aborted, failed (the
// failure is kept in the view state), or the document closed meanwhile.
export async function requestRendering(state: ImagesState, key: string, id: string | undefined, settings: DisplaySettings, io: ImagesIo): Promise<ImageRendering | undefined> {
	const view = state.views[key]
	if (!id || !view) return undefined

	renders.get(key)?.abort()
	const controller = new AbortController()
	renders.set(key, controller)
	view.renderPending = true
	view.error = undefined

	try {
		const request: RenderRequest = { settings }
		const response = await io.fetch(`/api/images/${encodeURIComponent(id)}/render`, jsonInit('POST', request, controller.signal))
		if (!response.ok) throw new Error(await responseError(response))
		const result = JSON.parse(response.headers.get(RENDER_HEADER) ?? 'null') as RenderResult
		const blob = await response.blob()
		if (controller.signal.aborted || !state.views[key]) return undefined
		return { url: io.createObjectURL(blob), result }
	} catch (error) {
		if (controller.signal.aborted) return undefined
		const current = state.views[key]
		if (current) current.error = message(error)
		return undefined
	} finally {
		if (renders.get(key) === controller) {
			renders.delete(key)
			const current = state.views[key]
			if (current) current.renderPending = false
		}
	}
}

// Renders a document with a snapshot of settings and, once the rendering succeeds, shows it and makes the snapshot
// the applied settings. Leaves Show Original. Resolves to whether they became the applied settings; a failure keeps
// the current rendering and applied settings.
async function renderDisplay(state: ImagesState, key: string, settings: DisplaySettings, io: ImagesIo): Promise<boolean> {
	const view = state.views[key]
	if (!view) return false

	view.display.showOriginal = false
	applies.set(key, settings)
	const rendering = await requestRendering(state, key, documentOf(state, key)?.info?.id, settings, io)
	if (applies.get(key) === settings) applies.delete(key)
	const current = state.views[key]
	if (!rendering || !current) return false

	const previous = current.rendering?.url
	current.rendering = rendering
	current.display.applied = settings
	if (previous) io.revokeObjectURL(previous)
	return true
}

// Returns the display settings of a document the next patch builds on: those being applied, or the applied ones;
// undefined before its first rendering.
export function currentDisplaySettings(state: ImagesState, key: string): DisplaySettings | undefined {
	return applies.get(key) ?? state.views[key]?.display.applied
}

// Applies a patch of display settings to a document: merges it into the settings being applied, or the applied ones,
// renders the result, and once it is shown saves it in the profile as the settings of the document's source. A patch
// applied while another rendering is in progress builds on that one, which it aborts. Ignored before the document's
// first rendering; a failure keeps the current rendering and applied settings and saves nothing.
export async function applyDisplay(state: ImagesState, key: string, patch: Partial<DisplaySettings>, io: ImagesIo = browserIo) {
	const current = currentDisplaySettings(state, key)
	if (!current) return

	const settings = copySettings({ ...current, ...patch })
	const source = documentOf(state, key)?.source
	if ((await renderDisplay(state, key, settings, io)) && source) io.saveDisplay(source, settings)
}

// Switches a document between its applied rendering and its original one, rendering the original on
// first use. The applied settings are untouched. Ignored while a rendering is in progress,
// which the original would otherwise abort.
export async function toggleOriginal(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const view = state.views[key]
	if (!view || view.renderPending) return

	if (view.display.showOriginal || view.display.original) {
		view.display.showOriginal = !view.display.showOriginal
		return
	}

	const rendering = await requestRendering(state, key, documentOf(state, key)?.info?.id, ORIGINAL_DISPLAY_SETTINGS, io)
	const current = state.views[key]
	if (!rendering || !current) return

	current.display.original = rendering
	current.display.showOriginal = true
}

// Returns the rendering the viewer shows for a view state: the original one during Show Original, the
// applied one otherwise.
export function shownRendering(view: Pick<ImageViewState, 'display' | 'rendering'>): ImageRendering | undefined {
	return view.display.showOriginal && view.display.original ? view.display.original : view.rendering
}

// Sets the zoom and pan of a document. Ignored for an unknown key.
export function setImageView(state: ImagesState, key: string, view: ViewerView) {
	const current = state.views[key]
	if (current) current.view = view
}

// Changes how the star markers of a document are shown. Ignored for an unknown key.
export function setStarMarkers(state: ImagesState, key: string, patch: Partial<Pick<ImageStarsState, 'visible' | 'acceptedOnly'>>) {
	const stars = state.views[key]?.stars
	if (stars) Object.assign(stars, patch)
}

// Selects a star of a result of a document, or clears the selection. Ignored for an unknown key.
export function selectStar(state: ImagesState, key: string, selected?: ImageStarsState['selected']) {
	const stars = state.views[key]?.stars
	if (stars) stars.selected = selected
}

// Changes how the streak lines of a document are shown, or the context its next detection sends; never runs one.
// Ignored for an unknown key.
export function setStreakView(state: ImagesState, key: string, patch: Partial<Omit<ImageStreaksState, 'selected'>>) {
	const streaks = state.views[key]?.streaks
	if (streaks) Object.assign(streaks, patch)
}

// Selects a streak of a result of a document, or clears the selection. Ignored for an unknown key.
export function selectStreak(state: ImagesState, key: string, selected?: ImageStreaksState['selected']) {
	const streaks = state.views[key]?.streaks
	if (streaks) streaks.selected = selected
}

// Replaces the plate solving request of a document, which only the next Solve Image sends. Ignored for an unknown key.
export function setPlateSolveRequest(state: ImagesState, key: string, request: PlateSolveRequest) {
	const plateSolving = state.views[key]?.plateSolving
	if (plateSolving) plateSolving.request = request
}

// Chooses the solution of a document that is shown: a job id, 'header', or undefined for its latest job. Ignored for an
// unknown key.
export function selectPlateSolution(state: ImagesState, key: string, selected: string | undefined) {
	const plateSolving = state.views[key]?.plateSolving
	if (plateSolving) plateSolving.selected = selected
}

// Changes how the overlay of the solution of a document is drawn; never solves. Ignored for an unknown key.
export function setPlateSolveOverlay(state: ImagesState, key: string, patch: Partial<Pick<ImagePlateSolvingState, 'overlay' | 'grid'>>) {
	const plateSolving = state.views[key]?.plateSolving
	if (plateSolving) Object.assign(plateSolving, patch)
}

// Changes how the annotation of a document is drawn, or the magnitude limit of its next run; never runs one. Ignored for
// an unknown key.
export function setAnnotationView(state: ImagesState, key: string, patch: Partial<Omit<ImageAnnotationState, 'selected' | 'layers'>> & { readonly layers?: Partial<AnnotationLayers> }) {
	const annotation = state.views[key]?.annotation
	if (!annotation) return
	const { layers, ...rest } = patch
	Object.assign(annotation, rest)
	if (layers) Object.assign(annotation.layers, layers)
}

// Selects an object of a result of a document, or clears the selection. Ignored for an unknown key.
export function selectAnnotation(state: ImagesState, key: string, selected?: ImageAnnotationState['selected']) {
	const annotation = state.views[key]?.annotation
	if (annotation) annotation.selected = selected
}

// Shows a tool in the contextual panel of a document. Ignored for an unknown key.
export function selectImageTool(state: ImagesState, key: string, tool: ImageToolId) {
	const current = state.tools[key]
	if (current) current.tool = tool
}

// Shows a document. Ignored for an unknown key.
export function selectImage(state: ImagesState, key: string) {
	if (documentOf(state, key)) state.activeKey = key
}

// Returns whether the operator can close a document: any document but a camera tab, which lives as long as its
// camera is connected.
export function isClosable(document: Pick<ImageDocument, 'source'>): boolean {
	return document.source.kind !== 'camera'
}

// Closes a document: aborts its rendering, revokes its object URLs, releases it on the server, and drops
// its view state and tool context. The next document (or the previous one, for the last) becomes active.
// A camera tab is never closed this way (see isClosable).
export function closeImage(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const document = documentOf(state, key)
	if (!document || !isClosable(document)) return
	removeDocument(state, key, io)
}

// Removes a document from the tab: aborts its rendering, revokes its object URLs, releases its image or the lease of
// its frame on the server, and drops its view state and tool context. The next document (or the previous one, for
// the last) becomes active.
export function removeDocument(state: ImagesState, key: string, io: ImagesIo) {
	const index = state.documents.findIndex((d) => d.key === key)
	if (index < 0) return

	const document = state.documents[index]
	const view = state.views[key]
	renders.get(key)?.abort()
	renders.delete(key)
	applies.delete(key)
	if (view?.rendering) io.revokeObjectURL(view.rendering.url)
	if (view?.display.original) io.revokeObjectURL(view.display.original.url)

	if (document.camera) {
		if (document.camera.shown?.lease) releaseLease(document.camera.shown.lease, io)
	} else if (document.info) {
		release(document.info.id, io)
	}

	state.documents.splice(index, 1)
	delete state.views[key]
	delete state.tools[key]
	if (state.activeKey === key) state.activeKey = (state.documents[index] ?? state.documents[index - 1])?.key
}

// Releases a lease of a captured frame, ignoring failures: nothing in the tab shows its frame any more.
export function releaseLease(lease: string, io: ImagesIo) {
	void io.fetch(`/api/capture-frames/leases/${encodeURIComponent(lease)}`, { method: 'DELETE' }).catch(() => undefined)
}

// Returns the display settings a document is applying while its rendering is in progress, if any.
export function applyingSettings(key: string): DisplaySettings | undefined {
	return applies.get(key)
}

// Forgets the display settings a document is applying when they are still settings, once a frame of a camera tab was
// shown with them.
export function settleApplying(key: string, settings: DisplaySettings) {
	if (applies.get(key) === settings) applies.delete(key)
}

// Asks the browser to confirm leaving the page while an image exists only in memory, since it cannot be recovered
// after a reload. Browsers show their own generic message. Returns a function that stops asking.
export function confirmUnsavedOnUnload(state: ImagesState): () => void {
	const listener = (event: BeforeUnloadEvent) => {
		if (hasUnsavedImages(state)) event.preventDefault()
	}

	window.addEventListener('beforeunload', listener)
	return () => window.removeEventListener('beforeunload', listener)
}
