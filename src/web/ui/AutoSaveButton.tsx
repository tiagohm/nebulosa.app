import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import * as Lucide from 'lucide-react'
import { useEffect, useState } from 'react'

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
				{enabled ? <Lucide.Save color='#2196F3' size={14} /> : <Lucide.SaveOff color='#9E9E9E' size={14} />}
			</Button>
		</Tooltip>
	)
}
