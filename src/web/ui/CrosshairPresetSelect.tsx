import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { CrosshairPreset } from 'src/types/image.crosshair'

const ITEMS = ['crosshair', 'bullseye'] as const

function CrosshairPresetItem(item: CrosshairPreset) {
	return <span>{item === 'bullseye' ? 'Bullseye' : 'Crosshair'}</span>
}

export type CrosshairPresetSelectProps = Omit<SelectProps<CrosshairPreset>, 'children' | 'items'>

export function CrosshairPresetSelect({ label = 'Preset', ...props }: CrosshairPresetSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CrosshairPresetItem}
		</Select>
	)
}
