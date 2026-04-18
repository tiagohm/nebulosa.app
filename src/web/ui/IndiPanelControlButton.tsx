import { useMolecule } from 'bunshi/react'
import type { Device } from 'nebulosa/src/indi.device'
import indiIcon from '@/assets/indi.webp'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'
import { Button, type ButtonProps } from './components/Button'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'onPointerUp' | 'children'> {
	readonly device?: Device | string
}

export function IndiPanelControlButton({ device, color = 'secondary', size = 'md', variant = 'ghost', ...props }: IndiPanelControlButtonProps) {
	const indi = useMolecule(IndiPanelControlMolecule)

	return <Button children={<img className={size === 'md' ? 'w-6' : 'w-9'} src={indiIcon} />} color={color} onPointerUp={() => indi.show(device)} size={size} tooltipContent='INDI' variant={variant} {...props} />
}
