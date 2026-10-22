import type { DeriveRequest, DisplaySettings, ImageFormat, ImageInfo, RenderRequest, RenderResult, SaveRequest, SaveResult, StarDetectionRequest, Stretch } from 'api'
import { nanoid } from 'nanoid'
import { proxy, ref } from 'valtio'
import { responseError } from '../http'
import { DEFAULT_STAR_REQUEST } from '../stars/stars'
import { FIT_VIEW, type ViewerView } from '../viewer/transform'
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

// Where a document's image comes from: a file of the server, or another document it was derived from
// (by its name). Captured frames will add their own kind.
export type ImageSource = { readonly kind: 'file'; readonly path: string } | { readonly kind: 'derived'; readonly sourceName: string }

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

// Returns the initial display settings of an opened image: the unprocessed settings, debayered with the
// image's own pattern when it is a CFA mosaic with a trusted one.
// A derived image already stretched is shown linear, so it is not stretched twice; one derived without a
// stretch gets the auto stretch like a file.
export function defaultDisplaySettings(info: ImageInfo): DisplaySettings {
	const stretch: DisplaySettings['stretch'] = info.origin === 'derived' && info.provenance.settings.stretch.mode !== 'linear' ? { mode: 'linear' } : ORIGINAL_DISPLAY_SETTINGS.stretch
	return { ...ORIGINAL_DISPLAY_SETTINGS, stretch, ...(info.cfa && { debayer: { enabled: true, pattern: 'auto' } }) }
}

// Returns the server file of a document: the file it was opened from, or the one a derived image was
// last saved to; undefined for a derived image never saved.
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
	state.views[document.key] = { view: FIT_VIEW, display: { pending, showOriginal: false }, renderPending: false, deriving: false, stars: { request: { detector: { ...DEFAULT_STAR_REQUEST.detector }, acceptance: { ...DEFAULT_STAR_REQUEST.acceptance } }, visible: true, acceptedOnly: false } }
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
	if (document.info) release(document.info.id, io)

	state.documents.splice(index, 1)
	delete state.views[key]
	delete state.tools[key]
	if (state.activeKey === key) state.activeKey = (state.documents[index] ?? state.documents[index - 1])?.key
}
