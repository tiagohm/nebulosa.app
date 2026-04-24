import type { Grayscale, ImageChannelOrGray } from 'nebulosa/src/image.types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

type ImageChannelOrGrayOption = Exclude<ImageChannelOrGray, Grayscale>

const ITEMS = ['RED', 'GREEN', 'BLUE', 'BT709', 'RMY', 'Y'] as const
const LABELS = ['Red', 'Green', 'Blue', 'BT709 (Gray)', 'RMY (Gray)', 'Y (Gray)'] as const

const ImageChannelOrGrayItem: SelectItemRenderer<ImageChannelOrGrayOption> = (_, i) => <span>{LABELS[i]}</span>

export type ImageChannelOrGraySelectProps = Omit<SelectProps<ImageChannelOrGrayOption>, 'children' | 'items'>

export function ImageChannelOrGraySelect({ label = 'Channel', ...props }: ImageChannelOrGraySelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ImageChannelOrGrayItem}
		</Select>
	)
}
