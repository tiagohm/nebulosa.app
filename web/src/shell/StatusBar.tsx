import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { captureRuntime } from '../camera/capture'
import { guidingRuntime } from '../camera/guiding'
import { controlRuntime, watchedDeviceState } from '../equipment-control/control'
import { roleDevice } from '../equipment/equipment'
import { roleDefinition } from '../equipment/roles'
import { useActiveServerId, useWatchedDevices } from '../equipment/useEquipment'
import { useActiveSite, useDisplayZone } from '../location/useLocation'
import { notificationsState } from '../notifications/notifications'
import { operationsState } from '../operations'
import { activeProfile, activeSetup, astronomicalClockPreferences, profileState, statusChipPreferences } from '../profile/profile'
import { meridianFlipState, monitorKey } from '../tools/meridianflip/meridianflip'
import { Icon, type IconName } from '../ui/Icon'
import { astronomicalClockRuntime, effectiveReadings, watchAstronomicalClock } from './statusbar/astronomicalclock'
import { AstronomicalClockChip } from './statusbar/AstronomicalClockChip'
// oxfmt-ignore
import { activeCapture, activeGuiding, type BarOperation, barOperations, CHIP_ROLES, type ChipRole, type ChipValue, fitClocks, fitItems, fitOperations, MOUNT_MOTION_ID, mountAbortTarget, mountChip, mountMotionRunning, mountMoving, roleChip, type ScopedDevice, scopedDeviceErrors, scopedRunningOperations } from './statusbar/selectors'
import { StatusDetails } from './statusbar/StatusDetailsPanel'
import { MeridianFlipItem, OperationItem, ServerLinkItem, StatusChip, useOperationAbortable } from './statusbar/StatusItems'

// Compact bar at the bottom of the window, visible from every workspace, showing everything the active profile has in
// as little room as it can: the tab's link to the application server, a chip per connected device of the profile's
// roles with what the profile asks of it, the device operations running on the profile's server connection, each with
// its Abort, the Meridian Flip Monitor of the profile's mount while it is enabled, its device failures, and the details
// button that lists all of it. A device that is not connected shows no chip. A narrower bar shows fewer chips, by
// priority, and fewer operations, and counts the others on the details button; the server link, the monitor, the
// failures, and the first operation are never left out. Every operation has its own Abort,
// through the same command as the page that started it, and it interrupts that operation alone; a motion of the mount
// of the profile that no operation holds has one too. In the room all of that leaves, the bar shows the real-time clock
// the profile asks for, which opens the Astronomical Time Converter; it never takes room from anything else, and is
// never the Sky simulation clock.

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

// Returns whether two sets hold the same ids.
function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>) {
	return a.size === b.size && [...a].every((id) => b.has(id))
}

// What the fitting decided for the bar.
interface FittedBar {
	// Roles of the chips shown.
	readonly chips: ReadonlySet<string>
	// Ids of the operations shown.
	readonly operations: ReadonlySet<string>
	// Chips and operations left out.
	readonly hidden: number
}

// Chip of the bar: its role, icon, name, reading, and device.
interface BarChip {
	// Role of the chip.
	readonly id: ChipRole
	// Icon of the chip.
	readonly icon: IconName
	// Name of the chip.
	readonly label: string
	// Reading of the chip.
	readonly value: ChipValue
	// Whether the chip shows a running session.
	readonly active: boolean
	// Device the chip opens in Equipment Control.
	readonly device: ScopedDevice
}

// Status bar of the application.
export function StatusBar() {
	const footerRef = useRef<HTMLElement>(null)
	const serverRef = useRef<HTMLSpanElement>(null)
	const groupRef = useRef<HTMLSpanElement>(null)
	const measureRef = useRef<HTMLDivElement>(null)
	const [fitted, setFitted] = useState<FittedBar>()
	const [fittedClocks, setFittedClocks] = useState<ReadonlySet<string>>()
	const [, setFooterWidth] = useState(0)
	const serverId = useActiveServerId()
	const profiles = useSnapshot(profileState)
	const { server: link } = useSnapshot(notificationsState)
	const { operations: known } = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const meridianFlip = useSnapshot(meridianFlipState)
	const abortable = useOperationAbortable()
	const devices = useWatchedDevices()
	const profile = activeProfile(profiles)
	const setup = activeSetup(profile)
	const observer = useActiveSite()
	const clock = astronomicalClockPreferences(profile.settings)
	const readings = effectiveReadings(clock, observer !== undefined)
	const timeZone = useDisplayZone(observer).zone
	const site = observer?.name
	const mount = roleDevice(setup, 'MOUNT', devices)
	const mainCamera = roleDevice(setup, 'MAIN_CAMERA', devices)
	const running = scopedRunningOperations(known, serverId)
	const mountState = watchedDeviceState(control, 'mount', mount)
	const monitor = mount ? meridianFlip.monitors[monitorKey(mount.connectionId, mount.id)] : undefined
	const capture = activeCapture(captures.sessions, mainCamera)
	const session = activeGuiding(guiding.sessions, roleDevice(setup, 'GUIDE_CAMERA', devices))
	const errors = scopedDeviceErrors({ serverId, devices, control })
	const abort = mountAbortTarget({ link, serverId, watched: control.watched, mount, state: mountState, operations: running })
	const online = link === 'online'
	const chips: BarChip[] = []

	for (const role of CHIP_ROLES) {
		const device = roleDevice(setup, role, devices)
		const preferences = statusChipPreferences(profile.settings, role)
		const value = preferences.visible ? roleChip(role, device, control, { capture: role === 'MAIN_CAMERA' ? capture : undefined, guiding: role === 'GUIDE_CAMERA' ? session : undefined }, preferences.fields) : undefined
		if (!value || !device) continue
		// A mount moved by an operation the driver does not report yet is moving too.
		const moving = role === 'MOUNT' ? value.moving || mountMoving(mountState, running, device) : value.moving
		chips.push({ id: role, icon: CHIP_ICONS[role], label: roleDefinition(role).label, value: { ...value, moving }, active: (role === 'GUIDE_CAMERA' && !!session) || (role === 'MAIN_CAMERA' && !!capture), device })
	}

	const operations: BarOperation[] = barOperations(running, { captures: captures.sessions, guiding: guiding.sessions }, abortable)

	// A motion of the mount no operation holds, as from a hand controller, can be aborted just the same.
	if (abort && mount && !mountMotionRunning(running, mount)) {
		const motion = mountChip(mountState, ['status']).text
		operations.unshift({ id: MOUNT_MOTION_ID, icon: 'mount', label: motion, title: `${abort.name}: ${motion}`, abortable: true })
	}

	const [latitude, longitude, elevation] = [observer?.latitude, observer?.longitude, observer?.elevation]
	const clockShown = clock.enabled

	// Keeps the sample of the clock current while it is shown, for the observing site of the profile; a socket that comes back
	// starts it again, since a server that was away may have restarted.
	useEffect(() => {
		if (!clockShown) return
		return watchAstronomicalClock(astronomicalClockRuntime, latitude === undefined || longitude === undefined || elevation === undefined ? undefined : { latitude, longitude, elevation })
	}, [clockShown, latitude, longitude, elevation, link])

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

	// Fits the operations and then the chips, measured on their hidden copies, in the room the server link and the
	// always-shown part of the right group leave, before the browser paints.
	useLayoutEffect(() => {
		const footer = footerRef.current
		const measure = measureRef.current
		const group = groupRef.current
		if (!footer || !measure || !group) return
		const widths = new Map(Array.from(measure.children, (child) => [(child as HTMLElement).dataset.chip, (child as HTMLElement).offsetWidth]))
		const fixed = Array.from(group.querySelectorAll<HTMLElement>('[data-fixed]'))
		const groupWidth = GROUP_INSET + fixed.reduce((sum, element) => sum + element.offsetWidth, 0) + ITEM_GAP * Math.max(0, fixed.length - 1)
		const room = footer.clientWidth - BAR_PADDING - (serverRef.current?.offsetWidth ?? 0) - ITEM_GAP - groupWidth
		const shown = fitOperations(
			operations.map(({ id }) => ({ id, width: widths.get(id) ?? 0 })),
			room,
			ITEM_GAP,
		)
		const items = chips.map((chip) => ({ id: chip.id, moving: chip.value.moving, active: chip.active, width: widths.get(chip.id) ?? 0 }))
		const left = room - shown.width
		const next = fitItems(items, left, ITEM_GAP, operations.length - shown.visible.size)
		setFitted((current) => (current && current.hidden === next.hidden && sameIds(current.chips, next.visible) && sameIds(current.operations, shown.visible) ? current : { chips: next.visible, operations: shown.visible, hidden: next.hidden }))
		const clocks = fitClocks(
			readings.map((reading) => ({ id: reading, width: widths.get(reading) ?? 0 })),
			items,
			next,
			left,
			ITEM_GAP,
		)
		setFittedClocks((current) => (current && sameIds(current, clocks) ? current : clocks))
	})

	const hidden = fitted?.hidden ?? 0

	return (
		<footer ref={footerRef} className="relative flex h-7 flex-none items-center gap-3 overflow-hidden border-t border-line-100 bg-base-000 px-4 text-xs leading-4 whitespace-nowrap text-ink-200">
			<div ref={measureRef} className="pointer-events-none invisible absolute top-0 left-0 flex">
				{chips.map((chip) => (
					<span key={chip.id} data-chip={chip.id} className="flex">
						<StatusChip icon={chip.icon} label={chip.label} value={chip.value} />
					</span>
				))}
				{operations.map((operation) => (
					<span key={operation.id} data-chip={operation.id} className="flex">
						<OperationItem operation={operation} online={online} />
					</span>
				))}
				{readings.map((reading) => (
					<span key={reading} data-chip={reading} className="flex">
						<AstronomicalClockChip reading={reading} timeZone={timeZone} showSeconds={clock.showSeconds} site={site} measure />
					</span>
				))}
			</div>
			<ServerLinkItem ref={serverRef} />
			{chips.map((chip) => (!fitted || fitted.chips.has(chip.id)) && <StatusChip key={chip.id} icon={chip.icon} label={chip.label} value={chip.value} device={chip.device} />)}
			<span ref={groupRef} className="ml-auto flex min-w-0 items-center gap-3 border-l border-line-100 pl-3">
				{operations.map((operation) => (!fitted || fitted.operations.has(operation.id)) && <OperationItem key={operation.id} operation={operation} online={online} />)}
				{readings.map((reading) => fittedClocks?.has(reading) && <AstronomicalClockChip key={reading} reading={reading} timeZone={timeZone} showSeconds={clock.showSeconds} site={site} />)}
				{monitor && <MeridianFlipItem monitor={monitor} name={mount?.name} />}
				{errors.length > 0 && (
					<span data-fixed title={errors.map((error) => `${error.name}: ${error.message}`).join('\n')} className="flex flex-none items-center gap-1 text-danger">
						<Icon name="error" className="size-3.5" />
						{errors.length}
					</span>
				)}
				<StatusDetails hidden={hidden} />
			</span>
		</footer>
	)
}
