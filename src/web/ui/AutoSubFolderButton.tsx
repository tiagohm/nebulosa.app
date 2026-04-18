import type { AutoSubFolderMode } from 'src/shared/types'
import { Button, type ButtonProps } from './components/Button'
import { Icons } from './Icon'

export interface AutoSubFolderModeButtonProps extends Omit<ButtonProps, 'onPointerUp' | 'variant' | 'size' | 'children'> {
	readonly value: AutoSubFolderMode
	readonly onValueChange: (value: AutoSubFolderMode) => void
}

export function AutoSubFolderModeButton({ value, onValueChange, ...props }: AutoSubFolderModeButtonProps) {
	const children = value === 'OFF' ? <Icons.FolderOff color='#9E9E9E' /> : value === 'NOON' ? <Icons.Sun color='#FFEB3B' /> : <Icons.Moon color='#2196F3' />
	return <Button children={children} onPointerUp={() => onValueChange(value === 'OFF' ? 'NOON' : value === 'NOON' ? 'MIDNIGHT' : 'OFF')} size='sm' tooltipContent={`Auto sub-folder mode: ${value}`} variant='ghost' {...props} />
}
