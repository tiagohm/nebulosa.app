import { Select, type SelectProps } from '@heroui/react'

export interface EnumSelectProps<T extends string = string> extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'disallowEmptySelection' | 'selectionMode' | 'items'> {
	readonly value: T
	readonly onValueChange: (value: T) => void
}

export function EnumSelect<T extends string = string>({ value, onValueChange, ...props }: EnumSelectProps<T>) {
	return <Select {...props} disallowEmptySelection onSelectionChange={(value) => onValueChange((value as Set<string>).values().next().value as never)} selectedKeys={new Set([value])} selectionMode='single' size='sm' />
}
