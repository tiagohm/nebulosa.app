import type { CameraCapabilities, CaptureSession, CoverState, DeviceSummary, DomeState, FlatPanelState, FocuserState, GuidingSessionSummary, MountState, OperationKind, OperationProgress, OperationRecord, RotatorState, WheelState } from 'api'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { cameraKey, captureRunning } from '../../camera/capture'
import { GUIDING_STATE_LABELS, guidingRunning } from '../../camera/guiding'
import type { SelectedConnectionStatus } from '../../connection/useSelectedConnection'
import { type ControlRuntime, watchedDeviceState } from '../../equipment-control/control'
import { ROLE_STATUS_LABELS, type RoleStatus } from '../../equipment/equipment'
import type { EquipmentRole } from '../../equipment/roles'
import type { ServerLink } from '../../notifications/notifications'
import { OPERATION_LABELS } from '../../operations'

// Pure view-model selectors of the status bar. Every selector is scoped to the active profile's open server
// connection by exact connection and device ids, so the status bar never shows or commands what belongs to
// another connection, and takes plain data (stores or their snapshots) so it can be tested without React.

// Mount operations that move the mount physically, for which the status bar offers an Abort. The mount stop
// of the server cancels every operation holding the mount before stopping its axes, so it ends each of
// these, nudges and remote-control motions included; TPPA and DARV sessions also hold the mount, but are
// left to their own Stop on purpose, since aborting them from the status bar would end a whole session.
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

// Most running operations named one by one in the status bar; more are summarized by count.
const MAX_NAMED_OPERATIONS = 2

// Returns running operations as one short line, such as "Mount slew · Camera capture · +1".
export function operationsSummary(running: readonly Pick<OperationRecord, 'kind'>[]) {
	const named = running.slice(0, MAX_NAMED_OPERATIONS).map((operation) => OPERATION_LABELS[operation.kind][1])
	const more = running.length - named.length
	return more > 0 ? `${named.join(' · ')} · +${more}` : named.join(' · ')
}

// Returns whether a mount is moving: a running motion of MOUNT_MOTIONS holds that exact device, or its driver
// reports a goto or flip, a manual axis motion, parking, or homing, which covers motions started outside the
// application, such as from a hand controller.
export function mountMoving(state: MountMotionState | undefined, operations: readonly OperationRecord[], mount: ScopedDevice): boolean {
	if (state && (state.slewing || state.moving || state.parking || state.homing)) return true
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

// Returns the value of a running capture: "Stopping" once a stop was requested, otherwise the frames taken out of
// those requested, such as "12/50", or the frames taken so far for a loop, which has no total.
export function captureValue(session: Pick<CaptureSession, 'stopping' | 'captured' | 'count'>): StatusValue {
	if (session.stopping) return { text: 'Stopping', tone: 'active' }
	return { text: session.count === undefined ? String(session.captured) : `${session.captured}/${session.count}`, tone: 'active' }
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
export const CHIP_ROLES = ['MAIN_CAMERA', 'FILTER_WHEEL', 'FOCUSER', 'ROTATOR', 'MOUNT', 'GUIDE_CAMERA', 'DOME', 'COVER', 'FLAT_PANEL'] as const satisfies readonly EquipmentRole[]

// Role with a device chip in the status bar.
export type ChipRole = (typeof CHIP_ROLES)[number]

// Reading of a device chip: a short value after its icon, and whether the device moves, shown as animated dots after
// the value instead of a motion text.
export interface ChipValue {
	// Short value, such as "50000" or "Open"; empty for the icon alone.
	readonly text: string
	// Severity of the value.
	readonly tone: StatusTone
	// Whether the device is moving: slewing, homing, parking, a manual motion, a filter change, or a cover or shutter
	// opening or closing.
	readonly moving: boolean
	// Full reading, shown as the chip's title and in the details panel, such as "Slewing" or "Position 50000 steps".
	readonly title: string
}

// Returns a sensor temperature in degrees Celsius rounded to 0.1 °C, such as "-10.2°C", or undefined when the driver
// reports none or a non-finite one. Rounding to -0 reads 0.0.
function temperatureText(temperature: number | undefined) {
	return temperature !== undefined && Number.isFinite(temperature) ? `${(Math.round(temperature * 10) / 10).toFixed(1)}°C` : undefined
}

// Returns the reading of a main or guide camera: its sensor temperature, when the driver reports a finite one, or the
// icon alone.
export function cameraChip(state: Pick<CameraCapabilities, 'temperature'> | undefined): ChipValue {
	const temperature = temperatureText(state?.temperature)
	return temperature ? { text: temperature, tone: 'ok', moving: false, title: `Sensor ${temperature}` } : { text: '', tone: 'ok', moving: false, title: 'Connected' }
}

// Returns the reading of a mount. A motion (parking, homing, a goto or flip, a manual axis motion, in that precedence)
// shows only the motion dots; otherwise parked, then tracking, then idle.
export function mountChip(state: Pick<MountState, 'parking' | 'homing' | 'slewing' | 'moving' | 'parked' | 'tracking'> | undefined): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const motion = state.parking ? 'Parking' : state.homing ? 'Homing' : state.slewing ? 'Slewing' : state.moving ? 'Moving' : undefined
	if (motion) return { text: '', tone: 'active', moving: true, title: motion }
	if (state.parked) return { text: 'Parked', tone: 'idle', moving: false, title: 'Parked' }
	if (state.tracking) return { text: 'Tracking', tone: 'ok', moving: false, title: 'Tracking' }
	return { text: 'Idle', tone: 'idle', moving: false, title: 'Idle' }
}

// Returns the reading of a focuser: its position in steps, with the motion dots while it moves; its temperature is
// in the title.
export function focuserChip(state: Pick<FocuserState, 'moving' | 'position' | 'temperature'> | undefined): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const temperature = temperatureText(state.temperature)
	return { text: String(state.position.value), tone: 'ok', moving: state.moving, title: `${state.moving ? 'Moving · ' : ''}Position ${state.position.value} steps${temperature ? ` · ${temperature}` : ''}` }
}

// Returns the reading of a filter wheel: the name of the filter at its 0-based slot, or the 1-based slot number when
// the driver names none; only the motion dots while it changes filter.
export function wheelChip(state: Pick<WheelState, 'moving' | 'position' | 'names'> | undefined): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	if (state.moving) return { text: '', tone: 'active', moving: true, title: 'Changing filter' }
	const slot = `#${state.position + 1}`
	const name = state.names[state.position]
	return name ? { text: name, tone: 'ok', moving: false, title: `${slot} · ${name}` } : { text: slot, tone: 'ok', moving: false, title: slot }
}

// Returns the reading of a rotator: its mechanical angle in degrees (not a sky position angle), with the motion dots
// while it moves.
export function rotatorChip(state: Pick<RotatorState, 'moving' | 'angle'> | undefined): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	const angle = `${state.angle.value.toFixed(1)}°`
	return { text: angle, tone: 'ok', moving: state.moving, title: `${state.moving ? 'Moving · ' : ''}Mechanical angle ${angle}` }
}

// Returns the reading of a dust cover: closed (parked) or open, or only the motion dots while it moves.
export function coverChip(state: Pick<CoverState, 'parked' | 'parking'> | undefined): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	if (state.parking) return { text: '', tone: 'active', moving: true, title: 'Moving' }
	return state.parked ? { text: 'Closed', tone: 'idle', moving: false, title: 'Closed' } : { text: 'Open', tone: 'ok', moving: false, title: 'Open' }
}

// Returns the reading of a flat panel: its light on or off; the brightness, in the driver's units, is in the title.
export function flatPanelChip(state: Pick<FlatPanelState, 'enabled' | 'intensity'> | undefined): ChipValue {
	if (!state) return { text: '', tone: 'muted', moving: false, title: 'State not reported' }
	return state.enabled ? { text: 'On', tone: 'ok', moving: false, title: `On · brightness ${state.intensity.value}` } : { text: 'Off', tone: 'idle', moving: false, title: 'Off' }
}

// Text of each settled shutter state of a dome; a moving shutter shows the motion dots, an unknown one nothing.
const SHUTTER_TEXT: Readonly<Partial<Record<DomeState['shutterState'], string>>> = { OPEN: 'Open', CLOSED: 'Closed', ERROR: 'Error' }

// Returns the reading of a dome: its shutter open or closed, when it has one, with the motion dots while it rotates,
// parks, homes, or its shutter opens or closes; the rotation state and the azimuth in degrees are in the title.
export function domeChip(state: Pick<DomeState, 'slewing' | 'moving' | 'homing' | 'parking' | 'parked' | 'hasShutter' | 'shutterState' | 'azimuth'> | undefined): ChipValue {
	if (!state) return { text: '--', tone: 'muted', moving: false, title: 'State not reported' }
	const shutterMoving = state.hasShutter && (state.shutterState === 'OPENING' || state.shutterState === 'CLOSING')
	const rotation = state.parking ? 'Parking' : state.homing ? 'Homing' : state.slewing || state.moving ? 'Moving' : state.parked ? 'Parked' : `Azimuth ${toDeg(state.azimuth.value).toFixed(1)}°`
	const text = state.hasShutter ? (SHUTTER_TEXT[state.shutterState] ?? '') : ''
	const shutter = state.hasShutter ? ` · shutter ${state.shutterState.toLowerCase()}` : ''
	const tone: StatusTone = state.hasShutter && state.shutterState === 'ERROR' ? 'error' : state.shutterState === 'CLOSED' ? 'idle' : 'ok'
	return { text, tone, moving: shutterMoving || state.parking || state.homing || state.slewing || state.moving, title: `${rotation}${shutter}` }
}

// Returns the reading of a guide camera: its running session (see guidingValue), or the icon alone while it does not guide.
export function guideChip(session: GuidingSessionSummary | undefined): ChipValue {
	if (!session) return { text: '--', tone: 'idle', moving: false, title: 'Not guiding' }
	const value = guidingValue(session)
	const label = GUIDING_STATE_LABELS[session.state]
	return { text: value.text, tone: value.tone, moving: false, title: value.text === label ? label : `${label} · ${value.text}` }
}

// Returns the reading of the device of a role, from the control state of the watched connection, or undefined, so the
// bar shows no chip, while no device is assigned or present or its driver does not report it connected. The guide
// camera's reading is its guiding session, passed separately.
export function roleChip(role: ChipRole, device: Pick<DeviceSummary, 'id' | 'connectionId' | 'connected'> | undefined, control: Pick<ControlRuntime, 'watched' | 'states'>, guiding?: GuidingSessionSummary): ChipValue | undefined {
	if (!device?.connected) return undefined

	switch (role) {
		case 'MAIN_CAMERA':
			return cameraChip(watchedDeviceState(control, 'camera', device))
		case 'GUIDE_CAMERA':
			return guideChip(guiding)
		case 'MOUNT':
			return mountChip(watchedDeviceState(control, 'mount', device))
		case 'FOCUSER':
			return focuserChip(watchedDeviceState(control, 'focuser', device))
		case 'FILTER_WHEEL':
			return wheelChip(watchedDeviceState(control, 'wheel', device))
		case 'ROTATOR':
			return rotatorChip(watchedDeviceState(control, 'rotator', device))
		case 'DOME':
			return domeChip(watchedDeviceState(control, 'dome', device))
		case 'COVER':
			return coverChip(watchedDeviceState(control, 'cover', device))
		case 'FLAT_PANEL':
			return flatPanelChip(watchedDeviceState(control, 'flatPanel', device))
	}
}

// Narrowest room, in CSS pixels, worth naming the other running operations in; with less they are counted instead.
const MINIMUM_SUMMARY_WIDTH = 80

// Chip of the status bar as the fitting sees it.
export interface BarItem {
	// Id of the chip: a role, or "capture".
	readonly id: string
	// Whether its device is moving.
	readonly moving: boolean
	// Whether it shows a running session.
	readonly active: boolean
	// Width of the chip as rendered, in CSS pixels.
	readonly width: number
}

// Chips the status bar shows and what it leaves to the details panel.
export interface FittedItems {
	// Ids of the chips shown in the bar.
	readonly visible: ReadonlySet<string>
	// Whether the other running operations are named in the bar, in the room left after every chip.
	readonly nameOthers: boolean
	// Chips left out plus the other running operations unless they are named.
	readonly hidden: number
}

// Returns the chips that fit in the room of the bar, by priority: moving devices, then running sessions, then the
// others, each group in display order; a chip that does not fit is skipped, so a narrower one after it may still fit.
// The room and the widths are in CSS pixels, and each chip after the first costs the gap between items too. The other
// running operations are named only when every chip fits and at least MINIMUM_SUMMARY_WIDTH is left; otherwise they
// are counted with the chips left out.
export function fitItems(items: readonly BarItem[], room: number, gap: number, otherOperations: number): FittedItems {
	const priority = [...items.filter((item) => item.moving), ...items.filter((item) => !item.moving && item.active), ...items.filter((item) => !item.moving && !item.active)]
	const visible = new Set<string>()
	let left = room

	for (const item of priority) {
		const cost = item.width + gap
		if (cost > left) continue
		visible.add(item.id)
		left -= cost
	}

	const nameOthers = otherOperations > 0 && visible.size === items.length && left - gap >= MINIMUM_SUMMARY_WIDTH
	return { visible, nameOthers, hidden: items.length - visible.size + (nameOthers ? 0 : otherOperations) }
}

// Returns the value of a role's device for the details panel: the role status while it is not connected, otherwise
// the full reading of its chip (see roleChip), in the active tone while it moves.
export function roleDetailValue(role: EquipmentRole, status: RoleStatus, device: Pick<DeviceSummary, 'id' | 'connectionId' | 'connected'> | undefined, control: Pick<ControlRuntime, 'watched' | 'states'>, guiding?: GuidingSessionSummary): StatusValue {
	const chip = status === 'connected' && role !== 'GUIDE_OUTPUT' ? roleChip(role, device, control, guiding) : undefined
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
