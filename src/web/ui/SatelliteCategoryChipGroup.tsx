import { Chip, type ChipProps, ScrollShadow } from '@heroui/react'
import type { SatelliteCategory } from 'src/shared/types'
import { stopPropagationDesktopOnly } from '../shared/util'

export interface SatelliteCategoryChipGroupProps {
	readonly className?: string
	readonly value: readonly SatelliteCategory[]
	readonly onValueChange: (value: SatelliteCategory[]) => void
	readonly size?: ChipProps['size']
}

const ENTRIES = ['SPECIAL', 'WEATHER', 'COMMUNICATION', 'NAVIGATION', 'SCIENTIFIC', 'MISCELLANEOUS'] as const

export function SatelliteCategoryChipGroup({ className, value, onValueChange, size = 'sm' }: SatelliteCategoryChipGroupProps) {
	function onHandlePointerUp(event: React.PointerEvent, type: SatelliteCategory, remove: boolean) {
		stopPropagationDesktopOnly(event)

		if (remove) {
			onValueChange(value.filter((e) => e !== type))
		} else {
			onValueChange([...value, type])
		}
	}

	return (
		<ScrollShadow className={className}>
			<div className='w-full flex flex-wrap gap-2'>
				{ENTRIES.map((item) => {
					const selected = value.includes(item)

					return (
						<Chip className='cursor-pointer' color={selected ? 'success' : 'default'} key={item} onPointerUp={(event) => onHandlePointerUp(event, item, selected)} size={size}>
							{item}
						</Chip>
					)
				})}
			</div>
		</ScrollShadow>
	)
}
