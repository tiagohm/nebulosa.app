import { cn } from 'cn'
import { useSelectedConnection } from '../connection/useSelectedConnection'
import { type EquipmentRole, roleDefinition } from '../equipment/roles'
import { RoleStatusText } from '../equipment/RoleStatusText'
import { useRoleDevice } from '../equipment/useEquipment'

// Compact bar at the bottom of the window with the real state of the selected connection and of the
// main equipment roles, visible from every workspace. It shows only states the application knows; no
// operation is reported until operations exist.

// Roles summarized in the status bar, in display order.
const STATUS_ROLES: readonly EquipmentRole[] = ['MAIN_CAMERA', 'MOUNT']

// Status bar of the application.
export function StatusBar() {
	const { connection, status } = useSelectedConnection()
	const connectionText = !connection ? 'No connection' : status === 'connected' ? `${connection.name} · Connected` : status === 'connecting' ? `${connection.name} · Connecting` : `${connection.name} · Not connected`

	return (
		<footer className="flex h-7 flex-none items-center gap-4 overflow-hidden border-t border-line-100 bg-base-000 px-4 text-[11px] leading-4 whitespace-nowrap text-ink-200">
			<span className="flex min-w-0 items-center gap-1.5">
				<span className={cn('size-1.5 flex-none rounded-full', status === 'connected' ? 'bg-success' : status === 'connecting' ? 'bg-accent' : 'border border-ink-300')} />
				<span className="truncate">{connectionText}</span>
			</span>
			{STATUS_ROLES.map((role) => (
				<RoleStatusItem key={role} role={role} />
			))}
		</footer>
	)
}

interface RoleStatusItemProps {
	// Role whose device state is shown.
	readonly role: EquipmentRole
}

// Label and state of one role of the active profile.
function RoleStatusItem({ role }: RoleStatusItemProps) {
	const { status } = useRoleDevice(role)

	return (
		<span className="flex items-center gap-1.5 border-l border-line-100 pl-4 max-sm:hidden">
			<span className="text-ink-300">{roleDefinition(role).label}</span>
			<RoleStatusText status={status} />
		</span>
	)
}
