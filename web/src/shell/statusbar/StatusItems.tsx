import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../../camera/capture'
import { guidingRuntime } from '../../camera/guiding'
import { useSelectedConnection } from '../../connection/useSelectedConnection'
import { controlRuntime, watchedDeviceState } from '../../equipment-control/control'
import { roleDefinition } from '../../equipment/roles'
import { useRoleDevice } from '../../equipment/useEquipment'
import { notificationsState } from '../../notifications/notifications'
import { navigate, routeState } from '../route'
import { activeCapture, activeGuiding, cameraValue, captureValue, connectionLabel, guidingValue, mountValue, roleValue, type ScopedDevice, serverLinkLabel, type StatusTone, type StatusValue } from './selectors'

// Items of the status bar: the event socket link and the chips of the active profile's main camera, mount, guide
// camera, and running capture. Each chip reads only the device assigned to its role on the active connection, and
// one with a device opens that exact device in Equipment Control; an unassigned role shows no chip.

// Text color of each status tone.
export const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
	muted: 'text-ink-300',
	idle: 'text-ink-200',
	active: 'text-accent',
	ok: 'text-success',
	error: 'text-danger',
}

// Classes shared by the items after the first one: the separator and the spacing.
const ITEM_CLASS = 'flex flex-none items-center gap-1.5 border-l border-line-100 pl-4'

// Classes added to an item that is a button.
const BUTTON_CLASS = 'cursor-pointer hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

// Link of the tab to the application server, with the active profile's connection in its title. The connection
// itself is shown and managed by the top bar.
export function ServerLinkItem() {
	const { server: link } = useSnapshot(notificationsState)
	const { connection, status } = useSelectedConnection()
	const text = serverLinkLabel(link)

	return (
		<span title={`${text} · ${connectionLabel(connection?.name, status)}`} className="flex min-w-0 flex-none items-center gap-1.5">
			<span className={cn('size-1.5 flex-none rounded-full', link === 'online' ? 'bg-success' : link === 'offline' ? 'bg-danger' : 'bg-accent')} />
			<span className={link === 'offline' ? 'text-danger' : undefined}>{text}</span>
		</span>
	)
}

interface StatusChipProps {
	// Short name of the item, such as "Mount".
	readonly label: string
	// Value of the item.
	readonly value: StatusValue
	// Full description of the item, shown as its title.
	readonly title: string
	// Exact device the item opens in Equipment Control; absent for an item that opens nothing.
	readonly device?: ScopedDevice
	// Extra classes, such as a breakpoint visibility.
	readonly className?: string
}

// Labeled value of the status bar, a button opening its device when it has one.
export function StatusChip({ label, value, title, device, className }: StatusChipProps) {
	const content = (
		<>
			<span className="text-ink-300">{label}</span>
			<span className={TONE_CLASSES[value.tone]}>{value.text}</span>
		</>
	)

	if (!device) {
		return (
			<span title={title} className={cn(ITEM_CLASS, className)}>
				{content}
			</span>
		)
	}

	return (
		<button type="button" title={`${title} · Open ${device.name} in Equipment Control`} onClick={() => navigate(routeState, { workspace: 'equipment', device: device.id })} className={cn(ITEM_CLASS, BUTTON_CLASS, className)}>
			{content}
		</button>
	)
}

interface ItemProps {
	// Extra classes, such as a breakpoint visibility.
	readonly className?: string
}

// Main camera of the profile and its sensor temperature; nothing while the role is not assigned.
export function CameraItem({ className }: ItemProps) {
	const { device, status } = useRoleDevice('MAIN_CAMERA')
	const control = useSnapshot(controlRuntime)
	if (status === 'notSelected') return null

	const value = cameraValue(status, watchedDeviceState(control, 'camera', device))
	return <StatusChip label="Camera" value={value} title={`${roleDefinition('MAIN_CAMERA').label}${device ? ` ${device.name}` : ''}: ${value.text}`} device={device} className={className} />
}

// Mount of the profile and its motion state; nothing while the role is not assigned.
export function MountItem({ className }: ItemProps) {
	const { device, status } = useRoleDevice('MOUNT')
	const control = useSnapshot(controlRuntime)
	if (status === 'notSelected') return null

	const value = mountValue(status, watchedDeviceState(control, 'mount', device))
	return <StatusChip label="Mount" value={value} title={`${roleDefinition('MOUNT').label}${device ? ` ${device.name}` : ''}: ${value.text}`} device={device} className={className} />
}

// Guide camera of the profile and its running guiding session; nothing unless the role's device is present.
export function GuidingItem({ className }: ItemProps) {
	const { device, status } = useRoleDevice('GUIDE_CAMERA')
	const { sessions } = useSnapshot(guidingRuntime)
	if (!device) return null

	const session = activeGuiding(sessions, device)
	const value = session ? guidingValue(session) : roleValue(status)
	return <StatusChip label="Guide" value={value} title={`${roleDefinition('GUIDE_CAMERA').label} ${device.name}: ${session ? value.text : `${value.text}, not guiding`}`} device={device} className={className} />
}

// Running capture of the profile's main camera: its frame count, or "Stopping"; nothing without one.
export function CaptureItem({ className }: ItemProps) {
	const { device } = useRoleDevice('MAIN_CAMERA')
	const { sessions } = useSnapshot(captureRuntime)
	const session = activeCapture(sessions, device)
	if (!session) return null

	const value = captureValue(session)
	return <StatusChip label="Capture" value={value} title={`Capture of ${session.cameraName}: ${session.count === undefined ? `${session.captured} frames (loop)` : `${session.captured} of ${session.count} frames`}${session.stopping ? ', stopping' : ''}`} className={className} />
}
