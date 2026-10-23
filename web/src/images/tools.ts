import type { ComponentType } from 'react'
import { ImageInspector } from './ImageInspector'
import type { ImageDocument, ImageViewState } from './images'
import { PlateSolverPanel } from './PlateSolverPanel'
import { StarDetectionPanel } from './StarDetectionPanel'

// Static registry of the contextual tools of the Images workspace. A tool replaces the contextual panel
// of one document, and each document remembers the tool it shows, so two documents can show different
// tools. The Image Inspector is the default; Star Detection analyzes the document, and the other analysis and
// processing tools are listed but cannot be selected until they have a panel. This registry is the only place Images tools are declared.

// Contextual tools of the Images workspace, in selector order.
export const IMAGE_TOOLS = ['inspector', 'plate-solver', 'star-detection', 'streak-detection', 'image-processing'] as const

// Identifier of an Images contextual tool.
export type ImageToolId = (typeof IMAGE_TOOLS)[number]

// Properties of a tool's contextual panel.
export interface ImageToolPanelProps {
	// Active document; absent when none is open.
	readonly document?: ImageDocument
	// View state of the active document.
	readonly view?: ImageViewState
	// Opens the file chooser.
	readonly onOpen: () => void
	// Opens the Save As dialog of the active document.
	readonly onSaveAs: () => void
}

// What running a tool's operation produces: a new rendering of the document (display), a new temporary
// document (derived), or data and overlays about the document that leave its pixels untouched
// (analysis). The output also names the tool's main action: Apply to View, Create Derived Image, or
// Run Analysis.
export type ImageOperationOutput = 'display' | 'derived' | 'analysis'

// Definition of an Images contextual tool.
export interface ImageToolDefinition {
	// Tool identifier.
	readonly id: ImageToolId
	// Display name in the tool selector.
	readonly label: string
	// Heading of the contextual panel.
	readonly panelTitle: string
	// Outputs the tool's operation supports, the default first.
	readonly outputs: readonly [ImageOperationOutput, ...ImageOperationOutput[]]
	// Contextual panel content; absent for a tool that is not implemented yet.
	readonly panel?: ComponentType<ImageToolPanelProps>
}

// Returns the definition of a tool that has no panel yet.
function plannedTool(id: Exclude<ImageToolId, 'inspector'>, label: string, outputs: ImageToolDefinition['outputs']): ImageToolDefinition {
	return { id, label, panelTitle: label, outputs }
}

// Definition of every Images contextual tool, by id.
export const IMAGE_TOOL_DEFINITIONS: Readonly<Record<ImageToolId, ImageToolDefinition>> = {
	inspector: { id: 'inspector', label: 'Image Inspector', panelTitle: 'Image Inspector', outputs: ['display', 'derived'], panel: ImageInspector },
	'plate-solver': { id: 'plate-solver', label: 'Plate Solving', panelTitle: 'Plate Solving', outputs: ['analysis'], panel: PlateSolverPanel },
	'star-detection': { id: 'star-detection', label: 'Star Detection', panelTitle: 'Star Detection', outputs: ['analysis'], panel: StarDetectionPanel },
	'streak-detection': plannedTool('streak-detection', 'Streak Detection', ['analysis']),
	'image-processing': plannedTool('image-processing', 'Image Processing', ['derived']),
}

// Returns why a tool cannot be selected, or undefined when it can.
export function imageToolUnavailable(id: ImageToolId): string | undefined {
	return IMAGE_TOOL_DEFINITIONS[id].panel ? undefined : 'Not available yet.'
}
