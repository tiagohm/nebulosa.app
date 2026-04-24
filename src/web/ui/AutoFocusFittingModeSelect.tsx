import type { AutoFocusFittingMode } from 'nebulosa/src/autofocus'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['TRENDLINES', 'PARABOLIC', 'TREND_PARABOLIC', 'HYPERBOLIC', 'TREND_HYPERBOLIC'] as const
const LABELS = ['Trendlines', 'Parabolic', 'Trendlines + Parabolic', 'Hyperbolic', 'Trendlines + Hyperbolic'] as const

const AutoFocusFittingModeItem: SelectItemRenderer<AutoFocusFittingMode> = (_, i) => <span>{LABELS[i]}</span>

export type AutoFocusFittingModeSelectProps = Omit<SelectProps<AutoFocusFittingMode>, 'children' | 'items'>

export function AutoFocusFittingModeSelect({ label = 'Fitting mode', ...props }: AutoFocusFittingModeSelectProps) {
	return (
		<Select label={label} items={ITEMS} {...props}>
			{AutoFocusFittingModeItem}
		</Select>
	)
}
