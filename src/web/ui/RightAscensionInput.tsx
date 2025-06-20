import { Input, type InputProps } from '@heroui/react'
import { formatRA, type ParseAngleOptions, parseAngle } from 'nebulosa/src/angle'

export interface RightAscensionInputProps extends Omit<InputProps, 'size' | 'value' | 'onValueChange'> {
	value?: string | number
	onValueChange?: (value: string) => void
}

const PARSE_ANGLE_OPTIONS: ParseAngleOptions = {
	isHour: true,
}

export function RightAscensionInput({ label = 'RA', value, isReadOnly, onValueChange, ...props }: RightAscensionInputProps) {
	return <Input {...props} isReadOnly={isReadOnly} label={label} onValueChange={onValueChange} placeholder='HH MM SS.ss' size='sm' value={isReadOnly ? formatRA(parseAngle(value, PARSE_ANGLE_OPTIONS) ?? 0) : value?.toString() || '00 00 00'} />
}
