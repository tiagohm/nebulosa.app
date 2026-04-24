import { Button, type ButtonProps } from './components/Button'
import { Icons } from './Icon'

export interface AutoSaveButtonProps extends Omit<ButtonProps, 'onPointerUp' | 'variant' | 'size' | 'value' | 'onValueChange' | 'children'> {
	readonly value: boolean
	readonly onValueChange: (value: boolean) => void
}

export function AutoSaveButton({ value, onValueChange, ...props }: AutoSaveButtonProps) {
	return <Button children={value ? <Icons.Save color="#9353d3" /> : <Icons.SaveOff color="#9E9E9E" />} onPointerUp={() => onValueChange(!value)} tooltipContent={`Auto save: ${value ? 'ON' : 'OFF'}`} variant="ghost" {...props} />
}
