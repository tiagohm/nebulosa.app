import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../../camera/capture'
import { guidingRuntime } from '../../camera/guiding'
import { useSelectedConnection } from '../../connection/useSelectedConnection'
import { controlRuntime, watchedDeviceState } from '../../equipment-control/control'
import { roleDefinition } from '../../equipment/roles'
import { useRoleDevice } from '../../equipment/useEquipment'
import { notificationsState } from '../../notifications/notifications'
import { Icon, type IconName } from '../../ui/Icon'
import { navigate, routeState } from '../route'
import { activeCapture, activeGuiding, cameraValue, captureValue, connectionLabel, guidingValue, mountValue, roleValue, type ScopedDevice, serverLinkLabel, type StatusTone, type StatusValue } from './selectors'

// Items of the status bar: the event socket link and the chips of the active profile's main camera, mount, guide
// camera, and running capture. Each chip is an icon and a value, its name in its title; it reads only the device
// assigned to its role on the active connection, and one with a device opens that exact device in Equipment
// Control. An unassigned role shows no chip.

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

// Classes of the icon of an item, sized to the 11 px text of the bar.
const ICON_CLASS = 'size-3.5 text-ink-300'

// Link of the tab to the application server, with the active profile's connection in its title. The connection
// itself is shown and managed by the top bar.
export function ServerLinkItem() {
	const { server: link } = useSnapshot(notificationsState)
	const { connection, status } = useSelectedConnection()

	return (
		<span title={`${serverLinkLabel(link)} · ${connectionLabel(connection?.name, status)}`} className="flex min-w-0 flex-none items-center gap-1.5">
			<Icon name="server" className={cn('size-3.5', link === 'online' ? 'text-success' : link === 'offline' ? 'text-danger' : 'text-accent')} />
			<span className={link === 'offline' ? 'text-danger' : undefined}>{link === 'online' ? 'Online' : serverLinkLabel(link)}</span>
		</span>
	)
}

interface StatusChipProps {
	// Icon of the item.
	readonly icon: IconName
	// Name of the item, such as "Mount", read through its title.
	readonly label: string
	// Value of the item.
	readonly value: StatusValue
	// Full description of the item, shown as its title.
	readonly title: string
	// Exact device the item opens in Equipment Control; absent for an item that opens nothing.
	readonly device?: ScopedDevice
}

// Icon and value of the status bar, a button opening its device when it has one.
export function StatusChip({ icon, label, value, title, device }: StatusChipProps) {
	const content = (
		<>
			<Icon name={icon} className={ICON_CLASS} />
			<span className="sr-only">{label}</span>
			<span className={TONE_CLASSES[value.tone]}>{value.text}</span>
		</>
	)

	if (!device) {
		return (
			<span title={title} className={ITEM_CLASS}>
				{content}
			</span>
		)
	}

	return (
		<button type="button" title={`${title} · Open ${device.name} in Equipment Control`} onClick={() => navigate(routeState, { workspace: 'equipment', device: device.id })} className={cn(ITEM_CLASS, BUTTON_CLASS)}>
			{content}
		</button>
	)
}

// Main camera of the profile and its sensor temperature; nothing while the role is not assigned.
export function CameraItem() {
	const { device, status } = useRoleDevice('MAIN_CAMERA')
	const control = useSnapshot(controlRuntime)
	if (status === 'notSelected') return null

	const label = roleDefinition('MAIN_CAMERA').label
	const value = cameraValue(status, watchedDeviceState(control, 'camera', device))
	return <StatusChip icon="camera" label={label} value={value} title={`${label}${device ? ` ${device.name}` : ''}: ${value.text}`} device={device} />
}

// Mount of the profile and its motion state; nothing while the role is not assigned.
export function MountItem() {
	const { device, status } = useRoleDevice('MOUNT')
	const control = useSnapshot(controlRuntime)
	if (status === 'notSelected') return null

	const label = roleDefinition('MOUNT').label
	const value = mountValue(status, watchedDeviceState(control, 'mount', device))
	return <StatusChip icon="mount" label={label} value={value} title={`${label}${device ? ` ${device.name}` : ''}: ${value.text}`} device={device} />
}

// Guide camera of the profile and its running guiding session; nothing unless the role's device is present.
export function GuidingItem() {
	const { device, status } = useRoleDevice('GUIDE_CAMERA')
	const { sessions } = useSnapshot(guidingRuntime)
	if (!device) return null

	const label = roleDefinition('GUIDE_CAMERA').label
	const session = activeGuiding(sessions, device)
	const value = session ? guidingValue(session) : roleValue(status)
	return <StatusChip icon="reticle" label={label} value={value} title={`${label} ${device.name}: ${session ? value.text : `${value.text}, not guiding`}`} device={device} />
}

// Running capture of the profile's main camera: its frame count, or "Stopping"; nothing without one.
export function CaptureItem() {
	const { device } = useRoleDevice('MAIN_CAMERA')
	const { sessions } = useSnapshot(captureRuntime)
	const session = activeCapture(sessions, device)
	if (!session) return null

	const value = captureValue(session)
	return <StatusChip icon="frame" label="Capture" value={value} title={`Capture of ${session.cameraName}: ${session.count === undefined ? `${session.captured} frames (loop)` : `${session.captured} of ${session.count} frames`}${session.stopping ? ', stopping' : ''}`} />
}
