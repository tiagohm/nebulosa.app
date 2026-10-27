import type { ComponentType } from 'react'
import { AutoFocusTool } from './AutoFocusTool'
import { CameraAcquisitionTool } from './CameraAcquisitionTool'
import type { CameraOperationContext } from './cameracontext'
import { DarvTool } from './DarvTool'
import { FlatWizardTool } from './FlatWizardTool'
import { GuidingTool } from './GuidingTool'
import { ImageInspector } from './ImageInspector'
import { ImageProcessingPanel } from './ImageProcessingPanel'
import type { ImageDocument, ImageViewState } from './images'
import { MountNudgeTool } from './MountNudgeTool'
import { PlateSolverPanel } from './PlateSolverPanel'
import { StarDetectionPanel } from './StarDetectionPanel'
import { TppaTool } from './TppaTool'

// Static registry of the contextual tools of the Images workspace, in two categories: image tools, which work on the
// document shown, and camera operations, which command the camera of a camera tab and the equipment associated with
// it. A tool replaces the contextual panel of one document, and each document remembers the tool it shows, so two
// documents can show different tools. The Image Inspector is the default. Camera operations are offered only on
// camera tabs, never on a file or derived document. A tool without a panel is listed but cannot be selected. Selecting
// a tool never starts or stops an operation. This registry is the only place Images tools are declared.

// Contextual tools of the Images workspace, in selector order: the image tools, then the camera operations.
export const IMAGE_TOOLS = ['inspector', 'plate-solver', 'star-detection', 'streak-detection', 'image-processing', 'camera-acquisition', 'auto-focus', 'mount-nudge', 'guiding', 'darv', 'tppa', 'flat-wizard'] as const

// Identifier of an Images contextual tool.
export type ImageToolId = (typeof IMAGE_TOOLS)[number]

// Category of a tool: an image tool, or a camera operation of a camera tab.
export type ImageToolCategory = 'image' | 'camera'

// Heading of each category in the tool selector.
export const IMAGE_TOOL_CATEGORY_LABELS: Readonly<Record<ImageToolCategory, string>> = { image: 'Image Tools', camera: 'Camera Operations' }

// Properties of a tool's contextual panel.
export interface ImageToolPanelProps {
	// Active document; absent when none is open.
	readonly document?: ImageDocument
	// View state of the active document.
	readonly view?: ImageViewState
	// Camera of the active camera tab and the equipment associated with it; absent for any other document.
	readonly camera?: CameraOperationContext
	// Opens the file chooser.
	readonly onOpen: () => void
	// Opens the Save As dialog of the active document.
	readonly onSaveAs: () => void
}

// What running an image tool's operation produces: a new rendering of the document (display), a new temporary
// document (derived), or data and overlays about the document that leave its pixels untouched
// (analysis). The output also names the tool's main action: Apply to View, Run Pipeline, or
// Run Analysis.
export type ImageOperationOutput = 'display' | 'derived' | 'analysis'

// Properties common to every Images contextual tool.
interface ImageToolBase {
	// Tool identifier.
	readonly id: ImageToolId
	// Display name in the tool selector.
	readonly label: string
	// Heading of the contextual panel.
	readonly panelTitle: string
	// Contextual panel content; absent for a tool that is not implemented yet.
	readonly panel?: ComponentType<ImageToolPanelProps>
}

// Definition of an image tool, which works on any document.
export interface ImageToolOnImage extends ImageToolBase {
	readonly category: 'image'
	// Outputs the tool's operation supports, the default first.
	readonly outputs: readonly [ImageOperationOutput, ...ImageOperationOutput[]]
}

// Definition of a camera operation, which works only on a camera tab; its frames reach the tab through the latest
// frame of the camera, never through a viewer of its own.
export interface CameraOperationTool extends ImageToolBase {
	readonly category: 'camera'
}

// Definition of an Images contextual tool.
export type ImageToolDefinition = ImageToolOnImage | CameraOperationTool

// Returns the definition of an image tool that has no panel yet.
function plannedImageTool(id: ImageToolId, label: string, outputs: ImageToolOnImage['outputs']): ImageToolOnImage {
	return { id, label, panelTitle: label, category: 'image', outputs }
}

// Definition of every Images contextual tool, by id.
export const IMAGE_TOOL_DEFINITIONS: Readonly<Record<ImageToolId, ImageToolDefinition>> = {
	inspector: { id: 'inspector', label: 'Image Inspector', panelTitle: 'Image Inspector', category: 'image', outputs: ['display'], panel: ImageInspector },
	'plate-solver': { id: 'plate-solver', label: 'Plate Solving', panelTitle: 'Plate Solving', category: 'image', outputs: ['analysis'], panel: PlateSolverPanel },
	'star-detection': { id: 'star-detection', label: 'Star Detection', panelTitle: 'Star Detection', category: 'image', outputs: ['analysis'], panel: StarDetectionPanel },
	'streak-detection': plannedImageTool('streak-detection', 'Streak Detection', ['analysis']),
	'image-processing': { id: 'image-processing', label: 'Image Processing', panelTitle: 'Image Processing', category: 'image', outputs: ['derived'], panel: ImageProcessingPanel },
	'camera-acquisition': { id: 'camera-acquisition', label: 'Acquisition', panelTitle: 'Acquisition', category: 'camera', panel: CameraAcquisitionTool },
	'auto-focus': { id: 'auto-focus', label: 'Auto Focus', panelTitle: 'Auto Focus', category: 'camera', panel: AutoFocusTool },
	'mount-nudge': { id: 'mount-nudge', label: 'Mount Nudge', panelTitle: 'Mount Nudge', category: 'camera', panel: MountNudgeTool },
	guiding: { id: 'guiding', label: 'Guiding', panelTitle: 'Guiding', category: 'camera', panel: GuidingTool },
	darv: { id: 'darv', label: 'DARV', panelTitle: 'DARV', category: 'camera', panel: DarvTool },
	tppa: { id: 'tppa', label: 'TPPA', panelTitle: 'TPPA', category: 'camera', panel: TppaTool },
	'flat-wizard': { id: 'flat-wizard', label: 'Flat Wizard', panelTitle: 'Flat Wizard', category: 'camera', panel: FlatWizardTool },
}

// Returns the category heading a tool is listed under in the selector.
export function imageToolGroup(id: ImageToolId): string {
	return IMAGE_TOOL_CATEGORY_LABELS[IMAGE_TOOL_DEFINITIONS[id].category]
}

// Returns why a tool cannot be selected for a document, or undefined when it can: a camera operation needs a camera
// tab, and a tool without a panel is not implemented yet. The devices a camera operation needs are checked by its
// panel, which says what to set up, so a tab can still show an operation whose equipment is missing.
export function imageToolUnavailable(id: ImageToolId, document?: Pick<ImageDocument, 'source'>): string | undefined {
	const definition = IMAGE_TOOL_DEFINITIONS[id]
	if (definition.category === 'camera' && document?.source.kind !== 'camera') return 'Only on a camera tab.'
	return definition.panel ? undefined : 'Not available yet.'
}
