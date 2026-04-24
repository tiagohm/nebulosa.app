import type { NameAndLabel } from 'nebulosa/src/indi.device'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

export interface FrameFormatSelectProps extends Omit<SelectProps<NameAndLabel>, 'children' | 'items' | 'onValueChange' | 'value'> {
	readonly items: readonly NameAndLabel[]
	readonly value?: string | null
	readonly onValueChange?: (value: string, index: number) => void
}

const FrameFormatItem: SelectItemRenderer<NameAndLabel> = (item) => <span>{item.label}</span>

export function FrameFormatSelect({ label = 'Format', items, onValueChange, value, ...props }: FrameFormatSelectProps) {
	const selectedItem = items.find((item) => item.name === value) ?? null

	// Reports the selected frame format by its INDI item name.
	function handleValueChange(item: NameAndLabel, index: number) {
		onValueChange?.(item.name, index)
	}

	return (
		<Select items={items} label={label} onValueChange={handleValueChange} value={selectedItem} {...props}>
			{FrameFormatItem}
		</Select>
	)
}
