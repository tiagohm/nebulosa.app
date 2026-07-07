import type { Device } from 'nebulosa/src/devices/indi/device'
import indiIcon from '@/assets/indi.webp'
import { indiBus } from '../shared/bus'
import { Button, type ButtonProps } from './components/Button'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'children'> {
	readonly device: Device
}

export function IndiPanelControlButton({ device, color = 'primary', size = 'md', variant = 'ghost', ...props }: IndiPanelControlButtonProps) {
	function handleClick() {
		indiBus.emitSync('togglePanelControl', device)
	}

	return <Button children={<img className={size === 'md' ? 'w-6' : 'w-9'} src={indiIcon} />} rounded color={color} onClick={handleClick} size={size} tooltipContent="INDI" variant={variant} {...props} />
}
