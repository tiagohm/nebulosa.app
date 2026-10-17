import { cameraView } from '../capture/views'
import type { CameraRole } from '../equipment/roles'
import { navigate, type RouteState } from '../shell/route'
import type { ToolDefinition } from './tools'

// Opening of a tool from anywhere in the interface: it navigates to the workspace and mode that run the
// tool, where its controls show what is missing. A Capture tool opens in the selected camera view, never
// asking for a camera; without any camera Capture shows that none is configured. Opening never starts an
// operation, so a tool whose requirements are not met can still be opened safely; planned tools cannot
// be opened.

// Whether a tool can be opened.
export function canLaunch(tool: Pick<ToolDefinition, 'status'>): boolean {
	return tool.status !== 'planned'
}

// Opens a tool in its workspace and, for Capture, in its mode within the view of camera, the camera role
// of the selected camera view (undefined when none is assigned). Returns false, changing nothing, for a
// planned tool.
export function launchTool(state: RouteState, tool: Pick<ToolDefinition, 'status' | 'route'>, camera: CameraRole | undefined, history: Pick<History, 'pushState'> = window.history): boolean {
	if (!canLaunch(tool)) return false
	const { route } = tool
	navigate(state, route.workspace === 'capture' ? { workspace: 'capture', camera: cameraView(camera ?? 'MAIN_CAMERA'), mode: route.mode } : route, history)
	return true
}
