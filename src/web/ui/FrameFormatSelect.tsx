import { SelectItem } from '@heroui/react'
import type { NameAndLabel } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface FrameFormatSelectProps extends Omit<EnumSelectProps<string>, 'children'> {
	readonly items: readonly NameAndLabel[]
}

export function FrameFormatSelect({ label = 'Format', items, ...props }: FrameFormatSelectProps) {
	return (
		<EnumSelect label={label} {...props}>
			{items.map((item) => (
				<SelectItem key={item.name}>{item.label}</SelectItem>
			))}
		</EnumSelect>
	)
}
