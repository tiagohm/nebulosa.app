import { MultiSelect } from '@ui/components/MultiSelect'
import type { MultiSelectProps } from '@ui/components/MultiSelect'
import type { SequencerFailureReason } from '#/sequencer'

const ITEMS = ['busy', 'aborted', 'disconnected', 'removed', 'timeout', 'alert', 'commandFailed', 'unexpectedState', 'qualityRejected', 'unsafe', 'storageUnavailable', 'unknown'] as const
const LABELS = ['Busy', 'Aborted', 'Disconnected', 'Removed', 'Timeout', 'Alert', 'Command Failed', 'Unexpected State', 'Quality Rejected', 'Unsafe', 'Storage Unavailable', 'Unknown'] as const

export type SequencerFailureReasonSelectProps = Omit<MultiSelectProps<SequencerFailureReason>, 'children' | 'items'>

function SequencerFailureReasonItem(item: SequencerFailureReason, index: number) {
	return <span>{LABELS[index]}</span>
}

export function SequencerFailureReasonSelect({ label = 'Failure reasons', ...props }: SequencerFailureReasonSelectProps) {
	return (
		<MultiSelect clearable label={label} items={ITEMS} {...props}>
			{SequencerFailureReasonItem}
		</MultiSelect>
	)
}
