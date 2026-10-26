import { type Dispatch, type SetStateAction, useEffect, useState } from 'react'
import { useSnapshot } from 'valtio'
import { operationsState } from '../../operations'
import { FAILURE_REASONS, Notice } from '../parts'
import { indiView } from './indi'

// Outcome of the latest write of a vector, as the server reports it: sending, waiting for the driver, applied,
// or why it was refused or failed. A write the server accepted is shown as waiting until its operation ends,
// never as done.

// Whether a vector has a write in flight: being sent, or accepted and still running.
export function useWriting(name: string) {
	const view = useSnapshot(indiView)
	const operations = useSnapshot(operationsState)
	const write = view.writes[name]
	return !!write && (write.sending || (!!write.operationId && operations.operations[write.operationId]?.state === 'running'))
}

export interface IndiWriteStatusProps {
	// Name of the vector.
	readonly name: string
}

// Line describing the latest write of a vector; nothing before the first.
export function IndiWriteStatus({ name }: IndiWriteStatusProps) {
	const view = useSnapshot(indiView)
	const operations = useSnapshot(operationsState)
	const write = view.writes[name]

	if (!write) return null
	if (write.sending) return <Notice>Sending…</Notice>
	if (write.error) return <Notice error>{write.code === 'conflict' ? `${write.error}. Review the values and apply again.` : write.error}</Notice>

	const operation = write.operationId ? operations.operations[write.operationId] : undefined

	if (!operation || operation.state === 'running') return <Notice>Waiting for the driver…</Notice>
	if (operation.state === 'succeeded') return <Notice>The driver accepted the change.</Notice>
	return <Notice error>{`The change failed: ${operation.reason ? FAILURE_REASONS[operation.reason] : 'unknown reason'}${operation.error ? ` (${operation.error})` : ''}.`}</Notice>
}

// Follows the write applied from an editor's draft, dropping the draft (with its state setter) once the write's
// operation succeeds, so the editor keeps showing what the user chose while the driver works instead of flashing
// back to the old values, and keeps it for review when the write is refused or fails. Returns the function to
// call once a write was sent for the vector.
export function useAppliedWrite<T>(name: string, setDraft: Dispatch<SetStateAction<T | undefined>>) {
	const [applied, setApplied] = useState<string>()
	const operations = useSnapshot(operationsState)
	const outcome = applied ? operations.operations[applied]?.state : undefined

	useEffect(() => {
		if (outcome === 'succeeded') setDraft(undefined)
		if (outcome === 'succeeded' || outcome === 'failed') setApplied(undefined)
	}, [outcome, setDraft])

	return () => setApplied(indiView.writes[name]?.operationId)
}
