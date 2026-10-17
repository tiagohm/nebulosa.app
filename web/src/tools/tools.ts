import { CAPTURE_MODE_DEFINITIONS } from '../capture/modes'
import type { EquipmentRole } from '../equipment/roles'
import type { CaptureMode, WorkspaceId } from '../shell/route'
import type { IconName } from '../ui/Icon'

// Static catalog of the application's tools: what each one does, what it needs, where it runs, and how
// far it is implemented. A tool is not a workspace: it opens in the workspace (and mode) that runs it,
// so the same implementation is reached from the catalog or from that workspace directly.

// Group a tool is listed under.
export type ToolCategory = 'image-analysis' | 'image-processing' | 'equipment' | 'astronomy'

// Implementation state: usable, a preview whose layout opens but whose operations do not exist yet, or
// planned and not openable.
export type ToolStatus = 'available' | 'preview' | 'planned'

// Resource a tool needs before it can run: a role's device connected, the camera of the selected Capture
// camera view connected (whichever camera role that is), or an open image.
export type ToolRequirement = { readonly kind: 'role'; readonly role: EquipmentRole } | { readonly kind: 'camera' } | { readonly kind: 'image' }

// Where a tool runs: a workspace and, for Capture, the mode it opens in the selected camera view.
export type ToolRoute = { readonly workspace: 'capture'; readonly mode: CaptureMode } | { readonly workspace: Exclude<WorkspaceId, 'capture'> }

// Definition of a tool.
export interface ToolDefinition {
	// Stable identifier.
	readonly id: string
	// Display name.
	readonly label: string
	// One-sentence description.
	readonly description: string
	// Card icon.
	readonly icon: IconName
	// Catalog group.
	readonly category: ToolCategory
	// Where the tool runs: its workspace and, for Capture, its mode.
	readonly route: ToolRoute
	// Resources the tool needs, in display order; empty when it needs none.
	readonly requires: readonly ToolRequirement[]
	// Implementation state.
	readonly status: ToolStatus
}

// Definition of a tool category.
export interface ToolCategoryDefinition {
	// Category identifier.
	readonly id: ToolCategory
	// Display name.
	readonly label: string
}

// Categories in catalog order.
export const TOOL_CATEGORIES: readonly ToolCategoryDefinition[] = [
	{ id: 'image-analysis', label: 'Image Analysis' },
	{ id: 'image-processing', label: 'Image Processing' },
	{ id: 'equipment', label: 'Equipment Tools' },
	{ id: 'astronomy', label: 'Astronomy Tools' },
]

// Requirement of an open image.
const IMAGE: readonly ToolRequirement[] = [{ kind: 'image' }]

// Returns the requirements of a Capture mode: the camera of the selected camera view and the roles of its
// registry definition.
function modeRequirements(mode: CaptureMode): readonly ToolRequirement[] {
	return [{ kind: 'camera' }, ...CAPTURE_MODE_DEFINITIONS[mode].requires.map((role): ToolRequirement => ({ kind: 'role', role }))]
}

// Returns the definition of a tool that runs as a Capture mode.
function captureTool(id: CaptureMode, description: string, icon: IconName): ToolDefinition {
	const label = id === 'camera' ? 'Camera Capturer' : CAPTURE_MODE_DEFINITIONS[id].label
	return { id, label, description, icon, category: 'equipment', route: { workspace: 'capture', mode: id }, requires: modeRequirements(id), status: 'preview' }
}

// Every tool, in catalog order within its category.
export const TOOLS: readonly ToolDefinition[] = [
	{ id: 'plate-solver', label: 'Plate Solver', description: 'Finds the sky coordinates and orientation of an image.', icon: 'compass', category: 'image-analysis', route: { workspace: 'images' }, requires: IMAGE, status: 'planned' },
	{ id: 'star-detection', label: 'Star Detection', description: 'Detects stars and measures their size and brightness.', icon: 'sky', category: 'image-analysis', route: { workspace: 'images' }, requires: IMAGE, status: 'planned' },
	{ id: 'streak-detection', label: 'Streak Detection', description: 'Finds satellite and meteor trails in an image.', icon: 'streak', category: 'image-analysis', route: { workspace: 'images' }, requires: IMAGE, status: 'planned' },
	{ id: 'image-processing', label: 'Image Processing', description: 'Stretches, calibrates, and transforms images.', icon: 'sliders', category: 'image-processing', route: { workspace: 'images' }, requires: IMAGE, status: 'planned' },
	captureTool('camera', 'Captures single frames or loops with the selected camera.', 'camera'),
	captureTool('mount-nudge', 'Frames a target by moving the mount while looping exposures.', 'mount'),
	captureTool('focus-calibrator', 'Finds the best focuser position from star sizes.', 'focuser'),
	captureTool('polar-alignment', 'Measures and corrects the polar axis alignment of the mount.', 'reticle'),
	{ id: 'astronomy-calculators', label: 'Astronomy Calculators', description: 'Field of view, sampling, exposure, and other observing calculations.', icon: 'calculator', category: 'astronomy', route: { workspace: 'tools' }, requires: [], status: 'planned' },
	{ id: 'astronomy-utilities', label: 'Astronomy Utilities', description: 'Time, coordinate, and ephemeris utilities.', icon: 'tools', category: 'astronomy', route: { workspace: 'tools' }, requires: [], status: 'planned' },
]

// Returns the definition of a tool, or undefined for an unknown id.
export function toolDefinition(id: string): ToolDefinition | undefined {
	return TOOLS.find((tool) => tool.id === id)
}
