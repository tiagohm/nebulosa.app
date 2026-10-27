import type { CameraCapabilities, CaptureSession, DeviceSummary, GuidingSessionSummary, MountState, OperationKind, OperationProgress, OperationRecord } from 'api'
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
	const named = running.slice(0, MAX_NAMED_OPERATIONS).map((operation) => OPERATION_LABELS[operation.kind])
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

// Returns the value of a camera role: its sensor temperature in degrees Celsius, rounded to 0.1 °C, while connected
// and its driver reports a finite one; "Connected" while connected without one; otherwise the role status.
export function cameraValue(status: RoleStatus, state: Pick<CameraCapabilities, 'temperature'> | undefined): StatusValue {
	if (status !== 'connected') return roleValue(status)
	const temperature = state?.temperature
	return temperature !== undefined && Number.isFinite(temperature) ? { text: `${(Math.round(temperature * 10) / 10).toFixed(1)}°C`, tone: 'ok' } : { text: 'Connected', tone: 'ok' }
}

// Returns the value of a mount role. A mount that is not connected shows its role status, and one whose state was
// not reported yet "Unknown". Otherwise one state is shown, by precedence: the motions (parking, homing, a goto or
// flip, a manual axis motion), then parked, then tracking, then idle.
export function mountValue(status: RoleStatus, state: Pick<MountState, 'connected' | 'parking' | 'homing' | 'slewing' | 'moving' | 'parked' | 'tracking'> | undefined): StatusValue {
	if (status !== 'connected') return roleValue(status)
	if (!state) return { text: 'Unknown', tone: 'muted' }
	if (!state.connected) return roleValue('disconnected')
	if (state.parking) return { text: 'Parking', tone: 'active' }
	if (state.homing) return { text: 'Homing', tone: 'active' }
	if (state.slewing) return { text: 'Slewing', tone: 'active' }
	if (state.moving) return { text: 'Moving', tone: 'active' }
	if (state.parked) return { text: 'Parked', tone: 'idle' }
	if (state.tracking) return { text: 'Tracking', tone: 'ok' }
	return { text: 'Idle', tone: 'idle' }
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

// Width class of the status bar: wide from Tailwind's lg breakpoint (64rem), medium from sm (40rem), narrow below.
export type StatusTier = 'wide' | 'medium' | 'narrow'

// Chips of the status bar that may be left to the details panel when the bar is narrow.
export type StatusItemId = 'camera' | 'mount' | 'guiding' | 'capture'

// Most chips the bar shows at each width; the others are left to the details panel and counted in its button.
const TIER_ITEM_LIMITS: Readonly<Record<StatusTier, number>> = { wide: Number.POSITIVE_INFINITY, medium: 2, narrow: 1 }

// Which chips the status bar has and what they show.
export interface StatusItemsInput {
	// Whether the MAIN_CAMERA role is assigned.
	readonly camera: boolean
	// Whether the MOUNT role is assigned.
	readonly mount: boolean
	// Whether the profile's mount is moving.
	readonly mountMoving: boolean
	// Whether the GUIDE_CAMERA role's device is present.
	readonly guiding: boolean
	// Whether that guide camera has a running session.
	readonly guidingActive: boolean
	// Whether the main camera has a running capture.
	readonly capture: boolean
	// Running operations not shown through a session.
	readonly otherOperations: number
}

// Chips the status bar shows and how many items it leaves to the details panel.
export interface CompactItems {
	// Chips shown in the bar.
	readonly visible: ReadonlySet<StatusItemId>
	// Chips left out plus, unless the bar is wide and names them, the other running operations.
	readonly hidden: number
}

// Returns the chips the status bar shows at a width, by priority: a moving mount, then a running capture and a
// running guiding session, then the main camera, then an idle mount, then an idle guide camera. The server link,
// the device failures, and the Abort are never left out; the other running operations are named only on a wide
// bar and otherwise counted with the chips left out.
export function compactItems(input: StatusItemsInput, tier: StatusTier): CompactItems {
	const priority: StatusItemId[] = []
	if (input.mount && input.mountMoving) priority.push('mount')
	if (input.capture) priority.push('capture')
	if (input.guiding && input.guidingActive) priority.push('guiding')
	if (input.camera) priority.push('camera')
	if (input.mount && !input.mountMoving) priority.push('mount')
	if (input.guiding && !input.guidingActive) priority.push('guiding')

	const visible = new Set(priority.slice(0, TIER_ITEM_LIMITS[tier]))
	return { visible, hidden: priority.length - visible.size + (tier === 'wide' ? 0 : input.otherOperations) }
}

// Returns the value of a role's device for the details panel: the role status while it is not connected, and
// otherwise what the device reports — a camera's temperature, the mount state, the filter at the wheel's slot
// (named by the driver, or its 1-based slot number), the focuser position in steps with its temperature, the
// rotator's mechanical angle in degrees (not a sky position angle), or the dome's motion, park, or azimuth in
// degrees. A device whose state was not reported yet shows "Connected".
export function roleDetailValue(role: EquipmentRole, status: RoleStatus, device: ScopedDevice | undefined, control: Pick<ControlRuntime, 'watched' | 'states'>): StatusValue {
	if (status !== 'connected') return roleValue(status)

	switch (role) {
		case 'MAIN_CAMERA':
		case 'GUIDE_CAMERA':
			return cameraValue(status, watchedDeviceState(control, 'camera', device))
		case 'MOUNT':
			return mountValue(status, watchedDeviceState(control, 'mount', device))
		case 'FILTER_WHEEL': {
			const state = watchedDeviceState(control, 'wheel', device)
			if (!state) break
			if (state.moving) return { text: 'Moving', tone: 'active' }
			return { text: state.names[state.position] || `Slot ${state.position + 1}`, tone: 'ok' }
		}
		case 'FOCUSER': {
			const state = watchedDeviceState(control, 'focuser', device)
			if (!state) break
			const temperature = state.temperature !== undefined && Number.isFinite(state.temperature) ? ` · ${(Math.round(state.temperature * 10) / 10).toFixed(1)}°C` : ''
			return { text: `${state.moving ? 'Moving · ' : ''}${state.position.value} steps${temperature}`, tone: state.moving ? 'active' : 'ok' }
		}
		case 'ROTATOR': {
			const state = watchedDeviceState(control, 'rotator', device)
			if (!state) break
			return { text: `${state.moving ? 'Moving · ' : ''}${state.angle.value.toFixed(1)}° mechanical`, tone: state.moving ? 'active' : 'ok' }
		}
		case 'DOME': {
			const state = watchedDeviceState(control, 'dome', device)
			if (!state) break
			if (state.parking) return { text: 'Parking', tone: 'active' }
			if (state.homing) return { text: 'Homing', tone: 'active' }
			if (state.slewing || state.moving) return { text: 'Moving', tone: 'active' }
			if (state.parked) return { text: 'Parked', tone: 'idle' }
			return { text: `Azimuth ${toDeg(state.azimuth.value).toFixed(1)}°`, tone: 'ok' }
		}
	}

	return roleValue(status)
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
