import { SelectItem } from '@heroui/react'
import type { SigmaClipCenterMethod } from 'nebulosa/src/image.types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function SigmaClipCenterMethodSelect({ label = 'Center method', ...props }: Omit<EnumSelectProps<SigmaClipCenterMethod>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='mean'>Mean</SelectItem>
			<SelectItem key='median'>Median</SelectItem>
		</EnumSelect>
	)
}
