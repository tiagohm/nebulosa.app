import { ScrollShadow, type ScrollShadowProps } from '@heroui/react'
import { useMemo } from 'react'
import { SATELLITE_GROUP_TYPES, type SatelliteCategory, type SatelliteGroupType } from 'src/shared/types'
import { stopPropagationDesktopOnly } from '@/shared/util'
import { Chip, type ChipProps } from './components/Chip'

export interface SatelliteGroupTypeChipGroupProps extends Omit<ScrollShadowProps, 'size'> {
	readonly value: readonly SatelliteGroupType[]
	readonly category: readonly SatelliteCategory[]
	readonly onValueChange: (value: SatelliteGroupType[]) => void
	readonly size?: ChipProps['size']
}

const ENTRIES = Object.entries(SATELLITE_GROUP_TYPES).sort((a, b) => a[1].description.localeCompare(b[1].description))

export function SatelliteGroupTypeChipGroup({ className, value, category, onValueChange, size = 'sm' }: SatelliteGroupTypeChipGroupProps) {
	const types = useMemo(() => ENTRIES.filter((e) => category.includes(e[1].category)), [category])

	function onHandlePointerUp(event: React.PointerEvent, type: SatelliteGroupType, remove: boolean) {
		stopPropagationDesktopOnly(event)

		if (remove) {
			onValueChange(value.filter((e) => e !== type))
		} else {
			onValueChange([...value, type])
		}
	}

	return (
		<ScrollShadow className={className}>
			<div className="flex w-full flex-wrap gap-2">
				{types.map(([key, item]) => {
					const selected = value.includes(key as never)
					return <Chip className="cursor-pointer" color={selected ? 'primary' : 'secondary'} key={key} label={item.description} onPointerUp={(event) => onHandlePointerUp(event, key as never, selected)} size={size} />
				})}
			</div>
		</ScrollShadow>
	)
}
