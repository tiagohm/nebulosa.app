import { SelectItem } from '@heroui/react'
import { SATELLITE_GROUP_TYPES, type SatelliteGroupType } from 'src/shared/types'
import { EnumMultipleSelect, type EnumMultipleSelectProps } from './EnumMultipleSelect'

export interface SatelliteGroupTypeSelectProps extends Omit<EnumMultipleSelectProps, 'children' | 'value' | 'onValueChange'> {
	readonly value: readonly SatelliteGroupType[]
	readonly onValueChange: (value: SatelliteGroupType[]) => void
}

export function SatelliteGroupTypeSelect({ label = 'Type', ...props }: SatelliteGroupTypeSelectProps) {
	return (
		<EnumMultipleSelect
			{...props}
			classNames={{ trigger: '!min-h-[48.75px]' }}
			isClearable
			label={label}
			placeholder='All'
			renderValue={(items) => {
				return <div className='mt-2 flex flex-nowrap gap-2'>{items.map((item) => item.key).join(', ')}</div>
			}}>
			{Object.entries(SATELLITE_GROUP_TYPES).map(([key, value]) => (
				<SelectItem key={key}>{value.description}</SelectItem>
			))}
		</EnumMultipleSelect>
	)
}
