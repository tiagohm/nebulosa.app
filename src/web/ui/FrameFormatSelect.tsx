import { SelectItem } from '@heroui/react'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface FrameFormatSelectProps extends Omit<EnumSelectProps<string>, 'children'> {
	readonly items: readonly string[]
}

export function FrameFormatSelect({ label = 'Format', items, ...props }: FrameFormatSelectProps) {
	return (
		<EnumSelect label={label} {...props}>
			{items.map((format) => (
				<SelectItem key={format}>{format}</SelectItem>
			))}
		</EnumSelect>
	)
}
