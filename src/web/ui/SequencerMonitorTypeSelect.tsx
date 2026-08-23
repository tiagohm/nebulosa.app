import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerMonitor } from '#/sequencer'

const ITEMS = ['weather', 'rain', 'wind', 'humidity', 'dewPoint', 'cloud', 'device', 'storage', 'power', 'guiding', 'mountLimit', 'heartbeat', 'custom'] as const
const LABELS = ['Weather', 'Rain', 'Wind', 'Humidity', 'Dew point', 'Cloud', 'Device', 'Storage', 'Power', 'Guiding', 'Mount limit', 'Heartbeat', 'Custom'] as const

function SequencerMonitorTypeItem(item: SequencerMonitor['type'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerMonitorTypeSelectProps extends Omit<SelectProps<SequencerMonitor['type']>, 'children' | 'items'> {}

export function SequencerMonitorTypeSelect({ label = 'Type', ...props }: SequencerMonitorTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerMonitorTypeItem}
		</Select>
	)
}
