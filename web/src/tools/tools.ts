import type { ComponentType } from 'react'
import type { ToolId } from '../shell/route'
import type { IconName } from '../ui/Icon'
import { Calculator } from './calculator/Calculator'
import { LunarEclipseMap } from './lunareclipse/LunarEclipseMap'
import { SolarEclipseMap } from './solareclipse/SolarEclipseMap'

// Static registry of the Tools workspace: standalone utilities that need neither a camera view nor an
// image document. The contextual tools and camera operations of Images are not listed
// here; they belong to the selectors of their workspaces. A tool opens at /tools/<id> in the Tools
// workspace; a tool without a view is planned and cannot be opened. A tool backed by a server service,
// such as the Alpaca Server, only shows and controls that service: closing its view never stops it.

// Implementation state: openable, or planned and not openable.
export type ToolStatus = 'available' | 'planned'

// Definition of a standalone tool.
export interface ToolDefinition {
	// Stable identifier, also the URL path segment.
	readonly id: ToolId
	// Display name.
	readonly label: string
	// One-sentence description.
	readonly description: string
	// Card icon.
	readonly icon: IconName
	// Component rendering the tool, including its WorkspaceLayout; absent while the tool is planned.
	readonly view?: ComponentType
}

// Every standalone tool, by id.
export const TOOL_DEFINITIONS: Readonly<Record<ToolId, ToolDefinition>> = {
	calculator: { id: 'calculator', label: 'Calculator', description: 'Field of view, image scale, sampling, and other observing calculations.', icon: 'calculator', view: Calculator },
	'solar-eclipse-map': { id: 'solar-eclipse-map', label: 'Solar Eclipse Map', description: 'Path and local circumstances of solar eclipses.', icon: 'sun', view: SolarEclipseMap },
	'lunar-eclipse-map': { id: 'lunar-eclipse-map', label: 'Lunar Eclipse Map', description: 'Visibility and local circumstances of lunar eclipses.', icon: 'moon', view: LunarEclipseMap },
	'alpaca-server': { id: 'alpaca-server', label: 'Alpaca Server', description: 'Publishes selected devices to ASCOM Alpaca clients on the network.', icon: 'server' },
}

// Returns the implementation state of a tool.
export function toolStatus(tool: Pick<ToolDefinition, 'view'>): ToolStatus {
	return tool.view ? 'available' : 'planned'
}
