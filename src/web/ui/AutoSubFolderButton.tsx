import type { ButtonProps } from '@ui/components/Button'
import { IconButton } from '@ui/components/IconButton'
import { Icons } from '@ui/Icon'
import type { AutoSubFolderMode } from 'src/shared/types'

export interface AutoSubFolderModeButtonProps extends Omit<ButtonProps, 'children'> {
	readonly value: AutoSubFolderMode
	readonly onValueChange: (value: AutoSubFolderMode) => void
}

const ICONS = {
	off: [Icons.FolderOff, 'default'],
	noon: [Icons.Sun, 'warning'],
	midnight: [Icons.Moon, 'primary'],
} as const

export function AutoSubFolderModeButton({ value, onValueChange, ...props }: AutoSubFolderModeButtonProps) {
	const [icon, color] = ICONS[value]
	return <IconButton color={color} icon={icon} onClick={() => onValueChange(value === 'off' ? 'noon' : value === 'noon' ? 'midnight' : 'off')} tooltipContent={`Auto sub-folder mode: ${value}`} variant="ghost" {...props} />
}
