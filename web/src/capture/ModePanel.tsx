import type { ReactNode } from 'react'
import type { EquipmentRole } from '../equipment/roles'
import { PanelSection } from '../shell/ContextualPanel'
import { RoleRow } from './RoleRow'

// Common structure of a Capture mode's contextual panel: the equipment the mode requires besides the
// camera, the mode's own sections, and the state of its operation. The camera is the one of the selected
// camera view, whose tab already shows its device and state and whose viewer offers the flow that fixes
// it, so the panel neither selects nor repeats it. Operations are owned by their services, never by this
// panel, so collapsing or switching it leaves them running.

export interface ModePanelProps {
	// Roles the mode requires besides the camera, in display order; the Equipment section is omitted when empty.
	readonly requires: readonly EquipmentRole[]
	// Sections of the mode's controls.
	readonly children: ReactNode
}

// Contextual panel of a Capture mode.
export function ModePanel({ requires, children }: ModePanelProps) {
	return (
		<>
			{requires.length > 0 && (
				<PanelSection title="Equipment">
					{requires.map((role) => (
						<RoleRow key={role} role={role} />
					))}
				</PanelSection>
			)}
			{children}
			<PanelSection title="Operation">
				<p className="m-0 text-ink-300">No operation running.</p>
			</PanelSection>
		</>
	)
}
