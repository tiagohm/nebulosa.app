import type { AutoFocusFittingMode } from 'nebulosa/src/autofocus'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['TRENDLINES', 'PARABOLIC', 'TREND_PARABOLIC', 'HYPERBOLIC', 'TREND_HYPERBOLIC'] as const
const LABELS = ['Trendlines', 'Parabolic', 'Trendlines + Parabolic', 'Hyperbolic', 'Trendlines + Hyperbolic'] as const

function AutoFocusFittingModeItem(item: AutoFocusFittingMode, i: number) {
	return <span>{LABELS[i]}</span>
}

export type AutoFocusFittingModeSelectProps = Omit<SelectProps<AutoFocusFittingMode>, 'children' | 'items'>

export function AutoFocusFittingModeSelect({ label = 'Fitting mode', ...props }: AutoFocusFittingModeSelectProps) {
	return (
		<Select label={label} items={ITEMS} {...props}>
			{AutoFocusFittingModeItem}
		</Select>
	)
}
