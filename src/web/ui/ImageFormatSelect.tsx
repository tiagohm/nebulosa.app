import { SelectItem } from '@heroui/react'
import type { ImageFormat } from 'nebulosa/src/image'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function ImageFormatSelect({ label = 'Format', ...props }: Omit<EnumSelectProps<ImageFormat>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='jpeg'>JPEG</SelectItem>
		</EnumSelect>
	)
}
