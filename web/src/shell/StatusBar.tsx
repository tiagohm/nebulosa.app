import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../camera/capture'
import { guidingRuntime } from '../camera/guiding'
import { connectionState } from '../connection/connection'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { deviceState } from '../equipment/equipment'
import { useActiveServerId, useRoleDevice, useWatchedDevices } from '../equipment/useEquipment'
import { notificationsState } from '../notifications/notifications'
import { operationsState } from '../operations'
import { profileState } from '../profile/profile'
import { abortProfileMount } from './statusbar/abort'
import { activeCapture, activeGuiding, mountAbortTarget, operationsSummary, otherOperations, scopedDeviceErrors, scopedRunningOperations, sessionOperationIds } from './statusbar/selectors'
import { CameraItem, CaptureItem, GuidingItem, MountItem, ServerLinkItem } from './statusbar/StatusItems'

// Compact bar at the bottom of the window, visible from every workspace: the tab's link to the application server,
// the active profile's main camera, mount, guide camera, and running capture, the other device operations running
// on the profile's server connection, and the failures of its devices. While the mount of the profile moves, it
// offers an Abort of that mount alone, through the same stop command as the Equipment Control page; nothing here
// stops any other device.

// Status bar of the application.
export function StatusBar() {
	return (
		<footer className="flex h-7 flex-none items-center gap-4 overflow-hidden border-t border-line-100 bg-base-000 px-4 text-[11px] leading-4 whitespace-nowrap text-ink-200">
			<ServerLinkItem />
			<CameraItem className="max-sm:hidden" />
			<MountItem className="max-sm:hidden" />
			<GuidingItem className="max-lg:hidden" />
			<CaptureItem className="max-sm:hidden" />
			<OperationsItem />
		</footer>
	)
}

// Running operations of the active server connection not shown by a session chip, the device failures of that
// connection, and the Abort of the profile's mount while it moves. With the event socket closed the operations are
// the last ones known, shown dimmed, and no Abort is offered.
function OperationsItem() {
	const serverId = useActiveServerId()
	const { server: link } = useSnapshot(notificationsState)
	const { operations } = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const devices = useWatchedDevices()
	const mount = useRoleDevice('MOUNT').device
	const mainCamera = useRoleDevice('MAIN_CAMERA').device
	const guideCamera = useRoleDevice('GUIDE_CAMERA').device
	const running = scopedRunningOperations(operations, serverId)
	const others = otherOperations(running, sessionOperationIds(activeCapture(captures.sessions, mainCamera), activeGuiding(guiding.sessions, guideCamera)))
	const errors = scopedDeviceErrors({ serverId, devices, control })
	const abort = mountAbortTarget({ link, serverId, watched: control.watched, mount, state: watchedDeviceState(control, 'mount', mount), operations: running })
	const online = link === 'online'

	if (others.length === 0 && errors.length === 0 && !abort) return null

	return (
		<span className="ml-auto flex min-w-0 items-center gap-3 border-l border-line-100 pl-4">
			{others.length > 0 && (
				<span title={online ? undefined : 'Server offline: last known operations'} className={cn('truncate', online ? 'text-accent' : 'text-ink-300')}>
					{operationsSummary(others)}
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
