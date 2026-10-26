import { proxy } from 'valtio'

// Navigation state of the tab: the active workspace, and for Tools the standalone tool shown. The URL path is the
// source of truth, so each tab navigates independently and a reload reopens the same context.
// Paths are /images, /sky, /tools, /tools/<tool>, the Equipment Control page
// /equipment, /equipment/<device id>, and /equipment/<device id>/indi for the INDI properties of the device,
// and the Settings page /settings/external-tools and
// /settings/external-tools/<tool id>, which are not workspaces of the navigation rail; anything else opens
// the default route.

// Main workspaces, in navigation order.
export const WORKSPACE_IDS = ['images', 'sky', 'tools'] as const

// Identifier of a main workspace; also its first path segment.
export type WorkspaceId = (typeof WORKSPACE_IDS)[number]

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

// View of a device in the Equipment Control page besides its controls: its INDI properties.
export type EquipmentView = 'indi'

// Location in the Equipment Control page: the device shown, if any, and its view. The page is opened from the
// Management menu, not from the navigation rail, and lists the devices of the active profile's connection only.
export interface EquipmentRoute {
	// Equipment Control page.
	readonly workspace: 'equipment'
	// Id of the device shown, on the active profile's connection; absent when none is selected.
	readonly device?: string
	// View of the device; absent for its controls.
	readonly view?: EquipmentView
}

// Location in the Settings page, whose only section is External Tools: the external program shown, if any.
// The page is opened from the Management menu, not from the navigation rail.
export interface SettingsRoute {
	// Settings page.
	readonly workspace: 'settings'
	// Id of the external program shown, as the server registers it; absent when none is selected.
	readonly tool?: string
}

// Location within the application: a workspace and, for Tools, the tool shown, the Equipment Control page and its
// device, or the Settings page and its external program.
export type Route = ToolsRoute | EquipmentRoute | SettingsRoute | { readonly workspace: Exclude<WorkspaceId, 'tools'> }

// Route opened for an empty or unknown path: Images, where the camera tabs are.
export const DEFAULT_ROUTE: Route = { workspace: 'images' }

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

// Whether value names a standalone tool.
export function isToolId(value: unknown): value is ToolId {
	return (TOOL_IDS as readonly unknown[]).includes(value)
}

// Returns the route of a URL path. An unknown workspace gives DEFAULT_ROUTE; an unknown tool opens the Tools
// catalog; any Settings path opens External Tools; extra segments are ignored.
export function parseRoute(pathname: string): Route {
	const [workspace = '', first = '', second = ''] = pathname.split('/').filter(Boolean)
	if (workspace === 'equipment') return first ? (second === 'indi' ? { workspace, device: first, view: second } : { workspace, device: first }) : { workspace }
	if (workspace === 'settings') return first === 'external-tools' && second ? { workspace, tool: second } : { workspace }
	if (!isWorkspaceId(workspace)) return DEFAULT_ROUTE

	if (workspace === 'tools') return isToolId(first) ? { workspace, tool: first } : { workspace }

	return { workspace }
}

// Returns the canonical URL path of a route.
export function routePath(route: Route): string {
	if (route.workspace === 'tools' && route.tool) return `/tools/${route.tool}`
	if (route.workspace === 'equipment') return route.device ? `/equipment/${encodeURIComponent(route.device)}${route.view ? `/${route.view}` : ''}` : '/equipment'
	if (route.workspace === 'settings') return route.tool ? `/settings/external-tools/${encodeURIComponent(route.tool)}` : '/settings/external-tools'
	return `/${route.workspace}`
}

// Navigates the tab to a route, adding a history entry when the path changes. Navigation only changes
// what is shown: it never connects, disconnects, or stops anything.
export function navigate(state: RouteState, route: Route, history: Pick<History, 'pushState'> = window.history) {
	if (routePath(route) !== routePath(state.route)) history.pushState(null, '', routePath(route))
	state.route = route
}

// Replaces the current route without adding a history entry, for a route that cannot be shown as is.
export function redirect(state: RouteState, route: Route, history: Pick<History, 'replaceState'> = window.history) {
	if (routePath(route) !== routePath(state.route)) history.replaceState(null, '', routePath(route))
	state.route = route
}

// Opens a workspace from the navigation rail.
export function openWorkspace(state: RouteState, workspace: WorkspaceId, history: Pick<History, 'pushState'> = window.history) {
	navigate(state, { workspace }, history)
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
