import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'

const TERMINAL_ITEMS = ['pause', 'suspend', 'stop', 'fail'] as const
const CONTINUE_ITEMS = ['continue', 'pause', 'suspend', 'stop', 'fail'] as const
const CONTINUE_UNGUIDED_ITEMS = ['continueUnguided', 'pause', 'suspend', 'stop', 'fail'] as const
const WAIT_ITEMS = ['wait', 'pause', 'suspend', 'stop', 'fail'] as const

const LABELS = {
	continue: 'Continue',
	continueUnguided: 'Continue unguided',
	wait: 'Wait',
	pause: 'Pause',
	suspend: 'Suspend',
	stop: 'Stop',
	fail: 'Fail',
} as const

export type SequencerOnFailureVariant = 'terminal' | 'continue' | 'continueUnguided' | 'wait'

export type SequencerOnFailureValue<T extends SequencerOnFailureVariant> = T extends 'continue' ? (typeof CONTINUE_ITEMS)[number] : T extends 'continueUnguided' ? (typeof CONTINUE_UNGUIDED_ITEMS)[number] : T extends 'wait' ? (typeof WAIT_ITEMS)[number] : (typeof TERMINAL_ITEMS)[number]

export interface SequencerOnFailureSelectProps<T extends SequencerOnFailureVariant = 'terminal'> extends Omit<SelectProps<SequencerOnFailureValue<T>>, 'children' | 'items'> {
	readonly variant?: T
}

function SequencerOnFailureItem(item: SequencerOnFailureValue<SequencerOnFailureVariant>) {
	return <span>{LABELS[item]}</span>
}

function itemsOf(variant: SequencerOnFailureVariant) {
	if (variant === 'continue') return CONTINUE_ITEMS
	if (variant === 'continueUnguided') return CONTINUE_UNGUIDED_ITEMS
	if (variant === 'wait') return WAIT_ITEMS
	return TERMINAL_ITEMS
}

export function SequencerOnFailureSelect<T extends SequencerOnFailureVariant = 'terminal'>({ variant = 'terminal' as T, label = 'On failure', ...props }: SequencerOnFailureSelectProps<T>) {
	return (
		<Select items={itemsOf(variant) as unknown as readonly SequencerOnFailureValue<T>[]} label={label} {...props}>
			{SequencerOnFailureItem}
		</Select>
	)
}
