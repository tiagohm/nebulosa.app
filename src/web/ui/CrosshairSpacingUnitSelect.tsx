import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { ImageCrosshairSpacingUnit } from '#/image.crosshair'

const ITEMS = ['pixel', 'normalized', 'angular'] as const

function CrosshairSpacingUnitItem(item: ImageCrosshairSpacingUnit) {
	return <span>{item === 'pixel' ? 'Pixel' : item === 'normalized' ? 'Normalized' : 'Angular'}</span>
}

export type CrosshairSpacingUnitSelectProps = Omit<SelectProps<ImageCrosshairSpacingUnit>, 'children' | 'items'>

export function CrosshairSpacingUnitSelect({ label = 'Spacing unit', ...props }: CrosshairSpacingUnitSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CrosshairSpacingUnitItem}
		</Select>
	)
}
