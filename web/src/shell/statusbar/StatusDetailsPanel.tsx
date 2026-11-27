import type { DeviceSummary, NotificationTarget, OperationRecord } from 'api'
import { cn } from 'cn'
import type { ReactNode, Ref } from 'react'
import { useSnapshot } from 'valtio'
import { captureCount, captureRuntime, captureStatus } from '../../camera/capture'
import { GUIDING_STATE_LABELS, guidingRuntime } from '../../camera/guiding'
import { useSelectedConnection } from '../../connection/useSelectedConnection'
import { controlRuntime } from '../../equipment-control/control'
import { DeviceLink } from '../../equipment-control/DeviceLink'
import { type DeviceView, deviceState, roleDevice, roleStatus, switchDevice, switchSetup } from '../../equipment/equipment'
import { type EquipmentRole, ROLE_GROUPS, ROLES } from '../../equipment/roles'
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
import { useNow } from '../../useNow'
import { navigate, routeState } from '../route'
import { astronomicalClockRuntime, clockApproximate, clockFreshness, clockReadingText, liveClock } from './astronomicalclock'
import { useMonotonicNow } from './AstronomicalClockChip'
import { type PanelPlacement, panelStyle, useBarPopover } from './popover'
import {
	activeCapture,
	activeGuiding,
	capturePercent,
	CHIP_ICONS,
	type ChipSessions,
	connectionLabel,
	type DeviceError,
	formatElapsed,
	guidingValue,
	operationTarget,
	otherOperations,
	progressText,
	type RoleDetail,
	roleDetail,
	scopedDeviceErrors,
	scopedRunningOperations,
	type ScopedDevice,
	serverLinkLabel,
	sessionOperationIds,
	type StatusWarning,
} from './selectors'
import { AbortButton, BAR_BADGE_TEXT, HIT_CLASS, TONE_CLASSES, useOperationAbortable } from './StatusItems'

// Details of the status bar: a button at its right end, showing how many items the bar left out, and before it, while
// a device fails, a button naming how many failures there are, and while the equipment gives wrong results, such as a mount
// reporting another site, a button naming how many warnings there are, all opening a panel above themselves (./popover) with
// everything the bar summarizes for the active profile's server connection — the server link and the selected connection, how many
// devices of the Equipment Setup are connected, every assigned role with its device, what it is doing in words, and what
// it reads, the Connect of each device that is not connected and Connect all, the way to the Equipment Setup, the running capture and guiding sessions with the enabled Meridian Flip
// Monitor and the running Mount Remote Control listeners of the mount, every other running operation with its devices,
// elapsed time, and reported progress, each with its Abort, the device failures, the warnings, each opening its device, and
// the real-time clock, even when the bar has no room for it, then the way to the Status Bar settings of the profile. The
// panel closes as every panel of the bar does, and after it opened a device, a camera tab, a tool, the Equipment Setup, or
// the settings; a Connect keeps it open. Closing it, or anything it opens, never stops a session or an operation, and
// nothing in it disconnects a device; only an Abort stops one.

// Width of the panel, in CSS pixels, when the viewport has room for it.
const PANEL_WIDTH = 420

interface StatusDetailsProps {
	// Items the bar left out, counted on the button.
	readonly hidden: number
	// Failures of the devices of the active connection, counted on their own button.
	readonly errors: readonly DeviceError[]
	// Warnings of the active connection, counted on their own button.
	readonly warnings: readonly StatusWarning[]
}

// Buttons of the failures, of the warnings, and of the details, and the panel they open.
export function StatusDetails({ hidden, errors, warnings }: StatusDetailsProps) {
	const { rootRef, buttonRef, panelRef, placement, toggle, close } = useBarPopover(PANEL_WIDTH)
	const open = !!placement

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
			{warnings.length > 0 && (
				<button
					type="button"
					title={`${warnings.map((warning) => `${warning.device.name}: ${warning.message}`).join('\n')}\n· Open the status details`}
					onClick={toggle}
					className={cn('flex cursor-pointer items-center gap-1 text-warning focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent', HIT_CLASS)}
				>
					<Icon name="warning" className="size-3.5" />
					{warnings.length}
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
			</button>
			{placement && <StatusDetailsPanel ref={panelRef} placement={placement} warnings={warnings} onClose={close} />}
		</span>
	)
}

interface StatusDetailsPanelProps {
	// Element of the panel, focused when it opens.
	readonly ref?: Ref<HTMLDivElement>
	// Position and width of the panel.
	readonly placement: PanelPlacement
	// Warnings of the active connection.
	readonly warnings: readonly StatusWarning[]
	// Closes the panel.
	readonly onClose: () => void
}

// Panel of the details.
function StatusDetailsPanel({ ref, placement, warnings, onClose }: StatusDetailsPanelProps) {
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
		<div ref={ref} tabIndex={-1} style={panelStyle(placement)} className="fixed z-30 box-border flex flex-col gap-3 overflow-y-auto rounded-md border border-line-100 bg-base-200 p-3 text-xs whitespace-normal text-ink-200 shadow-[0_12px_32px_rgb(0_0_0/0.45)] outline-none">
			{link !== 'online' && <p className="m-0 rounded-sm border border-danger px-2 py-1 text-danger">{link === 'offline' ? 'Server offline: showing the last known state.' : 'Connecting to the server.'}</p>}
			<Section title="Connection">
				<Row label="Server">{serverLinkLabel(link)}</Row>
				<Row label="Equipment">{connectionLabel(connection?.name, status)}</Row>
			</Section>
			<EquipmentSection devices={devices} online={status === 'connected'} onNavigate={onClose} sessions={{ capture, guiding: session }} />
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
							<span className={TONE_CLASSES.active}>{captureStatus(capture)}</span> · {captureCount(capture)}
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
							<span className={BAR_BADGE_TEXT[meridianFlipHeadline(monitor)[1]]}>{meridianFlipStatusText(monitor, now)}</span>
						</Row>
					)}
					{listeners && (
						<Row label="Remote control" actions={<OpenButton label="Open tool" onClick={openRemoteControl} />}>
							Serving · {listeners}
						</Row>
					)}
				</Section>
			)}
			<Section title="Operations" aside={others.length > 0 ? `${others.length} running` : undefined}>
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
			{warnings.length > 0 && (
				<Section title="Warnings">
					{warnings.map((warning) => (
						<WarningRow key={warning.id} warning={warning} devices={devices.devices} onNavigate={onClose} />
					))}
				</Section>
			)}
			<AstronomicalTimeSection onNavigate={onClose} />
			<LinkButton
				className="self-start"
				onClick={() => {
					navigate(routeState, { workspace: 'settings', section: 'status-bar' })
					onClose()
				}}
			>
				Status Bar Settings
			</LinkButton>
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
				Astronomical Time Converter
			</button>
		</Section>
	)
}

interface EquipmentSectionProps {
	// Devices of the watched connection, with their connect state.
	readonly devices: DeviceView
	// Whether the profile's server connection is open, so its devices are known and can be connected.
	readonly online: boolean
	// Called after a device or the Equipment Setup was opened.
	readonly onNavigate: () => void
	// Running sessions of the main and guide cameras, read by their rows.
	readonly sessions: ChipSessions
}

// Roles of the active profile's Equipment Setup: how many of its devices are connected, a row per assigned role in the
// order of its group, the roles with no device on one line, then Connect all while an assigned device on the open
// connection is not connected, and the way to the Equipment Setup. Connecting never closes the panel, and nothing here
// disconnects a device.
function EquipmentSection({ devices, online, onNavigate, sessions }: EquipmentSectionProps) {
	const profiles = useSnapshot(profileState)
	const control = useSnapshot(controlRuntime)
	const setup = activeSetup(activeProfile(profiles))
	const assigned = ROLES.filter(({ role }) => setup[role] !== undefined)
	const unassigned = ROLES.filter(({ role }) => setup[role] === undefined)
	const known = online && !devices.loading
	const connected = assigned.filter(({ role }) => roleStatus(setup, role, devices) === 'connected').length
	const connectable = known ? assigned.flatMap(({ role }) => roleDevice(setup, role, devices) ?? []).filter((device) => !device.connected && !devices.pending[device.id]) : []
	const summary = assigned.length === 0 ? undefined : !online ? 'Offline' : devices.loading ? 'Loading devices' : `${connected} of ${assigned.length} connected`

	// Opens the Equipment Setup of the profile.
	function openSetup() {
		deviceState.open = true
		onNavigate()
	}

	return (
		<Section title="Equipment" aside={summary}>
			{assigned.length === 0 ? (
				<p className="m-0 text-ink-300">No device is assigned to this profile.</p>
			) : (
				<div className="flex flex-col gap-2">
					{ROLE_GROUPS.map(({ group }) => {
						const roles = assigned.filter((definition) => definition.group === group)
						if (roles.length === 0) return null

						return (
							<ul key={group} className="m-0 flex list-none flex-col p-0">
								{roles.map(({ role, label }) => {
									const status = roleStatus(setup, role, devices)
									if (status === 'notSelected') return null
									const device = roleDevice(setup, role, devices)
									const detail: RoleDetail = !online ? OFFLINE_DETAIL : devices.loading ? LOADING_DETAIL : roleDetail(role, status, device, control, sessions)
									const canConnect = known && device !== undefined && !device.connected && !devices.pending[device.id]

									return <EquipmentRow key={role} role={role} label={label} device={device} name={setup[role]?.name || 'Unavailable device'} detail={detail} canConnect={canConnect} onNavigate={onNavigate} />
								})}
							</ul>
						)
					})}
				</div>
			)}
			{unassigned.length > 0 && assigned.length > 0 && <p className="m-0 text-ink-300">Not assigned: {unassigned.map(({ label }) => label).join(', ')}</p>}
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
				{connectable.length > 0 && (
					<LinkButton title={connectable.length === 1 ? `Connect ${connectable[0]?.name}` : `Connect the ${connectable.length} disconnected devices`} onClick={() => void switchSetup(deviceState, setup, true)}>
						Connect all
					</LinkButton>
				)}
				<LinkButton onClick={openSetup}>Equipment Setup</LinkButton>
			</div>
		</Section>
	)
}

// Row of a role while the profile's server connection is closed, so its device is not known.
const OFFLINE_DETAIL: RoleDetail = { state: { text: 'Offline', tone: 'muted' }, details: '' }

// Row of a role while the device list of the connection is being fetched.
const LOADING_DETAIL: RoleDetail = { state: { text: 'Loading', tone: 'muted' }, details: '' }

interface EquipmentRowProps {
	// Role of the row.
	readonly role: EquipmentRole
	// Name of the role.
	readonly label: string
	// Assigned device, when present on the connection.
	readonly device?: DeviceSummary
	// Name of the assigned device, shown without a device to open.
	readonly name: string
	// State and readings of the device.
	readonly detail: RoleDetail
	// Whether the device can be connected from the row: on the open connection, not connected, and with no request pending.
	readonly canConnect: boolean
	// Called after the device was opened.
	readonly onNavigate: () => void
}

// One role on two lines: its icon, name, and the state of its device in words, then the device, which opens it in
// Equipment Control, and its readings, or its Connect while it is not connected.
function EquipmentRow({ role, label, device, name, detail, canConnect, onNavigate }: EquipmentRowProps) {
	return (
		<li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 py-1">
			<Icon name={role === 'GUIDE_OUTPUT' ? 'guideOutput' : CHIP_ICONS[role]} className="size-3.5 text-ink-300" />
			<span className="min-w-0 truncate text-sm leading-5 text-ink-100">{label}</span>
			<span className={cn('text-right text-sm leading-5 tabular-nums', TONE_CLASSES[detail.state.tone])}>{detail.state.text}</span>
			<span className="col-start-2 col-end-4 flex min-w-0 flex-wrap items-baseline gap-x-3 text-xs leading-4">
				<span className="min-w-0 truncate text-ink-300">
					<DeviceLink device={device} fallback={name} className="text-ink-300 hover:text-ink-100" onNavigate={onNavigate} />
				</span>
				{canConnect && device ? (
					<LinkButton className="ml-auto text-ink-200 hover:text-accent" title={`Connect ${device.name}`} onClick={() => void switchDevice(deviceState, device.id, true)}>
						Connect
					</LinkButton>
				) : (
					detail.details && <span className="ml-auto text-right text-ink-200 tabular-nums">{detail.details}</span>
				)}
			</span>
		</li>
	)
}

interface WarningRowProps {
	// Warning of the row.
	readonly warning: StatusWarning
	// Devices of the watched connection, among which its device is opened.
	readonly devices: readonly DeviceSummary[]
	// Called after its device was opened.
	readonly onNavigate: () => void
}

// One warning on two lines: what it concerns in the warning tone, then what is wrong in words, with the link to its device
// in Equipment Control, where it is fixed.
function WarningRow({ warning, devices, onNavigate }: WarningRowProps) {
	const device = devices.find((candidate) => candidate.id === warning.device.id && candidate.connectionId === warning.device.connectionId)

	return (
		<div className="flex flex-col gap-0.5 py-1">
			<div className="flex items-baseline justify-between gap-3">
				<span className="flex items-center gap-1.5 text-sm leading-5 text-warning">
					<Icon name="warning" className="size-3.5" />
					{warning.label}
				</span>
				<DeviceLink device={device} fallback={warning.device.name} className="text-xs text-ink-200 hover:text-ink-100" onNavigate={onNavigate} />
			</div>
			<p className="m-0 text-xs leading-4 text-ink-200">{warning.message}.</p>
		</div>
	)
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
	// Summary of the section at the end of its heading, such as how many devices are connected; absent for none.
	readonly aside?: string
	// Rows of the section.
	readonly children: ReactNode
}

// Titled group of rows.
function Section({ title, aside, children }: SectionProps) {
	return (
		<section className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between gap-3">
				<SectionHeading>{title}</SectionHeading>
				{aside && <span className="text-xs leading-4 text-ink-300 tabular-nums">{aside}</span>}
			</div>
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
