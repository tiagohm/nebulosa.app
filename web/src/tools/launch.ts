import { navigate, type RouteState } from '../shell/route'
import type { ToolDefinition } from './tools'

// Opening of a tool from anywhere in the interface: it navigates to the workspace and mode that run the
// tool, where its controls show what is missing. Opening never starts an operation, so a tool whose
// requirements are not met can still be opened safely; planned tools cannot be opened.

// Whether a tool can be opened.
export function canLaunch(tool: Pick<ToolDefinition, 'status'>): boolean {
	return tool.status !== 'planned'
}

// Opens a tool in its workspace and mode. Returns false, changing nothing, for a planned tool.
export function launchTool(state: RouteState, tool: Pick<ToolDefinition, 'status' | 'route'>, history: Pick<History, 'pushState'> = window.history): boolean {
	if (!canLaunch(tool)) return false
	navigate(state, tool.route, history)
	return true
}
