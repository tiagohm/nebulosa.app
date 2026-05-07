import type { ChrominanceSubsampling } from 'nebulosa/src/libturbojpeg'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['4:4:4', '4:2:2', '4:2:0', 'GRAY', '4:4:0', '4:1:1', '4:4:1'] as const

function ChrominanceSubsamplingItem(item: ChrominanceSubsampling) {
	return <span>{item === 'GRAY' ? 'Gray' : item}</span>
}

export type ChrominanceSubsamplingSelectProps = Omit<SelectProps<ChrominanceSubsampling>, 'children' | 'items'>

export function ChrominanceSubsamplingSelect({ label = 'Chroma Subsampling', ...props }: ChrominanceSubsamplingSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{ChrominanceSubsamplingItem}
		</Select>
	)
}
