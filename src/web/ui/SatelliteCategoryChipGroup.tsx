import { tw } from '@shared/util'
import { Chip, type ChipProps } from '@ui/components/Chip'
import type { SatelliteCategory } from 'src/shared/types'

export interface SatelliteCategoryChipGroupProps extends React.ComponentProps<'div'> {
	readonly className?: string
	readonly value: readonly SatelliteCategory[]
	readonly onValueChange: (value: SatelliteCategory[]) => void
	readonly size?: ChipProps['size']
}

const ENTRIES = ['SPECIAL', 'WEATHER', 'COMMUNICATION', 'NAVIGATION', 'SCIENTIFIC', 'MISCELLANEOUS'] as const

export function SatelliteCategoryChipGroup({ value, onValueChange, size = 'sm', className, ...props }: SatelliteCategoryChipGroupProps) {
	function handleClick(type: SatelliteCategory, remove: boolean) {
		if (remove) {
			onValueChange(value.filter((e) => e !== type))
		} else {
			onValueChange([...value, type])
		}
	}

	return (
		<div className={tw('flex w-full flex-wrap gap-2', className)} {...props}>
			{ENTRIES.map((item) => {
				const selected = value.includes(item)
				return <Chip className="cursor-pointer" color={selected ? 'success' : 'secondary'} key={item} label={item} onClick={() => handleClick(item, selected)} size={size} />
			})}
		</div>
	)
}
