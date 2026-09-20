import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerMonitorBase } from '#/sequencer'

const ITEMS = ['warning', 'unsafe', 'critical'] as const
const LABELS = ['Warning', 'Unsafe', 'Critical'] as const

function SequencerMonitorSeverityItem(item: SequencerMonitorBase['severity'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerMonitorSeveritySelectProps extends Omit<SelectProps<SequencerMonitorBase['severity']>, 'children' | 'items'> {}

export function SequencerMonitorSeveritySelect({ label = 'Severity', ...props }: SequencerMonitorSeveritySelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerMonitorSeverityItem}
		</Select>
	)
}
