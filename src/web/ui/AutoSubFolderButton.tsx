import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import { useEffect, useState } from 'react'
import type { AutoSubFolderMode } from 'src/shared/types'
import { Icons } from './Icon'

export interface AutoSubFolderModeButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'onPointerUp' | 'variant' | 'size'> {
	readonly value: AutoSubFolderMode
	readonly onValueChange: (value: AutoSubFolderMode) => void
}

export function AutoSubFolderModeButton({ value, onValueChange, ...props }: AutoSubFolderModeButtonProps) {
	const [mode, setMode] = useState(value)

	useEffect(() => onValueChange(mode), [mode, onValueChange])

	return (
		<Tooltip content={`Auto sub-folder mode: ${mode}`} placement='bottom' showArrow>
			<Button {...props} isIconOnly onPointerUp={() => setMode(mode === 'OFF' ? 'NOON' : mode === 'NOON' ? 'MIDNIGHT' : 'OFF')} size='sm' variant='light'>
				{mode === 'OFF' ? <Icons.FolderOff color='#9E9E9E' size={14} /> : mode === 'NOON' ? <Icons.Sun color='#FFEB3B' size={14} /> : <Icons.Moon color='#2196F3' size={14} />}
			</Button>
		</Tooltip>
	)
}
