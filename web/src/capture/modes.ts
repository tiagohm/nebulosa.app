import type { ComponentType } from 'react'
import type { CameraRole, EquipmentRole } from '../equipment/roles'
import type { CaptureMode } from '../shell/route'
import { CameraCapturePanel } from './CameraCapturePanel'
import { MountNudgePanel } from './MountNudgePanel'

// Static registry of the Capture workspace's operational modes. A mode configures the shared workspace
// (its panel, overlays, and required equipment) of one camera view, and every mode uses that view's
// camera. A mode is not an operation, so selecting or leaving a mode never starts or stops anything;
// operations belong to the server services the mode's panel drives. Every mode shares the same viewer
// and device services. A planned mode is listed so the workflow is discoverable, but it cannot be
// selected until its operations exist; the camera mode is the home of every view and is never planned.

// Props of a mode's panel sections.
export interface CaptureModePanelProps {
	// Camera role of the selected camera view, whose device the mode uses.
	readonly camera: CameraRole
}

// Overlay drawn over the viewer by a mode.
export type CaptureOverlay = 'reticle'

// Definition of a Capture mode.
export interface CaptureModeDefinition {
	// Mode identifier, also the URL path segment.
	readonly id: CaptureMode
	// Display name in the mode selector.
	readonly label: string
	// Heading of the contextual panel.
	readonly panelTitle: string
	// Whether the mode's operations are not implemented yet, so it cannot be selected.
	readonly planned: boolean
	// Mode-specific sections of the contextual panel; absent when the mode has none.
	readonly panel?: ComponentType<CaptureModePanelProps>
	// Overlays shown by default over the viewer.
	readonly overlays: readonly CaptureOverlay[]
	// Roles the mode needs besides the camera of the view, in display order. Optional devices (such as
	// the filter wheel of the Flat Wizard) and devices managed by an external service (such as PHD2's
	// own guide camera and mount) are not listed.
	readonly requires: readonly EquipmentRole[]
}

// Definition of every Capture mode, by id, in selector order.
export const CAPTURE_MODE_DEFINITIONS: Readonly<Record<CaptureMode, CaptureModeDefinition>> = {
	camera: { id: 'camera', label: 'Camera Capture', panelTitle: 'Camera Capture', planned: false, panel: CameraCapturePanel, overlays: [], requires: [] },
	'mount-nudge': { id: 'mount-nudge', label: 'Mount Nudge', panelTitle: 'Mount Nudge', planned: false, panel: MountNudgePanel, overlays: [], requires: ['MOUNT'] },
	guiding: { id: 'guiding', label: 'Guiding', panelTitle: 'Guiding', planned: true, overlays: [], requires: [] },
	'auto-focus': { id: 'auto-focus', label: 'Auto Focus', panelTitle: 'Auto Focus', planned: true, overlays: [], requires: ['FOCUSER'] },
	darv: { id: 'darv', label: 'DARV', panelTitle: 'Drift Alignment (DARV)', planned: true, overlays: ['reticle'], requires: ['MOUNT'] },
	tppa: { id: 'tppa', label: 'TPPA', panelTitle: 'Three-Point Polar Alignment', planned: true, overlays: ['reticle'], requires: ['MOUNT'] },
	'flat-wizard': { id: 'flat-wizard', label: 'Flat Wizard', panelTitle: 'Flat Wizard', planned: true, overlays: [], requires: [] },
}

// Returns why a mode cannot be selected, or undefined when it can.
export function captureModeUnavailable(mode: CaptureMode): string | undefined {
	return CAPTURE_MODE_DEFINITIONS[mode].planned ? 'Not available yet.' : undefined
}
