import type { DisplaySettings, ImageClaimRequest, ImageInfo, ImageRect } from 'api'
import { subscribe } from 'valtio'
import { clientId } from '../events'
import { jsonInit } from '../http'
import { type WorkspaceSyncState, workspaceSyncState } from '../profile/sync'
import type { ViewEntry } from '../profile/view'
import type { ViewerView } from '../viewer/transform'
import { addDocument, browserIo, documentOf, failImage, fileName, type ImageAnnotationState, type ImageAstrometryState, type ImageDocument, type ImagePlateSolvingState, type ImagesIo, type ImagesState, type ImageStreaksState, type ImageToolContext, type ImageViewState, openImageFile, showOpenedImage } from './images'
import { type ImageToolId, imageToolsFor } from './tools'

// Open Images: the files open in the Images workspace of a tab come back after a reload of that tab, in the same order,
// each with its key, its tool, and its view state (zoom and pan, the display settings applied, how its overlays are drawn,
// its plate solving request, measurements, markers, and statistics area), as the openImages view entry of the tab's
// session storage keeps them. A file document shown again first claims the image the page held, so its pixels and the
// results of its analyses are used as they are; when the server no longer holds it (a restart, or a page gone longer
// than the grace of its documents), the file is opened again and the results start over. Selections, renderings, and
// measurements in progress are never kept. Camera tabs follow their cameras instead (cameratabs.ts).

// View state of a file document kept across reloads: what the operator set, never a rendering, a selection, or a
// measurement in progress.
export interface KeptImageView {
	// Zoom and pan of the viewer.
	readonly view: ViewerView
	// Display settings applied; absent when none were applied yet.
	readonly display?: DisplaySettings
	// How the star markers are drawn.
	readonly stars: { readonly visible: boolean; readonly acceptedOnly: boolean }
	// How the streak lines are drawn and the context of the next streak detection.
	readonly streaks: Omit<ImageStreaksState, 'selected'>
	// Plate solving request, solution shown, and overlay; the solution shown counts only while the image is the same.
	readonly plateSolving: ImagePlateSolvingState
	// Astrometric measurements, markers, and the target of Target Offset.
	readonly astrometry: Omit<ImageAstrometryState, 'selected'>
	// Annotation layers and appearance.
	readonly annotation: Omit<ImageAnnotationState, 'selected'>
	// Rectangle of image pixels the statistics measure, in pixels; absent for the whole image.
	readonly statisticsArea?: ImageRect
	// Whether every overlay is kept off the image.
	readonly overlaysHidden?: boolean
}

// File document kept across reloads.
export interface KeptImage {
	// Key of the document, given to it again.
	readonly key: string
	// Path of its file on the server.
	readonly path: string
	// Id of the image the page held; absent while it was opening or after it failed to open.
	readonly imageId?: string
	// Tool its contextual panel showed.
	readonly tool: ImageToolId
	// Its view state.
	readonly view: KeptImageView
}

// Returns what is kept of the view state of a document, as plain data of its own (the store's objects are proxies).
export function keptImageView(view: ImageViewState): KeptImageView {
	const { visible, labels, useSolution, useStars } = view.streaks
	const { measurements, markers, target } = view.astrometry
	const { layers, labels: annotationLabels, outlines, motion, density, magnitudeLimit, bodies, centerSelected } = view.annotation

	const kept: KeptImageView = {
		view: view.view,
		...(view.display.applied && { display: view.display.applied }),
		stars: { visible: view.stars.visible, acceptedOnly: view.stars.acceptedOnly },
		streaks: { visible, labels, useSolution, useStars },
		plateSolving: view.plateSolving,
		astrometry: { measurements, markers, ...(target && { target }) },
		annotation: { layers, labels: annotationLabels, outlines, motion, density, magnitudeLimit, bodies, centerSelected },
		...(view.statistics.area && { statisticsArea: view.statistics.area }),
		...(view.overlaysHidden && { overlaysHidden: true }),
	}

	return JSON.parse(JSON.stringify(kept)) as KeptImageView
}

// Returns what is kept of a file document, its view state, and its tool context; undefined for any other document.
export function keptImage(document: ImageDocument, view: ImageViewState | undefined, context: ImageToolContext | undefined): KeptImage | undefined {
	if (document.source.kind !== 'file' || !view) return undefined
	return { key: document.key, path: document.source.path, ...(document.info && { imageId: document.info.id }), tool: context?.tool ?? 'inspector', view: keptImageView(view) }
}

// Gives the view state of a document shown again what was kept of it, as copies of its own. The solution shown is kept
// only for the same image (sameImage) or when it is the WCS of the header, since a job id belongs to one image.
export function applyKeptImageView(view: ImageViewState, kept: KeptImageView, sameImage: boolean) {
	const { selected, ...plateSolving } = structuredClone(kept.plateSolving)
	view.view = kept.view
	Object.assign(view.stars, kept.stars)
	Object.assign(view.streaks, kept.streaks)
	view.plateSolving = sameImage || selected === 'header' ? { ...plateSolving, ...(selected !== undefined && { selected }) } : plateSolving
	view.astrometry = structuredClone(kept.astrometry)
	view.annotation = structuredClone(kept.annotation)
	view.statistics = kept.statisticsArea ? { area: kept.statisticsArea } : {}
	view.overlaysHidden = kept.overlaysHidden
}

// Asks the server to make client (this page) one of the pages holding an image; resolves to its description, or to
// undefined when the server no longer holds it.
async function claimImage(id: string, io: ImagesIo, client: string): Promise<ImageInfo | undefined> {
	const response = await io.fetch(`/api/images/${encodeURIComponent(id)}/claim`, jsonInit('POST', { client } satisfies ImageClaimRequest))
	return response.ok ? ((await response.json()) as ImageInfo) : undefined
}

// Shows again a file document the page had open before it reloaded: added at once with its key, tool, and view state as
// a loading document that does not take the view from the one shown, then given the image it held (claimed) or, when
// the server no longer holds it, the file opened again, and rendered with the display settings it had applied, fitted to
// the image. A document closed meanwhile releases the image; one whose file cannot be opened shows why.
export async function restoreImage(state: ImagesState, kept: KeptImage, io: ImagesIo = browserIo, client: string = clientId) {
	const { key, path } = kept
	const document: ImageDocument = { key, name: fileName(path), source: { kind: 'file', path }, status: 'loading' }
	addDocument(state, document, io, false)
	applyKeptImageView(state.views[key], kept.view, false)
	if (imageToolsFor(document).includes(kept.tool)) state.tools[key].tool = kept.tool

	try {
		const claimed = kept.imageId === undefined ? undefined : await claimImage(kept.imageId, io, client)
		const view = state.views[key]
		// The same image keeps its results, so the solution it showed is shown again unless another was chosen meanwhile.
		if (claimed && view && view.plateSolving.selected === undefined && kept.view.plateSolving.selected !== undefined) view.plateSolving.selected = kept.view.plateSolving.selected
		await showOpenedImage(state, key, claimed ?? (await openImageFile(path, io, client)), kept.view.display, io, client)
	} catch (error) {
		failImage(state, key, error)
	}
}

// Resolves once the workspace of the tab (its profiles) is loaded, at once when it already is.
function workspaceLoaded(sync: WorkspaceSyncState): Promise<void> {
	if (sync.loaded) return Promise.resolve()

	return new Promise((resolve) => {
		const stop = subscribe(sync, () => {
			if (!sync.loaded) return
			stop()
			resolve()
		})
	})
}

// Keeps the file documents of the tab, in tab order, and shows them again once when the page loads (restoreImage), as
// soon as the workspace of sync is loaded, since a document starts from the preferences of the active profile; those
// still waiting stay kept meanwhile. A key already open is skipped.
export function openImagesEntry(images: ImagesState, io: ImagesIo = browserIo, client: string = clientId, sync: WorkspaceSyncState = workspaceSyncState): ViewEntry {
	// Documents kept by the page before the reload and not shown again yet.
	let pending: readonly KeptImage[] = []

	return {
		name: 'openImages',
		store: images,
		restore: (value) => {
			pending = value as readonly KeptImage[]

			void workspaceLoaded(sync).then(() => {
				const restoring = pending
				pending = []
				for (const kept of restoring) if (!documentOf(images, kept.key)) void restoreImage(images, kept, io, client)
			})
		},
		value: () => {
			const kept = images.documents.flatMap((document) => keptImage(document, images.views[document.key], images.tools[document.key]) ?? [])
			const all = [...kept, ...pending.filter(({ key }) => !documentOf(images, key))]
			return all.length > 0 ? all : undefined
		},
	}
}
