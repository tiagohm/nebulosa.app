import { SelectItem } from '@heroui/react'
import type { SCNRProtectionMethod } from 'nebulosa/src/image.types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function SCNRProtectionMethodSelect({ label = 'Method', ...props }: Omit<EnumSelectProps<SCNRProtectionMethod>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='MAXIMUM_MASK'>Maximum Mask</SelectItem>
			<SelectItem key='ADDITIVE_MASK'>Additive Mask</SelectItem>
			<SelectItem key='AVERAGE_NEUTRAL'>Average Neutral</SelectItem>
			<SelectItem key='MAXIMUM_NEUTRAL'>Maximum Neutral</SelectItem>
			<SelectItem key='MINIMUM_NEUTRAL'>Minimum Neutral</SelectItem>
		</EnumSelect>
	)
}
