import type { ImageFormat } from 'nebulosa/src/image.types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['jpeg'] as const
const LABELS = ['JPEG'] as const

const ImageFormatItem: SelectItemRenderer<ImageFormat> = (_, i) => <span>{LABELS[i]}</span>

export type ImageFormatSelectProps = Omit<SelectProps<ImageFormat>, 'children' | 'items'>

export function ImageFormatSelect({ label = 'Format', ...props }: ImageFormatSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ImageFormatItem}
		</Select>
	)
}
