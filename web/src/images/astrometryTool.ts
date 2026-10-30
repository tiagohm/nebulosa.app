import { useEffect, useMemo, useRef } from 'react'
import { proxy } from 'valtio'
import { type AstrometryMode, type Draft, draftFrom, hitMeasurement, moveDraft, pressDraft, releaseDraft } from '../platesolving/measurement'
import type { ViewerInteraction } from '../viewer/interaction'
import type { OverlayView, Point } from '../viewer/transform'
import { addMeasurement, type ImageAstrometryState, imagesState, removeMeasurement, selectAstrometryItem, updateMeasurement } from './images'

// Astrometric tool of the Images workspace: the viewer interaction that draws and edits the measurements of the
// document shown. While a measurement mode is chosen it owns every press over the image (a drag draws, a click then
// another click draws too); with the Plate Solver tool shown it takes only presses on the handles of measurements,
// leaving the rest to the pan and a click to select. The gesture in progress (the draft) lives in its own store, so a
// pointer move renders only the overlay that draws it, never the workspace. A draft belongs to one image: it is dropped
// when another image is shown or the tool is disabled, and a drawing when the mode changes to another kind. Escape
// drops the draft, then leaves the mode, then clears the selection; Delete removes the selected measurement. Nothing
// here solves or sends anything.

// Radius of the handles a press picks, in screen pixels.
export const HANDLE_RADIUS = 12

// Distance from a line a click selects it within, in screen pixels.
const LINE_PICK_RADIUS = 8

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
	// Its measurements and selection.
	readonly astrometry?: ImageAstrometryState
	// Mode chosen for it.
	readonly mode: AstrometryMode
	// Chooses its mode.
	readonly onModeChange: (mode: AstrometryMode) => void
	// Whether measurements can be drawn or edited: a solution is shown and Guiding does not pick a star.
	readonly enabled: boolean
	// Whether the handles of measurements can be dragged and measurements selected by a click outside a mode: the
	// Plate Solver tool is shown.
	readonly editable: boolean
}

// Interaction and click handler of the tool.
export interface AstrometryTool {
	// Interaction the viewer routes presses to; absent when the tool takes none.
	readonly interaction?: ViewerInteraction
	// Selects the measurement whose line is under a click, or clears the selection; absent when clicks are not the
	// tool's.
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
		if (draft && (!enabled || draft.imageId !== imageId || (draft.type === 'create' && draft.kind !== mode))) astrometryDraft.draft = undefined
	}, [documentKey, imageId, mode, enabled])

	const drawing = mode !== 'pan'
	const interaction = useMemo<ViewerInteraction>(
		() => ({
			cursor: drawing ? 'crosshair' : 'grab',
			onPointerDown(point, view) {
				const { imageId, astrometry, mode } = latest.current
				if (!imageId || !astrometry) return false
				const { draft, take } = pressDraft(astrometryDraft.draft, point, { imageId, mode, measurements: astrometry.measurements, selected: astrometry.selected?.id, radius: HANDLE_RADIUS / view.scale })
				astrometryDraft.draft = draft
				if (draft?.type === 'edit') selectAstrometryItem(imagesState, latest.current.documentKey ?? '', { kind: 'measurement', id: draft.measurement.id })
				return take
			},
			onPointerMove(point) {
				if (astrometryDraft.draft) astrometryDraft.draft = moveDraft(astrometryDraft.draft, point)
			},
			onPointerUp(point, view) {
				const { documentKey } = latest.current
				const { draft, commit } = releaseDraft(astrometryDraft.draft, point, CLICK_RADIUS / view.scale)
				astrometryDraft.draft = draft
				if (!documentKey || !commit) return
				if (commit.type === 'add') addMeasurement(imagesState, documentKey, commit.measurement)
				else updateMeasurement(imagesState, documentKey, commit.measurement)
			},
			onCancel() {
				const { documentKey, mode, astrometry, onModeChange } = latest.current
				if (astrometryDraft.draft) astrometryDraft.draft = undefined
				else if (mode !== 'pan') onModeChange('pan')
				else if (documentKey && astrometry?.selected) selectAstrometryItem(imagesState, documentKey, undefined)
			},
			onDelete() {
				const { documentKey, astrometry } = latest.current
				if (documentKey && astrometry?.selected) removeMeasurement(imagesState, documentKey, astrometry.selected.id)
			},
		}),
		[drawing],
	)

	const measureFrom = (point: Point) => {
		const { imageId } = latest.current
		if (!imageId) return
		astrometryDraft.draft = draftFrom(imageId, point)
		latest.current.onModeChange('distance')
	}

	if (!enabled) return { measureFrom }

	const select = (point: Point, view: OverlayView) => {
		const { documentKey, astrometry } = latest.current
		if (!documentKey || !astrometry) return
		const id = hitMeasurement(astrometry.measurements, point, LINE_PICK_RADIUS / view.scale)
		selectAstrometryItem(imagesState, documentKey, id === undefined ? undefined : { kind: 'measurement', id })
	}

	return { interaction: drawing || editable ? interaction : undefined, select: editable && !drawing ? select : undefined, measureFrom }
}
