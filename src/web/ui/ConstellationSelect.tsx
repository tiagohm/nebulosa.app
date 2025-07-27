import { SelectItem } from '@heroui/react'
import { CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/constellation'
import { EnumMultipleSelect, type EnumMultipleSelectProps } from './EnumMultipleSelect'

export function ConstellationSelect({ label = 'Constellation', ...props }: Omit<EnumMultipleSelectProps<number>, 'children'>) {
	return (
		<EnumMultipleSelect {...props} classNames={{ trigger: '!min-h-[48.75px]' }} isClearable label={label} placeholder='All' renderValue={(items) => <div className='mt-2 flex flex-nowrap gap-2'>{items.map((item) => CONSTELLATION_LIST[item.key as number]).join(', ')}</div>}>
			{CONSTELLATION_LIST.map((c, i) => (
				<SelectItem key={i}>
					{CONSTELLATIONS[c].name} ({c})
				</SelectItem>
			))}
		</EnumMultipleSelect>
	)
}
