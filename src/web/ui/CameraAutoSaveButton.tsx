import { ToggleButton, type ToggleButtonProps } from '@ui/components/ToggleButton'
import { Icons } from '@ui/Icon'

export function CameraAutoSaveButton({ value, ...props }: ToggleButtonProps) {
	return <ToggleButton offIcon={Icons.SaveOff} onIcon={Icons.Save} tooltipContent={`Auto save: ${value ? 'ON' : 'OFF'}`} value={value} {...props} />
}
