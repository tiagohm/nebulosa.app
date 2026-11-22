import { proxy } from 'valtio'
import type { ViewEntry } from '../profile/view'

// View of the bottom area of each camera tab: the capture frames carousel, or the Focus Curve, guiding graph, or
// Pointing Map of a session of its camera. The view is the operator's choice, except that a new Auto Focus session of
// the camera shows its Focus Curve once, the first time the tab sees it running, so a run is watched as it forms; the
// operator can then choose another view, which a later update of the same session never overrides. Both are kept in
// this tab's browser storage, so a reload comes back to the same view without following a session again.

// View of the bottom area of a camera tab.
export type BottomView = 'frames' | 'curve' | 'guiding' | 'pointing'

// Views of the bottom area, in display order.
export const BOTTOM_VIEWS: readonly BottomView[] = ['frames', 'curve', 'guiding', 'pointing']

// Bottom area of the camera tabs of this browser tab.
export interface CameraBottomViews {
	// View chosen for each camera tab, by camera tab key; the carousel when absent.
	views: Record<string, BottomView>
	// Id of the last Auto Focus session whose curve each camera tab showed by itself, by camera tab key.
	followed: Record<string, string>
}

// Bottom area of the camera tabs of this browser tab.
export const cameraBottomViews = proxy<CameraBottomViews>({ views: {}, followed: {} })

// Chooses the view of a camera tab, by its key.
export function chooseBottomView(state: CameraBottomViews, key: string, view: BottomView) {
	state.views[key] = view
}

// Shows the Focus Curve of a camera tab, by its key, for a running Auto Focus session, by its id, the first time the tab
// sees that session; a session it already followed leaves the view as the operator chose it.
export function followAutoFocus(state: CameraBottomViews, key: string, sessionId: string) {
	if (state.followed[key] === sessionId) return
	state.followed[key] = sessionId
	state.views[key] = 'curve'
}

// Keeps the bottom area of the camera tabs in browser storage; what the page set before the restore is kept.
export function cameraBottomViewsEntry(state: CameraBottomViews): ViewEntry {
	return {
		name: 'cameraBottomViews',
		store: state,
		restore: (value) => {
			const { views, followed } = value as Partial<CameraBottomViews>

			for (const [key, view] of Object.entries(views ?? {})) if (BOTTOM_VIEWS.includes(view)) state.views[key] ??= view
			for (const [key, sessionId] of Object.entries(followed ?? {})) if (typeof sessionId === 'string') state.followed[key] ??= sessionId
		},
		value: () => (Object.keys(state.views).length > 0 || Object.keys(state.followed).length > 0 ? state : undefined),
	}
}
