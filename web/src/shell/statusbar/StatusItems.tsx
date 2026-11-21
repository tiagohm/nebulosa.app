import type { MeridianFlipMonitor, MountRemoteServer, OperationRecord } from 'api'
import { cn } from 'cn'
import { type Ref, useState } from 'react'
import { useSnapshot } from 'valtio'
import { autoFocusRuntime } from '../../camera/autofocus'
import { captureRuntime } from '../../camera/capture'
import { darkLibraryWizardRuntime } from '../../camera/darklibrarywizard'
import { darvRuntime } from '../../camera/darv'
import { flatWizardRuntime } from '../../camera/flatwizard'
import { guidingRuntime } from '../../camera/guiding'
import { ipolarRuntime } from '../../camera/ipolar'
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
import { connectEndpoints, listenersStatusText, MOUNT_REMOTE_PROTOCOL_LABELS } from '../../tools/mountremotecontrol/listeners'
import { Icon, type IconName } from '../../ui/Icon'
import { TONE_TEXT } from '../../ui/StatusBadge'
import { useNow } from '../../useNow'
import { navigate, routeState } from '../route'
import { abortOperation, type OperationAbortStores } from './abort'
import { type BarOperation, type ChipValue, operationInterruption, type ScopedDevice, serverLinkLabel, type StatusTone } from './selectors'

// Items of the status bar, as small as they can be: the server link is an icon alone while it is online and says its
// state otherwise, each chip an icon and a short reading, its name and full reading in its title, each running
// operation its icon, name, and progress, followed by its Abort, the enabled Meridian Flip Monitor of the profile's mount
// its icon and status, and the running Mount Remote Control listeners of that mount their protocols and clients. A chip
// opens its exact device in Equipment Control, or the page itself for a device missing from the connection. Every
// control of the bar is pressed anywhere across the height of the bar, not only on the text it shows.

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

// Classes that extend the area a control of the bar is pressed in across the whole height of the bar, at any of its
// heights, without changing how it looks; the bar clips what goes past its edges.
export const HIT_CLASS = "relative before:absolute before:inset-x-0 before:-inset-y-3 before:content-['']"

// Classes added to a chip that is a button.
const BUTTON_CLASS = cn('cursor-pointer hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent', HIT_CLASS)

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
	ipolar: ipolarRuntime,
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
	const ipolar = useSnapshot(ipolarRuntime)
	const darv = useSnapshot(darvRuntime)
	const flatWizard = useSnapshot(flatWizardRuntime)
	const darkLibraryWizard = useSnapshot(darkLibraryWizardRuntime)
	const targetCentering = useSnapshot(targetCenteringRuntime)
	const mountPointing = useSnapshot(mountPointingRuntime)

	return (operation: OperationRecord) => operationInterruption(operation, { link, control, captures, guiding, autoFocus, tppa, ipolar, darv, flatWizard, darkLibraryWizard, targetCentering, mountPointing }) !== undefined
}

interface ServerLinkItemProps {
	// Element of the item, measured by the bar.
	readonly ref?: Ref<HTMLSpanElement>
}

// Link of the tab to the application server: a green server icon while the event socket is open, and otherwise a red
// one followed by the state in words, since everything else the bar shows is then only the last state known. The
// connection itself is managed by the top bar.
export function ServerLinkItem({ ref }: ServerLinkItemProps) {
	const { server } = useSnapshot(notificationsState)
	const text = serverLinkLabel(server)
	const online = server === 'online'

	return (
		<span ref={ref} title={online ? text : `${text}: the bar shows the last state known`} className={cn('flex flex-none items-center gap-1', online ? 'text-success' : 'text-danger')}>
			<Icon name="server" className="size-3.5" />
			{!online && <span>{text}</span>}
		</span>
	)
}

interface StatusChipProps {
	// Icon of the chip.
	readonly icon: IconName
	// Name of the chip, such as "Mount", read through its title.
	readonly label: string
	// Name of the device of the Equipment Setup, read through its title.
	readonly name?: string
	// Reading of the chip.
	readonly value: ChipValue
	// Exact device the chip opens in Equipment Control; absent for a device missing from the connection, which opens the
	// page itself.
	readonly device?: ScopedDevice
	// Whether this is the hidden copy the bar measures, which is not a button.
	readonly measure?: boolean
}

// Icon and short reading of a device, a button opening it in Equipment Control.
export function StatusChip({ icon, label, name, value, device, measure }: StatusChipProps) {
	const title = `${label}${name ? ` ${name}` : ''}: ${value.title}`
	const content = (
		<>
			<Icon name={icon} className="size-3.5 text-ink-300" />
			{value.text && <span className={cn('max-w-44 truncate', TONE_CLASSES[value.tone])}>{value.text}</span>}
		</>
	)

	if (measure) {
		return (
			<span title={title} className={CHIP_CLASS}>
				{content}
			</span>
		)
	}

	return (
		<button type="button" title={`${title} · Open in Equipment Control`} onClick={() => navigate(routeState, device ? { workspace: 'equipment', device: device.id } : { workspace: 'equipment' })} className={cn(CHIP_CLASS, BUTTON_CLASS)}>
			{content}
		</button>
	)
}

interface MeridianFlipItemProps {
	// Enabled monitor of the profile's mount.
	readonly monitor: MeridianFlipMonitor
	// Name of the mount, read through the title.
	readonly name?: string
	// Executor of the mount: the step of its running flip, whether a flip is armed or scheduled, and whether its latest flip
	// left the capture paused for the operator.
	readonly executor?: { readonly step?: string; readonly armed: boolean; readonly paused: boolean }
}

// Meridian Flip Monitor of the profile's mount while it is enabled: its icon and short status in the tone of its headline
// (the step of a running flip of the Executor instead, and whether a flip is armed or left the capture paused, the
// latter in the warning tone), with the time to or since the transit while it monitors, opening the tool. The countdown
// is only interpolated from the server's sample.
export function MeridianFlipItem({ monitor, name, executor }: MeridianFlipItemProps) {
	const now = useNow(monitor.availability === 'monitoring')
	const [, headline] = meridianFlipHeadline(monitor, now)
	// A running flip shows its step; an armed one and a capture left paused are said after the monitor status.
	const text = executor?.step ?? `${meridianFlipStatusText(monitor, now)}${executor?.armed ? ' · Armed' : ''}${executor?.paused ? ' · Capture paused' : ''}`
	const tone = executor?.step ? 'active' : executor?.paused && headline !== 'danger' ? 'warning' : headline
	const title = `Meridian Flip Monitor${name ? ` of ${name}` : ''}: ${text}`

	return (
		<button type="button" data-fixed title={`${title} · Open the tool`} onClick={() => navigate(routeState, { workspace: 'tools', tool: 'meridian-flip' })} className={cn('flex flex-none items-center gap-1', BUTTON_CLASS)}>
			<Icon name="meridian" className="size-3.5 text-ink-300" />
			<span className={cn('tabular-nums', TONE_TEXT[tone])}>{text}</span>
		</button>
	)
}

// The offline switch of the ephemeris sources while it is on, since it changes what every position, plan, and lookup
// of the server can answer: its icon and "Ephemeris offline", opening its section of the Settings page.
export function EphemerisOfflineItem() {
	const title = 'Ephemeris sources offline: nothing asks JPL, and only what was already read is answered'

	return (
		<button type="button" data-fixed title={`${title} · Open the setting`} onClick={() => navigate(routeState, { workspace: 'settings', section: 'ephemeris-sources' })} className={cn('flex flex-none items-center gap-1', BUTTON_CLASS)}>
			<Icon name="database" className="size-3.5 text-ink-300" />
			<span className="text-ink-200">Ephemeris offline</span>
		</button>
	)
}

interface MountRemoteItemProps {
	// Running listeners of the profile's mount, in protocol order; at least one.
	readonly servers: readonly MountRemoteServer[]
	// Name of the mount, read through the title.
	readonly name?: string
}

// Mount Remote Control listeners of the profile's mount while one runs: the remote icon and their protocols and count
// of clients, in the idle tone since they serve for the whole night, with each listener's address and clients in the title, opening the tool.
export function MountRemoteItem({ servers, name }: MountRemoteItemProps) {
	const text = listenersStatusText(servers)
	const details = servers.map((server) => `${MOUNT_REMOTE_PROTOCOL_LABELS[server.protocol]} on ${connectEndpoints(server).join(', ') || `port ${server.port}`}`).join('; ')
	const title = `Mount Remote Control${name ? ` of ${name}` : ''}: ${text}. ${details}`

	return (
		<button type="button" data-fixed title={`${title} · Open the tool`} onClick={() => navigate(routeState, { workspace: 'tools', tool: 'mount-remote-control' })} className={cn('flex flex-none items-center gap-1', BUTTON_CLASS)}>
			<Icon name="remote" className="size-3.5 text-ink-300" />
			<span className="text-ink-200">{text}</span>
		</button>
	)
}

interface AbortButtonProps {
	// Id of the operation.
	readonly id: string
	// Name of the operation, with its devices when they are known, such as "Move of Focuser Simulator".
	readonly label: string
	// Whether it sits in the bar, where it is pressed across the height of the bar (HIT_CLASS); a row of the details
	// panel keeps it to its own box, so it never covers the rows around it.
	readonly inBar?: boolean
}

// Abort of one operation; what it sends is decided again from the live stores when pressed. Once pressed it says
// Stopping and takes no second press while the server answers and, when it accepted, until the operation ends and the
// button goes with it; a refused Abort can be pressed again, its reason being a device failure of the bar.
export function AbortButton({ id, label, inBar }: AbortButtonProps) {
	const [stopping, setStopping] = useState(false)

	// Sends the Abort, and lets it be pressed again when it was refused.
	async function handleClick() {
		setStopping(true)
		if (!(await abortOperation(id, ABORT_STORES))) setStopping(false)
	}

	return (
		<button
			type="button"
			title={stopping ? `Stopping ${label}` : `Abort ${label}`}
			disabled={stopping}
			onClick={() => void handleClick()}
			className={cn('group flex flex-none cursor-pointer items-center border-0 bg-transparent p-0 font-mono text-xs leading-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-progress', inBar && HIT_CLASS)}
		>
			<span className={cn('rounded-sm border px-1.5 transition-colors duration-150 motion-reduce:transition-none', stopping ? 'border-line-200 text-ink-300' : 'border-danger text-danger group-hover:bg-danger group-hover:text-base-000')}>{stopping ? 'Stopping' : 'Abort'}</span>
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
export function OperationItem({ operation: { id, icon, label, target, detail, title, abortable }, online }: OperationItemProps) {
	return (
		<span title={online ? title : `Server offline: last known operation · ${title}`} className={cn('flex flex-none items-center gap-2', online ? 'text-accent' : 'text-ink-300')}>
			<Icon name={icon} className="size-3.5 text-ink-300" />
			{label}
			{detail && <span className="tabular-nums">{detail}</span>}
			{abortable && <AbortButton id={id} label={target ? `${label} of ${target}` : label} inBar />}
		</span>
	)
}
