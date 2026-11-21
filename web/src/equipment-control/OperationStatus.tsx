import type { OperationRecord } from 'api'
import { cn } from 'cn'
import { useSnapshot } from 'valtio'
import { deviceState } from '../equipment/equipment'
import { OPERATION_LABELS, operationsState, runningOn } from '../operations'
import { controlRuntime } from './control'
import type { DeviceGroup } from './groups'
import { FAILURE_REASONS } from './parts'

// Activity of a physical device, shown in its header so it stays in view next to the controls that caused it,
// however far the page scrolled: the operations holding any of its interfaces, whichever tab or service started them,
// the command this tab has in flight, the outcome of the last command this tab started, as the server reported it,
// and the refusals of its commands and of its connection. A request accepted by the server is shown as running,
// never as done. The lines sit in an <output>, so assistive technologies announce them as they change.

export interface OperationStatusProps {
	// Device whose activity is shown.
	readonly group: DeviceGroup
}

// Outcome of a finished operation as one line, named by the command that started it (label) when this tab knows it.
function outcomeOf(operation: OperationRecord, label: string = OPERATION_LABELS[operation.kind][1]) {
	if (operation.state === 'succeeded') return `${label} completed.`
	return `${label} failed: ${operation.reason ? FAILURE_REASONS[operation.reason] : 'unknown reason'}${operation.error ? ` (${operation.error})` : ''}.`
}

// One line of activity, in the working size of the panel and the tone of what it reports.
function Line({ tone = 'muted', children }: { readonly tone?: 'muted' | 'running' | 'error'; readonly children: string }) {
	return <span className={cn('block text-pretty', tone === 'running' ? 'text-accent' : tone === 'error' ? 'text-danger' : 'text-ink-200')}>{children}</span>
}

// Activity lines of a device; nothing when there is none.
export function OperationStatus({ group }: OperationStatusProps) {
	const operations = useSnapshot(operationsState)
	const control = useSnapshot(controlRuntime)
	const runtime = useSnapshot(deviceState)
	const running = new Map<string, OperationRecord>()
	for (const device of group.devices) for (const operation of runningOn(operations, device.connectionId, device.id)) running.set(operation.operationId, operation)
	// The writes of INDI properties name the physical device when no interface manages it.
	if (group.indi) for (const operation of runningOn(operations, group.indi.connectionId, group.hardwareId)) running.set(operation.operationId, operation)
	const pending = group.devices.flatMap((device) => (control.pending[device.id] ? [control.pending[device.id]] : []))
	const errors = group.devices.flatMap((device) => (control.errors[device.id] ? [control.errors[device.id]] : []))
	const connection = group.primary && runtime.errors[group.primary.id]
	const finished = group.devices.flatMap((device) => {
		const operation = operations.operations[control.operations[device.id] ?? '']
		return operation && operation.state !== 'running' ? [{ operation, label: control.labels[device.id] }] : []
	})

	if (running.size === 0 && pending.length === 0 && errors.length === 0 && finished.length === 0 && !connection) return null

	return (
		<output className="flex flex-col gap-0.5 text-sm leading-5">
			{Array.from(running.values(), (operation) => (
				<Line key={operation.operationId} tone="running">
					{operation.progress ? `${OPERATION_LABELS[operation.kind][1]}: step ${operation.progress.step} of ${operation.progress.steps}, ${operation.progress.message}…` : `${OPERATION_LABELS[operation.kind][1]} running…`}
				</Line>
			))}
			{pending.map((label) => (
				<Line key={label}>{`${label}: sending…`}</Line>
			))}
			{finished.map(({ operation, label }) => (
				<Line key={operation.operationId} tone={operation.state === 'failed' ? 'error' : 'muted'}>
					{outcomeOf(operation, label)}
				</Line>
			))}
			{errors.map((error) => (
				<Line key={error} tone="error">
					{error}
				</Line>
			))}
			{connection && <Line tone="error">{connection}</Line>}
		</output>
	)
}
