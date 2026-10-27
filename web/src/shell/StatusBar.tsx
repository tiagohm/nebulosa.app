import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { connectionState } from '../connection/connection'
import { useSelectedConnection } from '../connection/useSelectedConnection'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { deviceState } from '../equipment/equipment'
import { type EquipmentRole, roleDefinition } from '../equipment/roles'
import { RoleStatusText } from '../equipment/RoleStatusText'
import { useActiveServerId, useRoleDevice, useWatchedDevices } from '../equipment/useEquipment'
import { notificationsState } from '../notifications/notifications'
import { operationsState } from '../operations'
import { profileState } from '../profile/profile'
import { abortProfileMount } from './statusbar/abort'
import { mountAbortTarget, operationsSummary, scopedDeviceErrors, scopedRunningOperations } from './statusbar/selectors'

// Compact bar at the bottom of the window with the real state of the selected connection, of the main
// equipment roles, and of the device operations running on the active profile's server connection, visible
// from every workspace. While the mount of the profile moves, it offers an Abort of that mount alone, through
// the same stop command as the Equipment Control page; nothing here stops any other device.

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
			<OperationsItem />
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

// Running operations of the active server connection, the device failures of that connection, and the Abort of
// the profile's mount while it moves. With the event socket closed the operations are the last ones known, shown
// dimmed, and no Abort is offered.
function OperationsItem() {
	const serverId = useActiveServerId()
	const { server: link } = useSnapshot(notificationsState)
	const { operations } = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const devices = useWatchedDevices()
	const mount = useRoleDevice('MOUNT').device
	const running = scopedRunningOperations(operations, serverId)
	const errors = scopedDeviceErrors({ serverId, devices, control })
	const abort = mountAbortTarget({ link, serverId, watched: control.watched, mount, state: watchedDeviceState(control, 'mount', mount), operations: running })
	const online = link === 'online'

	if (running.length === 0 && errors.length === 0) return null

	return (
		<span className="ml-auto flex min-w-0 items-center gap-3 border-l border-line-100 pl-4">
			{running.length > 0 && (
				<span title={online ? undefined : 'Server offline: last known operations'} className={cn('truncate', online ? 'text-accent' : 'text-ink-300')}>
					{operationsSummary(running)}
				</span>
			)}
			{errors.length > 0 && (
				<span title={errors.map((error) => `${error.name}: ${error.message}`).join('\n')} className="flex-none text-danger">
					{errors.length === 1 ? `${errors[0].name} error` : `${errors.length} equipment errors`}
				</span>
			)}
			{abort && (
				<button
					type="button"
					title={`Abort the motion of ${abort.name}`}
					onClick={() => void abortProfileMount({ connections: connectionState, profiles: profileState, devices: deviceState, control: controlRuntime, operations: operationsState, notifications: notificationsState })}
					className="flex-none cursor-pointer rounded-sm border border-danger bg-transparent px-1.5 py-0 font-mono text-[11px] leading-4 text-danger transition-colors duration-150 hover:bg-danger hover:text-base-000 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
				>
					Abort {abort.name}
				</button>
			)}
		</span>
	)
}
