import type { ButtonProps } from '@ui/components/Button'
import { IconButton } from '@ui/components/IconButton'
import { Icons } from '@ui/Icon'
import type { CameraAutoSubFolderMode } from 'src/types/camera'

export interface CameraAutoSubFolderModeButtonProps extends Omit<ButtonProps, 'children'> {
	readonly value: CameraAutoSubFolderMode
	readonly onValueChange: (value: CameraAutoSubFolderMode) => void
}

const ICONS = {
	off: [Icons.FolderOff, 'default'],
	noon: [Icons.Sun, 'warning'],
	midnight: [Icons.Moon, 'primary'],
} as const

export function CameraAutoSubFolderModeButton({ value, onValueChange, ...props }: CameraAutoSubFolderModeButtonProps) {
	const [icon, color] = ICONS[value]
	return <IconButton color={color} icon={icon} onClick={() => onValueChange(value === 'off' ? 'noon' : value === 'noon' ? 'midnight' : 'off')} tooltipContent={`Auto sub-folder mode: ${value}`} variant="ghost" {...props} />
}
