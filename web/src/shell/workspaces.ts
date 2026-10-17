import type { ComponentType } from 'react'
import { CaptureWorkspace } from '../capture/CaptureWorkspace'
import { ImagesWorkspace } from '../images/ImagesWorkspace'
import { SkyWorkspace } from '../sky/SkyWorkspace'
import { ToolsWorkspace } from '../tools/ToolsWorkspace'
import type { IconName } from '../ui/Icon'
import { WORKSPACE_IDS, type WorkspaceId } from './route'

// Static registry of the main workspaces: what the navigation rail lists and the shell renders. A new
// workspace (such as the Sequencer) is added to WORKSPACE_IDS and here; individual tools never are.

// Definition of a main workspace.
export interface WorkspaceDefinition {
	// Stable identifier, also the first URL path segment.
	readonly id: WorkspaceId
	// Display name in the navigation rail.
	readonly label: string
	// Navigation rail icon.
	readonly icon: IconName
	// Component rendering the whole workspace, including its WorkspaceLayout.
	readonly component: ComponentType
}

// Definition of every workspace, by id.
const DEFINITIONS: Readonly<Record<WorkspaceId, WorkspaceDefinition>> = {
	capture: { id: 'capture', label: 'Capture', icon: 'capture', component: CaptureWorkspace },
	images: { id: 'images', label: 'Images', icon: 'images', component: ImagesWorkspace },
	sky: { id: 'sky', label: 'Sky', icon: 'sky', component: SkyWorkspace },
	tools: { id: 'tools', label: 'Tools', icon: 'tools', component: ToolsWorkspace },
}

// Workspaces in navigation order.
export const WORKSPACES: readonly WorkspaceDefinition[] = WORKSPACE_IDS.map((id) => DEFINITIONS[id])

// Returns the definition of a workspace.
export function workspaceDefinition(id: WorkspaceId): WorkspaceDefinition {
	return DEFINITIONS[id]
}
