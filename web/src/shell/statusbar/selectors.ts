import type { CameraCapabilities, CapturePhase, CaptureSession, CoverState, DeviceSummary, DomeState, FlatPanelState, FocuserState, GuidingSessionSummary, MountState, OperationKind, OperationProgress, OperationRecord, RotatorState, WheelState } from 'api'
import { formatDEC, formatRA, normalizeAngle, toDeg } from 'nebulosa/src/math/units/angle'
import type { AutoFocusRuntime } from '../../camera/autofocus'
import { type CaptureRuntime, cameraKey, captureRunning, frameProgress } from '../../camera/capture'
import type { DarvRuntime } from '../../camera/darv'
import type { FlatWizardRuntime } from '../../camera/flatwizard'
import { GUIDING_STATE_LABELS, type GuidingRuntime, guidingRunning } from '../../camera/guiding'
import type { TargetCenteringRuntime } from '../../camera/targetcentering'
import type { TppaRuntime } from '../../camera/tppa'
import type { SelectedConnectionStatus } from '../../connection/useSelectedConnection'
import { type ControlRuntime, watchedDeviceState } from '../../equipment-control/control'
import { ROLE_STATUS_LABELS, type RoleStatus } from '../../equipment/equipment'
import type { EquipmentRole } from '../../equipment/roles'
import type { MountPointingRuntime } from '../../mountpointing/mountpointing'
import type { ServerLink } from '../../notifications/notifications'
import { OPERATION_LABELS } from '../../operations'
import { DEFAULT_STATUS_CHIPS, type StatusChipField, type StatusChipRole } from '../../profile/schema'
import type { IconName } from '../../ui/Icon'

// Pure view-model selectors of the status bar. Every selector is scoped to the active profile's open server
// connection by exact connection and device ids, so the status bar never shows or commands what belongs to
// another connection, and takes plain data (stores or their snapshots) so it can be tested without React.

// Mount operations that move the mount physically, stopped by the mount stop of the server, which cancels every
// operation holding the mount before stopping its axes, so it ends each of these, nudges and remote-control motions
// included. TPPA and DARV sessions also hold the mount, but they are not motions: each has an interruption of its own.
export const MOUNT_MOTIONS: ReadonlySet<OperationKind> = new Set<OperationKind>(['mount.slew', 'mount.goto', 'mount.flip', 'mount.park', 'mount.unpark', 'mount.home', 'mount.findHome', 'mount.nudge', 'mount.remoteMove'])

// Motion and capability fields of a mount state the Abort depends on.
export type MountMotionState = Pick<MountState, 'connected' | 'canAbort' | 'slewing' | 'moving' | 'parking' | 'homing'>

// Device identity the status bar matches operations and states against.
export type ScopedDevice = Pick<DeviceSummary, 'id' | 'connectionId' | 'name'>

// Returns the running operations holding at least one device of the server connection, in start order (Unix
// milliseconds, then operation id); empty without a server connection. Operations without devices are never
// included, since nothing scopes them to a connection.
export function scopedRunningOperations(operations: Readonly<Record<string, OperationRecord>>, serverId: string | undefined): OperationRecord[] {
	if (serverId === undefined) return []

	return Object.values(operations)
		.filter((operation) => operation.state === 'running' && operation.devices.some((device) => device.connectionId === serverId))
		.sort((a, b) => a.startedAt - b.startedAt || (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0))
}

// Returns whether a mount is moving: a running motion of MOUNT_MOTIONS holds that exact device, or its driver
// reports a goto or flip, a manual axis motion, parking, or homing, which covers motions started outside the
// application, such as from a hand controller.
export function mountMoving(state: MountMotionState | undefined, operations: readonly OperationRecord[], mount: ScopedDevice): boolean {
	return (state !== undefined && (state.slewing || state.moving || state.parking || state.homing)) || mountMotionRunning(operations, mount)
}

// Returns whether a running motion of MOUNT_MOTIONS holds that exact mount.
export function mountMotionRunning(operations: readonly OperationRecord[], mount: ScopedDevice): boolean {
	return operations.some((operation) => operation.state === 'running' && MOUNT_MOTIONS.has(operation.kind) && operation.devices.some((device) => device.connectionId === mount.connectionId && device.deviceId === mount.id))
}

// Inputs that decide whether the profile's mount can be aborted.
export interface MountAbortInput {
	// State of the event socket of the tab; absent before it first opened.
	readonly link: ServerLink | undefined
	// Id of the active profile's open server connection.
	readonly serverId: string | undefined
	// Id of the server connection the control store mirrors.
	readonly watched: string | undefined
	// Device assigned to the profile's MOUNT role on the watched connection.
	readonly mount: ScopedDevice | undefined
	// Control state of that mount, read only while the control store mirrors its connection.
	readonly state: MountMotionState | undefined
	// Running operations of the server connection.
	readonly operations: readonly OperationRecord[]
}

// Mount the status bar may abort.
export interface MountAbortTarget {
	// Exact id of the mount on the watched connection.
	readonly deviceId: string
	// Driver-reported name of the mount.
	readonly name: string
}

// Returns the mount the status bar may abort, or undefined unless every condition holds: the event socket is
// online (a closed socket means the state may be stale), the mount belongs to the active server connection and
// the control store mirrors that same connection, the driver reports it connected and able to abort, and it
// is moving.
export function mountAbortTarget({ link, serverId, watched, mount, state, operations }: MountAbortInput): MountAbortTarget | undefined {
	if (link !== 'online' || !mount || serverId === undefined || mount.connectionId !== serverId || watched !== serverId) return undefined
	if (!state?.connected || !state.canAbort || !mountMoving(state, operations, mount)) return undefined
	return { deviceId: mount.id, name: mount.name }
}

// Failure of a device of the active connection, as listed by the status bar.
export interface DeviceError {
	// Exact id of the device.
	readonly deviceId: string
	// Driver-reported name of the device.
	readonly name: string
	// Message of the failure.
	readonly message: string
}

// Inputs of the device errors of the active connection.
export interface DeviceErrorsInput {
	// Id of the active profile's open server connection.
	readonly serverId: string | undefined
	// Id of the server connection the device store tracks, its devices, and their connect failures by device id.
	readonly devices: { readonly watched?: string; readonly devices: readonly ScopedDevice[]; readonly errors: Readonly<Record<string, string>> }
	// Id of the server connection the control store mirrors and its command failures by device id.
	readonly control: { readonly watched?: string; readonly errors: Readonly<Record<string, string>> }
}

// Returns the failures of the devices of the active server connection, in device list order: connect and
// driver failures of the device store, and refused or failed commands of the control store, each only while
// its store tracks that connection. A device with both shows the command failure, the more recent one.
export function scopedDeviceErrors({ serverId, devices, control }: DeviceErrorsInput): DeviceError[] {
	if (serverId === undefined || devices.watched !== serverId) return []

	const commands = control.watched === serverId ? control.errors : {}
	const errors: DeviceError[] = []

	for (const device of devices.devices) {
		if (device.connectionId !== serverId) continue
		const message = commands[device.id] ?? devices.errors[device.id]
		if (message) errors.push({ deviceId: device.id, name: device.name, message })
	}

	return errors
}

// Severity of a status value, mapped to a text color by the status bar; the text always states the value too.
export type StatusTone = 'muted' | 'idle' | 'active' | 'ok' | 'error'

// Value of a status bar item: its text and severity.
export interface StatusValue {
	// Text of the value, such as "Tracking" or "-10.2°C".
	readonly text: string
	// Severity of the value.
	readonly tone: StatusTone
}

// Severity of each role status.
const ROLE_STATUS_TONES: Readonly<Record<RoleStatus, StatusTone>> = {
	notSelected: 'muted',
	unavailable: 'muted',
	disconnected: 'idle',
	connecting: 'active',
	connected: 'ok',
	disconnecting: 'active',
	error: 'error',
}

// Returns the status of a role as a value: its label and the severity of its status.
export function roleValue(status: RoleStatus): StatusValue {
	return { text: ROLE_STATUS_LABELS[status], tone: ROLE_STATUS_TONES[status] }
}

// Returns the state of the event socket as text: online once open, reconnecting after it closed, and connecting
// before it first opened.
export function serverLinkLabel(link: ServerLink | undefined) {
	return link === 'online' ? 'Server online' : link === 'offline' ? 'Reconnecting' : 'Connecting'
}

// Returns the state of the active profile's selected connection as text, such as "Observatory · Connected".
export function connectionLabel(name: string | undefined, status: SelectedConnectionStatus) {
	if (name === undefined) return 'No connection'
	return `${name} · ${status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Disconnected'}`
}

// Returns the running capture session of a camera, or undefined without a camera or while its latest session ended.
export function activeCapture(sessions: Readonly<Record<string, CaptureSession>>, camera: ScopedDevice | undefined): CaptureSession | undefined {
	const session = camera && sessions[cameraKey(camera.connectionId, camera.id)]
	return captureRunning(session) ? session : undefined
}

// Returns the completed part of a running capture in whole percent, [0, 100]: of the frames requested, counting the
// frame in flight by the progress of its exposure, or, for a loop, of the exposure of the current frame, undefined
// between frames or before the driver reported any progress.
export function capturePercent(session: Pick<CaptureSession, 'phase' | 'captured' | 'count' | 'exposure'>): number | undefined {
	const fraction = session.phase === 'exposing' ? frameProgress(session.exposure)?.fraction : undefined
	if (session.count === undefined) return fraction === undefined ? undefined : Math.floor(fraction * 100)
	const inFlight = session.phase === 'reading' ? 1 : (fraction ?? 0)
	return session.count > 0 ? Math.min(100, Math.floor(((session.captured + inFlight) / session.count) * 100)) : undefined
}

// Returns the value of a running capture: "Stopping" once a stop was requested, otherwise the frames taken out of
// those requested and the completed percentage, such as "12/50 · 24%", or the frames taken so far for a loop, which
// has no total.
export function captureValue(session: Pick<CaptureSession, 'phase' | 'stopping' | 'captured' | 'count' | 'exposure'>): StatusValue {
	if (session.stopping) return { text: 'Stopping', tone: 'active' }
	const frames = session.count === undefined ? String(session.captured) : `${session.captured}/${session.count}`
	const percent = capturePercent(session)
	return { text: percent === undefined ? frames : `${frames} · ${percent}%`, tone: 'active' }
}

// Returns the running guiding session of a guide camera, or undefined without a camera or while its latest session
// ended.
export function activeGuiding(sessions: Readonly<Record<string, GuidingSessionSummary>>, camera: ScopedDevice | undefined): GuidingSessionSummary | undefined {
	const session = camera && sessions[cameraKey(camera.connectionId, camera.id)]
	return guidingRunning(session) ? session : undefined
}

// Returns the value of a running guiding session. While guiding it shows a dither or a settle in progress, or the
// total RMS of the latest guide steps: in arcseconds (RMS in guide pixels times the pixel scale in arcseconds per
// pixel) when the scale is known, otherwise in guide pixels; with no measured step yet it shows "Guiding". In any
// other state it shows the guider state alone, never an RMS left from an earlier guiding period.
export function guidingValue(session: Pick<GuidingSessionSummary, 'state' | 'settling' | 'dithering' | 'rms' | 'pixelScale'>): StatusValue {
	const { state, rms, pixelScale } = session

	if (state === 'guiding') {
		if (session.dithering) return { text: 'Dithering', tone: 'active' }
		if (session.settling) return { text: 'Settling', tone: 'active' }
		if (!rms || !(rms.samples > 0) || !Number.isFinite(rms.total)) return { text: GUIDING_STATE_LABELS.guiding, tone: 'ok' }
		const text = pixelScale !== undefined && Number.isFinite(pixelScale) && pixelScale > 0 ? `RMS ${(rms.total * pixelScale).toFixed(2)}″` : `RMS ${rms.total.toFixed(2)} px`
		return { text, tone: 'ok' }
	}

	return { text: GUIDING_STATE_LABELS[state], tone: state === 'lostLock' ? 'error' : 'active' }
}

// Returns the ids of the operations a capture and a guiding session hold: the capture's camera.capture, and the
// guiding session's camera.guiding and, while it guides, guideOutput.guiding. They are shown through their session.
export function sessionOperationIds(capture: Pick<CaptureSession, 'operationId'> | undefined, guiding: Pick<GuidingSessionSummary, 'operationId' | 'runOperationId'> | undefined): Set<string> {
	const ids = new Set<string>()
	if (capture?.operationId) ids.add(capture.operationId)
	if (guiding?.operationId) ids.add(guiding.operationId)
	if (guiding?.runOperationId) ids.add(guiding.runOperationId)
	return ids
}

// Returns the operations not shown through a session, by exact operation id, in their order.
export function otherOperations(operations: readonly OperationRecord[], sessionIds: ReadonlySet<string>): OperationRecord[] {
	return operations.filter((operation) => !sessionIds.has(operation.operationId))
}

// Roles with a device chip in the status bar, in display order: imaging, then telescope, then observatory.
export const CHIP_ROLES = ['MAIN_CAMERA', 'FILTER_WHEEL', 'FOCUSER', 'ROTATOR', 'MOUNT', 'GUIDE_CAMERA', 'DOME', 'COVER', 'FLAT_PANEL'] as const satisfies readonly StatusChipRole[]

// Role with a device chip in the status bar.
export type ChipRole = (typeof CHIP_ROLES)[number]

// Reading of a device chip: a short value after its icon, and whether the device moves.
export interface ChipValue {
	// Short value, such as "Slewing", "Moving 50000", or "Open"; empty for the icon alone.
	readonly text: string
	// Severity of the value.
	readonly tone: StatusTone
	// Whether the device is moving: slewing, homing, parking, a manual motion, a filter change, or a cover or shutter
	// opening or closing. Such a chip is the last one left out of a narrow bar.
	readonly moving: boolean
	// Full reading, shown as the chip's title and in the details panel, such as "Slewing" or "Position 50000 steps".
	readonly title: string
}

// Readings of a chip by field; a reading the device does not have right now is absent.
type ChipReadings = Partial<Record<StatusChipField, string>>

// Returns the short value of a chip: the readings of the fields chosen that the device has, in the order of the fields.
function chipText(readings: ChipReadings, fields: readonly StatusChipField[]) {
	return fields.flatMap((field) => readings[field] ?? []).join(' ')
}

// Returns a sensor temperature in degrees Celsius rounded to 0.1 °C, such as "-10.2°C", or undefined when the driver
// reports none or a non-finite one. Rounding to -0 reads 0.0.
function temperatureText(temperature: number | undefined) {
	return temperature !== undefined && Number.isFinite(temperature) ? `${(Math.round(temperature * 10) / 10).toFixed(1)}°C` : undefined
}

// Status of a camera in each phase of a capture that is running.
const CAPTURE_PHASE_STATUS: Readonly<Partial<Record<CapturePhase, string>>> = { starting: 'Starting', exposing: 'Exposing', reading: 'Reading', saving: 'Saving', waiting: 'Waiting' }

// Returns the reading of a main camera: what it is doing, from its running capture or, for any other tool, from the
// exposure its driver reports, its sensor temperature when the driver reports a finite one, and its cooler power in
// percent when it has a cooler.
export function cameraChip(state: Partial<Pick<CameraCapabilities, 'temperature' | 'exposing' | 'cooler'>> | undefined, capture?: Pick<CaptureSession, 'phase'>, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.MAIN_CAMERA.fields): ChipValue {
	const status = capture ? CAPTURE_PHASE_STATUS[capture.phase] : state?.exposing ? 'Exposing' : undefined
	const temperature = temperatureText(state?.temperature)
	const cooler = state?.cooler && Number.isFinite(state.cooler.power) ? `${Math.round(state.cooler.power)}%` : undefined
	const title = [status, temperature && `Sensor ${temperature}`, cooler && `Cooler ${cooler}`].filter(Boolean).join(' · ') || 'Connected'
	return { text: chipText({ status, temperature, cooler }, fields), tone: status ? 'active' : 'ok', moving: false, title }
}

// Returns the reading of a mount: its motion (parking, homing, a goto or flip, a manual axis motion, in that precedence),
// otherwise parked, then tracking, then idle, and its reported equatorial coordinates of date.
export function mountChip(state: (Pick<MountState, 'parking' | 'homing' | 'slewing' | 'moving' | 'parked' | 'tracking'> & Partial<Pick<MountState, 'rightAscension' | 'declination'>>) | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.MOUNT.fields): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const motion = state.parking ? 'Parking' : state.homing ? 'Homing' : state.slewing ? 'Slewing' : state.moving ? 'Moving' : undefined
	const status = motion ?? (state.parked ? 'Parked' : state.tracking ? 'Tracking' : 'Idle')
	const coordinates = state.rightAscension !== undefined && state.declination !== undefined ? `${formatRA(normalizeAngle(state.rightAscension), false)} ${formatDEC(state.declination, false)}` : undefined
	return { text: chipText({ status, coordinates }, fields), tone: motion ? 'active' : status === 'Tracking' ? 'ok' : 'idle', moving: !!motion, title: coordinates ? `${status} · ${coordinates}` : status }
}

// Returns the reading of a focuser: "Moving" while it moves, its position in steps, and its temperature.
export function focuserChip(state: Pick<FocuserState, 'moving' | 'position' | 'temperature'> | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.FOCUSER.fields): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const temperature = temperatureText(state.temperature)
	const title = `${state.moving ? 'Moving · ' : ''}Position ${state.position.value} steps${temperature ? ` · ${temperature}` : ''}`
	return { text: chipText({ status: state.moving ? 'Moving' : undefined, position: String(state.position.value), temperature }, fields), tone: state.moving ? 'active' : 'ok', moving: state.moving, title }
}

// Returns the reading of a filter wheel: "Changing" while it changes filter, otherwise the name of the filter at its
// 0-based slot, or the 1-based slot number when the driver names none.
export function wheelChip(state: Pick<WheelState, 'moving' | 'position' | 'names'> | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.FILTER_WHEEL.fields): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	if (state.moving) return { text: chipText({ status: 'Changing' }, fields), tone: 'active', moving: true, title: 'Changing filter' }
	const slot = `#${state.position + 1}`
	const name = state.names[state.position]
	return { text: chipText({ filter: name || slot }, fields), tone: 'ok', moving: false, title: name ? `${slot} · ${name}` : slot }
}

// Returns the reading of a rotator: "Moving" while it moves, and its mechanical angle in degrees (not a sky position
// angle).
export function rotatorChip(state: Pick<RotatorState, 'moving' | 'angle'> | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.ROTATOR.fields): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const angle = `${state.angle.value.toFixed(1)}°`
	return { text: chipText({ status: state.moving ? 'Moving' : undefined, angle }, fields), tone: state.moving ? 'active' : 'ok', moving: state.moving, title: `${state.moving ? 'Moving · ' : ''}Mechanical angle ${angle}` }
}

// Returns the reading of a dust cover: closed (parked), open, or moving.
export function coverChip(state: Pick<CoverState, 'parked' | 'parking'> | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.COVER.fields): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	if (state.parking) return { text: chipText({ status: 'Moving' }, fields), tone: 'active', moving: true, title: 'Moving' }
	const status = state.parked ? 'Closed' : 'Open'
	return { text: chipText({ status }, fields), tone: state.parked ? 'idle' : 'ok', moving: false, title: status }
}

// Returns the reading of a flat panel: its light on or off, and, while on, its brightness in the driver's units.
export function flatPanelChip(state: Pick<FlatPanelState, 'enabled' | 'intensity'> | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.FLAT_PANEL.fields): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const brightness = state.enabled ? String(state.intensity.value) : undefined
	return { text: chipText({ status: state.enabled ? 'On' : 'Off', brightness }, fields), tone: state.enabled ? 'ok' : 'idle', moving: false, title: brightness ? `On · brightness ${brightness}` : 'Off' }
}

// Text of each shutter state of a dome; an unknown one shows nothing.
const SHUTTER_TEXT: Readonly<Partial<Record<DomeState['shutterState'], string>>> = { OPEN: 'Open', CLOSED: 'Closed', OPENING: 'Opening', CLOSING: 'Closing', ERROR: 'Error' }

// Returns the reading of a dome: what its rotation is doing, when it is doing something, its shutter, when it has one,
// and its azimuth in degrees.
export function domeChip(state: Pick<DomeState, 'slewing' | 'moving' | 'homing' | 'parking' | 'parked' | 'hasShutter' | 'shutterState' | 'azimuth'> | undefined, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.DOME.fields): ChipValue {
	if (!state) return { text: '--', tone: 'muted', moving: false, title: 'State not reported' }
	const shutterMoving = state.hasShutter && (state.shutterState === 'OPENING' || state.shutterState === 'CLOSING')
	const azimuth = `${toDeg(state.azimuth.value).toFixed(1)}°`
	const status = state.parking ? 'Parking' : state.homing ? 'Homing' : state.slewing || state.moving ? 'Moving' : state.parked ? 'Parked' : undefined
	const moving = shutterMoving || state.parking || state.homing || state.slewing || state.moving
	const shutter = state.hasShutter ? ` · shutter ${state.shutterState.toLowerCase()}` : ''
	const tone: StatusTone = state.hasShutter && state.shutterState === 'ERROR' ? 'error' : moving ? 'active' : state.shutterState === 'CLOSED' ? 'idle' : 'ok'
	return { text: chipText({ status, shutter: state.hasShutter ? SHUTTER_TEXT[state.shutterState] : undefined, azimuth }, fields), tone, moving, title: `${status ?? `Azimuth ${azimuth}`}${shutter}` }
}

// Returns the reading of a guide camera: its running session (see guidingValue), or "--" while it does not guide, and
// its sensor temperature when the driver reports a finite one.
export function guideChip(session: GuidingSessionSummary | undefined, state?: Pick<CameraCapabilities, 'temperature'>, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS.GUIDE_CAMERA.fields): ChipValue {
	const temperature = temperatureText(state?.temperature)
	if (!session) return { text: chipText({ status: '--', temperature }, fields), tone: 'idle', moving: false, title: 'Not guiding' }
	const value = guidingValue(session)
	const label = GUIDING_STATE_LABELS[session.state]
	return { text: chipText({ status: value.text, temperature }, fields), tone: value.tone, moving: false, title: value.text === label ? label : `${label} · ${value.text}` }
}

// Sessions that read through a device chip.
export interface ChipSessions {
	// Running guiding session of the guide camera.
	readonly guiding?: GuidingSessionSummary
	// Running capture of the main camera.
	readonly capture?: CaptureSession
}

// Returns the reading of the device of a role, from the control state of the watched connection, or undefined, so the
// bar shows no chip, while no device is assigned or present or its driver does not report it connected. fields are the
// readings shown.
export function roleChip(role: ChipRole, device: Pick<DeviceSummary, 'id' | 'connectionId' | 'connected'> | undefined, control: Pick<ControlRuntime, 'watched' | 'states'>, sessions: ChipSessions = {}, fields: readonly StatusChipField[] = DEFAULT_STATUS_CHIPS[role].fields): ChipValue | undefined {
	if (!device?.connected) return undefined

	switch (role) {
		case 'MAIN_CAMERA':
			return cameraChip(watchedDeviceState(control, 'camera', device), sessions.capture, fields)
		case 'GUIDE_CAMERA':
			return guideChip(sessions.guiding, watchedDeviceState(control, 'camera', device), fields)
		case 'MOUNT':
			return mountChip(watchedDeviceState(control, 'mount', device), fields)
		case 'FOCUSER':
			return focuserChip(watchedDeviceState(control, 'focuser', device), fields)
		case 'FILTER_WHEEL':
			return wheelChip(watchedDeviceState(control, 'wheel', device), fields)
		case 'ROTATOR':
			return rotatorChip(watchedDeviceState(control, 'rotator', device), fields)
		case 'DOME':
			return domeChip(watchedDeviceState(control, 'dome', device), fields)
		case 'COVER':
			return coverChip(watchedDeviceState(control, 'cover', device), fields)
		case 'FLAT_PANEL':
			return flatPanelChip(watchedDeviceState(control, 'flatPanel', device), fields)
	}
}

// Chip of the status bar as the fitting sees it.
export interface BarItem {
	// Id of the chip: a role.
	readonly id: string
	// Whether its device is moving.
	readonly moving: boolean
	// Whether it shows a running session.
	readonly active: boolean
	// Width of the chip as rendered, in CSS pixels.
	readonly width: number
}

// Operation of the status bar as the fitting sees it.
export interface FittedOperation {
	// Id of the operation.
	readonly id: string
	// Width of the operation as rendered, in CSS pixels.
	readonly width: number
}

// Operations the status bar shows.
export interface FittedOperations {
	// Ids of the operations shown in the bar.
	readonly visible: ReadonlySet<string>
	// Room they take, gaps included, in CSS pixels.
	readonly width: number
}

// Returns the operations that fit in the room of the bar, in order, before any chip, since each one carries its Abort;
// one that does not fit is skipped, so a narrower one after it may still fit. The first one is always shown, and the
// details panel lists the others. The room and the widths are in CSS pixels.
export function fitOperations(operations: readonly FittedOperation[], room: number, gap: number): FittedOperations {
	const visible = new Set<string>()
	let width = 0

	for (const operation of operations) {
		const cost = operation.width + gap
		if (visible.size > 0 && width + cost > room) continue
		visible.add(operation.id)
		width += cost
	}

	return { visible, width }
}

// Chips the status bar shows and what it leaves to the details panel.
export interface FittedItems {
	// Ids of the chips shown in the bar.
	readonly visible: ReadonlySet<string>
	// Chips and operations left out.
	readonly hidden: number
}

// Returns the chips that fit in the room the operations left, by priority: moving devices, then running sessions, then
// the others, each group in display order; a chip that does not fit is skipped, so a narrower one after it may still fit.
// The room and the widths are in CSS pixels, and each chip after the first costs the gap between items too.
export function fitItems(items: readonly BarItem[], room: number, gap: number, hiddenOperations: number): FittedItems {
	const priority = [...items.filter((item) => item.moving), ...items.filter((item) => !item.moving && item.active), ...items.filter((item) => !item.moving && !item.active)]
	const visible = new Set<string>()
	let left = room

	for (const item of priority) {
		const cost = item.width + gap
		if (cost > left) continue
		visible.add(item.id)
		left -= cost
	}

	return { visible, hidden: items.length - visible.size + hiddenOperations }
}

// Reading of the clock as the fitting sees it.
export interface BarClock {
	// Id of the reading.
	readonly id: string
	// Width of the reading as rendered, in CSS pixels.
	readonly width: number
}

// Returns the readings of the clock that fit, in order, a later one only if the one before it fit. The clock is opportunistic:
// it takes no room fitItems gave out, so it is shown only when nothing else is left out, in the room left after the operations
// and every chip. Never counted on the details button, which always lists it. Widths and room are in CSS pixels, as for fitItems.
export function fitClocks(clocks: readonly BarClock[], items: readonly BarItem[], { hidden }: Pick<FittedItems, 'hidden'>, room: number, gap: number): Set<string> {
	const shown = new Set<string>()
	if (hidden > 0) return shown

	let left = room - items.reduce((sum, item) => sum + item.width + gap, 0)

	for (const clock of clocks) {
		const cost = clock.width + gap
		if (cost > left) break
		shown.add(clock.id)
		left -= cost
	}

	return shown
}

// Returns the value of a role's device for the details panel: the role status while it is not connected, otherwise
// the full reading of its chip (see roleChip), in the active tone while it moves.
export function roleDetailValue(role: EquipmentRole, status: RoleStatus, device: Pick<DeviceSummary, 'id' | 'connectionId' | 'connected'> | undefined, control: Pick<ControlRuntime, 'watched' | 'states'>, sessions?: ChipSessions): StatusValue {
	const chip = status === 'connected' && role !== 'GUIDE_OUTPUT' ? roleChip(role, device, control, sessions) : undefined
	return chip ? { text: chip.title, tone: chip.moving ? 'active' : chip.tone } : roleValue(status)
}

// Returns the time an operation has run, from its start in Unix milliseconds to now in Unix milliseconds, as
// "m:ss" or, from one hour, "h:mm:ss"; a start after now (clocks of the server and the browser differ) reads 0:00.
export function formatElapsed(startedAt: number, now: number) {
	const total = Math.max(0, Math.floor((now - startedAt) / 1000))
	const hours = Math.floor(total / 3600)
	const minutes = Math.floor(total / 60) % 60
	const seconds = String(total % 60).padStart(2, '0')
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

// Returns the progress an operation reports, such as "2/5 · Moving to 1100", or undefined while it reports none.
export function progressText(progress: OperationProgress | undefined) {
	if (!progress || !(progress.steps >= 1)) return undefined
	return progress.message ? `${progress.step}/${progress.steps} · ${progress.message}` : `${progress.step}/${progress.steps}`
}

// Running operation of the status bar.
export interface BarOperation {
	// Id of the operation, or MOUNT_MOTION_ID for a motion of the mount no operation holds.
	readonly id: string
	// Icon of the operation.
	readonly icon: IconName
	// Name of the operation, such as "Slew" or "Capture".
	readonly label: string
	// Short progress, such as "12/50 · 24%" or "2/5"; absent while it reports none.
	readonly detail?: string
	// Full description, shown as its title, such as "Move · 2/5 · Moving to 1100".
	readonly title: string
	// Whether the operation can be interrupted from the bar.
	readonly abortable: boolean
}

// Id of the bar operation standing for a motion of the mount that no operation holds, such as one from a hand controller.
export const MOUNT_MOTION_ID = 'mount-motion'

// Sessions that give the operations of the bar a better progress than the operation itself reports.
export interface BarOperationSessions {
	// Latest capture session of each camera.
	readonly captures: Readonly<Record<string, CaptureSession>>
	// Latest guiding session of each camera.
	readonly guiding: Readonly<Record<string, GuidingSessionSummary>>
}

// Returns the running operations as the bar shows them, those it can interrupt first, each group in start order. A
// guiding session counts once: its guideOutput.guiding is part of its camera.guiding, which interrupts both.
export function barOperations(operations: readonly OperationRecord[], { captures, guiding }: BarOperationSessions, abortable: (operation: OperationRecord) => boolean): BarOperation[] {
	const runs = new Set(Object.values(guiding).map((session) => session.runOperationId))
	const shown: BarOperation[] = []

	for (const operation of operations) {
		if (runs.has(operation.operationId)) continue

		const [icon, label] = OPERATION_LABELS[operation.kind]
		const capture = operation.kind === 'camera.capture' ? Object.values(captures).find((session) => session.operationId === operation.operationId) : undefined
		const { progress } = operation
		const detail = capture ? captureValue(capture).text : progress && progress.steps >= 1 ? `${progress.step}/${progress.steps}` : undefined
		const full = progressText(progress) ?? detail
		shown.push({ id: operation.operationId, icon, label, detail, title: full ? `${label} · ${full}` : label, abortable: abortable(operation) })
	}

	return [...shown.filter((operation) => operation.abortable), ...shown.filter((operation) => !operation.abortable)]
}

// Device types whose stop interrupts a motion.
export type InterruptibleDevice = 'mount' | 'focuser' | 'rotator' | 'dome' | 'cover' | 'guideOutput'

// Device each motion other than those of a mount is stopped through. A filter wheel has no abort, and a change of an
// INDI property cannot be interrupted.
const DEVICE_MOTIONS: Readonly<Partial<Record<OperationKind, InterruptibleDevice>>> = {
	'focuser.move': 'focuser',
	'rotator.move': 'rotator',
	'rotator.home': 'rotator',
	'dome.slew': 'dome',
	'dome.home': 'dome',
	'dome.park': 'dome',
	'dome.unpark': 'dome',
	'dome.shutter': 'dome',
	'dome.move': 'dome',
	'cover.open': 'cover',
	'cover.close': 'cover',
	'guideOutput.pulse': 'guideOutput',
}

// Camera a session of a tool works with.
interface SessionCamera {
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
}

// Session of a camera tool, as far as interrupting it goes.
export interface InterruptibleSession {
	// Id of the session.
	readonly sessionId: string
	// Camera of the session.
	readonly camera: SessionCamera
}

// Tool whose session is ended to interrupt its operation.
export type InterruptibleTool = 'autoFocus' | 'tppa' | 'darv' | 'flatWizard' | 'targetCentering' | 'mountPointing' | 'guiding'

// The one command that interrupts an operation: the stop of a device, the abort of a capture, or the end of a session.
export type Interruption = { readonly type: 'device'; readonly device: InterruptibleDevice; readonly deviceId: string } | { readonly type: 'capture'; readonly camera: SessionCamera; readonly abort: boolean } | { readonly type: 'session'; readonly tool: InterruptibleTool; readonly session: InterruptibleSession }

// What decides how an operation can be interrupted.
export interface InterruptionInput {
	// State of the event socket of the tab; absent before it first opened.
	readonly link: ServerLink | undefined
	// Control states of the watched connection.
	readonly control: Pick<ControlRuntime, 'watched' | 'states'>
	// Latest sessions of each tool, by camera.
	readonly captures: Pick<CaptureRuntime, 'sessions'>
	readonly guiding: Pick<GuidingRuntime, 'sessions'>
	readonly autoFocus: Pick<AutoFocusRuntime, 'sessions'>
	readonly tppa: Pick<TppaRuntime, 'sessions'>
	readonly darv: Pick<DarvRuntime, 'sessions'>
	readonly flatWizard: Pick<FlatWizardRuntime, 'sessions'>
	readonly targetCentering: Pick<TargetCenteringRuntime, 'sessions'>
	readonly mountPointing: Pick<MountPointingRuntime, 'sessions'>
}

// Returns the stop of the device of a motion, when the control store mirrors its connection, its driver reports it
// connected, and able to stop.
function deviceInterruption(device: InterruptibleDevice, operation: OperationRecord, control: InterruptionInput['control']): Interruption | undefined {
	const ref = operation.devices.find(({ connectionId, deviceId }) => connectionId === control.watched && control.states[device][deviceId])
	const state = ref && control.states[device][ref.deviceId]
	if (!ref || !state?.connected || ('canAbort' in state && !state.canAbort)) return undefined
	return { type: 'device', device, deviceId: ref.deviceId }
}

// Returns the session of a tool whose operation this is as an interruption, or undefined when the tab does not know it.
function sessionInterruption(tool: InterruptibleTool, sessions: Readonly<Record<string, InterruptibleSession & { readonly operationId: string }>>, operationId: string): Interruption | undefined {
	const session = Object.values(sessions).find((candidate) => candidate.operationId === operationId)
	return session && { type: 'session', tool, session }
}

// Returns the command that interrupts a running operation, or undefined when none can: the operation has none, or the
// event socket is not online (a closed socket means the state may be stale). A motion is stopped through its device, a
// capture aborts its exposure, or ends after it when the camera cannot abort, and a session of a tool is ended, with
// whatever it has done kept as its own Stop keeps it.
export function operationInterruption(operation: OperationRecord, input: InterruptionInput): Interruption | undefined {
	if (input.link !== 'online' || operation.state !== 'running') return undefined

	const { operationId, kind } = operation
	const device = MOUNT_MOTIONS.has(kind) ? 'mount' : DEVICE_MOTIONS[kind]
	if (device) return deviceInterruption(device, operation, input.control)

	switch (kind) {
		case 'camera.capture': {
			const session = Object.values(input.captures.sessions).find((candidate) => candidate.operationId === operationId)
			if (!session) return undefined
			const camera = { connectionId: session.connectionId, deviceId: session.deviceId }
			return { type: 'capture', camera, abort: watchedDeviceState(input.control, 'camera', { connectionId: camera.connectionId, id: camera.deviceId })?.canAbort ?? false }
		}
		case 'camera.guiding':
			return sessionInterruption('guiding', input.guiding.sessions, operationId)
		case 'focuser.autofocus':
			return sessionInterruption('autoFocus', input.autoFocus.sessions, operationId)
		case 'mount.tppa':
			return sessionInterruption('tppa', input.tppa.sessions, operationId)
		case 'camera.flatWizard':
			return sessionInterruption('flatWizard', input.flatWizard.sessions, operationId)
		case 'mount.targetCentering':
			return sessionInterruption('targetCentering', input.targetCentering.sessions, operationId)
		case 'mount.pointingModel':
		case 'mount.pointingVerification':
			return sessionInterruption('mountPointing', input.mountPointing.sessions, operationId)
		case 'mount.darv': {
			const session = Object.values(input.darv.sessions).find((candidate) => candidate.measurements.some((measurement) => measurement.operationId === operationId))
			return session && { type: 'session', tool: 'darv', session }
		}
		default:
			return undefined
	}
}
