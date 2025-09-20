import { Select, type SelectProps } from '@heroui/react'

export type EnumSelectValue = string | number

export interface EnumSelectProps<T extends EnumSelectValue = string> extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'disallowEmptySelection' | 'selectionMode' | 'items'> {
	readonly value: T
	readonly onValueChange: (value: T) => void
}

// Fix large height
const WITH_END_CONTENT_CLASS_NAMES = { innerWrapper: '!pt-0', endContent: 'mb-0', value: 'pt-2' } as const

export function EnumSelect<T extends EnumSelectValue = string>({ value, onValueChange, classNames, ...props }: EnumSelectProps<T>) {
	return <Select {...props} classNames={{ ...WITH_END_CONTENT_CLASS_NAMES, ...classNames }} disallowEmptySelection onSelectionChange={(value) => onValueChange((value as Set<EnumSelectValue>).values().next().value as never)} selectedKeys={new Set([value])} selectionMode='single' size='sm' />
}
