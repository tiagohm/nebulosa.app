import { Select, type SelectProps } from '@ui/components/Select'
import type { ImageFormat } from 'nebulosa/src/imaging/model/types'

const ITEMS = ['jpeg'] as const
const LABELS = ['JPEG'] as const

function ImageFormatItem(item: ImageFormat, i: number) {
	return <span>{LABELS[i]}</span>
}

export type ImageFormatSelectProps = Omit<SelectProps<ImageFormat>, 'children' | 'items'>

export function ImageFormatSelect({ label = 'Format', ...props }: ImageFormatSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ImageFormatItem}
		</Select>
	)
}
