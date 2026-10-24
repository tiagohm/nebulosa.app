import type { CommandAccepted, DeviceStateMap, DeviceStates, ManagedDeviceType, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { deviceUrl, jsonInit, responseError } from '../http'

// Control state of the devices of the active profile's server connection, as the server reports it, and
// the commands this tab sends to them. The server owns every physical state: this store only mirrors it,
// from the connection's state snapshot and the per-type state events, and never shows a commanded value
// as reached. Events arriving while a snapshot is in flight are queued and replayed onto it, so an older
// snapshot never overwrites a newer event; each event carries a device's whole state, so the last one
// received wins. A command is never sent again on its own: a durable command carries a token generated
// once per user action, so even a request repeated by the network is answered with its first operation.

// Managed device types, in the order the server lists them.
export const DEVICE_TYPES = ['camera', 'mount', 'focuser', 'wheel', 'rotator', 'guideOutput', 'dome', 'cover', 'flatPanel', 'dewHeater'] as const satisfies readonly ManagedDeviceType[]

// Control states of the watched connection, by device type and then by device id.
export type ControlStates = { [T in ManagedDeviceType]: Record<string, DeviceStateMap[T]> }

// Control runtime of the tab.
export interface ControlRuntime {
	// Id of the server connection whose devices are mirrored; absent when the profile has no open connection.
	watched?: string
	// Control states of the watched connection's devices.
	states: ControlStates
	// Whether the state snapshot of the watched connection is being fetched.
	loading: boolean
	// Why the last snapshot could not be fetched; cleared by the next successful one.
	loadError?: string
	// Command in flight for each device, by device id, as a short description such as "Park".
	pending: Record<string, string>
	// Last refused or failed command of each device, by device id; cleared by its next command.
	errors: Record<string, string>
	// Operation of the last durable command this tab started on each device, by device id.
	operations: Record<string, string>
}

// Returns an empty set of control states.
function emptyStates(): ControlStates {
	return { camera: {}, mount: {}, focuser: {}, wheel: {}, rotator: {}, guideOutput: {}, dome: {}, cover: {}, flatPanel: {}, dewHeater: {} }
}

// Returns a new control runtime watching nothing.
export function newControlRuntime(): ControlRuntime {
	return { states: emptyStates(), loading: false, pending: {}, errors: {}, operations: {} }
}

// Control runtime of the tab.
export const controlRuntime = proxy<ControlRuntime>(newControlRuntime())

// State carried by a state event: the device type and its whole state.
type StateUpdate = { [T in ManagedDeviceType]: { readonly type: T; readonly state: DeviceStateMap[T] } }[ManagedDeviceType]

// Counter of snapshot fetches; a response is applied only if no later fetch started.
let generation = 0

// State events of the watched connection received while a snapshot is in flight, replayed onto it.
let queued: StateUpdate[] = []

// Returns the device state an event carries, or undefined for any other event.
export function stateUpdateOf(event: ServerEvent): StateUpdate | undefined {
	switch (event.type) {
		case 'camera:capabilities':
			return { type: 'camera', state: event.capabilities }
		case 'mount:updated':
			return { type: 'mount', state: event.state }
		case 'focuser:updated':
			return { type: 'focuser', state: event.state }
		case 'wheel:updated':
			return { type: 'wheel', state: event.state }
		case 'rotator:updated':
			return { type: 'rotator', state: event.state }
		case 'guideOutput:updated':
			return { type: 'guideOutput', state: event.state }
		case 'dome:updated':
			return { type: 'dome', state: event.state }
		case 'cover:updated':
			return { type: 'cover', state: event.state }
		case 'flatPanel:updated':
			return { type: 'flatPanel', state: event.state }
		case 'dewHeater:updated':
			return { type: 'dewHeater', state: event.state }
		default:
			return undefined
	}
}

// Stores the state of one device.
function applyUpdate(state: ControlRuntime, { type, state: device }: StateUpdate) {
	;(state.states[type] as Record<string, DeviceStateMap[ManagedDeviceType]>)[device.id] = device
}

// Forgets the states of a removed device.
function forgetDevice(state: ControlRuntime, id: string) {
	for (const type of DEVICE_TYPES) delete state.states[type][id]
	delete state.pending[id]
	delete state.errors[id]
	delete state.operations[id]
}

// Returns the state of a device of a type, or undefined while none was reported.
export function deviceStateOf<T extends ManagedDeviceType>(states: Readonly<ControlStates>, type: T, id: string): DeviceStateMap[T] | undefined {
	return (states[type] as Readonly<Record<string, DeviceStateMap[T]>>)[id]
}

// Fetches the control states of the watched connection. A response is dropped when the watched
// connection changed or another fetch started meanwhile.
export async function refreshStates(state: ControlRuntime, request: typeof fetch = fetch) {
	const serverId = state.watched
	const current = ++generation

	if (!serverId) {
		state.loading = false
		return
	}

	state.loading = true

	try {
		const response = await request(`/api/connections/${encodeURIComponent(serverId)}/states`)
		if (current !== generation || state.watched !== serverId) return

		if (!response.ok) {
			state.loadError = await responseError(response)
			return
		}

		const snapshot = (await response.json()) as DeviceStates
		if (current !== generation || state.watched !== serverId) return

		const states = emptyStates()
		for (const type of DEVICE_TYPES) for (const device of snapshot[type]) (states[type] as Record<string, DeviceStateMap[ManagedDeviceType]>)[device.id] = device
		state.states = states
		state.loadError = undefined

		const replay = queued
		queued = []
		for (const update of replay) applyUpdate(state, update)
	} catch {
		if (current === generation && state.watched === serverId) state.loadError = 'Unable to reach the server'
	} finally {
		if (current === generation) state.loading = false
	}
}

// Mirrors the devices of another server connection, or none. The previous connection's states, pending
// commands, and errors are dropped; nothing is sent to its devices.
export function watchControl(state: ControlRuntime, serverId: string | undefined, request: typeof fetch = fetch) {
	if (state.watched === serverId) return

	state.watched = serverId
	state.states = emptyStates()
	state.pending = {}
	state.errors = {}
	state.operations = {}
	state.loadError = undefined
	queued = []

	void refreshStates(state, request)
}

// Applies a server event of the watched connection: a device's new state, its removal, and the connection
// opening again or closing. Events of any other connection are ignored.
export function handleControlEvent(state: ControlRuntime, event: ServerEvent, request: typeof fetch = fetch) {
	switch (event.type) {
		case 'connection:open':
			if (event.connection.id === state.watched) void refreshStates(state, request)
			return
		case 'connection:close':
			if (event.id === state.watched) {
				state.states = emptyStates()
				queued = []
			}
			return
		case 'device:removed':
			if (event.connectionId === state.watched) forgetDevice(state, event.id)
			return
	}

	const update = stateUpdateOf(event)
	if (!update || update.state.connectionId !== state.watched) return
	if (state.loading) queued.push(update)
	applyUpdate(state, update)
}

// Command a panel sends to a device of the watched connection.
export interface DeviceCommand {
	// Type of the device, which selects its routes.
	readonly type: ManagedDeviceType
	// Exact id of the device.
	readonly deviceId: string
	// Last path segment of the command route, such as "park".
	readonly action: string
	// Short description shown while the command is in flight, such as "Park".
	readonly label: string
	// Request body, if the command takes one.
	readonly body?: object
}

// Sends a command and records its failure. Ignored while the device has a command in flight. When the
// server cannot be reached, the command may still have been applied, so the snapshot is fetched again
// instead of assuming nothing happened. Returns the parsed body of a successful response, if any.
async function send(state: ControlRuntime, { type, deviceId, action, label, body }: DeviceCommand, request: typeof fetch): Promise<unknown> {
	const serverId = state.watched
	if (!serverId || state.pending[deviceId]) return undefined

	state.pending[deviceId] = label
	delete state.errors[deviceId]

	try {
		const response = await request(deviceUrl(serverId, type, deviceId, action), jsonInit('POST', body ?? {}))
		if (state.watched !== serverId) return undefined

		if (!response.ok) {
			state.errors[deviceId] = await responseError(response)
			return undefined
		}

		return response.status === 204 ? true : await response.json()
	} catch {
		if (state.watched !== serverId) return undefined
		state.errors[deviceId] = 'Unable to reach the server; the command may have been applied.'
		await refreshStates(state, request)
		return undefined
	} finally {
		if (state.watched === serverId) delete state.pending[deviceId]
	}
}

// Sends an immediate command, a setting the driver applies at once; resolves true when it was applied.
// The new state arrives as an event, never from the request.
export async function sendCommand(state: ControlRuntime, command: DeviceCommand, request: typeof fetch = fetch): Promise<boolean> {
	return (await send(state, command, request)) !== undefined
}

// Sends a stop or abort. Unlike other commands it is sent even while another command of the device is in
// flight, since stopping a motion must never wait for the request that started it, and it marks nothing as
// pending. Resolves true when the server confirmed the stop.
export async function stopCommand(state: ControlRuntime, { type, deviceId, action }: Omit<DeviceCommand, 'label' | 'body'>, request: typeof fetch = fetch): Promise<boolean> {
	const serverId = state.watched
	if (!serverId) return false

	try {
		const response = await request(deviceUrl(serverId, type, deviceId, action), { method: 'POST' })
		if (response.ok) return true
		if (state.watched === serverId) state.errors[deviceId] = await responseError(response)
	} catch {
		if (state.watched === serverId) state.errors[deviceId] = 'Unable to reach the server; the device may still be moving.'
	}

	return false
}

// Starts a durable command, such as a motion, under a token generated once for this action, and records
// the id of the operation running it; its progress and outcome arrive as operation events.
export async function startCommand(state: ControlRuntime, command: DeviceCommand, request: typeof fetch = fetch): Promise<void> {
	const token = crypto.randomUUID()
	const accepted = (await send(state, { ...command, body: { ...command.body, token } }, request)) as CommandAccepted | undefined
	if (accepted?.operationId) state.operations[command.deviceId] = accepted.operationId
}
