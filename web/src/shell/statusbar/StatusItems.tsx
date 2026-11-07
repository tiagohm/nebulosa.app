import type { MeridianFlipMonitor, OperationRecord } from 'api'
import { cn } from 'cn'
import type { Ref } from 'react'
import { useSnapshot } from 'valtio'
import { autoFocusRuntime } from '../../camera/autofocus'
import { captureRuntime } from '../../camera/capture'
import { darkLibraryWizardRuntime } from '../../camera/darklibrarywizard'
import { darvRuntime } from '../../camera/darv'
import { flatWizardRuntime } from '../../camera/flatwizard'
import { guidingRuntime } from '../../camera/guiding'
import { targetCenteringRuntime } from '../../camera/targetcentering'
import { tppaRuntime } from '../../camera/tppa'
import { connectionState } from '../../connection/connection'
import { controlRuntime } from '../../equipment-control/control'
import { deviceState } from '../../equipment/equipment'
import { mountPointingRuntime } from '../../mountpointing/mountpointing'
import { notificationsState } from '../../notifications/notifications'
import { operationsState } from '../../operations'
import { profileState } from '../../profile/profile'
import { meridianFlipHeadline, meridianFlipStatusText } from '../../tools/meridianflip/meridianflip'
import { Icon, type IconName } from '../../ui/Icon'
import { TONE_TEXT } from '../../ui/StatusBadge'
import { useNow } from '../../useNow'
import { navigate, routeState } from '../route'
import { abortOperation, type OperationAbortStores } from './abort'
import { type BarOperation, type ChipValue, operationInterruption, type ScopedDevice, serverLinkLabel, type StatusTone } from './selectors'

// Items of the status bar, as small as they can be: the server link is an icon alone, each chip an icon and a short
// reading, its name and full reading in its title, each running operation its icon, name, and progress, followed by
// its Abort, and the enabled Meridian Flip Monitor of the profile's mount its icon and status. A chip with a device
// opens that exact device in Equipment Control.

// Text color of each status tone.
export const TONE_CLASSES: Readonly<Record<StatusTone, string>> = {
	muted: 'text-ink-300',
	idle: 'text-ink-200',
	active: 'text-accent',
	ok: 'text-success',
	error: 'text-danger',
}

// Classes shared by the chips: the separator and the spacing.
const CHIP_CLASS = 'flex flex-none items-center gap-1 border-l border-line-100 pl-3'

// Classes added to a chip that is a button.
const BUTTON_CLASS = 'cursor-pointer hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent'

// Live stores every Abort of the bar and of the details panel decides from.
const ABORT_STORES: OperationAbortStores = {
	connections: connectionState,
	profiles: profileState,
	devices: deviceState,
	control: controlRuntime,
	operations: operationsState,
	notifications: notificationsState,
	captures: captureRuntime,
	guiding: guidingRuntime,
	autoFocus: autoFocusRuntime,
	tppa: tppaRuntime,
	darv: darvRuntime,
	flatWizard: flatWizardRuntime,
	darkLibraryWizard: darkLibraryWizardRuntime,
	targetCentering: targetCenteringRuntime,
	mountPointing: mountPointingRuntime,
}

// Returns whether a running operation can be interrupted right now, from snapshots of what decides it.
export function useOperationAbortable() {
	const { server: link } = useSnapshot(notificationsState)
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const autoFocus = useSnapshot(autoFocusRuntime)
	const tppa = useSnapshot(tppaRuntime)
	const darv = useSnapshot(darvRuntime)
	const flatWizard = useSnapshot(flatWizardRuntime)
	const darkLibraryWizard = useSnapshot(darkLibraryWizardRuntime)
	const targetCentering = useSnapshot(targetCenteringRuntime)
	const mountPointing = useSnapshot(mountPointingRuntime)

	return (operation: OperationRecord) => operationInterruption(operation, { link, control, captures, guiding, autoFocus, tppa, darv, flatWizard, darkLibraryWizard, targetCentering, mountPointing }) !== undefined
}

interface ServerLinkItemProps {
	// Element of the item, measured by the bar.
	readonly ref?: Ref<HTMLSpanElement>
}

// Link of the tab to the application server: a server icon, green while the event socket is open and red otherwise,
// with the link and the active profile's connection in its title. The connection itself is managed by the top bar.
export function ServerLinkItem({ ref }: ServerLinkItemProps) {
	const { server } = useSnapshot(notificationsState)
	const text = serverLinkLabel(server)

	return (
		<span ref={ref} title={text} className="flex flex-none items-center">
			<Icon name="server" className={cn('size-3.5', server === 'online' ? 'text-success' : 'text-danger')} />
			<span className="sr-only">{text}</span>
		</span>
	)
}

interface StatusChipProps {
	// Icon of the chip.
	readonly icon: IconName
	// Name of the chip, such as "Mount", read through its title.
	readonly label: string
	// Reading of the chip.
	readonly value: ChipValue
	// Exact device the chip opens in Equipment Control; absent for the hidden copy the bar measures.
	readonly device?: ScopedDevice
}

// Icon and short reading of a device, a button opening it when it has one.
export function StatusChip({ icon, label, value, device }: StatusChipProps) {
	const title = `${label}${device ? ` ${device.name}` : ''}: ${value.title}`
	const content = (
		<>
			<Icon name={icon} className="size-3.5 text-ink-300" />
			<span className="sr-only">{title}</span>
			{value.text && <span className={cn('max-w-44 truncate', TONE_CLASSES[value.tone])}>{value.text}</span>}
		</>
	)

	if (!device) {
		return (
			<span title={title} className={CHIP_CLASS}>
				{content}
			</span>
		)
	}

	return (
		<button type="button" title={`${title} · Open in Equipment Control`} onClick={() => navigate(routeState, { workspace: 'equipment', device: device.id })} className={cn(CHIP_CLASS, BUTTON_CLASS)}>
			{content}
		</button>
	)
}

interface MeridianFlipItemProps {
	// Enabled monitor of the profile's mount.
	readonly monitor: MeridianFlipMonitor
	// Name of the mount, read through the title.
	readonly name?: string
	// Executor of the mount: the step of its running flip, or whether a flip is armed or scheduled.
	readonly executor?: { readonly step?: string; readonly armed: boolean }
}

// Meridian Flip Monitor of the profile's mount while it is enabled: its icon and short status in the tone of its headline
// (the step of a running flip of the Executor instead, and whether a flip is armed),
// with the time to or since the transit while it monitors, opening the tool. The countdown is only interpolated from the
// server's sample.
export function MeridianFlipItem({ monitor, name, executor }: MeridianFlipItemProps) {
	const now = useNow(monitor.availability === 'monitoring')
	const [, headline] = meridianFlipHeadline(monitor)
	// A running flip shows its step; an armed one is said after the monitor status.
	const text = executor?.step ?? `${meridianFlipStatusText(monitor, now)}${executor?.armed ? ' · Armed' : ''}`
	const tone = executor?.step ? 'active' : headline
	const title = `Meridian Flip Monitor${name ? ` of ${name}` : ''}: ${text}`

	return (
		<button type="button" data-fixed title={`${title} · Open the tool`} onClick={() => navigate(routeState, { workspace: 'tools', tool: 'meridian-flip-monitor' })} className={cn('flex flex-none items-center gap-1', BUTTON_CLASS)}>
			<Icon name="meridian" className="size-3.5 text-ink-300" />
			<span className="sr-only">{title}</span>
			<span className={cn('tabular-nums', TONE_TEXT[tone])}>{text}</span>
		</button>
	)
}

interface AbortButtonProps {
	// Id of the operation.
	readonly id: string
	// Name of the operation.
	readonly label: string
}

// Abort of one operation; what it sends is decided again from the live stores when pressed.
export function AbortButton({ id, label }: AbortButtonProps) {
	return (
		<button
			type="button"
			title={`Abort ${label}`}
			onClick={() => void abortOperation(id, ABORT_STORES)}
			className="flex-none cursor-pointer rounded-sm border border-danger bg-transparent px-1.5 py-0 font-mono text-xs leading-4 text-danger transition-colors duration-150 hover:bg-danger hover:text-base-000 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
		>
			Abort
		</button>
	)
}

interface OperationItemProps {
	// Running operation.
	readonly operation: BarOperation
	// Whether the event socket is open; otherwise the operation is only the last one known.
	readonly online: boolean
}

// Icon, name, and progress of a running operation, followed by its Abort when it can be interrupted.
export function OperationItem({ operation: { id, icon, label, detail, title, abortable }, online }: OperationItemProps) {
	return (
		<span title={online ? title : `Server offline: last known operation · ${title}`} className={cn('flex flex-none items-center gap-2', online ? 'text-accent' : 'text-ink-300')}>
			<Icon name={icon} className="size-3.5 text-ink-300" />
			{label}
			{detail && <span className="tabular-nums">{detail}</span>}
			{abortable && <AbortButton id={id} label={label} />}
		</span>
	)
}
