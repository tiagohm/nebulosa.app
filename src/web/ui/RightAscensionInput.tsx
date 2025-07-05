import { Input, type InputProps } from '@heroui/react'

export interface RightAscensionInputProps extends Omit<InputProps, 'size' | 'value' | 'onValueChange'> {
	readonly value?: string | number
	readonly onValueChange?: (value: string) => void
}

export function RightAscensionInput({ label = 'RA', value, isReadOnly, onValueChange, ...props }: RightAscensionInputProps) {
	return <Input {...props} isReadOnly={isReadOnly} label={label} onValueChange={onValueChange} placeholder='HH MM SS.ss' size='sm' value={value?.toString() || '00 00 00'} />
}
