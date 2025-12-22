import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import type { AutoSubFolderMode } from 'src/shared/types'
import { Icons } from './Icon'

export interface AutoSubFolderModeButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'onPointerUp' | 'variant' | 'size'> {
	readonly value: AutoSubFolderMode
	readonly onValueChange: (value: AutoSubFolderMode) => void
}

export function AutoSubFolderModeButton({ value, onValueChange, ...props }: AutoSubFolderModeButtonProps) {
	return (
		<Tooltip content={`Auto sub-folder mode: ${value}`} placement='bottom' showArrow>
			<Button {...props} isIconOnly onPointerUp={() => onValueChange(value === 'OFF' ? 'NOON' : value === 'NOON' ? 'MIDNIGHT' : 'OFF')} size='sm' variant='light'>
				{value === 'OFF' ? <Icons.FolderOff color='#9E9E9E' size={14} /> : value === 'NOON' ? <Icons.Sun color='#FFEB3B' size={14} /> : <Icons.Moon color='#2196F3' size={14} />}
			</Button>
		</Tooltip>
	)
}
