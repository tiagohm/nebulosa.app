import type { SCNRProtectionMethod } from 'nebulosa/src/image.types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['MAXIMUM_MASK', 'ADDITIVE_MASK', 'AVERAGE_NEUTRAL', 'MAXIMUM_NEUTRAL', 'MINIMUM_NEUTRAL'] as const
const LABELS = ['Maximum Mask', 'Additive Mask', 'Average Neutral', 'Maximum Neutral', 'Minimum Neutral'] as const

const SCNRProtectionMethodItem: SelectItemRenderer<SCNRProtectionMethod> = (_, i) => <span>{LABELS[i]}</span>

export type SCNRProtectionMethodSelectProps = Omit<SelectProps<SCNRProtectionMethod>, 'children' | 'items'>

export function SCNRProtectionMethodSelect({ label = 'Method', ...props }: SCNRProtectionMethodSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SCNRProtectionMethodItem}
		</Select>
	)
}
