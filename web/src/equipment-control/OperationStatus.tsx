import type { OperationRecord } from 'api'
import { useSnapshot } from 'valtio'
import { OPERATION_LABELS, operationsState, runningOn } from '../operations'
import { PanelSection } from '../shell/ContextualPanel'
import { controlRuntime } from './control'
import type { DeviceGroup } from './groups'
import { FAILURE_REASONS, Notice } from './parts'

// Activity of a physical device: the operations holding any of its interfaces, whichever tab or service
// started them, the command this tab has in flight, and the outcome of the last command this tab started,
// as the server reported it. A request accepted by the server is shown as running, never as done.

export interface OperationStatusProps {
	// Device whose activity is shown.
	readonly group: DeviceGroup
}

// Outcome of a finished operation as one line.
function outcomeOf(operation: OperationRecord) {
	const label = OPERATION_LABELS[operation.kind][1]
	if (operation.state === 'succeeded') return `${label} completed.`
	return `${label} failed: ${operation.reason ? FAILURE_REASONS[operation.reason] : 'unknown reason'}${operation.error ? ` (${operation.error})` : ''}.`
}

// Section with the activity of a device; nothing when there is none.
export function OperationStatus({ group }: OperationStatusProps) {
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const running = new Map<string, OperationRecord>()
	for (const device of group.devices) for (const operation of runningOn(operations, device.connectionId, device.id)) running.set(operation.operationId, operation)
	// The writes of INDI properties name the physical device when no interface manages it.
	if (group.indi) for (const operation of runningOn(operations, group.indi.connectionId, group.hardwareId)) running.set(operation.operationId, operation)
	const pending = group.devices.flatMap((device) => (control.pending[device.id] ? [control.pending[device.id]] : []))
	const errors = group.devices.flatMap((device) => (control.errors[device.id] ? [control.errors[device.id]] : []))
	const finished = group.devices.flatMap((device) => {
		const operation = operations.operations[control.operations[device.id] ?? '']
		return operation && operation.state !== 'running' ? [operation] : []
	})

	if (running.size === 0 && pending.length === 0 && errors.length === 0 && finished.length === 0) return null

	return (
		<PanelSection title="Activity">
			{Array.from(running.values(), (operation) => (
				<p key={operation.operationId} className="m-0 text-accent">
					{operation.progress ? `${OPERATION_LABELS[operation.kind][1]} — Step ${operation.progress.step} of ${operation.progress.steps}: ${operation.progress.message}…` : `${OPERATION_LABELS[operation.kind][1]} running…`}
				</p>
			))}
			{pending.map((label) => (
				<Notice key={label}>{label}: sending…</Notice>
			))}
			{finished.map((operation) => (
				<Notice key={operation.operationId} error={operation.state === 'failed'}>
					{outcomeOf(operation)}
				</Notice>
			))}
			{errors.map((error) => (
				<Notice key={error} error>
					{error}
				</Notice>
			))}
		</PanelSection>
	)
}
