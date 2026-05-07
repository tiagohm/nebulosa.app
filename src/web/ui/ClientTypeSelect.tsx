import type { ClientType } from 'nebulosa/src/indi.device'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['INDI', 'ALPACA', 'SIMULATOR'] as const
const LABELS = ['INDI', 'Alpaca', 'Simulator'] as const

function ClientTypeItem(item: ClientType, i: number) {
	return <span>{LABELS[i]}</span>
}

export type ClientTypeSelectProps = Omit<SelectProps<ClientType>, 'children' | 'items'>

export function ClientTypeSelect({ label = 'Type', ...props }: ClientTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ClientTypeItem}
		</Select>
	)
}
