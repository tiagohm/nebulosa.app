import { Select, type SelectProps } from '@heroui/react'

export interface EnumMultipleSelectProps<T extends string = string> extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'selectionMode' | 'items'> {
	readonly value: readonly T[]
	readonly onValueChange: (value: T[]) => void
}

export function EnumMultipleSelect<T extends string = string>({ disallowEmptySelection = false, value, onValueChange, ...props }: EnumMultipleSelectProps<T>) {
	return <Select {...props} disallowEmptySelection={disallowEmptySelection} onSelectionChange={(value) => onValueChange(Array.from(value as Set<T>) as never)} selectedKeys={new Set(value)} selectionMode='multiple' size='sm' />
}
