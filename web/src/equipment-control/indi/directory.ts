import type { IndiDeviceEvent, IndiDeviceSummary, ServerEvent } from 'api'
import { proxy } from 'valtio'

// Mirror of the INDI device directory of the watched connection: every physical device the INDI server
// reports, managed by Nebulosa or not, without any property value. Fed by GET
// /api/connections/:id/indi/devices and the indi:device* events, it follows the same connection as the device
// runtime, so a device of another connection is never listed. A connection that is not INDI lists none.

// INDI directory state.
export interface IndiDirectoryState {
	// Id of the server connection whose devices are listed; absent when the profile has no open connection.
	watched?: string
	// Physical devices of the watched connection, in the order the server reported them.
	devices: IndiDeviceSummary[]
	// Whether the list is being fetched.
	loading: boolean
}

// INDI directory of the tab.
export const indiDirectory = proxy<IndiDirectoryState>({ devices: [], loading: false })

// Counter of fetches; a response is applied only if no later fetch started.
let generation = 0

// Directory events of the watched connection received while a fetch is in flight, replayed onto its answer.
let queued: IndiDeviceEvent[] = []

// Fetches the directory of the watched connection; a response is dropped when the watched connection changed or
// another fetch started meanwhile.
export async function refreshIndiDirectory(state: IndiDirectoryState, request: typeof fetch = fetch) {
	const connectionId = state.watched
	const current = ++generation

	if (!connectionId) {
		state.loading = false
		return
	}

	state.loading = true

	try {
		const response = await request(`/api/connections/${encodeURIComponent(connectionId)}/indi/devices`)
		const devices = response.ok ? ((await response.json()) as IndiDeviceSummary[]) : []
		if (current !== generation || state.watched !== connectionId) return
		state.devices = devices
		const replay = queued
		queued = []
		for (const event of replay) applyIndiDirectoryEvent(state, event)
	} catch {
		// The server is unreachable; the next socket open refreshes the list.
	} finally {
		if (current === generation) state.loading = false
	}
}

// Lists the devices of another connection, or none.
export function watchIndiDirectory(state: IndiDirectoryState, connectionId: string | undefined, request: typeof fetch = fetch) {
	if (state.watched === connectionId) return
	state.watched = connectionId
	state.devices = []
	queued = []
	void refreshIndiDirectory(state, request)
}

// Applies a server event: the directory events of the watched connection, and the watched connection opening
// again or closing.
export function handleIndiDirectoryEvent(state: IndiDirectoryState, event: ServerEvent, request: typeof fetch = fetch) {
	switch (event.type) {
		case 'connection:open':
			if (event.connection.id === state.watched) void refreshIndiDirectory(state, request)
			return
		case 'connection:close':
			if (event.id === state.watched) state.devices = []
			return
		case 'indi:deviceAdded':
		case 'indi:deviceUpdated':
		case 'indi:deviceRemoved': {
			const connectionId = event.type === 'indi:deviceRemoved' ? event.connectionId : event.device.connectionId
			if (connectionId !== state.watched) return
			if (state.loading) queued.push(event)
			applyIndiDirectoryEvent(state, event)
		}
	}
}

// Applies a directory event of the watched connection.
function applyIndiDirectoryEvent(state: IndiDirectoryState, event: IndiDeviceEvent) {
	if (event.type === 'indi:deviceRemoved') {
		state.devices = state.devices.filter((device) => device.hardwareId !== event.hardwareId)
	} else if (state.devices.some((device) => device.hardwareId === event.device.hardwareId)) {
		state.devices = state.devices.map((device) => (device.hardwareId === event.device.hardwareId ? event.device : device))
	} else {
		state.devices = [...state.devices, event.device]
	}
}
