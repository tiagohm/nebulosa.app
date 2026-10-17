import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { deviceState } from '../equipment/equipment'
import { type EquipmentRole, roleDefinition } from '../equipment/roles'
import { RoleStatusText } from '../equipment/RoleStatusText'
import { useRoleDevice } from '../equipment/useEquipment'
import { activeProfile, activeSetup, profileState } from '../profile/profile'

// Row of a contextual panel with the device the active profile assigned to a role and its real state,
// and a shortcut to the existing flow that resolves a missing requirement. It only reads state.

export interface RoleRowProps {
	// Role whose device is shown.
	readonly role: EquipmentRole
}

// Device and state of a role, with a shortcut to fix it.
export function RoleRow({ role }: RoleRowProps) {
	const { device, status } = useRoleDevice(role)
	const profiles = useSnapshot(profileState)
	const name = device?.name || activeSetup(activeProfile(profiles))[role]?.name || (status === 'notSelected' ? 'None selected' : 'Unknown device')
	const fix = status === 'unavailable' ? { label: 'Connections', open: () => (connectionState.open = true) } : status === 'connected' || status === 'connecting' || status === 'disconnecting' ? undefined : { label: 'Equipment Setup', open: () => (deviceState.open = true) }

	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-baseline justify-between gap-2">
				<span className="text-xs text-ink-300">{roleDefinition(role).label}</span>
				<RoleStatusText status={status} className="text-xs" />
			</div>
			<div className="flex items-baseline justify-between gap-2">
				<span className="min-w-0 truncate text-ink-100">{name}</span>
				{fix && (
					<button type="button" onClick={fix.open} className="flex-none cursor-pointer border-0 bg-transparent p-0 font-mono text-xs text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
						{fix.label}
					</button>
				)}
			</div>
		</div>
	)
}
