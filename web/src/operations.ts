import type { OperationKind, OperationRecord, ServerEvent } from 'api'
import { proxy } from 'valtio'

// Device operations of the server as this tab knows them. The server owns every operation, whichever tab
// or service started it, so this store only mirrors it: it is fed by operation:updated events and, on
// every socket (re)open, by the list of running operations, so a reloaded tab or another tab sees an
// operation in progress. Finished operations are kept for a while so their outcome can still be shown.
// Operations are addressed by exact connection and device ids, never by role.

// Operations known to the tab.
export interface OperationsState {
	// Every running operation and the latest finished ones, by operation id.
	operations: Record<string, OperationRecord>
}

// Display name of each operation kind.
export const OPERATION_LABELS: Readonly<Record<OperationKind, string>> = {
	'mount.slew': 'Mount slew',
	'mount.goto': 'Mount goto',
	'mount.flip': 'Mount flip',
	'mount.park': 'Mount park',
	'mount.unpark': 'Mount unpark',
	'mount.home': 'Mount go home',
	'mount.findHome': 'Mount find home',
	'mount.nudge': 'Mount nudge',
	'guideOutput.pulse': 'Guide pulse',
	'focuser.move': 'Focuser move',
	'wheel.move': 'Filter change',
	'rotator.move': 'Rotator move',
	'rotator.home': 'Rotator go home',
	'cover.open': 'Cover open',
	'cover.close': 'Cover close',
	'dome.slew': 'Dome slew',
	'dome.home': 'Dome find home',
	'dome.park': 'Dome park',
	'dome.unpark': 'Dome unpark',
	'dome.shutter': 'Dome shutter',
	'dome.move': 'Dome rotation',
	'camera.capture': 'Camera capture',
	'focuser.autofocus': 'Auto Focus',
	'mount.tppa': 'TPPA',
	'mount.darv': 'DARV',
	'camera.flatWizard': 'Flat Wizard',
	'camera.guiding': 'Guiding',
	'guideOutput.guiding': 'Guiding corrections',
	'indi.propertyWrite': 'INDI property change',
}

// Most finished operations kept; older ones are dropped. Running operations are always kept.
const MAX_FINISHED = 32

// Operations known to the tab.
export const operationsState = proxy<OperationsState>({ operations: {} })

// Counter of refreshes; a response is applied only if no later refresh started.
let generation = 0

// Drops the oldest finished operations beyond MAX_FINISHED.
function pruneFinished(state: OperationsState) {
	const finished = Object.values(state.operations).filter((operation) => operation.state !== 'running')
	for (const operation of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) delete state.operations[operation.operationId]
}

// Applies an operation event; any other event is ignored.
export function handleOperationEvent(state: OperationsState, event: ServerEvent) {
	if (event.type !== 'operation:updated') return
	state.operations[event.operation.operationId] = event.operation
	pruneFinished(state)
}

// Replaces the running operations with the server's list. An operation known as running that the server
// no longer lists ended while the socket was closed; its outcome is unknown, so it is dropped. A response
// is dropped when another refresh started meanwhile.
export async function refreshOperations(state: OperationsState, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/operations')
		if (!response.ok || current !== generation) return
		const running = (await response.json()) as OperationRecord[]
		if (current !== generation) return

		for (const operation of Object.values(state.operations)) {
			if (operation.state === 'running') delete state.operations[operation.operationId]
		}

		for (const operation of running) state.operations[operation.operationId] = operation
	} catch {
		// The server is unreachable; the next socket open refreshes the list.
	}
}

// Returns the running operations holding a device, in start order.
export function runningOn(state: Pick<OperationsState, 'operations'>, connectionId: string, deviceId: string): OperationRecord[] {
	return Object.values(state.operations)
		.filter((operation) => operation.state === 'running' && operation.devices.some((device) => device.connectionId === connectionId && device.deviceId === deviceId))
		.sort((a, b) => a.startedAt - b.startedAt)
}

// Returns whether a running operation holds a device.
export function deviceBusy(state: Pick<OperationsState, 'operations'>, connectionId: string, deviceId: string): boolean {
	return runningOn(state, connectionId, deviceId).length > 0
}
