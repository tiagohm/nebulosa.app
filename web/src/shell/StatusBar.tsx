import type { OperationKind, OperationRecord } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { useSelectedConnection } from '../connection/useSelectedConnection'
import { controlRuntime, deviceStateOf, stopCommand } from '../equipment-control/control'
import { deviceState } from '../equipment/equipment'
import { type EquipmentRole, roleDefinition } from '../equipment/roles'
import { RoleStatusText } from '../equipment/RoleStatusText'
import { useRoleDevice } from '../equipment/useEquipment'
import { OPERATION_LABELS, operationsState } from '../operations'

// Compact bar at the bottom of the window with the real state of the selected connection, of the main
// equipment roles, and of the device operations running on the server, visible from every workspace.
// While the mount of the profile moves, it offers an Abort of that mount alone, through the same stop
// command as the Equipment Control page; nothing here stops any other device.

// Roles summarized in the status bar, in display order.
const STATUS_ROLES: readonly EquipmentRole[] = ['MAIN_CAMERA', 'MOUNT']

// Mount operations the status bar can abort: those that move the mount.
const MOUNT_MOTIONS: ReadonlySet<OperationKind> = new Set(['mount.slew', 'mount.goto', 'mount.flip', 'mount.park', 'mount.unpark', 'mount.home', 'mount.findHome', 'mount.nudge'])

// Most running operations named one by one; more are summarized by count.
const MAX_NAMED_OPERATIONS = 2

// Returns the running operations as one short line, such as "Mount slew · Camera capture".
export function operationsSummary(running: readonly Pick<OperationRecord, 'kind'>[]) {
	const named = running.slice(0, MAX_NAMED_OPERATIONS).map((operation) => OPERATION_LABELS[operation.kind])
	const more = running.length - named.length
	return more > 0 ? `${named.join(' · ')} · +${more}` : named.join(' · ')
}

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

// Running operations of the server, a device error of the connection, and the Abort of the profile's
// mount while one of its motions runs.
function OperationsItem() {
	const operations = useSnapshot(operationsState)
	const devices = useSnapshot(deviceState)
	const control = useSnapshot(controlRuntime)
	const mount = useRoleDevice('MOUNT')
	const running = Object.values(operations.operations).filter((operation) => operation.state === 'running')
	const mountDevice = mount.device
	const mountState = mountDevice && deviceStateOf(control.states, 'mount', mountDevice.id)
	const mountMoving = mountDevice !== undefined && running.some((operation) => MOUNT_MOTIONS.has(operation.kind) && operation.devices.some((device) => device.connectionId === mountDevice.connectionId && device.deviceId === mountDevice.id))
	const error = Object.keys(devices.errors).length > 0

	if (running.length === 0 && !error) return null

	return (
		<span className="ml-auto flex min-w-0 items-center gap-3 border-l border-line-100 pl-4">
			{running.length > 0 && <span className="truncate text-accent">{operationsSummary(running)}</span>}
			{error && <span className="flex-none text-danger">Equipment error</span>}
			{mountMoving && mountState?.canAbort && (
				<button
					type="button"
					title={`Abort the motion of ${mountDevice.name}`}
					onClick={() => void stopCommand(controlRuntime, { type: 'mount', deviceId: mountDevice.id, action: 'stop' })}
					className="flex-none cursor-pointer rounded-sm border border-danger bg-transparent px-1.5 py-0 font-mono text-[11px] leading-4 text-danger transition-colors duration-150 hover:bg-danger hover:text-base-000 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
				>
					Abort {mountDevice.name}
				</button>
			)}
		</span>
	)
}
