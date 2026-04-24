import type { ChrominanceSubsampling } from 'nebulosa/src/jpeg'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['4:4:4', '4:2:2', '4:2:0', 'GRAY', '4:4:0', '4:1:1', '4:4:1'] as const
const LABELS = ['4:4:4', '4:2:2', '4:2:0', 'Gray', '4:4:0', '4:1:1', '4:4:1'] as const

const ChrominanceSubsamplingItem: SelectItemRenderer<ChrominanceSubsampling> = (_, i) => <span>{LABELS[i]}</span>

export type ChrominanceSubsamplingSelectProps = Omit<SelectProps<ChrominanceSubsampling>, 'children' | 'items'>

export function ChrominanceSubsamplingSelect({ label = 'Chroma Subsampling', ...props }: ChrominanceSubsamplingSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ChrominanceSubsamplingItem}
		</Select>
	)
}
