import type { CaptureFrameOpened, CaptureFrameSummary, CaptureLeaseReconcileResponse, DeriveRequest, DisplaySettings, ImageFormat, ImageInfo, PlateSolveRequest, RenderRequest, RenderResult, SaveRequest, SaveResult, ServerEvent, StarDetectionRequest, Stretch } from 'api'
import { nanoid } from 'nanoid'
import { proxy, ref } from 'valtio'
import { clientId } from '../events'
import { responseError } from '../http'
import { DEFAULT_PLATE_SOLVE_REQUEST } from '../platesolving/platesolving'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import { FIT_VIEW, type ViewerView } from '../viewer/transform'
import { captureFrameUrl, frameLabel } from './captureframes'
import type { ImageToolId } from './tools'

// Image documents open in the tab's Images workspace. Each open image is split in three objects under the
// same key: the document (identity, origin, and the server-side image with its metadata), its view state
// (zoom, pan, display settings, and the current rendering, a JPEG held as an object URL), and its tool
// context (the contextual tool it shows, the Image Inspector at first). Two documents never share a view
// or tool, and a future derived image (such as a processing result) can open as a new document with its
// own view while the original stays as it is.
//
// Display settings are edited as pending settings that never render by themselves; applying them sends
// a snapshot to the server, and only a successful rendering makes that snapshot the applied settings, so
// edits made while it is processing stay pending and a failure keeps the previous rendering and applied
// settings. Show Original renders the unprocessed image (no debayering, auto stretch, neutral
// adjustments) once and keeps it beside the applied rendering. Only the latest rendering request of a
// document counts; starting a new one aborts the previous, and an object URL is revoked as soon as a
// newer rendering replaces it or the document closes. Requests belong to the store, not to components,
// so they complete while the panel is collapsed or another document is shown. Everything lives in
// memory only: it survives switching tabs and workspaces but is not restored after a reload.
//
// The star detection of a document keeps its request being edited, which is sent only by Run Detection, and
// how its markers are shown; neither zoom, pan, display settings, nor the markers ever run a detection.
//
// A derived image, computed by the server from a document's pending settings, opens as a new document
// that is unsaved until a save to a server file succeeds; the page asks before unloading while one
// exists, and closing one is confirmed by the workspace.
//
// A captured frame opens by its frame id from the server's capture frame registry, under a lease that keeps its
// document open on the server until the tab closes it; the same frame opens once, and a newer exposure never
// changes it. A live tab follows a camera instead: it shows the latest frame of the camera, each one under its own
// lease, and only the newest frame counts when several arrive while one is being opened. Pausing it keeps the frame
// shown, and so does a manual analysis started on it; pinning opens the frame shown as a tab of its own. Leases
// belong to the page (clientId); every socket reopen reconciles them, and a frame whose lease was lost is marked
// unavailable rather than replaced by another.

// Where a document's image comes from: a file of the server, another document it was derived from (by its name), a
// captured frame (by its frame id), or the latest frames of a camera, for a live tab.
export type ImageSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'derived'; readonly sourceName: string } | { readonly kind: 'capture'; readonly frameId: string } | { readonly kind: 'live'; readonly connectionId: string; readonly deviceId: string }

// Whether a live tab updates itself: following the camera, paused by the operator, or paused because a manual
// analysis was started on the frame shown.
export type LiveState = 'following' | 'paused' | 'pausedForAnalysis'

// Captured frame shown by a capture or live document.
export interface CapturedState {
	// Frame shown, as the registry describes it; absent before a live tab shows one.
	frame?: CaptureFrameSummary
	// Lease keeping the document of the frame open on the server; absent when none is held.
	lease?: string
	// How a live tab updates itself; absent for a captured frame.
	live?: LiveState
	// Why the latest frame of a live tab could not be shown, or why the frame shown was lost.
	error?: string
}

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
	// Frame shown by a captured frame or a live tab.
	capture?: CapturedState
}

// Display settings of a document: those being edited and those of the current rendering.
export interface ImageDisplayState {
	// Settings shown by the controls; editing them never renders.
	pending: DisplaySettings
	// Exact settings the current rendering was made with; absent before the first rendering succeeds.
	applied?: DisplaySettings
	// Whether the viewer shows the original rendering instead of the applied one.
	showOriginal: boolean
	// Rendering of the unprocessed image (ORIGINAL_DISPLAY_SETTINGS), made on the first Show Original.
	original?: ImageRendering
}

// Star detection of a document as the tab shows it: the request being edited and how its markers are shown.
export interface ImageStarsState {
	// Request the next Run Detection sends; editing it never runs one.
	request: StarDetectionRequest
	// Whether the markers of the latest result are drawn.
	visible: boolean
	// Whether only the accepted stars are drawn.
	acceptedOnly: boolean
	// Selected star: its index in the result of a job, which only counts while that result is shown.
	selected?: { readonly jobId: string; readonly index: number }
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
	// Whether a derived image is being created from the document.
	deriving: boolean
	// Why creating the latest derived image failed.
	deriveError?: string
	// Star detection request and markers.
	stars: ImageStarsState
	// Plate solving request, solution shown, and overlay.
	plateSolving: ImagePlateSolvingState
}

// State of a document's display settings: rendering, the latest rendering failed, the pending settings
// differ from the applied ones, or they are applied.
export type DisplayStatus = 'processing' | 'error' | 'not-applied' | 'applied'

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
}

// Response header with the RenderResult of a rendering (RENDER_HEADER of the API).
const RENDER_HEADER = 'X-Image-Render'

// Image documents of the tab.
export const imagesState = proxy<ImagesState>({ documents: [], views: {}, tools: {} })

// Asks the browser to confirm leaving the page while an image exists only in memory, since it cannot
// be recovered after a reload. Browsers show their own generic message.
if (typeof window !== 'undefined') {
	window.addEventListener('beforeunload', (event) => {
		if (hasUnsavedImages(imagesState)) event.preventDefault()
	})
}

// Browser implementation of ImagesIo.
export const browserIo: ImagesIo = {
	fetch: (input, init) => fetch(input, init),
	createObjectURL: (blob) => URL.createObjectURL(blob),
	revokeObjectURL: (url) => URL.revokeObjectURL(url),
}

// Settings of the unprocessed image shown by Show Original: no debayering, a linked auto stretch, and
// neutral adjustments.
export const ORIGINAL_DISPLAY_SETTINGS: DisplaySettings = { debayer: { enabled: false }, stretch: { mode: 'auto', linked: true }, brightness: 1, contrast: 1, gamma: 1, saturation: 1, scnr: { enabled: false }, invert: false }

// Pending rendering request of each document, by document key.
const renders = new Map<string, AbortController>()

// Frame a live tab is opening, by document key; only the latest one counts.
const lives = new Map<string, string>()

// Returns the initial display settings of an opened image: the unprocessed settings, debayered with the
// image's own pattern when it is a CFA mosaic with a trusted one.
// A derived image already stretched is shown linear, so it is not stretched twice; one derived without a
// stretch gets the auto stretch like a file.
export function defaultDisplaySettings(info: ImageInfo): DisplaySettings {
	const stretch: DisplaySettings['stretch'] = info.origin === 'derived' && info.provenance.settings.stretch.mode !== 'linear' ? { mode: 'linear' } : ORIGINAL_DISPLAY_SETTINGS.stretch
	return { ...ORIGINAL_DISPLAY_SETTINGS, stretch, ...(info.cfa && { debayer: { enabled: true, pattern: 'auto' } }) }
}

// Returns the server file of a document: the file it was opened from, or the one a derived image was
// last saved to; undefined for a derived image never saved and for a captured frame, whose server path is not
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
function copySettings(settings: DisplaySettings): DisplaySettings {
	return JSON.parse(JSON.stringify(settings)) as DisplaySettings
}

// Returns whether two JSON-like values are deeply equal, regardless of key order.
function sameValue(a: unknown, b: unknown): boolean {
	if (a === b) return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
	const keys = Object.keys(a)
	if (keys.length !== Object.keys(b).length) return false
	return keys.every((key) => sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}

// Returns whether two display settings are equal.
export function sameDisplaySettings(a: DisplaySettings, b: DisplaySettings | undefined): boolean {
	return b !== undefined && sameValue(a, b)
}

// Returns the display status of a document's view state.
export function displayStatus(view: Pick<ImageViewState, 'display' | 'renderPending' | 'error'>): DisplayStatus {
	if (view.renderPending) return 'processing'
	if (view.error) return 'error'
	return sameDisplaySettings(view.display.pending, view.display.applied) ? 'applied' : 'not-applied'
}

// Returns a single stretch summarizing the stretch a rendering applied: the stretch itself, or the mean
// of the per-channel stretches of an unlinked auto stretch. Used to start a manual stretch from it.
export function summaryStretch(result: RenderResult): Stretch {
	const n = result.stretch.length
	const mean = (pick: (s: Stretch) => number) => result.stretch.reduce((sum, s) => sum + pick(s), 0) / n
	return { midtone: mean((s) => s.midtone), shadow: mean((s) => s.shadow), highlight: mean((s) => s.highlight) }
}

// Returns the document with key, if still open.
function documentOf(state: ImagesState, key: string): ImageDocument | undefined {
	return state.documents.find((d) => d.key === key)
}

// Returns the document shown, if any.
export function activeDocument(state: { readonly documents: readonly ImageDocument[]; readonly activeKey?: string }): ImageDocument | undefined {
	return state.documents.find((d) => d.key === state.activeKey)
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
function message(error: unknown): string {
	return error instanceof Error ? error.message : 'Unable to reach the server'
}

// Asks the server to release an image, ignoring failures: the document is already gone from the tab.
function release(id: string, io: ImagesIo) {
	void io.fetch(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined)
}

// Opens a server file as a new active document, fitted to the viewer and shown with the Image
// Inspector, and renders it once with its default display settings (defaultDisplaySettings), which
// become its pending and applied settings. A document closed before the server answers is released on
// the server.
export async function openImage(state: ImagesState, path: string, io: ImagesIo = browserIo) {
	const key = nanoid()
	const name = path.split(/[\\/]/).at(-1) || path
	addDocument(state, { key, name, source: { kind: 'file', path }, status: 'loading', unsaved: false })

	try {
		const response = await io.fetch('/api/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) })
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
		const view = state.views[key]
		if (view) view.display.pending = copySettings(defaultDisplaySettings(info))
	} catch (error) {
		const document = documentOf(state, key)
		if (document) Object.assign(document, { status: 'error', error: message(error) })
		return
	}

	await applyDisplay(state, key, io)
}

// Adds a document as the active one, fitted to the viewer and shown with the Image Inspector, with its
// default display settings when the server already described it.
function addDocument(state: ImagesState, document: ImageDocument) {
	const pending = copySettings(document.info ? defaultDisplaySettings(document.info) : ORIGINAL_DISPLAY_SETTINGS)
	state.documents.push(document)
	state.views[document.key] = {
		view: FIT_VIEW,
		display: { pending, showOriginal: false },
		renderPending: false,
		deriving: false,
		stars: { request: { detector: { ...DEFAULT_STAR_REQUEST.detector }, acceptance: { ...DEFAULT_STAR_REQUEST.acceptance } }, visible: true, acceptedOnly: false },
		plateSolving: { request: { ...DEFAULT_PLATE_SOLVE_REQUEST }, overlay: true, grid: false },
	}
	state.tools[document.key] = { tool: 'inspector' }
	state.activeKey = document.key
}

// Creates a derived image from a document with a snapshot of its pending display settings, computed by
// the server in floating point, and opens it as a new active, unsaved document rendered with its
// default settings. The source document is unchanged. A failure is kept in the source's view state.
export async function createDerivedImage(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const source = documentOf(state, key)
	const view = state.views[key]
	if (!source?.info || !view || view.deriving) return

	const request: DeriveRequest = { settings: copySettings(view.display.pending) }
	view.deriving = true
	view.deriveError = undefined

	try {
		const response = await io.fetch(`/api/images/${encodeURIComponent(source.info.id)}/derive`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
		if (!response.ok) throw new Error(await responseError(response))
		const info = (await response.json()) as ImageInfo
		const derivedKey = nanoid()
		addDocument(state, { key: derivedKey, name: info.name, source: { kind: 'derived', sourceName: source.name }, status: 'ready', info: ref(info), unsaved: true })
		await applyDisplay(state, derivedKey, io)
	} catch (error) {
		const current = state.views[key]
		if (current) current.deriveError = message(error)
	} finally {
		const current = state.views[key]
		if (current) current.deriving = false
	}
}

// Saves a document to a file of the server in a format. An existing file is only replaced with
// overwrite. Once the server confirms the write, the document is saved: no longer unsaved, named after
// the file, with the path remembered. A failure leaves the document as it was, so the save can be retried.
export async function saveImage(state: ImagesState, key: string, path: string, format: ImageFormat, overwrite: boolean, io: ImagesIo = browserIo): Promise<SaveImageOutcome> {
	const id = documentOf(state, key)?.info?.id
	if (!id) return { status: 'failed', error: 'The image is not open' }

	try {
		const request: SaveRequest = { path, format, overwrite }
		const response = await io.fetch(`/api/images/${encodeURIComponent(id)}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })

		if (response.status === 409) {
			const body = (await response.json()) as { readonly error: string; readonly reason: string }
			return body.reason === 'exists' ? { status: 'exists' } : { status: 'failed', error: body.error }
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

// Renders an opened document with settings, aborting its previous rendering request. Resolves to the
// new rendering, whose object URL the caller then owns, or to undefined when the request was aborted,
// failed (the failure is kept in the view state), or the document closed meanwhile.
async function requestRendering(state: ImagesState, key: string, settings: DisplaySettings, io: ImagesIo): Promise<ImageRendering | undefined> {
	const id = documentOf(state, key)?.info?.id
	const view = state.views[key]
	if (!id || !view) return undefined

	renders.get(key)?.abort()
	const controller = new AbortController()
	renders.set(key, controller)
	view.renderPending = true
	view.error = undefined

	try {
		const request: RenderRequest = { settings }
		const response = await io.fetch(`/api/images/${encodeURIComponent(id)}/render`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal })
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

// Applies the pending display settings of a document: renders a snapshot of them and, once the
// rendering succeeds, shows it and makes the snapshot the applied settings. Leaves Show Original. Edits
// made meanwhile stay pending; a failure keeps the current rendering and applied settings.
export async function applyDisplay(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const view = state.views[key]
	if (!view) return

	const settings = copySettings(view.display.pending)
	view.display.showOriginal = false
	const rendering = await requestRendering(state, key, settings, io)
	const current = state.views[key]
	if (!rendering || !current) return

	const previous = current.rendering?.url
	current.rendering = rendering
	current.display.applied = settings
	if (previous) io.revokeObjectURL(previous)
}

// Replaces the pending display settings of a document, without rendering. Ignored for an unknown key.
export function editDisplay(state: ImagesState, key: string, settings: DisplaySettings) {
	const view = state.views[key]
	if (view) view.display.pending = copySettings(settings)
}

// Discards the pending edits of a document, restoring the applied settings, without rendering.
export function revertDisplay(state: ImagesState, key: string) {
	const display = state.views[key]?.display
	if (display?.applied) display.pending = copySettings(display.applied)
}

// Restores the default display settings of a document as pending settings, without rendering.
export function resetDisplay(state: ImagesState, key: string) {
	const info = documentOf(state, key)?.info
	const view = state.views[key]
	if (info && view) view.display.pending = copySettings(defaultDisplaySettings(info))
}

// Switches a document between its applied rendering and its original one, rendering the original on
// first use. The pending and applied settings are untouched. Ignored while a rendering is in progress,
// which the original would otherwise abort.
export async function toggleOriginal(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const view = state.views[key]
	if (!view || view.renderPending) return

	if (view.display.showOriginal || view.display.original) {
		view.display.showOriginal = !view.display.showOriginal
		return
	}

	const rendering = await requestRendering(state, key, ORIGINAL_DISPLAY_SETTINGS, io)
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

// Replaces the star detection request of a document, which only the next Run Detection sends. Ignored for an
// unknown key.
export function setStarRequest(state: ImagesState, key: string, request: StarDetectionRequest) {
	const stars = state.views[key]?.stars
	if (stars) stars.request = request
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

// Shows a tool in the contextual panel of a document. Ignored for an unknown key.
export function selectImageTool(state: ImagesState, key: string, tool: ImageToolId) {
	const current = state.tools[key]
	if (current) current.tool = tool
}

// Shows a document. Ignored for an unknown key.
export function selectImage(state: ImagesState, key: string) {
	if (documentOf(state, key)) state.activeKey = key
}

// Closes a document: aborts its rendering, revokes its object URLs, releases it on the server, and drops
// its view state and tool context. The next document (or the previous one, for the last) becomes active.
export function closeImage(state: ImagesState, key: string, io: ImagesIo = browserIo) {
	const index = state.documents.findIndex((d) => d.key === key)
	if (index < 0) return

	const document = state.documents[index]
	const view = state.views[key]
	renders.get(key)?.abort()
	renders.delete(key)
	if (view?.rendering) io.revokeObjectURL(view.rendering.url)
	if (view?.display.original) io.revokeObjectURL(view.display.original.url)
	lives.delete(key)

	if (document.capture) {
		if (document.capture.lease) releaseLease(document.capture.lease, io)
	} else if (document.info) {
		release(document.info.id, io)
	}

	state.documents.splice(index, 1)
	delete state.views[key]
	delete state.tools[key]
	if (state.activeKey === key) state.activeKey = (state.documents[index] ?? state.documents[index - 1])?.key
}

// Releases a lease of a captured frame, ignoring failures: the document is already gone from the tab.
function releaseLease(lease: string, io: ImagesIo) {
	void io.fetch(`/api/capture-frames/leases/${encodeURIComponent(lease)}`, { method: 'DELETE' }).catch(() => undefined)
}

// Opens a captured frame on the server under a lease of client. Resolves to the opened frame, or to the message
// of the refusal.
async function requestFrame(frameId: string, io: ImagesIo, client: string): Promise<CaptureFrameOpened | string> {
	try {
		const response = await io.fetch(`${captureFrameUrl(frameId)}/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client }) })
		if (!response.ok) return await responseError(response)
		return (await response.json()) as CaptureFrameOpened
	} catch (error) {
		return message(error)
	}
}

// Opens a captured frame as a new active document named after its file or its camera and number, rendered once with
// its default display settings. A frame already open is shown instead, unless its document failed, which is
// replaced. A refusal, such as a frame no longer in memory, is the document's error; another frame is never opened
// in its place. A document closed before the server answers releases its lease.
export async function openCaptureFrame(state: ImagesState, frameId: string, io: ImagesIo = browserIo, client: string = clientId) {
	const existing = state.documents.find((d) => d.source.kind === 'capture' && d.source.frameId === frameId)

	if (existing && existing.status !== 'error') {
		state.activeKey = existing.key
		return
	}

	if (existing) closeImage(state, existing.key, io)

	const key = nanoid()
	addDocument(state, { key, name: 'Captured frame', source: { kind: 'capture', frameId }, status: 'loading', unsaved: false, capture: {} })
	const opened = await requestFrame(frameId, io, client)
	const document = documentOf(state, key)

	if (typeof opened === 'string') {
		if (document) Object.assign(document, { status: 'error', error: opened })
		return
	}

	if (!document) {
		releaseLease(opened.lease, io)
		return
	}

	document.info = ref(opened.info)
	document.name = frameLabel(opened.frame)
	document.status = 'ready'
	document.capture = { frame: ref(opened.frame), lease: opened.lease }
	const view = state.views[key]
	if (view) view.display.pending = copySettings(defaultDisplaySettings(opened.info))
	await applyDisplay(state, key, io)
}

// Camera a live tab follows.
export interface LiveCamera {
	// Id of the connection that provides it.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Name the tab is labelled with.
	readonly name: string
}

// Opens a live tab of a camera as the active document, or shows the one already open, and shows frameId, the latest
// available frame of the camera, when there is one; without it, the tab waits for the first captured frame.
// Opening a live tab never commands the camera.
export async function openLive(state: ImagesState, camera: LiveCamera, frameId?: string, io: ImagesIo = browserIo, client: string = clientId) {
	const { connectionId, deviceId, name } = camera
	const existing = state.documents.find((d) => d.source.kind === 'live' && d.source.connectionId === connectionId && d.source.deviceId === deviceId)

	if (existing) {
		state.activeKey = existing.key
		return
	}

	const key = nanoid()
	addDocument(state, { key, name: `Live · ${name}`, source: { kind: 'live', connectionId, deviceId }, status: 'ready', unsaved: false, capture: { live: 'following' } })
	if (frameId) await showLiveFrame(state, key, frameId, io, client)
}

// Shows a frame in a live tab: opens it under a new lease and, unless a newer frame was asked for meanwhile or the
// tab closed, replaces the frame shown, keeping zoom, pan, and display settings, then releases the lease of the
// previous frame. The results of the previous frame (selected star, chosen solution, original rendering) are not
// carried over. A refusal keeps the frame shown and is the tab's error.
export async function showLiveFrame(state: ImagesState, key: string, frameId: string, io: ImagesIo = browserIo, client: string = clientId) {
	if (!documentOf(state, key)?.capture) return
	lives.set(key, frameId)
	const opened = await requestFrame(frameId, io, client)
	const document = documentOf(state, key)
	const capture = document?.capture
	const superseded = lives.get(key) !== frameId

	if (typeof opened === 'string') {
		if (capture && !superseded) {
			capture.error = opened
			lives.delete(key)
		}

		return
	}

	if (!document || !capture || superseded) {
		releaseLease(opened.lease, io)
		return
	}

	lives.delete(key)
	const previous = capture.lease
	const first = !document.info
	document.info = ref(opened.info)
	document.status = 'ready'
	document.error = undefined
	Object.assign(capture, { frame: ref(opened.frame), lease: opened.lease, error: undefined })

	const view = state.views[key]

	if (view) {
		if (first) view.display.pending = copySettings(defaultDisplaySettings(opened.info))
		if (view.display.original) io.revokeObjectURL(view.display.original.url)
		view.display.original = undefined
		view.stars.selected = undefined
		view.plateSolving.selected = undefined
	}

	if (previous) releaseLease(previous, io)
	await applyDisplay(state, key, io)
}

// Follows the registry events: a live tab following a camera shows each newer frame of it that is in memory, and
// every open document of a frame takes the latest description of its frame (such as its file being saved).
export function handleCapturedFrame(state: ImagesState, event: ServerEvent, io: ImagesIo = browserIo, client: string = clientId) {
	if (event.type !== 'captureFrame:updated') return
	const { frame, source } = event

	for (const document of state.documents) {
		const capture = document.capture
		if (!capture) continue
		if (capture.frame?.frameId === frame.frameId && capture.frame.revision < frame.revision) capture.frame = ref(frame)

		if (document.source.kind !== 'live' || capture.live !== 'following' || document.source.connectionId !== frame.connectionId || document.source.deviceId !== frame.deviceId) continue
		if (frame.availability !== 'memory' || frame.frameId !== source.latestFrameId || lives.get(document.key) === frame.frameId) continue
		if (capture.frame && capture.frame.sequence >= frame.sequence) continue
		void showLiveFrame(state, document.key, frame.frameId, io, client)
	}
}

// Pauses a live tab, which keeps the frame shown while the camera goes on; reason tells whether the operator paused
// it or a manual analysis did. Ignored unless the tab follows its camera.
export function pauseLive(state: ImagesState, key: string, reason: Exclude<LiveState, 'following'> = 'paused') {
	const capture = documentOf(state, key)?.capture
	if (capture?.live !== 'following') return
	capture.live = reason
	lives.delete(key)
}

// Resumes a live tab, showing frameId, the latest available frame of its camera, when it is not the frame shown;
// frames captured while it was paused are not replayed.
export async function resumeLive(state: ImagesState, key: string, frameId?: string, io: ImagesIo = browserIo, client: string = clientId) {
	const capture = documentOf(state, key)?.capture
	if (!capture?.live || capture.live === 'following') return
	capture.live = 'following'
	if (frameId && frameId !== capture.frame?.frameId) await showLiveFrame(state, key, frameId, io, client)
}

// Opens the frame a live tab shows as a captured frame of its own, under its own lease; the live tab goes on.
export async function pinLive(state: ImagesState, key: string, io: ImagesIo = browserIo, client: string = clientId) {
	const frameId = documentOf(state, key)?.capture?.frame?.frameId
	if (frameId) await openCaptureFrame(state, frameId, io, client)
}

// Sends the leases the documents hold to the server, which releases the other leases of the page and answers those
// it no longer has: the frame of such a document is marked unavailable, never replaced. Run on every socket open.
export async function reconcileCapturedFrames(state: ImagesState, io: ImagesIo = browserIo, client: string = clientId) {
	const leases = state.documents.flatMap((d) => (d.capture?.lease ? [d.capture.lease] : []))
	if (leases.length === 0) return

	try {
		const response = await io.fetch(`/api/capture-frames/clients/${encodeURIComponent(client)}/leases`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leases }) })
		if (!response.ok) return
		const { lost } = (await response.json()) as CaptureLeaseReconcileResponse

		for (const document of state.documents) {
			const capture = document.capture
			if (!capture?.lease || !lost.includes(capture.lease)) continue
			capture.lease = undefined
			capture.error = 'The frame shown is no longer available on the server'
			if (!capture.live) Object.assign(document, { status: 'error', error: 'The frame is no longer available on the server; open it again from Capture Frames' })
		}
	} catch {
		// The server is unreachable; the next socket open reconciles again.
	}
}

// Releases the leases of the page when it is unloaded, since its documents do not survive a reload.
if (typeof window !== 'undefined') {
	window.addEventListener('pagehide', () => {
		if (imagesState.documents.some((d) => d.capture?.lease)) navigator.sendBeacon(`/api/capture-frames/clients/${encodeURIComponent(clientId)}/leases`, new Blob([JSON.stringify({ leases: [] })], { type: 'application/json' }))
	})
}
