import { Select, type SelectProps } from '@ui/components/Select'
import type { CfaPattern } from 'nebulosa/src/imaging/model/types'

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
