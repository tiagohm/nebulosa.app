import { useEffect, useMemo, useRef } from 'react'
import { proxy, useSnapshot } from 'valtio'
import type { ViewerInteraction } from '../viewer/interaction'
import { type PixelRect, rectangleSelection } from '../viewer/rectangleSelection'
import type { Size } from '../viewer/transform'
import { holdCameraFrame } from './cameratabs'
import { imagesState, setStatisticsArea } from './images'

// Selection of the area the Histogram and Statistics section of the Image Inspector measures: Select Area puts one
// document in selection mode, where a drag over the image draws the rectangle (rectangleSelection) and its release
// commits it as the document's area and leaves the mode. The first press holds the frame a camera tab shows, so a new
// frame never replaces the image under the drag. Escape drops the rectangle in progress, then leaves the mode. The mode
// and the rectangle in progress live in their own store, so a pointer move renders only the overlay that draws it.

// Selection in progress: the document in selection mode and the rectangle being drawn over its image.
export interface StatisticsAreaSelection {
	// Key of the document in selection mode; absent when none is.
	documentKey?: string
	// Rectangle being drawn, with the id of the image it is drawn over.
	draft?: { readonly imageId: string; readonly rect: PixelRect }
}

// Selection in progress, shared by the Image Inspector, the workspace, and the overlay.
export const statisticsAreaSelection = proxy<StatisticsAreaSelection>({})

// Puts a document in selection mode, dropping any rectangle in progress.
export function startAreaSelection(documentKey: string) {
	statisticsAreaSelection.documentKey = documentKey
	statisticsAreaSelection.draft = undefined
}

// Leaves selection mode.
export function stopAreaSelection() {
	statisticsAreaSelection.documentKey = undefined
	statisticsAreaSelection.draft = undefined
}

// What the selection needs of the workspace.
export interface StatisticsAreaToolOptions {
	// Key of the document shown.
	readonly documentKey?: string
	// Id of its image.
	readonly imageId?: string
	// Size of its image, in pixels.
	readonly image?: Size
	// Whether an area can be drawn: the Image Inspector is shown, the overlays are, and Guiding picks no star.
	readonly enabled: boolean
}

// Returns the interaction of the selection of the document shown while it is in selection mode and enabled. Selection
// mode ends when it is disabled or another document is shown.
export function useStatisticsAreaTool(options: StatisticsAreaToolOptions): ViewerInteraction | undefined {
	const latest = useRef(options)
	latest.current = options
	const { documentKey, imageId, enabled } = options
	const selecting = useSnapshot(statisticsAreaSelection).documentKey
	const active = enabled && selecting !== undefined && selecting === documentKey

	useEffect(() => {
		if (selecting !== undefined && (!enabled || selecting !== documentKey)) stopAreaSelection()
		else if (statisticsAreaSelection.draft && statisticsAreaSelection.draft.imageId !== imageId) statisticsAreaSelection.draft = undefined
	}, [selecting, enabled, documentKey, imageId])

	const interaction = useMemo(
		() =>
			rectangleSelection({
				image: () => latest.current.image,
				onStart: () => {
					// A frame the camera would replace stays shown while its area is drawn.
					if (latest.current.documentKey) holdCameraFrame(imagesState, latest.current.documentKey)
				},
				onDraft: (rect) => {
					const { imageId } = latest.current
					statisticsAreaSelection.draft = rect && imageId ? { imageId, rect } : undefined
				},
				onCommit: (rect) => {
					if (latest.current.documentKey) setStatisticsArea(imagesState, latest.current.documentKey, rect)
					stopAreaSelection()
				},
				onLeave: stopAreaSelection,
			}),
		[],
	)

	return active ? interaction : undefined
}
