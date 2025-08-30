import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import { memo } from 'react'
import type { Device } from 'src/shared/types'
import indiIcon from '@/assets/indi.webp'
import { IndiPanelControlMolecule } from '@/molecules/indi/panelcontrol'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'onPointerUp' | 'isIconOnly' | 'children'> {
	readonly device?: Device | string
}

export const IndiPanelControlButton = memo(({ device, color = 'secondary', size = 'md', variant = 'light', ...props }: IndiPanelControlButtonProps) => {
	const indi = useMolecule(IndiPanelControlMolecule)

	return (
		<Tooltip content='INDI' placement='bottom' showArrow>
			<Button {...props} color={color} isIconOnly onPointerUp={() => indi.show(device)} size={size} variant={variant}>
				<img className={`${size === 'md' ? 'w-6' : 'w-9'}`} src={indiIcon} />
			</Button>
		</Tooltip>
	)
})
