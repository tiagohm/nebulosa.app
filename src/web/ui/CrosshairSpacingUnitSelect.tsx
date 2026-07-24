import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { CrosshairSpacingUnit } from 'src/types/image.crosshair'

const ITEMS = ['pixel', 'normalized', 'angular'] as const

function CrosshairSpacingUnitItem(item: CrosshairSpacingUnit) {
	return <span>{item === 'pixel' ? 'Pixel' : item === 'normalized' ? 'Normalized' : 'Angular'}</span>
}

export type CrosshairSpacingUnitSelectProps = Omit<SelectProps<CrosshairSpacingUnit>, 'children' | 'items'>

export function CrosshairSpacingUnitSelect({ label = 'Spacing unit', ...props }: CrosshairSpacingUnitSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CrosshairSpacingUnitItem}
		</Select>
	)
}
