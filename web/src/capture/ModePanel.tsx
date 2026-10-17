import type { ReactNode } from 'react'
import type { CameraRole, EquipmentRole } from '../equipment/roles'
import { PanelSection } from '../shell/ContextualPanel'
import { RoleRow } from './RoleRow'

// Common structure of a Capture mode's contextual panel: the camera of the view and the other equipment
// the mode requires, the mode's own sections, and the state of its operation. The camera is the one of
// the selected camera view, so no panel selects a camera. Operations are owned by their services, never
// by this panel, so collapsing or switching it leaves them running.

export interface ModePanelProps {
	// Camera role of the view the panel belongs to.
	readonly camera: CameraRole
	// Roles the mode requires besides the camera, in display order.
	readonly requires: readonly EquipmentRole[]
	// Sections of the mode's controls.
	readonly children: ReactNode
}

// Contextual panel of a Capture mode.
export function ModePanel({ camera, requires, children }: ModePanelProps) {
	return (
		<>
			<PanelSection title="Equipment">
				{[camera, ...requires].map((role) => (
					<RoleRow key={role} role={role} />
				))}
			</PanelSection>
			{children}
			<PanelSection title="Operation">
				<p className="m-0 text-ink-300">No operation running.</p>
			</PanelSection>
		</>
	)
}
