import type { OperationRecord } from 'api'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { roleDevice } from '../equipment/equipment'
import type { CameraRole, EquipmentRole } from '../equipment/roles'
import { useWatchedDevices } from '../equipment/useEquipment'
import { OPERATION_LABELS, operationsState, runningOn } from '../operations'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import { PanelSection } from '../shell/ContextualPanel'
import { RoleRow } from './RoleRow'

// Common structure of a Capture mode's contextual panel: the equipment the mode requires besides the
// camera, the mode's own sections, and the operations running on the devices the mode uses. The camera
// is the one of the selected camera view, whose tab already shows its device and state and whose viewer
// offers the flow that fixes it, so the panel neither selects nor repeats it. Operations are owned by
// their services, never by this panel, so collapsing or switching it leaves them running; the list shows
// every operation holding those devices, whichever tab or service started it.

export interface ModePanelProps {
	// Camera role of the selected camera view.
	readonly camera: CameraRole
	// Roles the mode requires besides the camera, in display order; the Equipment section is omitted when empty.
	readonly requires: readonly EquipmentRole[]
	// Sections of the mode's controls; absent when the mode has none.
	readonly children?: ReactNode
}

// Contextual panel of a Capture mode.
export function ModePanel({ camera, requires, children }: ModePanelProps) {
	const profiles = useSnapshot(profileState)
	const runtime = useWatchedDevices()
	const operations = useSnapshot(operationsState)
	const setup = activeSetup(activeProfile(profiles))
	const running = new Map<string, OperationRecord>()

	for (const role of [camera, ...requires]) {
		const device = roleDevice(setup, role, runtime)
		if (device) for (const operation of runningOn(operations, device.connectionId, device.id)) running.set(operation.operationId, operation)
	}

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
				{running.size === 0 ? (
					<p className="m-0 text-ink-300">No operation running.</p>
				) : (
					[...running.values()].map((operation) => (
						<p key={operation.operationId} className="m-0 text-ink-100">
							{OPERATION_LABELS[operation.kind]} running…
						</p>
					))
				)}
			</PanelSection>
		</>
	)
}
