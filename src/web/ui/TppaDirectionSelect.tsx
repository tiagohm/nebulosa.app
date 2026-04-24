import type { TppaStart } from 'src/shared/types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['EAST', 'WEST'] as const
const LABELS = ['East', 'West'] as const

const TppaDirectionItem: SelectItemRenderer<TppaStart['direction']> = (_, i) => <span>{LABELS[i]}</span>

export type TppaDirectionSelectProps = Omit<SelectProps<TppaStart['direction']>, 'children' | 'items'>

export function TppaDirectionSelect({ label = 'Direction', ...props }: TppaDirectionSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{TppaDirectionItem}
		</Select>
	)
}
