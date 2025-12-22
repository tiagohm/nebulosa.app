import { SelectItem } from '@heroui/react'
import type { Grayscale, ImageChannelOrGray } from 'nebulosa/src/image.types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function ImageChannelOrGraySelect({ label = 'Channel', ...props }: Omit<EnumSelectProps<Exclude<ImageChannelOrGray, Grayscale>>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='RED'>Red</SelectItem>
			<SelectItem key='GREEN'>Green</SelectItem>
			<SelectItem key='BLUE'>Blue</SelectItem>
			<SelectItem key='BT709'>BT709 (Gray)</SelectItem>
			<SelectItem key='RMY'>RMY (Gray)</SelectItem>
			<SelectItem key='Y'>Y (Gray)</SelectItem>
		</EnumSelect>
	)
}
