import { SelectItem } from '@heroui/react'
import type { AutoFocusFittingMode } from 'nebulosa/src/autofocus'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function AutoFocusFittingModeSelect({ label = 'Fitting Mode', ...props }: Omit<EnumSelectProps<AutoFocusFittingMode>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='TRENDLINES'>Trendline</SelectItem>
			<SelectItem key='PARABOLIC'>Parabolic</SelectItem>
			<SelectItem key='TREND_PARABOLIC'>Trendline + Parabolic</SelectItem>
			<SelectItem key='HYPERBOLIC'>Hyperbolic</SelectItem>
			<SelectItem key='TREND_HYPERBOLIC'>Trendline + Hyperbolic</SelectItem>
		</EnumSelect>
	)
}
