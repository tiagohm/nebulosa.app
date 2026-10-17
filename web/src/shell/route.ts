import { proxy } from 'valtio'

// Navigation state of the tab: the active workspace and, for Capture, its operational mode. The URL path
// is the source of truth, so each tab navigates independently and a reload reopens the same context;
// nothing is kept in localStorage. Paths are /capture/<mode>, /images, /sky, and /tools; anything else
// opens the default route.

// Main workspaces, in navigation order.
export const WORKSPACE_IDS = ['capture', 'images', 'sky', 'tools'] as const

// Identifier of a main workspace; also its first path segment.
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

// Operational modes of the Capture workspace; also the second path segment of a Capture route.
export const CAPTURE_MODES = ['camera', 'mount-nudge', 'focus-calibrator', 'polar-alignment'] as const

// Identifier of a Capture operational mode.
export type CaptureMode = (typeof CAPTURE_MODES)[number]

// Location within the application: a workspace and, for Capture, the selected mode.
export type Route = { readonly workspace: 'capture'; readonly mode: CaptureMode } | { readonly workspace: Exclude<WorkspaceId, 'capture'> }

// Route opened for an empty or unknown path.
export const DEFAULT_ROUTE: Route = { workspace: 'capture', mode: 'camera' }

// Navigation store of the tab.
export interface RouteState {
	// Current route, mirrored by the URL path.
	route: Route
	// Capture mode selected last in the tab, restored when Capture is opened from the navigation rail.
	captureMode: CaptureMode
}

// Navigation store of the tab, at the default route until watchHistory runs.
export const routeState = proxy<RouteState>({ route: DEFAULT_ROUTE, captureMode: 'camera' })

// Whether value names a workspace.
function isWorkspaceId(value: string): value is WorkspaceId {
	return (WORKSPACE_IDS as readonly string[]).includes(value)
}

// Whether value names a Capture mode.
function isCaptureMode(value: string): value is CaptureMode {
	return (CAPTURE_MODES as readonly string[]).includes(value)
}

// Returns the route of a URL path. An unknown workspace gives DEFAULT_ROUTE; a Capture path without a
// known mode opens the camera mode; extra segments are ignored.
export function parseRoute(pathname: string): Route {
	const [workspace = '', mode = ''] = pathname.split('/').filter(Boolean)
	if (!isWorkspaceId(workspace)) return DEFAULT_ROUTE
	if (workspace === 'capture') return { workspace, mode: isCaptureMode(mode) ? mode : 'camera' }
	return { workspace }
}

// Returns the canonical URL path of a route.
export function routePath(route: Route): string {
	return route.workspace === 'capture' ? `/capture/${route.mode}` : `/${route.workspace}`
}

// Applies a route to the store, remembering the Capture mode.
function apply(state: RouteState, route: Route) {
	state.route = route
	if (route.workspace === 'capture') state.captureMode = route.mode
}

// Navigates the tab to a route, adding a history entry when the path changes. Navigation only changes
// what is shown: it never connects, disconnects, or stops anything.
export function navigate(state: RouteState, route: Route, history: Pick<History, 'pushState'> = window.history) {
	if (routePath(route) !== routePath(state.route)) history.pushState(null, '', routePath(route))
	apply(state, route)
}

// Opens a workspace from the navigation rail; Capture reopens the mode selected last in the tab.
export function openWorkspace(state: RouteState, workspace: WorkspaceId, history: Pick<History, 'pushState'> = window.history) {
	navigate(state, workspace === 'capture' ? { workspace, mode: state.captureMode } : { workspace }, history)
}

// Loads the route of the current URL, rewriting it to its canonical path, and follows the browser's back
// and forward buttons. Returns a function that stops following them.
export function watchHistory(state: RouteState, target: Window = window): () => void {
	function sync() {
		const route = parseRoute(target.location.pathname)
		apply(state, route)
		if (target.location.pathname !== routePath(route)) target.history.replaceState(null, '', routePath(route) + target.location.search)
	}

	sync()
	target.addEventListener('popstate', sync)
	return () => target.removeEventListener('popstate', sync)
}
