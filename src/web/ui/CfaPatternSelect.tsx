import type { CfaPattern } from 'nebulosa/src/image.types'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['AUTO', 'RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG'] as const

function CfaPatternItem(item: CfaPattern | 'AUTO') {
	return <span>{item === 'AUTO' ? 'Auto' : item}</span>
}

export type CfaPatternSelectProps = Omit<SelectProps<CfaPattern | 'AUTO'>, 'children' | 'items'>

export function CfaPatternSelect({ label = 'CFA Pattern', ...props }: CfaPatternSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CfaPatternItem}
		</Select>
	)
}
