import type { ComponentType } from 'react'
import type { IconName } from '../ui/Icon'
import { AnnotationPanel } from './AnnotationPanel'
import { AutoFocusTool } from './AutoFocusTool'
import { CameraAcquisitionTool } from './CameraAcquisitionTool'
import type { CameraOperationContext } from './cameracontext'
import { DarkLibraryWizardTool } from './DarkLibraryWizardTool'
import { DarvTool } from './DarvTool'
import { FlatWizardTool } from './FlatWizardTool'
import { GuidingTool } from './GuidingTool'
import { ImageInspector } from './ImageInspector'
import { ImageProcessingPanel } from './ImageProcessingPanel'
import type { ImageDocument, ImageViewState } from './images'
import { IPolarTool } from './IPolarTool'
import { LiveStackingTool } from './LiveStackingTool'
import { MountNudgeTool } from './MountNudgeTool'
import { PlateSolverPanel } from './PlateSolverPanel'
import { PointingModelBuilderTool } from './PointingModelBuilderTool'
import { StarDetectionPanel } from './StarDetectionPanel'
import { StarProfileInspectorPanel } from './StarProfileInspectorPanel'
import { StreakDetectionPanel } from './StreakDetectionPanel'
import { TargetCenteringTool } from './TargetCenteringTool'
import { TppaTool } from './TppaTool'

// Static registry of the contextual tools of the Images workspace, in two categories: image tools, which work on the
// document shown, and camera operations, which command the camera of a camera tab and the equipment associated with
// it. A tool replaces the contextual panel of one document, and each document remembers the tool it shows, so two
// documents can show different tools. The Image Inspector is the default. Camera operations are listed only on
// camera tabs, never on a file or derived document. A tool without a panel is listed but cannot be selected. Selecting
// a tool never starts or stops an operation. This registry is the only place Images tools are declared.

// Contextual tools of the Images workspace, in tool bar order: the image tools, then the camera operations.
export const IMAGE_TOOLS = [
	'inspector',
	'plate-solver',
	'star-detection',
	'star-profile',
	'streak-detection',
	'annotation',
	'image-processing',
	'camera-acquisition',
	'live-stacking',
	'auto-focus',
	'mount-nudge',
	'guiding',
	'darv',
	'tppa',
	'ipolar',
	'pointing-model-builder',
	'target-centering',
	'flat-wizard',
	'dark-library-wizard',
] as const

// Identifier of an Images contextual tool.
export type ImageToolId = (typeof IMAGE_TOOLS)[number]

// Category of a tool: an image tool, or a camera operation of a camera tab.
export type ImageToolCategory = 'image' | 'camera'

// Heading of each category in the tool bar's overflow list.
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
	// Display name, the tooltip of its button in the tool bar and its entry in the overflow list.
	readonly label: string
	// Icon of its button in the tool bar.
	readonly icon: IconName
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

// Definition of every Images contextual tool, by id.
export const IMAGE_TOOL_DEFINITIONS: Readonly<Record<ImageToolId, ImageToolDefinition>> = {
	inspector: { id: 'inspector', label: 'Image Inspector', panelTitle: 'Image Inspector', icon: 'histogram', category: 'image', outputs: ['display'], panel: ImageInspector },
	'plate-solver': { id: 'plate-solver', label: 'Plate Solving', panelTitle: 'Plate Solving', icon: 'plateSolve', category: 'image', outputs: ['analysis'], panel: PlateSolverPanel },
	'star-detection': { id: 'star-detection', label: 'Star Detection', panelTitle: 'Star Detection', icon: 'starDetection', category: 'image', outputs: ['analysis'], panel: StarDetectionPanel },
	'star-profile': { id: 'star-profile', label: 'Star Profile Inspector', panelTitle: 'Star Profile Inspector', icon: 'starProfile', category: 'image', outputs: ['analysis'], panel: StarProfileInspectorPanel },
	'streak-detection': { id: 'streak-detection', label: 'Streak Detection', panelTitle: 'Streak Detection', icon: 'streakDetection', category: 'image', outputs: ['analysis'], panel: StreakDetectionPanel },
	annotation: { id: 'annotation', label: 'Annotation', panelTitle: 'Annotation', icon: 'annotation', category: 'image', outputs: ['analysis'], panel: AnnotationPanel },
	'image-processing': { id: 'image-processing', label: 'Image Processing', panelTitle: 'Image Processing', icon: 'wand', category: 'image', outputs: ['derived'], panel: ImageProcessingPanel },
	'camera-acquisition': { id: 'camera-acquisition', label: 'Acquisition', panelTitle: 'Acquisition', icon: 'shutter', category: 'camera', panel: CameraAcquisitionTool },
	'live-stacking': { id: 'live-stacking', label: 'Live Stacking', panelTitle: 'Live Stacking', icon: 'liveStack', category: 'camera', panel: LiveStackingTool },
	'auto-focus': { id: 'auto-focus', label: 'Auto Focus', panelTitle: 'Auto Focus', icon: 'focusCurve', category: 'camera', panel: AutoFocusTool },
	'mount-nudge': { id: 'mount-nudge', label: 'Mount Nudge', panelTitle: 'Mount Nudge', icon: 'move', category: 'camera', panel: MountNudgeTool },
	guiding: { id: 'guiding', label: 'Guiding', panelTitle: 'Guiding', icon: 'guideStar', category: 'camera', panel: GuidingTool },
	darv: { id: 'darv', label: 'DARV', panelTitle: 'DARV', icon: 'darv', category: 'camera', panel: DarvTool },
	tppa: { id: 'tppa', label: 'TPPA', panelTitle: 'TPPA', icon: 'threePoint', category: 'camera', panel: TppaTool },
	ipolar: { id: 'ipolar', label: 'iPolar', panelTitle: 'iPolar', icon: 'polarScope', category: 'camera', panel: IPolarTool },
	'pointing-model-builder': { id: 'pointing-model-builder', label: 'Pointing Model Builder', panelTitle: 'Pointing Model Builder', icon: 'pointingModel', category: 'camera', panel: PointingModelBuilderTool },
	'target-centering': { id: 'target-centering', label: 'Target Centering', panelTitle: 'Target Centering', icon: 'target', category: 'camera', panel: TargetCenteringTool },
	'flat-wizard': { id: 'flat-wizard', label: 'Flat Wizard', panelTitle: 'Flat Wizard', icon: 'flatField', category: 'camera', panel: FlatWizardTool },
	'dark-library-wizard': { id: 'dark-library-wizard', label: 'Dark Library Wizard', panelTitle: 'Dark Library Wizard', icon: 'darkLibrary', category: 'camera', panel: DarkLibraryWizardTool },
}

// Returns the category heading a tool is listed under in the tool bar's overflow list.
export function imageToolGroup(id: ImageToolId): string {
	return IMAGE_TOOL_CATEGORY_LABELS[IMAGE_TOOL_DEFINITIONS[id].category]
}

// Returns the tools of the tool bar of a document, in tool bar order: every image tool, plus the camera
// operations only on a camera tab, so a file, a derived document, or no document never lists them.
export function imageToolsFor(document?: Pick<ImageDocument, 'source'>): readonly ImageToolId[] {
	return document?.source.kind === 'camera' ? IMAGE_TOOLS : IMAGE_TOOLS.filter((id) => IMAGE_TOOL_DEFINITIONS[id].category === 'image')
}

// Returns why a listed tool cannot be selected, or undefined when it can: a tool without a panel is not implemented
// yet. The devices a camera operation needs are checked by its panel, which says what to set up, so a tab can still
// show an operation whose equipment is missing.
export function imageToolUnavailable(id: ImageToolId): string | undefined {
	return IMAGE_TOOL_DEFINITIONS[id].panel ? undefined : 'Not available yet.'
}

// Width of a button of the tool bar, in CSS pixels (`size-8`).
export const TOOL_BAR_BUTTON_WIDTH = 32

// Space between two items of the tool bar, in CSS pixels (`gap-0.5`).
export const TOOL_BAR_GAP = 2

// Width of the divider between the image tools and the camera operations, margins included, in CSS pixels
// (`w-px` with `mx-1`).
export const TOOL_BAR_DIVIDER_WIDTH = 9

// Tools of a tool bar split by the room it has.
export interface ImageToolBarLayout {
	// Tools shown as buttons, in tool bar order.
	readonly shown: readonly ImageToolId[]
	// Tools listed by the overflow button, in tool bar order; empty when every tool has a button and the overflow button
	// is not shown.
	readonly overflow: readonly ImageToolId[]
}

// Returns the width, in CSS pixels, of a tool bar with a button for each of the given tools, in tool bar order, a
// divider wherever the category changes, and the overflow button when overflow is true.
export function imageToolBarWidth(tools: readonly ImageToolId[], overflow: boolean): number {
	let items = tools.length + (overflow ? 1 : 0)
	let width = items * TOOL_BAR_BUTTON_WIDTH

	for (let i = 1; i < tools.length; i++) {
		if (IMAGE_TOOL_DEFINITIONS[tools[i]].category !== IMAGE_TOOL_DEFINITIONS[tools[i - 1]].category) {
			width += TOOL_BAR_DIVIDER_WIDTH
			items++
		}
	}

	return items > 0 ? width + (items - 1) * TOOL_BAR_GAP : 0
}

// Returns the first count tools, in tool bar order, with the selected tool in place of the last of them when it is not
// already among them.
function leadingTools(tools: readonly ImageToolId[], selected: ImageToolId, count: number): readonly ImageToolId[] {
	const shown = tools.slice(0, count)
	return shown.includes(selected) || !tools.includes(selected) ? shown : [...shown.slice(0, count - 1), selected]
}

// Splits the tools of a tool bar, in tool bar order, between buttons and the overflow list for a bar width CSS pixels
// wide: every tool has a button when they all fit; otherwise as many leading tools as fit beside the overflow button,
// the selected tool always among them, so the active tool stays visible. At least one button is shown however narrow
// the bar is.
export function fitImageToolBar(tools: readonly ImageToolId[], selected: ImageToolId, width: number): ImageToolBarLayout {
	if (tools.length <= 1 || imageToolBarWidth(tools, false) <= width) return { shown: tools, overflow: [] }

	let shown = leadingTools(tools, selected, 1)

	for (let count = tools.length - 1; count > 1; count--) {
		const candidate = leadingTools(tools, selected, count)

		if (imageToolBarWidth(candidate, true) <= width) {
			shown = candidate
			break
		}
	}

	return { shown, overflow: tools.filter((id) => !shown.includes(id)) }
}
