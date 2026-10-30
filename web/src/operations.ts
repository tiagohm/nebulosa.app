import type { OperationKind, OperationRecord, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { SnapshotRefreshes } from './refresh'
import type { IconName } from './ui/Icon'

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
export const OPERATION_LABELS: Readonly<Record<OperationKind, readonly [IconName, string]>> = {
	'mount.slew': ['mount', 'Slew'],
	'mount.goto': ['mount', 'Goto'],
	'mount.flip': ['mount', 'Flip'],
	'mount.park': ['mount', 'Park'],
	'mount.unpark': ['mount', 'Unpark'],
	'mount.home': ['mount', 'Go home'],
	'mount.findHome': ['mount', 'Find home'],
	'mount.nudge': ['mount', 'Nudge'],
	'mount.remoteMove': ['mount', 'Remote mount motion'],
	'mount.pointingModel': ['mount', 'Pointing model'],
	'mount.pointingVerification': ['mount', 'Pointing verification'],
	'mount.targetCentering': ['mount', 'Target Centering'],
	'guideOutput.pulse': ['guideOutput', 'Pulse'],
	'focuser.move': ['focuser', 'Move'],
	'wheel.move': ['wheel', 'Change'],
	'rotator.move': ['rotator', 'Move'],
	'rotator.home': ['rotator', 'Go home'],
	'cover.open': ['cover', 'Open'],
	'cover.close': ['cover', 'Close'],
	'dome.slew': ['dome', 'Slew'],
	'dome.home': ['dome', 'Find home'],
	'dome.park': ['dome', 'Park'],
	'dome.unpark': ['dome', 'Unpark'],
	'dome.shutter': ['dome', 'Shutter'],
	'dome.move': ['dome', 'Rotation'],
	'camera.capture': ['camera', 'Capture'],
	'focuser.autofocus': ['focuser', 'Auto Focus'],
	'mount.tppa': ['mount', 'TPPA'],
	'mount.darv': ['mount', 'DARV'],
	'camera.flatWizard': ['camera', 'Flat Wizard'],
	'camera.guiding': ['camera', 'Guiding'],
	'guideOutput.guiding': ['guideOutput', 'Corrections'],
	'indi.propertyWrite': ['success', 'INDI property change'],
}

// Most finished operations kept; older ones are dropped. Running operations are always kept.
const MAX_FINISHED = 32

// Operations known to the tab.
export const operationsState = proxy<OperationsState>({ operations: {} })

// Refreshes of the running operations, ordered against the operation events applied meanwhile.
const refreshes = new SnapshotRefreshes()

// Drops the oldest finished operations beyond MAX_FINISHED.
function pruneFinished(state: OperationsState) {
	const finished = Object.values(state.operations).filter((operation) => operation.state !== 'running')
	for (const operation of finished.slice(0, Math.max(0, finished.length - MAX_FINISHED))) delete state.operations[operation.operationId]
}

// Applies an operation event; any other event is ignored.
export function handleOperationEvent(state: OperationsState, event: ServerEvent) {
	if (event.type !== 'operation:updated') return
	state.operations[event.operation.operationId] = event.operation
	refreshes.updated(event.operation.operationId)
	pruneFinished(state)
}

// Replaces the running operations with the server's list. An operation known as running that the server
// no longer lists ended while the socket was closed; its outcome is unknown, so it is dropped. An operation
// whose event arrived during the request is left as the event set it, so one that ended meanwhile is never
// shown running again and one that started meanwhile is never dropped. A response is dropped when another
// refresh started meanwhile.
export async function refreshOperations(state: OperationsState, request: typeof fetch = fetch) {
	const token = refreshes.start()

	try {
		const response = await request('/api/operations')
		if (!response.ok || !refreshes.current(token)) return
		const running = (await response.json()) as OperationRecord[]
		if (!refreshes.current(token)) return

		for (const operation of Object.values(state.operations)) {
			if (operation.state === 'running' && !refreshes.changed(operation.operationId)) delete state.operations[operation.operationId]
		}

		for (const operation of running) if (!refreshes.changed(operation.operationId)) state.operations[operation.operationId] = operation
	} catch {
		// The server is unreachable; the next socket open refreshes the list.
	} finally {
		refreshes.end(token)
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
