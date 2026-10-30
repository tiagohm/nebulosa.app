import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { useEffect, useMemo, useRef } from 'react'
import { proxy } from 'valtio'
import { type AstrometryMode, clampToImage, type Draft, type DraftCommit, draftFrom, hitItem, moveDraft, pressDraft, releaseDraft } from '../platesolving/measurement'
import type { ViewerInteraction } from '../viewer/interaction'
import type { OverlayView, Point, Size } from '../viewer/transform'
import { addMarker, addMeasurement, type ImageAstrometryState, imagesState, removeAstrometryItem, selectAstrometryItem, updateMarker, updateMeasurement } from './images'

// Astrometric tool of the Images workspace: the viewer interaction that draws and edits the measurements and markers of
// the document shown. While a measure mode is chosen it owns every press over the image (a drag draws, a click then
// another click draws too, a click places a marker); with the Plate Solver tool shown it takes only presses on the
// handles of measurements and on markers, leaving the rest to the pan and a click to select. Points are kept inside the
// image. The gesture in progress (the draft) lives in its own store, so a pointer move renders only the overlay that
// draws it, never the workspace. A draft belongs to one image: it is dropped when another image is shown or the tool is
// disabled, and a drawing when the mode changes to another kind. Escape drops the draft, then leaves the mode, then
// clears the selection; Delete removes the selected item. Nothing here solves or sends anything.

// Radius of the handles a press picks, in screen pixels.
export const HANDLE_RADIUS = 12

// Distance from an outline a click selects it within, in screen pixels.
const PICK_RADIUS = 8

// Distance a press may move and still be a click, in screen pixels.
const CLICK_RADIUS = 4

// Gesture in progress of the astrometric tool, shared by the tool and the overlay that draws it.
export const astrometryDraft = proxy<{ draft?: Draft }>({})

// What the tool needs of the workspace.
export interface AstrometryToolOptions {
	// Key of the document shown.
	readonly documentKey?: string
	// Id of its image.
	readonly imageId?: string
	// Size of its image, in pixels.
	readonly image?: Size
	// Selected solution of its image.
	readonly solution?: PlateSolution
	// Its measurements, markers, and selection.
	readonly astrometry?: ImageAstrometryState
	// Mode chosen for it.
	readonly mode: AstrometryMode
	// Chooses its mode.
	readonly onModeChange: (mode: AstrometryMode) => void
	// Whether items can be drawn or edited: a solution is shown and Guiding does not pick a star.
	readonly enabled: boolean
	// Whether handles can be dragged and items selected by a click outside a mode: the Plate Solver tool is shown.
	readonly editable: boolean
}

// Interaction and actions of the tool.
export interface AstrometryTool {
	// Interaction the viewer routes presses to; absent when the tool takes none.
	readonly interaction?: ViewerInteraction
	// Selects the item whose outline is under a click, or clears the selection; absent when clicks are not the tool's.
	readonly select?: (point: Point, view: OverlayView) => void
	// Starts a distance from a point, waiting for the click at its end.
	readonly measureFrom: (point: Point) => void
}

// Returns the tool of the document shown.
export function useAstrometryTool(options: AstrometryToolOptions): AstrometryTool {
	const latest = useRef(options)
	latest.current = options
	const { documentKey, imageId, mode, enabled, editable } = options

	// A draft of another image, of another kind than the mode, or while the tool is disabled is dropped.
	useEffect(() => {
		const { draft } = astrometryDraft
		if (draft && (!enabled || draft.imageId !== imageId || (draft.type === 'create' && draft.kind !== mode) || (draft.type === 'marker' && mode !== 'marker'))) astrometryDraft.draft = undefined
	}, [documentKey, imageId, mode, enabled])

	const drawing = mode !== 'pan'
	const interaction = useMemo<ViewerInteraction>(() => {
		// Returns a point kept inside the image shown.
		const inside = (point: Point) => (latest.current.image ? clampToImage(point, latest.current.image) : point)

		return {
			cursor: drawing ? 'crosshair' : 'grab',
			onPointerDown(point, view) {
				const { documentKey, imageId, astrometry, mode } = latest.current
				if (!documentKey || !imageId || !astrometry) return false
				const { draft, take } = pressDraft(astrometryDraft.draft, inside(point), { imageId, mode, measurements: astrometry.measurements, markers: astrometry.markers, selected: astrometry.selected, radius: HANDLE_RADIUS / view.scale })
				astrometryDraft.draft = draft
				if (draft?.type === 'edit') selectAstrometryItem(imagesState, documentKey, { kind: 'measurement', id: draft.original.id })
				else if (draft?.type === 'move') selectAstrometryItem(imagesState, documentKey, { kind: 'marker', id: draft.marker.id })
				return take
			},
			onPointerMove(point) {
				if (astrometryDraft.draft) astrometryDraft.draft = moveDraft(astrometryDraft.draft, inside(point))
			},
			onPointerUp(point, view) {
				const { draft, commit } = releaseDraft(astrometryDraft.draft, inside(point), CLICK_RADIUS / view.scale)
				astrometryDraft.draft = draft
				if (latest.current.documentKey) apply(latest.current.documentKey, commit)
			},
			onCancel() {
				const { documentKey, mode, astrometry, onModeChange } = latest.current
				if (astrometryDraft.draft) astrometryDraft.draft = undefined
				else if (mode !== 'pan') onModeChange('pan')
				else if (documentKey && astrometry?.selected) selectAstrometryItem(imagesState, documentKey, undefined)
			},
			onDelete() {
				const { documentKey, astrometry } = latest.current
				if (documentKey && astrometry?.selected) removeAstrometryItem(imagesState, documentKey, astrometry.selected)
			},
		}
	}, [drawing])

	const measureFrom = (point: Point) => {
		const { imageId, image } = latest.current
		if (!imageId) return
		astrometryDraft.draft = draftFrom(imageId, image ? clampToImage(point, image) : point)
		latest.current.onModeChange('distance')
	}

	if (!enabled) return { measureFrom }

	const select = (point: Point, view: OverlayView) => {
		const { documentKey, astrometry, solution } = latest.current
		if (!documentKey || !astrometry || !solution) return
		selectAstrometryItem(imagesState, documentKey, hitItem(solution, astrometry.measurements, astrometry.markers, point, PICK_RADIUS / view.scale, view.scale))
	}

	return { interaction: drawing || editable ? interaction : undefined, select: editable && !drawing ? select : undefined, measureFrom }
}

// Applies what a gesture ends with to the astrometry of a document.
function apply(documentKey: string, commit: DraftCommit) {
	if (!commit) return
	if (commit.type === 'addMeasurement') addMeasurement(imagesState, documentKey, commit.measurement)
	else if (commit.type === 'updateMeasurement') updateMeasurement(imagesState, documentKey, commit.measurement)
	else if (commit.type === 'addMarker') addMarker(imagesState, documentKey, commit.marker)
	else updateMarker(imagesState, documentKey, commit.marker)
}
