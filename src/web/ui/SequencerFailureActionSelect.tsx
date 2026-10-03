import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerFailureAction } from '#/sequencer'

const ITEMS = ['retry', 'skip', 'pause', 'suspend', 'stop', 'fail'] as const
const LABELS = ['Retry', 'Skip', 'Pause', 'Suspend', 'Stop', 'Fail'] as const

function SequencerFailureActionItem(item: SequencerFailureAction, i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerFailureActionProps extends Omit<SelectProps<SequencerFailureAction>, 'children' | 'items'> {}

export function SequencerFailureActionSelect({ label = 'Action on failure', ...props }: SequencerFailureActionProps) {
	return (
		<Select items={ITEMS} {...props}>
			{SequencerFailureActionItem}
		</Select>
	)
}
