import { SelectItem } from '@heroui/react'
import type { StarDetectionType } from 'src/api/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function StarDetectionSelect({ label = 'Detector', value, onValueChange, ...props }: Omit<EnumSelectProps<StarDetectionType>, 'children'>) {
	return (
		<EnumSelect {...props} label={label} onValueChange={onValueChange} value={value}>
			<SelectItem key='ASTAP'>Astap</SelectItem>
		</EnumSelect>
	)
}
