import { SelectItem } from '@heroui/react'
import type { NameAndLabel } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface FrameFormatSelectProps extends Omit<EnumSelectProps<string>, 'children'> {
	readonly items: readonly NameAndLabel[]
}

const FrameFormatItem = (item: NameAndLabel) => <SelectItem key={item.name}>{item.label}</SelectItem>

export function FrameFormatSelect({ label = 'Format', items, ...props }: FrameFormatSelectProps) {
	return (
		<EnumSelect label={label} {...props}>
			{items.map(FrameFormatItem)}
		</EnumSelect>
	)
}
