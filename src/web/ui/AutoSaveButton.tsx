import { ToggleButton, type ToggleButtonProps } from './components/ToggleButton'
import { Icons } from './Icon'

export function AutoSaveButton({ value, ...props }: ToggleButtonProps) {
	return <ToggleButton offIcon={Icons.SaveOff} onIcon={Icons.Save} tooltipContent={`Auto save: ${value ? 'ON' : 'OFF'}`} value={value} {...props} />
}
