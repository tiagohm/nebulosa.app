import type { NameAndLabel } from 'nebulosa/src/indi.device'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

export interface SlewRateSelectProps extends Omit<SelectProps<NameAndLabel>, 'children' | 'items' | 'onValueChange' | 'value'> {
	readonly rates: readonly Readonly<NameAndLabel>[]
	readonly value?: string | null
	readonly onValueChange?: (value: string, index: number) => void
}

const SlewRateItem: SelectItemRenderer<NameAndLabel> = (rate) => <span>{rate.label}</span>

export function SlewRateSelect({ disabled, label = 'Slew Rate', onValueChange, rates, value, ...props }: SlewRateSelectProps) {
	const selectedRate = rates.find((rate) => rate.name === value) ?? null

	// Reports the selected slew rate by its INDI item name.
	function handleValueChange(rate: NameAndLabel, index: number) {
		onValueChange?.(rate.name, index)
	}

	return (
		<Select disabled={disabled || rates.length === 0} items={rates} label={label} onValueChange={handleValueChange} value={selectedRate} {...props}>
			{SlewRateItem}
		</Select>
	)
}
