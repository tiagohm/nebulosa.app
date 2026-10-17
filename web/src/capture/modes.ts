import type { ComponentType } from 'react'
import type { EquipmentRole } from '../equipment/roles'
import type { CaptureMode } from '../shell/route'
import { CameraPanel } from './CameraPanel'
import { FocusCalibratorPanel } from './FocusCalibratorPanel'
import { MountNudgePanel } from './MountNudgePanel'
import { PolarAlignmentPanel } from './PolarAlignmentPanel'

// Static registry of the Capture workspace's operational modes. A mode configures the shared workspace
// (its panel, overlays, and required equipment); it is not an operation, so selecting or leaving a
// mode never starts or stops anything. Every mode shares the same viewer and device services.

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
	// Contextual panel content.
	readonly panel: ComponentType
	// Overlays shown by default over the viewer.
	readonly overlays: readonly CaptureOverlay[]
	// Roles the mode needs, in display order.
	readonly requires: readonly EquipmentRole[]
}

// Definition of every Capture mode, by id, in selector order.
export const CAPTURE_MODE_DEFINITIONS: Readonly<Record<CaptureMode, CaptureModeDefinition>> = {
	camera: { id: 'camera', label: 'Camera Capture', panelTitle: 'Camera Controls', panel: CameraPanel, overlays: [], requires: ['MAIN_CAMERA'] },
	'mount-nudge': { id: 'mount-nudge', label: 'Mount Nudge', panelTitle: 'Mount Nudge', panel: MountNudgePanel, overlays: ['reticle'], requires: ['MAIN_CAMERA', 'MOUNT'] },
	'focus-calibrator': { id: 'focus-calibrator', label: 'Focus Calibrator', panelTitle: 'Focus Calibrator', panel: FocusCalibratorPanel, overlays: [], requires: ['MAIN_CAMERA', 'FOCUSER'] },
	'polar-alignment': { id: 'polar-alignment', label: 'Polar Alignment', panelTitle: 'Polar Alignment', panel: PolarAlignmentPanel, overlays: ['reticle'], requires: ['MAIN_CAMERA', 'MOUNT'] },
}
