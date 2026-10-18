import { proxy } from 'valtio'

// Navigation state of the tab: the active workspace, for Capture its camera view and operational mode,
// and for Tools the standalone tool shown. The URL path is the source of truth, so each tab navigates
// independently and a reload reopens the same context; the camera and mode selected last are
// remembered by the active profile, which builds the Capture route opened from the navigation rail.
// Paths are /capture/<camera>/<mode>, /images, /sky, /tools, and /tools/<tool>; anything else opens
// the default route.

// Main workspaces, in navigation order.
export const WORKSPACE_IDS = ['capture', 'images', 'sky', 'tools'] as const

// Identifier of a main workspace; also its first path segment.
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

// Camera views of the Capture workspace; also the second path segment of a Capture route. Each one
// stands for a camera role of the profile's equipment setup.
export const CAPTURE_CAMERAS = ['main', 'guide'] as const

// Identifier of a Capture camera view.
export type CaptureCamera = (typeof CAPTURE_CAMERAS)[number]

// Operational modes of the Capture workspace; also the third path segment of a Capture route.
export const CAPTURE_MODES = ['camera', 'mount-nudge', 'guiding', 'auto-focus', 'darv', 'tppa', 'flat-wizard'] as const

// Identifier of a Capture operational mode.
export type CaptureMode = (typeof CAPTURE_MODES)[number]

// Mode ids written by earlier versions, in URLs and profiles, and the mode each one became.
const CAPTURE_MODE_ALIASES: Readonly<Record<string, CaptureMode>> = { 'focus-calibrator': 'auto-focus', 'polar-alignment': 'tppa' }

// Location in the Capture workspace: the camera view shown and its operational mode.
export interface CaptureRoute {
	// Capture workspace.
	readonly workspace: 'capture'
	// Camera view shown.
	readonly camera: CaptureCamera
	// Operational mode of the camera view.
	readonly mode: CaptureMode
}

// Standalone tools of the Tools workspace; also the second path segment of a Tools route.
export const TOOL_IDS = ['calculator', 'solar-eclipse-map', 'lunar-eclipse-map', 'alpaca-server'] as const

// Identifier of a standalone tool.
export type ToolId = (typeof TOOL_IDS)[number]

// Location in the Tools workspace: the catalog, or the view of one tool.
export interface ToolsRoute {
	// Tools workspace.
	readonly workspace: 'tools'
	// Tool shown; absent for the catalog.
	readonly tool?: ToolId
}

// Location within the application: a workspace and, for Capture, the camera view and its mode, or for
// Tools, the tool shown.
export type Route = CaptureRoute | ToolsRoute | { readonly workspace: Exclude<WorkspaceId, 'capture' | 'tools'> }

// Route opened for an empty or unknown path.
export const DEFAULT_ROUTE: Route = { workspace: 'capture', camera: 'main', mode: 'camera' }

// Navigation store of the tab.
export interface RouteState {
	// Current route, mirrored by the URL path.
	route: Route
}

// Navigation store of the tab, at the default route until watchHistory runs.
export const routeState = proxy<RouteState>({ route: DEFAULT_ROUTE })

// Whether value names a workspace.
function isWorkspaceId(value: string): value is WorkspaceId {
	return (WORKSPACE_IDS as readonly string[]).includes(value)
}

// Whether value names a Capture camera view.
function isCaptureCamera(value: string): value is CaptureCamera {
	return (CAPTURE_CAMERAS as readonly string[]).includes(value)
}

// Whether value names a standalone tool.
export function isToolId(value: unknown): value is ToolId {
	return (TOOL_IDS as readonly unknown[]).includes(value)
}

// Whether value names a Capture mode.
export function isCaptureMode(value: unknown): value is CaptureMode {
	return (CAPTURE_MODES as readonly unknown[]).includes(value)
}

// Returns the Capture mode a value names, reading the ids of earlier versions; undefined for anything else.
export function captureModeOf(value: unknown): CaptureMode | undefined {
	if (isCaptureMode(value)) return value
	return typeof value === 'string' && Object.hasOwn(CAPTURE_MODE_ALIASES, value) ? CAPTURE_MODE_ALIASES[value] : undefined
}

// Returns the route of a URL path. An unknown workspace gives DEFAULT_ROUTE; a Capture path without a
// known camera opens the main camera, reading the path written before camera views existed
// (/capture/<mode>); a mode id of an earlier version opens the mode it became, and an unknown mode
// opens the camera mode; an unknown tool opens the Tools catalog;
// extra segments are ignored.
export function parseRoute(pathname: string): Route {
	const [workspace = '', first = '', second = ''] = pathname.split('/').filter(Boolean)
	if (!isWorkspaceId(workspace)) return DEFAULT_ROUTE

	if (workspace === 'capture') {
		const camera = isCaptureCamera(first) ? first : 'main'
		const mode = isCaptureCamera(first) ? second : first
		return { workspace, camera, mode: captureModeOf(mode) ?? 'camera' }
	}

	if (workspace === 'tools') return isToolId(first) ? { workspace, tool: first } : { workspace }

	return { workspace }
}

// Returns the canonical URL path of a route.
export function routePath(route: Route): string {
	if (route.workspace === 'capture') return `/capture/${route.camera}/${route.mode}`
	if (route.workspace === 'tools' && route.tool) return `/tools/${route.tool}`
	return `/${route.workspace}`
}

// Navigates the tab to a route, adding a history entry when the path changes. Navigation only changes
// what is shown: it never connects, disconnects, or stops anything.
export function navigate(state: RouteState, route: Route, history: Pick<History, 'pushState'> = window.history) {
	if (routePath(route) !== routePath(state.route)) history.pushState(null, '', routePath(route))
	state.route = route
}

// Replaces the current route without adding a history entry, for a route that cannot be shown as is,
// such as a camera view whose role is no longer assigned.
export function redirect(state: RouteState, route: Route, history: Pick<History, 'replaceState'> = window.history) {
	if (routePath(route) !== routePath(state.route)) history.replaceState(null, '', routePath(route))
	state.route = route
}

// Opens a workspace from the navigation rail; Capture opens the given route, which the caller builds
// from the camera view and mode the active profile selected last.
export function openWorkspace(state: RouteState, workspace: WorkspaceId, capture: CaptureRoute, history: Pick<History, 'pushState'> = window.history) {
	navigate(state, workspace === 'capture' ? capture : { workspace }, history)
}

// Loads the route of the current URL, rewriting it to its canonical path, and follows the browser's back
// and forward buttons. Returns a function that stops following them.
export function watchHistory(state: RouteState, target: Window = window): () => void {
	function sync() {
		const route = parseRoute(target.location.pathname)
		state.route = route
		if (target.location.pathname !== routePath(route)) target.history.replaceState(null, '', routePath(route) + target.location.search)
	}

	sync()
	target.addEventListener('popstate', sync)
	return () => target.removeEventListener('popstate', sync)
}
