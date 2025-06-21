import { Select, SelectItem, type SelectProps } from '@heroui/react'
import type { StarDetectionType } from 'src/api/types'

export interface StarDetectionSelectProps extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'disallowEmptySelection' | 'children' | 'selectionMode'> {
	value: StarDetectionType
	onValueChange: (value: StarDetectionType) => void
}

export function StarDetectionSelect({ label = 'Detector', value, onValueChange, ...props }: StarDetectionSelectProps) {
	return (
		<Select {...props} disallowEmptySelection label={label} onSelectionChange={(value) => onValueChange((value as Set<string>).values().next().value as never)} selectedKeys={new Set([value])} selectionMode='single' size='sm'>
			<SelectItem key='ASTAP'>Astap</SelectItem>
		</Select>
	)
}
