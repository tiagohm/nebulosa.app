import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { TppaDirection } from '#/tppa'

const ITEMS = ['east', 'west'] as const
const LABELS = ['East', 'West'] as const

function TppaDirectionItem(item: TppaDirection, i: number) {
	return <span>{LABELS[i]}</span>
}

export type TppaDirectionSelectProps = Omit<SelectProps<TppaDirection>, 'children' | 'items'>

export function TppaDirectionSelect({ label = 'Direction', ...props }: TppaDirectionSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{TppaDirectionItem}
		</Select>
	)
}
