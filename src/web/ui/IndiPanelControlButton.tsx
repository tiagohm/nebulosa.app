import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import { memo } from 'react'
import bus from 'src/shared/bus'
import indiIcon from '@/assets/indi.webp'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'onPointerUp' | 'isIconOnly' | 'children'> {
	readonly device?: string
}

export const IndiPanelControlButton = memo(({ device, color = 'secondary', size = 'md', variant = 'light' }: IndiPanelControlButtonProps) => {
	function handlePointerUp() {
		bus.emit('indiPanelControl:show', device)
	}

	return (
		<Tooltip content='INDI' placement='bottom' showArrow>
			<Button color={color} isIconOnly onPointerUp={handlePointerUp} size={size} variant={variant}>
				<img className={`${size === 'md' ? 'w-6' : 'w-9'}`} src={indiIcon} />
			</Button>
		</Tooltip>
	)
})
