import { cn } from 'cn'
import { useLayoutEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../camera/capture'
import { guidingRuntime } from '../camera/guiding'
import { connectionState } from '../connection/connection'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { deviceState, roleDevice } from '../equipment/equipment'
import { roleDefinition } from '../equipment/roles'
import { useActiveServerId, useWatchedDevices } from '../equipment/useEquipment'
import { notificationsState } from '../notifications/notifications'
import { operationsState } from '../operations'
import { activeProfile, activeSetup, profileState } from '../profile/profile'
import { Icon, type IconName } from '../ui/Icon'
import { abortProfileMount } from './statusbar/abort'
// oxfmt-ignore
import { activeCapture, activeGuiding, captureValue, CHIP_ROLES, type ChipRole, type ChipValue, fitItems, type FittedItems, mountAbortTarget, mountMoving, operationsSummary, otherOperations, roleChip, type ScopedDevice, scopedDeviceErrors, scopedRunningOperations, sessionOperationIds } from './statusbar/selectors'
import { StatusDetails } from './statusbar/StatusDetailsPanel'
import { ServerLinkItem, StatusChip } from './statusbar/StatusItems'

// Compact bar at the bottom of the window, visible from every workspace, showing everything the active profile has in
// as little room as it can: the tab's link to the application server, a chip per connected device of the profile's
// roles and for the main camera's running capture, the other device operations running on the profile's server
// connection, its device failures, and the details button that lists all of it. A device that is not connected shows
// no chip. A narrower bar shows fewer chips, by priority, and counts the others on the details button; the server
// link, the failures, and the Abort are never left out. While the mount of the profile moves, the bar offers an Abort
// of that mount alone, through the same stop command as the Equipment Control page; nothing here stops any other
// device.

// Gap between the items of the bar, in CSS pixels (gap-3).
const ITEM_GAP = 12

// Horizontal padding of the bar, in CSS pixels (px-4 on each side).
const BAR_PADDING = 32

// Width of the separator and padding that open the right group, in CSS pixels (border-l and pl-3).
const GROUP_INSET = 13

// Icon of each role's chip.
const CHIP_ICONS: Readonly<Record<ChipRole, IconName>> = {
	MAIN_CAMERA: 'camera',
	FILTER_WHEEL: 'wheel',
	FOCUSER: 'focuser',
	ROTATOR: 'rotator',
	MOUNT: 'mount',
	GUIDE_CAMERA: 'reticle',
	DOME: 'dome',
	COVER: 'cover',
	FLAT_PANEL: 'flatPanel',
}

// Chip of the bar: its id, icon, name, reading, and device.
interface BarChip {
	// Role of the chip, or "capture".
	readonly id: ChipRole | 'capture'
	// Icon of the chip.
	readonly icon: IconName
	// Name of the chip.
	readonly label: string
	// Reading of the chip.
	readonly value: ChipValue
	// Whether the chip shows a running session.
	readonly active: boolean
	// Device the chip opens in Equipment Control.
	readonly device?: ScopedDevice
}

// Status bar of the application.
export function StatusBar() {
	const footerRef = useRef<HTMLElement>(null)
	const serverRef = useRef<HTMLSpanElement>(null)
	const groupRef = useRef<HTMLSpanElement>(null)
	const measureRef = useRef<HTMLDivElement>(null)
	const [fitted, setFitted] = useState<FittedItems>()
	const [, setFooterWidth] = useState(0)
	const serverId = useActiveServerId()
	const profiles = useSnapshot(profileState)
	const { server: link } = useSnapshot(notificationsState)
	const { operations } = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const devices = useWatchedDevices()
	const setup = activeSetup(activeProfile(profiles))
	const mount = roleDevice(setup, 'MOUNT', devices)
	const mainCamera = roleDevice(setup, 'MAIN_CAMERA', devices)
	const running = scopedRunningOperations(operations, serverId)
	const mountState = watchedDeviceState(control, 'mount', mount)
	const capture = activeCapture(captures.sessions, mainCamera)
	const session = activeGuiding(guiding.sessions, roleDevice(setup, 'GUIDE_CAMERA', devices))
	const others = otherOperations(running, sessionOperationIds(capture, session))
	const errors = scopedDeviceErrors({ serverId, devices, control })
	const abort = mountAbortTarget({ link, serverId, watched: control.watched, mount, state: mountState, operations: running })
	const online = link === 'online'

	const chips: BarChip[] = []

	for (const role of CHIP_ROLES) {
		const device = roleDevice(setup, role, devices)
		const value = roleChip(role, device, control, role === 'GUIDE_CAMERA' ? session : undefined)
		if (!value) continue
		// A mount moved by an operation the driver does not report yet still shows the motion dots.
		const moving = role === 'MOUNT' && device ? value.moving || mountMoving(mountState, running, device) : value.moving
		chips.push({ id: role, icon: CHIP_ICONS[role], label: roleDefinition(role).label, value: { ...value, moving }, active: role === 'GUIDE_CAMERA' && !!session, device })

		if (role === 'MAIN_CAMERA' && capture) {
			const count = captureValue(capture)
			const title = `${capture.count === undefined ? `${capture.captured} frames (loop)` : `${capture.captured} of ${capture.count} frames`}${capture.stopping ? ', stopping' : ''}`
			chips.push({ id: 'capture', icon: 'frame', label: 'Capture', value: { text: count.text, tone: count.tone, moving: false, title }, active: true })
		}
	}

	// Re-renders when the bar or a chip changes size, so the chips are fitted again.
	useLayoutEffect(() => {
		const footer = footerRef.current
		const measure = measureRef.current
		if (!footer || !measure) return
		const observer = new ResizeObserver(() => setFooterWidth(footer.clientWidth))
		observer.observe(footer)
		observer.observe(measure)
		return () => observer.disconnect()
	}, [])

	// Fits the chips, measured on their hidden copies, in the room the server link and the right group leave, before
	// the browser paints.
	useLayoutEffect(() => {
		const footer = footerRef.current
		const measure = measureRef.current
		const group = groupRef.current
		if (!footer || !measure || !group) return
		const widths = new Map(Array.from(measure.children, (child) => [(child as HTMLElement).dataset.chip, (child as HTMLElement).offsetWidth]))
		const fixed = Array.from(group.querySelectorAll<HTMLElement>('[data-fixed]'))
		const groupWidth = GROUP_INSET + fixed.reduce((sum, element) => sum + element.offsetWidth, 0) + ITEM_GAP * Math.max(0, fixed.length - 1)
		const room = footer.clientWidth - BAR_PADDING - (serverRef.current?.offsetWidth ?? 0) - ITEM_GAP - groupWidth
		const next = fitItems(
			chips.map((chip) => ({ id: chip.id, moving: chip.value.moving, active: chip.active, width: widths.get(chip.id) ?? 0 })),
			room,
			ITEM_GAP,
			others.length,
		)
		setFitted((current) => (current && current.hidden === next.hidden && current.nameOthers === next.nameOthers && current.visible.size === next.visible.size && [...next.visible].every((id) => current.visible.has(id)) ? current : next))
	})

	const visible = fitted?.visible
	const hidden = fitted?.hidden ?? 0
	const nameOthers = fitted?.nameOthers ?? false

	return (
		<footer ref={footerRef} className="relative flex h-7 flex-none items-center gap-3 overflow-hidden border-t border-line-100 bg-base-000 px-4 text-[11px] leading-4 whitespace-nowrap text-ink-200">
			<div ref={measureRef} className="pointer-events-none invisible absolute top-0 left-0 flex">
				{chips.map((chip) => (
					<span key={chip.id} data-chip={chip.id} className="flex">
						<StatusChip icon={chip.icon} label={chip.label} value={chip.value} />
					</span>
				))}
			</div>
			<ServerLinkItem ref={serverRef} />
			{chips.map((chip) => (!visible || visible.has(chip.id)) && <StatusChip key={chip.id} icon={chip.icon} label={chip.label} value={chip.value} device={chip.device} />)}
			<span ref={groupRef} className="ml-auto flex min-w-0 items-center gap-3 border-l border-line-100 pl-3">
				{nameOthers && (
					<span title={online ? undefined : 'Server offline: last known operations'} className={cn('min-w-0 truncate', online ? 'text-accent' : 'text-ink-300')}>
						{operationsSummary(others)}
					</span>
				)}
				{errors.length > 0 && (
					<span data-fixed title={errors.map((error) => `${error.name}: ${error.message}`).join('\n')} className="flex flex-none items-center gap-1 text-danger">
						<Icon name="error" className="size-3.5" />
						{errors.length}
					</span>
				)}
				{abort && (
					<button
						data-fixed
						type="button"
						title={`Abort the motion of ${abort.name}`}
						onClick={() => void abortProfileMount({ connections: connectionState, profiles: profileState, devices: deviceState, control: controlRuntime, operations: operationsState, notifications: notificationsState })}
						className="flex-none cursor-pointer rounded-sm border border-danger bg-transparent px-1.5 py-0 font-mono text-[11px] leading-4 text-danger transition-colors duration-150 hover:bg-danger hover:text-base-000 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
					>
						Abort
					</button>
				)}
				<StatusDetails hidden={hidden} />
			</span>
		</footer>
	)
}
