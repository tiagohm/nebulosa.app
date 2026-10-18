import type { DeviceEvent, DeviceSummary, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { responseError } from '../http'
import type { EquipmentRole, EquipmentSetup } from './roles'

// Device runtime of the tab: the devices of the one server connection the active profile works with,
// their real connection state as reported by the server, and the tab's pending device connect and
// disconnect requests. Only the watched connection is tracked; events and late responses for any other
// connection are ignored, so switching profile or connection never mixes devices of two servers.

// Time a device connect or disconnect may take before it is reported as failed, in milliseconds.
export const SWITCH_TIMEOUT = 30000

// Device runtime state.
export interface DeviceState {
	// Id of the server connection whose devices are tracked; absent when the profile has no open connection.
	watched?: string
	// Devices of the watched connection.
	devices: DeviceSummary[]
	// Whether the device list of the watched connection is being fetched.
	loading: boolean
	// Pending request of each device, by device id.
	pending: Record<string, 'connect' | 'disconnect'>
	// Last failure of each device, by device id: a rejected request, a timeout, or a driver alert.
	errors: Record<string, string>
	// Whether the Equipment Setup modal is shown.
	open: boolean
}

// Read-only view of the device runtime used to resolve roles, satisfied by the state and its snapshots.
export interface DeviceView {
	// Id of the tracked server connection.
	readonly watched?: string
	// Devices of the tracked connection.
	readonly devices: readonly DeviceSummary[]
	// Whether the device list is being fetched.
	readonly loading: boolean
	// Pending request of each device, by device id.
	readonly pending: Readonly<Record<string, 'connect' | 'disconnect'>>
	// Last failure of each device, by device id.
	readonly errors: Readonly<Record<string, string>>
}

// Device runtime of the tab.
export const deviceState = proxy<DeviceState>({ devices: [], loading: false, pending: {}, errors: {}, open: false })

// Operational state of a role, as shown to the user.
export type RoleStatus = 'notSelected' | 'unavailable' | 'disconnected' | 'connecting' | 'connected' | 'disconnecting' | 'error'

// Display text of each role status.
export const ROLE_STATUS_LABELS: Readonly<Record<RoleStatus, string>> = {
	notSelected: 'Not Selected',
	unavailable: 'Unavailable',
	disconnected: 'Disconnected',
	connecting: 'Connecting',
	connected: 'Connected',
	disconnecting: 'Disconnecting',
	error: 'Error',
}

// Counter of device list fetches; a response is applied only if no later fetch started.
let generation = 0

// Pending-request timers by device id.
const timers = new Map<string, Timer>()

// Device events of the watched connection received while a device list fetch is in flight. They are
// replayed, in order, onto the fetched list, which may predate them.
let queued: DeviceEvent[] = []

// Clears the pending request of a device and its timeout.
function settle(state: DeviceState, id: string) {
	clearTimeout(timers.get(id))
	timers.delete(id)
	delete state.pending[id]
}

// Drops the tracked devices with their pending requests and queued events; errors are kept unless
// clearErrors is set.
function clearDevices(state: DeviceState, clearErrors: boolean) {
	for (const id of Array.from(timers.keys())) settle(state, id)
	state.devices = []
	state.pending = {}
	if (clearErrors) state.errors = {}
	queued = []
}

// Fetches the device list of the watched connection. A response is dropped when the watched connection
// changed or another fetch started meanwhile.
export async function refreshDevices(state: DeviceState) {
	const serverId = state.watched
	const current = ++generation

	if (!serverId) {
		state.loading = false
		return
	}

	state.loading = true

	try {
		const response = await fetch(`/api/connections/${encodeURIComponent(serverId)}/devices`)
		const devices = response.ok ? ((await response.json()) as DeviceSummary[]) : []
		if (current !== generation || state.watched !== serverId) return
		state.devices = devices
		const replay = queued
		queued = []
		for (const event of replay) applyDeviceEvent(state, event)
	} catch {
		// The server is unreachable; the next socket open refreshes the list.
	} finally {
		if (current === generation) state.loading = false
	}
}

// Tracks the devices of another server connection, or none. The previous connection's devices, pending
// requests, and errors are dropped; its devices are not disconnected.
export function watchServer(state: DeviceState, serverId: string | undefined) {
	if (state.watched === serverId) return

	clearDevices(state, true)
	state.watched = serverId

	void refreshDevices(state)
}

// Applies a server event of the watched connection: devices appearing, disappearing, or changing their
// connection state, and the connection itself opening again or closing. Telemetry and mount operation
// events are left to the features that use them.
export function handleDeviceEvent(state: DeviceState, event: ServerEvent) {
	switch (event.type) {
		case 'connection:open':
			if (event.connection.id === state.watched) void refreshDevices(state)
			return
		case 'connection:close':
			if (event.id === state.watched) clearDevices(state, false)
			return
		case 'device:added':
		case 'device:removed':
		case 'device:updated': {
			const connectionId = event.type === 'device:added' ? event.device.connectionId : event.connectionId
			if (connectionId !== state.watched) return
			if (state.loading) queued.push(event)
			applyDeviceEvent(state, event)
		}
	}
}

// Applies a device event of the watched connection to its device list, pending requests, and errors.
function applyDeviceEvent(state: DeviceState, event: DeviceEvent) {
	switch (event.type) {
		case 'device:added':
			state.devices = [...state.devices.filter((d) => d.id !== event.device.id), event.device]
			return
		case 'device:removed':
			state.devices = state.devices.filter((d) => d.id !== event.id)
			settle(state, event.id)
			return
		case 'device:updated': {
			const device = state.devices.find((d) => d.id === event.id)
			if (device) state.devices = state.devices.map((d) => (d.id === event.id ? { ...d, connected: event.connected } : d))
			const pending = state.pending[event.id]

			if (event.state === 'Alert') {
				settle(state, event.id)
				state.errors[event.id] = 'The driver reported an error'
			} else if (!pending || (pending === 'connect') === event.connected) {
				// The device reached the requested state, or changed on its own.
				settle(state, event.id)
				delete state.errors[event.id]
			}
		}
	}
}

// Connects (connect = true) or disconnects a device of the watched connection. Ignored while the device
// has a pending request. The request settles when the server reports the new state, or fails after
// SWITCH_TIMEOUT.
export async function switchDevice(state: DeviceState, deviceId: string, connect: boolean) {
	const serverId = state.watched
	const device = state.devices.find((d) => d.id === deviceId)
	if (!serverId || !device || state.pending[deviceId]) return
	if (device.connected === connect) return

	state.pending[deviceId] = connect ? 'connect' : 'disconnect'
	delete state.errors[deviceId]
	timers.set(
		deviceId,
		setTimeout(() => {
			if (!state.pending[deviceId]) return
			settle(state, deviceId)
			state.errors[deviceId] = `The device did not ${connect ? 'connect' : 'disconnect'} in time`
		}, SWITCH_TIMEOUT),
	)

	try {
		const url = `/api/connections/${encodeURIComponent(serverId)}/devices/${encodeURIComponent(deviceId)}/${connect ? 'connect' : 'disconnect'}`
		const response = await fetch(url, { method: 'POST' })

		if (!response.ok && state.watched === serverId) {
			settle(state, deviceId)
			state.errors[deviceId] = await responseError(response)
		}
	} catch (error) {
		if (state.watched !== serverId) return
		settle(state, deviceId)
		state.errors[deviceId] = error instanceof Error ? error.message : 'Unable to reach the server'
	}
}

// Returns the device assigned to a role among the watched connection's devices.
export function roleDevice(setup: Readonly<EquipmentSetup>, role: EquipmentRole, state: Pick<DeviceView, 'devices'>): DeviceSummary | undefined {
	const id = setup[role]?.id
	return id === undefined ? undefined : state.devices.find((d) => d.id === id)
}

// Returns the operational state of a role: whether a device is assigned, present on the watched
// connection, switching, failed, or connected. A device of a closed connection is unavailable.
export function roleStatus(setup: Readonly<EquipmentSetup>, role: EquipmentRole, state: Pick<DeviceView, 'devices' | 'pending' | 'errors'>): RoleStatus {
	const id = setup[role]?.id
	if (id === undefined) return 'notSelected'

	const device = roleDevice(setup, role, state)
	if (!device) return 'unavailable'

	const pending = state.pending[id]
	if (pending) return pending === 'connect' ? 'connecting' : 'disconnecting'
	if (state.errors[id]) return 'error'

	return device.connected ? 'connected' : 'disconnected'
}
