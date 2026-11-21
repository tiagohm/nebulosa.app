import type { NotificationTarget, OperationRecord } from 'api'
import { cn } from 'cn'
import { type ReactNode, type Ref, useEffect, useRef, useState } from 'react'
import { useSnapshot } from 'valtio'
import { captureCount, captureRuntime, captureStatus } from '../../camera/capture'
import { GUIDING_STATE_LABELS, guidingRuntime } from '../../camera/guiding'
import { useSelectedConnection } from '../../connection/useSelectedConnection'
import { controlRuntime } from '../../equipment-control/control'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { roleDevice, roleStatus } from '../../equipment/equipment'
import { ROLES } from '../../equipment/roles'
import { RoleStatusText } from '../../equipment/RoleStatusText'
import { useActiveServerId, useRoleDevice, useWatchedDevices } from '../../equipment/useEquipment'
import { imagesState } from '../../images/images'
import { useActiveSite, useDisplayZone } from '../../location/useLocation'
import { notificationsState } from '../../notifications/notifications'
import { openNotificationTarget, targetAvailable } from '../../notifications/target'
import { OPERATION_LABELS, operationsState } from '../../operations'
import { activeProfile, activeSetup, profileState } from '../../profile/profile'
import { openAstronomicalTimeConverter, qualityNotes } from '../../tools/astronomicaltime/astronomicaltime'
import { meridianFlipHeadline, meridianFlipState, meridianFlipStatusText, monitorKey } from '../../tools/meridianflip/meridianflip'
import { listenersStatusText, mountListeners, mountRemoteControlState } from '../../tools/mountremotecontrol/listeners'
import { DataRow } from '../../ui/DataRow'
import { Icon } from '../../ui/Icon'
import { LinkButton } from '../../ui/LinkButton'
import { SectionHeading } from '../../ui/SectionHeading'
import { TONE_TEXT } from '../../ui/StatusBadge'
import { useNow } from '../../useNow'
import { navigate, routeState } from '../route'
import { astronomicalClockRuntime, clockApproximate, clockFreshness, clockReadingText, liveClock } from './astronomicalclock'
import { useMonotonicNow } from './AstronomicalClockChip'
import {
	activeCapture,
	activeGuiding,
	capturePercent,
	type ChipSessions,
	connectionLabel,
	type DeviceError,
	formatElapsed,
	guidingValue,
	operationTarget,
	otherOperations,
	progressText,
	roleDetailValue,
	scopedDeviceErrors,
	scopedRunningOperations,
	type ScopedDevice,
	serverLinkLabel,
	sessionOperationIds,
} from './selectors'
import { AbortButton, HIT_CLASS, TONE_CLASSES, useOperationAbortable } from './StatusItems'

// Details of the status bar: a button at its right end, showing how many items the bar left out, and before it, while
// a device fails, a button naming how many failures there are, both opening a panel above themselves with everything
// the bar summarizes for the active profile's server connection — the server link and the selected connection, every
// role with its device and what it reports, the running capture and guiding sessions with the enabled Meridian Flip
// Monitor and the running Mount Remote Control listeners of the mount, every other running operation with its devices,
// elapsed time, and reported progress, each with its Abort, the device failures, and the real-time clock, even when the
// bar has no room for it. The panel is placed in the viewport (fixed), so the clipping bar never cuts it, follows the
// buttons when the window resizes, takes the focus when it opens so the keyboard goes on inside it, and closes when a
// button is pressed again, on a press outside, on Escape (returning the focus to the details button), and after it
// opened a device, a camera tab, or a tool. Closing it, or anything it opens, never stops a session or an operation;
// only an Abort does.

// Width of the panel, in CSS pixels, when the viewport has room for it.
const PANEL_WIDTH = 380

// Smallest distance kept between the panel and the edges of the viewport, in CSS pixels.
const VIEWPORT_GUTTER = 16

// Distance between the button and the panel, in CSS pixels.
const PANEL_GAP = 4

// Height of the top bar the panel never covers, in CSS pixels.
const TOP_BAR_HEIGHT = 56

// Position and width of the panel in the viewport, in CSS pixels.
interface PanelPlacement {
	readonly bottom: number
	readonly right: number
	readonly width: number
}

interface StatusDetailsProps {
	// Items the bar left out, counted on the button.
	readonly hidden: number
	// Failures of the devices of the active connection, counted on their own button.
	readonly errors: readonly DeviceError[]
}

// Buttons of the failures and of the details, and the panel they open.
export function StatusDetails({ hidden, errors }: StatusDetailsProps) {
	const [placement, setPlacement] = useState<PanelPlacement>()
	const rootRef = useRef<HTMLSpanElement>(null)
	const buttonRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const open = !!placement

	// Returns where the panel goes: above the buttons, aligned with the right edge of the details button but kept inside
	// the viewport, or undefined while the button is not laid out.
	function place(): PanelPlacement | undefined {
		const rect = buttonRef.current?.getBoundingClientRect()
		if (!rect) return undefined
		const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * VIEWPORT_GUTTER)
		const right = Math.max(VIEWPORT_GUTTER, Math.min(window.innerWidth - rect.right, window.innerWidth - width - VIEWPORT_GUTTER))
		return { bottom: window.innerHeight - rect.top + PANEL_GAP, right, width }
	}

	// Opens the panel, or closes it when it is open.
	function toggle() {
		setPlacement(open ? undefined : place())
	}

	// Moves the focus into the panel once it opened, so Tab goes on through its controls.
	useEffect(() => {
		if (open) panelRef.current?.focus()
	}, [open])

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setPlacement(undefined)
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key !== 'Escape' || e.defaultPrevented) return
			setPlacement(undefined)
			buttonRef.current?.focus()
		}

		// Follows the buttons, as when a phone's address bar hides or the device turns.
		function handleResize() {
			setPlacement(place())
		}

		document.addEventListener('mousedown', handlePointerDown)
		document.addEventListener('keydown', handleKeyDown)
		window.addEventListener('resize', handleResize)

		return () => {
			document.removeEventListener('mousedown', handlePointerDown)
			document.removeEventListener('keydown', handleKeyDown)
			window.removeEventListener('resize', handleResize)
		}
	}, [open])

	return (
		<span ref={rootRef} data-fixed className="flex flex-none items-center gap-3">
			{errors.length > 0 && (
				<button
					type="button"
					title={`${errors.map((error) => `${error.name}: ${error.message}`).join('\n')}\n· Open the status details`}
					onClick={toggle}
					className={cn('flex cursor-pointer items-center gap-1 text-danger focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent', HIT_CLASS)}
				>
					<Icon name="error" className="size-3.5" />
					{errors.length === 1 ? '1 failure' : `${errors.length} failures`}
				</button>
			)}
			<button
				ref={buttonRef}
				type="button"
				title={hidden > 0 ? `${hidden} more in the status details` : 'Status details'}
				onClick={toggle}
				className={cn('flex min-w-7 cursor-pointer items-center justify-center rounded-sm px-1 text-ink-200 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent', HIT_CLASS, open && 'bg-base-300 text-ink-100')}
			>
				{hidden > 0 ? `+${hidden}` : <Icon name="info" className="size-3.5" />}
				<span className="sr-only">{hidden > 0 ? ' more in the status details' : 'Status details'}</span>
			</button>
			{placement && <StatusDetailsPanel ref={panelRef} placement={placement} onClose={() => setPlacement(undefined)} />}
		</span>
	)
}

interface StatusDetailsPanelProps {
	// Element of the panel, focused when it opens.
	readonly ref?: Ref<HTMLDivElement>
	// Position and width of the panel.
	readonly placement: PanelPlacement
	// Closes the panel.
	readonly onClose: () => void
}

// Panel of the details.
function StatusDetailsPanel({ ref, placement: { bottom, right, width }, onClose }: StatusDetailsPanelProps) {
	const now = useNow()
	const serverId = useActiveServerId()
	const { server: link } = useSnapshot(notificationsState)
	const { connection, status } = useSelectedConnection()
	const { operations } = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const captures = useSnapshot(captureRuntime)
	const guiding = useSnapshot(guidingRuntime)
	const abortable = useOperationAbortable()
	const { documents } = useSnapshot(imagesState)
	const devices = useWatchedDevices()
	const mainCamera = useRoleDevice('MAIN_CAMERA').device
	const guideCamera = useRoleDevice('GUIDE_CAMERA').device
	const mount = useRoleDevice('MOUNT').device
	const meridianFlip = useSnapshot(meridianFlipState)
	const monitor = mount ? meridianFlip.monitors[monitorKey(mount.connectionId, mount.id)] : undefined
	const remoteControl = useSnapshot(mountRemoteControlState)
	const listeners = listenersStatusText(mount ? mountListeners(remoteControl.servers, mount.connectionId, mount.id) : [])
	const capture = activeCapture(captures.sessions, mainCamera)
	const session = activeGuiding(guiding.sessions, guideCamera)
	const others = otherOperations(scopedRunningOperations(operations, serverId), sessionOperationIds(capture, session))
	const percent = capture && capturePercent(capture)
	const captureOperation = capture && operations[capture.operationId]
	const guidingOperation = session && operations[session.operationId]
	const errors = scopedDeviceErrors({ serverId, devices, control })

	// Opens the camera tab of a session with one of its tools, when the tab is open.
	function openCamera(target: NotificationTarget) {
		if (openNotificationTarget(target, { images: imagesState, route: routeState, devices: devices.devices })) onClose()
	}

	// Opens the Meridian Flip Monitor tool.
	function openMeridianFlip() {
		navigate(routeState, { workspace: 'tools', tool: 'meridian-flip' })
		onClose()
	}

	// Opens the Mount Remote Control tool.
	function openRemoteControl() {
		navigate(routeState, { workspace: 'tools', tool: 'mount-remote-control' })
		onClose()
	}

	const captureTarget: NotificationTarget | undefined = mainCamera && { kind: 'cameraTool', connectionId: mainCamera.connectionId, deviceId: mainCamera.id, tool: 'camera-acquisition' }
	const guidingTarget: NotificationTarget | undefined = guideCamera && { kind: 'cameraTool', connectionId: guideCamera.connectionId, deviceId: guideCamera.id, tool: 'guiding' }

	return (
		<div
			ref={ref}
			tabIndex={-1}
			style={{ bottom, right, width, maxHeight: `calc(100dvh - ${bottom + TOP_BAR_HEIGHT + VIEWPORT_GUTTER}px)` }}
			className="fixed z-30 box-border flex flex-col gap-3 overflow-y-auto rounded-md border border-line-100 bg-base-200 p-3 text-xs whitespace-normal text-ink-200 shadow-[0_12px_32px_rgb(0_0_0/0.45)] outline-none"
		>
			{link !== 'online' && <p className="m-0 rounded-sm border border-danger px-2 py-1 text-danger">{link === 'offline' ? 'Server offline: showing the last known state.' : 'Connecting to the server.'}</p>}
			<Section title="Connection">
				<Row label="Server">{serverLinkLabel(link)}</Row>
				<Row label="Equipment">{connectionLabel(connection?.name, status)}</Row>
			</Section>
			<Section title="Equipment">
				<EquipmentRows devices={devices} onNavigate={onClose} sessions={{ capture, guiding: session }} />
			</Section>
			{(capture !== undefined || session !== undefined || monitor !== undefined || listeners !== undefined) && (
				<Section title="Sessions">
					{capture && (
						<Row
							label="Capture"
							actions={
								<>
									{targetAvailable(captureTarget, { documents, devices: devices.devices }) && <OpenButton onClick={() => openCamera(captureTarget)} />}
									{captureOperation && abortable(captureOperation) && <AbortButton id={captureOperation.operationId} label={mainCamera ? `Capture of ${mainCamera.name}` : 'Capture'} />}
								</>
							}
						>
							<span className="text-accent">{capture.stopping ? 'Stopping' : captureStatus(capture)}</span> · {captureCount(capture)}
							{percent !== undefined && ` · ${percent}%`}
						</Row>
					)}
					{session && (
						<Row
							label="Guiding"
							actions={
								<>
									{targetAvailable(guidingTarget, { documents, devices: devices.devices }) && <OpenButton onClick={() => openCamera(guidingTarget)} />}
									{guidingOperation && abortable(guidingOperation) && <AbortButton id={guidingOperation.operationId} label={guideCamera ? `Guiding of ${guideCamera.name}` : 'Guiding'} />}
								</>
							}
						>
							<span className={TONE_CLASSES[guidingValue(session).tone]}>{GUIDING_STATE_LABELS[session.state]}</span>
							{guidingValue(session).text !== GUIDING_STATE_LABELS[session.state] && ` · ${guidingValue(session).text}`}
						</Row>
					)}
					{monitor && (
						<Row label="Meridian flip" actions={<OpenButton label="Open tool" onClick={openMeridianFlip} />}>
							<span className={TONE_TEXT[meridianFlipHeadline(monitor)[1]]}>{meridianFlipStatusText(monitor, now)}</span>
						</Row>
					)}
					{listeners && (
						<Row label="Remote control" actions={<OpenButton label="Open tool" onClick={openRemoteControl} />}>
							Serving · {listeners}
						</Row>
					)}
				</Section>
			)}
			<Section title={`Operations · ${others.length}`}>
				{others.length > 0 ? others.map((operation) => <OperationRow key={operation.operationId} operation={operation} devices={devices.devices} now={now} abortable={abortable(operation)} />) : <p className="m-0 text-ink-300">No other operation running.</p>}
			</Section>
			{errors.length > 0 && (
				<Section title="Failures">
					{errors.map((error) => (
						<Row key={error.deviceId} label={error.name} tone="danger">
							{error.message}
						</Row>
					))}
				</Section>
			)}
			<AstronomicalTimeSection onNavigate={onClose} />
		</div>
	)
}

interface AstronomicalTimeSectionProps {
	// Called after the converter was opened.
	readonly onNavigate: () => void
}

// Real current time in every form the clock shows, with the site, its accuracy, and the way to the converter.
function AstronomicalTimeSection({ onNavigate }: AstronomicalTimeSectionProps) {
	const now = useMonotonicNow()
	const { sample } = useSnapshot(astronomicalClockRuntime)
	const observer = useActiveSite()
	const timeZone = useDisplayZone(observer).zone
	const freshness = clockFreshness(sample, now)
	const live = sample && freshness !== 'expired' ? liveClock(sample, now) : undefined
	const approximate = clockApproximate(sample)
	const readings = (['utc', 'local', 'jd', 'mjd', ...(observer ? (['last', 'lmst'] as const) : [])] as const).map((reading) => clockReadingText(reading, live, timeZone, true, approximate))

	return (
		<Section title="Astronomical Time">
			{readings.map(({ label, value }) => (
				<Row key={label} label={label}>
					{value}
					{label === 'Local' && ` · ${timeZone}`}
				</Row>
			))}
			{!observer && <p className="m-0 text-ink-300">Sidereal times need an observing site in this profile.</p>}
			{freshness === 'stale' && <p className="m-0 text-ink-300">Not updated recently: the server is not answering.</p>}
			{sample &&
				qualityNotes(sample.reference.quality).map((note) => (
					<p key={note} className="m-0 text-ink-300">
						{note}
					</p>
				))}
			<button
				type="button"
				onClick={() => {
					openAstronomicalTimeConverter()
					onNavigate()
				}}
				className="cursor-pointer self-start border-0 bg-transparent p-0 text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
			>
				Open Astronomical Time Converter
			</button>
		</Section>
	)
}

interface EquipmentRowsProps {
	// Devices of the watched connection, with their connect state.
	readonly devices: ReturnType<typeof useWatchedDevices>
	// Called after a device was opened.
	readonly onNavigate: () => void
	// Running sessions of the main and guide cameras, read by their rows.
	readonly sessions: ChipSessions
}

// Every role of the active profile with its device, status, and what the device reports.
function EquipmentRows({ devices, onNavigate, sessions }: EquipmentRowsProps) {
	const profiles = useSnapshot(profileState)
	const control = useSnapshot(controlRuntime)
	const setup = activeSetup(activeProfile(profiles))

	return ROLES.map(({ role, label }) => {
		const device = roleDevice(setup, role, devices)
		const status = roleStatus(setup, role, devices)
		const value = roleDetailValue(role, status, device, control, sessions)

		return (
			<Row key={role} label={label}>
				{status === 'notSelected' ? (
					<RoleStatusText status="notSelected" />
				) : (
					<>
						<DeviceLink device={device} fallback={setup[role]?.name || 'Unavailable device'} className="text-ink-100" onNavigate={onNavigate} /> · {status === 'connected' ? <span className={TONE_CLASSES[value.tone]}>{value.text}</span> : <RoleStatusText status={status} />}
					</>
				)}
			</Row>
		)
	})
}

interface OperationRowProps {
	// Running operation.
	readonly operation: OperationRecord
	// Devices of the watched connection, naming the operation's devices.
	readonly devices: readonly ScopedDevice[]
	// Current time in Unix milliseconds.
	readonly now: number
	// Whether the operation can be interrupted.
	readonly abortable: boolean
}

// Kind, devices, elapsed time, reported progress, and Abort of a running operation.
function OperationRow({ operation, devices, now, abortable }: OperationRowProps) {
	const target = operationTarget(operation, devices)
	const progress = progressText(operation.progress)
	const label = OPERATION_LABELS[operation.kind][1]

	return (
		<Row label={label} actions={abortable && <AbortButton id={operation.operationId} label={target ? `${label} of ${target}` : label} />}>
			{target ?? 'Unknown device'} · {formatElapsed(operation.startedAt, now)}
			{progress && ` · ${progress}`}
		</Row>
	)
}

interface SectionProps {
	// Heading of the section.
	readonly title: string
	// Rows of the section.
	readonly children: ReactNode
}

// Titled group of rows.
function Section({ title, children }: SectionProps) {
	return (
		<section className="flex flex-col gap-1">
			<SectionHeading>{title}</SectionHeading>
			{children}
		</section>
	)
}

interface RowProps {
	// Name of the row.
	readonly label: string
	// Value of the row.
	readonly children: ReactNode
	// Tone of the whole value; a failure for the rows of the failures.
	readonly tone?: 'danger'
	// Links and Aborts acting on what the row is about, after its value; absent for a row with none.
	readonly actions?: ReactNode
}

// Data row of the panel: the name at the start and the value at the end, its links and Aborts after it.
function Row({ label, children, tone, actions }: RowProps) {
	return (
		<DataRow label={label} tone={tone} actions={actions ? <span className="flex items-center gap-2 pl-1">{actions}</span> : undefined}>
			{children}
		</DataRow>
	)
}

interface OpenButtonProps {
	// Text of the link; "Open in Images" by default.
	readonly label?: string
	// Opens what the row is about.
	readonly onClick: () => void
}

// Link opening what a row is about: the camera tab of a session in Images, or a tool.
function OpenButton({ label = 'Open in Images', onClick }: OpenButtonProps) {
	return <LinkButton onClick={onClick}>{label}</LinkButton>
}
