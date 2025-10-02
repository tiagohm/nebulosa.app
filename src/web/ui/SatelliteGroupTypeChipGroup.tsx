import { Chip, type ChipProps, ScrollShadow } from '@heroui/react'
import { SATELLITE_GROUP_TYPES, type SatelliteGroupType } from 'src/shared/types'

export interface SatelliteGroupTypeChipGroupProps {
	readonly className?: string
	readonly value: readonly SatelliteGroupType[]
	readonly onValueChange: (value: SatelliteGroupType[]) => void
	readonly size?: ChipProps['size']
}

const ENTRIES = Object.entries(SATELLITE_GROUP_TYPES).sort((a, b) => a[1].description.localeCompare(b[1].description))

export function SatelliteGroupTypeChipGroup({ className, value, onValueChange, size = 'sm' }: SatelliteGroupTypeChipGroupProps) {
	function onHandlePointerUp(event: React.PointerEvent, type: SatelliteGroupType, remove: boolean) {
		event.stopPropagation()

		if (remove) {
			onValueChange(value.filter((e) => e !== type))
		} else {
			onValueChange([...value, type])
		}
	}

	return (
		<ScrollShadow className={className}>
			<div className='w-full flex flex-wrap gap-2'>
				{ENTRIES.map(([key, item]) => {
					const selected = value.includes(key as never)

					return (
						<Chip className='cursor-pointer' color={selected ? 'primary' : 'default'} key={key} onPointerUp={(event) => onHandlePointerUp(event, key as never, selected)} size={size}>
							{item.description}
						</Chip>
					)
				})}
			</div>
		</ScrollShadow>
	)
}
