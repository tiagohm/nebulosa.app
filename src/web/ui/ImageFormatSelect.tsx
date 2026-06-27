import type { ImageFormat } from 'nebulosa/src/imaging/model/types'
import { Select, type SelectProps } from './components/Select'

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
