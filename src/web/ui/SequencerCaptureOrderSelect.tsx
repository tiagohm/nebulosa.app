import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerCapture } from '#/sequencer'

const ITEMS = ['sequential', 'interleaved', 'roundRobin', 'weightedRoundRobin'] as const
const LABELS = ['Sequential', 'Interleaved', 'Round robin', 'Weighted round robin'] as const

function SequencerCaptureOrderItem(item: SequencerCapture['order'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerCaptureOrderSelectProps extends Omit<SelectProps<SequencerCapture['order']>, 'children' | 'items'> {}

export function SequencerCaptureOrderSelect({ label = 'Order', ...props }: SequencerCaptureOrderSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerCaptureOrderItem}
		</Select>
	)
}
