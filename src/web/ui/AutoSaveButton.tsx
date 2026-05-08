import { ToggleButton, type ToggleButtonProps } from './components/ToggleButton'
import { Icons } from './Icon'

export function AutoSaveButton({ value: selected, onValueChange, ...props }: ToggleButtonProps) {
	return <ToggleButton offIcon={Icons.SaveOff} onIcon={Icons.Save} tooltipContent={`Auto save: ${selected ? 'ON' : 'OFF'}`} value={selected} {...props} />
}
