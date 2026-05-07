import type { TppaStart } from 'src/shared/types'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['EAST', 'WEST'] as const
const LABELS = ['East', 'West'] as const

function TppaDirectionItem(item: TppaStart['direction'], i: number) {
	return <span>{LABELS[i]}</span>
}

export type TppaDirectionSelectProps = Omit<SelectProps<TppaStart['direction']>, 'children' | 'items'>

export function TppaDirectionSelect({ label = 'Direction', ...props }: TppaDirectionSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{TppaDirectionItem}
		</Select>
	)
}
