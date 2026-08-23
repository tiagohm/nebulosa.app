import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerNotification } from '#/sequencer'

const ITEMS = ['info', 'warning', 'error', 'critical'] as const
const LABELS = ['Info', 'Warning', 'Error', 'Critical'] as const

function SequencerNotificationSeverityItem(item: SequencerNotification['minimumSeverity'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerNotificationSeveritySelectProps extends Omit<SelectProps<SequencerNotification['minimumSeverity']>, 'children' | 'items'> {}

export function SequencerNotificationSeveritySelect({ label = 'Minimum severity', ...props }: SequencerNotificationSeveritySelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerNotificationSeverityItem}
		</Select>
	)
}
