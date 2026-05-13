import type { AutoSubFolderMode } from 'src/shared/types'
import type { ButtonProps } from './components/Button'
import { IconButton } from './components/IconButton'
import { Icons } from './Icon'

export interface AutoSubFolderModeButtonProps extends Omit<ButtonProps, 'onPointerUp' | 'variant' | 'size' | 'children'> {
	readonly value: AutoSubFolderMode
	readonly onValueChange: (value: AutoSubFolderMode) => void
}

const ICONS = {
	OFF: [Icons.FolderOff, 'default'],
	NOON: [Icons.Sun, 'warning'],
	MIDNIGHT: [Icons.Moon, 'primary'],
} as const

export function AutoSubFolderModeButton({ value, onValueChange, ...props }: AutoSubFolderModeButtonProps) {
	const [icon, color] = ICONS[value]
	return <IconButton color={color} icon={icon} onPointerUp={() => onValueChange(value === 'OFF' ? 'NOON' : value === 'NOON' ? 'MIDNIGHT' : 'OFF')} tooltipContent={`Auto sub-folder mode: ${value}`} variant="ghost" {...props} />
}
