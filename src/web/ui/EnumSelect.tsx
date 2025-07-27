import { Select, type SelectProps } from '@heroui/react'

export type EnumSelectValue = string | number

export interface EnumSelectProps<T extends EnumSelectValue = string> extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'disallowEmptySelection' | 'selectionMode' | 'items'> {
	readonly value: T
	readonly onValueChange: (value: T) => void
}

export function EnumSelect<T extends EnumSelectValue = string>({ value, onValueChange, ...props }: EnumSelectProps<T>) {
	return <Select {...props} disallowEmptySelection onSelectionChange={(value) => onValueChange((value as Set<EnumSelectValue>).values().next().value as never)} selectedKeys={new Set([value])} selectionMode='single' size='sm' />
}
