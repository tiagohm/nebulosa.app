import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { Grayscale, ImageChannelOrGray } from 'nebulosa/src/imaging/model/types'

type ImageChannelOrGrayOption = Exclude<ImageChannelOrGray, Grayscale>

const ITEMS = ['RED', 'GREEN', 'BLUE', 'BT709', 'RMY', 'Y'] as const
const LABELS = ['Red', 'Green', 'Blue', 'BT709 (Gray)', 'RMY (Gray)', 'Y (Gray)'] as const

function ImageChannelOrGrayItem(item: ImageChannelOrGrayOption, i: number) {
	return <span>{LABELS[i]}</span>
}

export type ImageChannelOrGraySelectProps = Omit<SelectProps<ImageChannelOrGrayOption>, 'children' | 'items'>

export function ImageChannelOrGraySelect({ label = 'Channel', ...props }: ImageChannelOrGraySelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ImageChannelOrGrayItem}
		</Select>
	)
}
