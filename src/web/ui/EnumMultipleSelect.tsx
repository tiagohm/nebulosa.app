import { Select, type SelectProps } from '@heroui/react'
import type { EnumSelectValue } from './EnumSelect'

export interface EnumMultipleSelectProps<T extends EnumSelectValue = string> extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'selectionMode' | 'items'> {
	readonly value: readonly T[]
	readonly onValueChange: (value: T[]) => void
}

export function EnumMultipleSelect<T extends EnumSelectValue = string>({ disallowEmptySelection = false, value, onValueChange, ...props }: EnumMultipleSelectProps<T>) {
	return <Select {...props} disallowEmptySelection={disallowEmptySelection} onSelectionChange={(value) => onValueChange(Array.from(value as Set<EnumSelectValue>) as never)} selectedKeys={new Set(value)} selectionMode='multiple' size='sm' />
}
