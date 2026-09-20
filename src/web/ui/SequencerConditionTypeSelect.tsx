import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerEndCondition, SequencerStartCondition } from '#/sequencer'

const START_ITEMS = ['manual', 'at', 'sunAltitude', 'targetAltitude'] as const
const END_ITEMS = ['afterSequence', 'at', 'sunAltitude', 'targetAltitude', 'integrationTime'] as const

const LABELS = {
	manual: 'Manual',
	afterSequence: 'After sequence',
	at: 'At time',
	sunAltitude: 'Sun altitude',
	targetAltitude: 'Target altitude',
	integrationTime: 'Integration time',
} as const

export type SequencerConditionKind = 'start' | 'end'

export type SequencerConditionType<T extends SequencerConditionKind> = T extends 'start' ? SequencerStartCondition['type'] : SequencerEndCondition['type']

export interface SequencerConditionTypeSelectProps<T extends SequencerConditionKind> extends Omit<SelectProps<SequencerConditionType<T>>, 'children' | 'items'> {
	readonly kind: T
}

function SequencerConditionTypeItem(item: SequencerConditionType<SequencerConditionKind>) {
	return <span>{LABELS[item]}</span>
}

export function SequencerConditionTypeSelect<T extends SequencerConditionKind>({ kind, label = kind === 'start' ? 'Start' : 'End', ...props }: SequencerConditionTypeSelectProps<T>) {
	const items = (kind === 'start' ? START_ITEMS : END_ITEMS) as unknown as readonly SequencerConditionType<T>[]

	return (
		<Select items={items} label={label} {...props}>
			{SequencerConditionTypeItem}
		</Select>
	)
}
