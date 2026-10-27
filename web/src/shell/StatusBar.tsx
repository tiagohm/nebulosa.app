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
import { activeCapture, activeGuiding, compactItems, mountAbortTarget, mountMoving, operationsSummary, otherOperations, scopedDeviceErrors, scopedRunningOperations, sessionOperationIds, type StatusTier } from './statusbar/selectors'
import { StatusDetails } from './statusbar/StatusDetailsPanel'
import { CameraItem, CaptureItem, GuidingItem, MountItem, ServerLinkItem } from './statusbar/StatusItems'
import { useMediaQuery, WIDE_SCREEN } from './useMediaQuery'

// Compact bar at the bottom of the window, visible from every workspace: the tab's link to the application server,
// the active profile's main camera, mount, guide camera, and running capture, the other device operations running
// on the profile's server connection, its device failures, and the details button that lists all of it. A narrower
// bar shows fewer chips, by priority, and counts the others on the details button; the server link, the failures,
// and the Abort are never left out. While the mount of the profile moves, the bar offers an Abort of that mount
// alone, through the same stop command as the Equipment Control page; nothing here stops any other device.

// Media query of Tailwind's sm breakpoint (40rem), from which the bar is medium.
const MEDIUM_SCREEN = '(min-width: 40rem)'

// Status bar of the application.
export function StatusBar() {
	const wide = useMediaQuery(WIDE_SCREEN)
	const medium = useMediaQuery(MEDIUM_SCREEN)
	const tier: StatusTier = wide ? 'wide' : medium ? 'medium' : 'narrow'
	const serverId = useActiveServerId()
	const { server: link } = useSnapshot(notificationsState)
	const { operations } = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const devices = useWatchedDevices()
	const mount = useRoleDevice('MOUNT')
	const mainCamera = useRoleDevice('MAIN_CAMERA')
	const guideCamera = useRoleDevice('GUIDE_CAMERA').device
	const running = scopedRunningOperations(operations, serverId)
	const mountState = watchedDeviceState(control, 'mount', mount.device)
	const capture = activeCapture(captures.sessions, mainCamera.device)
	const session = activeGuiding(guiding.sessions, guideCamera)
	const others = otherOperations(running, sessionOperationIds(capture, session))
	const errors = scopedDeviceErrors({ serverId, devices, control })
	const abort = mountAbortTarget({ link, serverId, watched: control.watched, mount: mount.device, state: mountState, operations: running })
	const moving = !!mount.device && mountMoving(mountState, running, mount.device)
	const { visible, hidden } = compactItems({ camera: mainCamera.status !== 'notSelected', mount: mount.status !== 'notSelected', mountMoving: moving, guiding: !!guideCamera, guidingActive: !!session, capture: !!capture, otherOperations: others.length }, tier)
	const online = link === 'online'

	return (
		<footer className="flex h-7 flex-none items-center gap-4 overflow-hidden border-t border-line-100 bg-base-000 px-4 text-[11px] leading-4 whitespace-nowrap text-ink-200">
			<ServerLinkItem />
			{visible.has('camera') && <CameraItem />}
			{visible.has('mount') && <MountItem />}
			{visible.has('guiding') && <GuidingItem />}
			{visible.has('capture') && <CaptureItem />}
			<span className="ml-auto flex min-w-0 items-center gap-3 border-l border-line-100 pl-4">
				{tier === 'wide' && others.length > 0 && (
					<span title={online ? undefined : 'Server offline: last known operations'} className={cn('min-w-0 truncate', online ? 'text-accent' : 'text-ink-300')}>
						{operationsSummary(others)}
					</span>
				)}
				{errors.length > 0 && (
					<span title={errors.map((error) => `${error.name}: ${error.message}`).join('\n')} className="min-w-0 truncate text-danger">
						{errors.length === 1 && tier === 'wide' ? `${errors[0].name} error` : `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`}
					</span>
				)}
				<StatusDetails hidden={hidden} />
				{abort && (
					<button
						type="button"
						title={`Abort the motion of ${abort.name}`}
						onClick={() => void abortProfileMount({ connections: connectionState, profiles: profileState, devices: deviceState, control: controlRuntime, operations: operationsState, notifications: notificationsState })}
						className="max-w-48 flex-none cursor-pointer truncate rounded-sm border border-danger bg-transparent px-1.5 py-0 font-mono text-[11px] leading-4 text-danger transition-colors duration-150 hover:bg-danger hover:text-base-000 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
					>
						{tier === 'narrow' ? 'Abort' : `Abort ${abort.name}`}
					</button>
				)}
			</span>
		</footer>
	)
}
