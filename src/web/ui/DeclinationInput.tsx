import { Input, type InputProps } from '@heroui/react'

export interface DeclinationInputProps extends Omit<InputProps, 'size' | 'value' | 'onValueChange'> {
	value?: string | number
	onValueChange?: (value: string) => void
}

export function DeclinationInput({ label = 'DEC', value, isReadOnly, onValueChange, ...props }: DeclinationInputProps) {
	return <Input {...props} isReadOnly={isReadOnly} label={label} onValueChange={onValueChange} placeholder='+DDD MM SS.ss' size='sm' value={value?.toString() || '+000 00 00'} />
}
