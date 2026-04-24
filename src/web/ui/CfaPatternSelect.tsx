import type { CfaPattern } from 'nebulosa/src/image.types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

type CfaPatternOption = CfaPattern | 'AUTO'

const ITEMS = ['AUTO', 'RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG'] as const
const LABELS = ['Auto', 'RGGB', 'BGGR', 'GBRG', 'GRBG', 'GRGB', 'GBGR', 'RGBG', 'BGRG'] as const

const CfaPatternItem: SelectItemRenderer<CfaPatternOption> = (_, i) => <span>{LABELS[i]}</span>

export type CfaPatternSelectProps = Omit<SelectProps<CfaPatternOption>, 'children' | 'items'>

export function CfaPatternSelect({ label = 'CFA Pattern', ...props }: CfaPatternSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{CfaPatternItem}
		</Select>
	)
}
