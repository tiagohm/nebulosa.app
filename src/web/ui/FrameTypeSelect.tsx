import { SelectItem } from '@heroui/react'
import type { FrameType } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function FrameTypeSelect({ label = 'Frame Type', ...props }: Omit<EnumSelectProps<FrameType>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='LIGHT'>Light</SelectItem>
			<SelectItem key='DARK'>Dark</SelectItem>
			<SelectItem key='FLAT'>Flat</SelectItem>
			<SelectItem key='BIAS'>Bias</SelectItem>
		</EnumSelect>
	)
}
