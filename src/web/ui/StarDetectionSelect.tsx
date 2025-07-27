import { SelectItem } from '@heroui/react'
import type { StarDetectionType } from 'src/shared/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function StarDetectionSelect({ label = 'Detector', ...props }: Omit<EnumSelectProps<StarDetectionType>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='ASTAP'>Astap</SelectItem>
		</EnumSelect>
	)
}
