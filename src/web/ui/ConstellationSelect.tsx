import { SelectItem } from '@heroui/react'
import { CONSTELLATION_LIST, CONSTELLATIONS, type Constellation } from 'nebulosa/src/constellation'
import { EnumMultipleSelect, type EnumMultipleSelectProps } from './EnumMultipleSelect'

export type ConstellationSelectProps = Omit<EnumMultipleSelectProps<Constellation>, 'children'>

const ConstellationItem = (c: Constellation) => (
	<SelectItem key={c}>
		{CONSTELLATIONS[c].name} ({c})
	</SelectItem>
)

export function ConstellationSelect({ label = 'Constellation', ...props }: ConstellationSelectProps) {
	return (
		<EnumMultipleSelect {...props} classNames={{ trigger: 'min-h-15!' }} isClearable label={label} placeholder='All' renderValue={(items) => <div className='mt-2 flex flex-nowrap gap-2'>{items.map((e) => e.key).join(', ')}</div>}>
			{CONSTELLATION_LIST.map(ConstellationItem)}
		</EnumMultipleSelect>
	)
}
