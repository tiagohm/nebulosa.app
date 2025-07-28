import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import { useEffect, useState } from 'react'
import { Icons } from './Icon'

export interface AutoSaveButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'onPointerUp' | 'variant' | 'size' | 'value' | 'onValueChange'> {
	readonly value: boolean
	readonly onValueChange: (value: boolean) => void
}

export function AutoSaveButton({ value, onValueChange, ...props }: AutoSaveButtonProps) {
	const [enabled, setEnabled] = useState(value)

	useEffect(() => onValueChange(enabled), [enabled, onValueChange])

	return (
		<Tooltip content={`Auto save: ${enabled ? 'ON' : 'OFF'}`} placement='bottom' showArrow>
			<Button {...props} isIconOnly onPointerUp={() => setEnabled(!enabled)} size='sm' variant='light'>
				{enabled ? <Icons.Save color='#9353d3' size={14} /> : <Icons.SaveOff color='#9E9E9E' size={14} />}
			</Button>
		</Tooltip>
	)
}
