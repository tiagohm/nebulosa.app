import type { SatelliteCategory } from 'src/shared/types'
import { stopPropagationDesktopOnly } from '@/shared/util'
import { Chip, type ChipProps } from './components/Chip'

export interface SatelliteCategoryChipGroupProps extends React.ComponentProps<'div'> {
	readonly className?: string
	readonly value: readonly SatelliteCategory[]
	readonly onValueChange: (value: SatelliteCategory[]) => void
	readonly size?: ChipProps['size']
}

const ENTRIES = ['SPECIAL', 'WEATHER', 'COMMUNICATION', 'NAVIGATION', 'SCIENTIFIC', 'MISCELLANEOUS'] as const

export function SatelliteCategoryChipGroup({ value, onValueChange, size = 'sm', ...props }: SatelliteCategoryChipGroupProps) {
	function onHandlePointerUp(event: React.PointerEvent, type: SatelliteCategory, remove: boolean) {
		stopPropagationDesktopOnly(event)

		if (remove) {
			onValueChange(value.filter((e) => e !== type))
		} else {
			onValueChange([...value, type])
		}
	}

	return (
		<div className="flex w-full flex-wrap gap-2" {...props}>
			{ENTRIES.map((item) => {
				const selected = value.includes(item)
				return <Chip className="cursor-pointer" color={selected ? 'success' : 'secondary'} key={item} label={item} onPointerUp={(event) => onHandlePointerUp(event, item, selected)} size={size} />
			})}
		</div>
	)
}
