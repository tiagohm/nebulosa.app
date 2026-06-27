import type { Device } from 'nebulosa/src/devices/indi/device'
import bus from 'src/shared/bus'
import indiIcon from '@/assets/indi.webp'
import { Button, type ButtonProps } from './components/Button'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'children'> {
	readonly device: Device
}

export function IndiPanelControlButton({ device, color = 'primary', size = 'md', variant = 'ghost', ...props }: IndiPanelControlButtonProps) {
	function handleClick() {
		bus.emit('indi:panelcontrol:toggle', device)
	}

	return <Button children={<img className={size === 'md' ? 'w-6' : 'w-9'} src={indiIcon} />} rounded color={color} onClick={handleClick} size={size} tooltipContent="INDI" variant={variant} {...props} />
}
