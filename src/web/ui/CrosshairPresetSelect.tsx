import type { CrosshairPreset } from '@shared/types/crosshair'
import { Select, type SelectProps } from '@ui/components/Select'

const ITEMS = ['crosshair', 'bullseye', 'fine-grid', 'coarse-grid'] as const

function CrosshairPresetItem(item: CrosshairPreset) {
	return <span>{item === 'bullseye' ? 'Bullseye' : item === 'crosshair' ? 'Crosshair' : item === 'fine-grid' ? 'Fine Grid' : 'Coarse Grid'}</span>
}

export type CrosshairPresetSelectProps = Omit<SelectProps<CrosshairPreset>, 'children' | 'items'>

export function CrosshairPresetSelect({ label = 'Preset', ...props }: CrosshairPresetSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CrosshairPresetItem}
		</Select>
	)
}
