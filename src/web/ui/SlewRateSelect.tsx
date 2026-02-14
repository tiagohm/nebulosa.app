import { SelectItem } from '@heroui/react'
import type { NameAndLabel } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface SlewRateSelectProps extends Omit<EnumSelectProps, 'children'> {
	readonly rates: readonly Readonly<NameAndLabel>[]
}

export function SlewRateSelect({ rates, isDisabled, label = 'Slew Rate', ...props }: SlewRateSelectProps) {
	return (
		<EnumSelect {...props} isDisabled={isDisabled || !rates.length} label={label}>
			{rates.map((rate) => (
				<SelectItem key={rate.name}>{rate.label}</SelectItem>
			))}
		</EnumSelect>
	)
}
