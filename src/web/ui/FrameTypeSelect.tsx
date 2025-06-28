import { SelectItem } from '@heroui/react'
import type { FrameType } from 'src/api/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function FrameTypeSelect({ label = 'Frame Type', value, onValueChange, ...props }: Omit<EnumSelectProps<FrameType>, 'children'>) {
	return (
		<EnumSelect {...props} label={label} onValueChange={onValueChange} value={value}>
			<SelectItem key='LIGHT'>Light</SelectItem>
			<SelectItem key='DARK'>Dark</SelectItem>
			<SelectItem key='FLAT'>Flat</SelectItem>
			<SelectItem key='BIAS'>Bias</SelectItem>
		</EnumSelect>
	)
}
