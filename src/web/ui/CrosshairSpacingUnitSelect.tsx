import type { CrosshairSpacingUnit } from '@shared/types/crosshair'
import { Select, type SelectProps } from '@ui/components/Select'

const ITEMS = ['pixel', 'normalized'] as const

function CrosshairSpacingUnitItem(item: CrosshairSpacingUnit) {
	return <span>{item === 'pixel' ? 'Pixel' : 'Normalized'}</span>
}

export type CrosshairSpacingUnitSelectProps = Omit<SelectProps<CrosshairSpacingUnit>, 'children' | 'items'>

export function CrosshairSpacingUnitSelect({ label = 'Spacing unit', ...props }: CrosshairSpacingUnitSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CrosshairSpacingUnitItem}
		</Select>
	)
}
