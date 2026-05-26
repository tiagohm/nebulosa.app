import type { Device } from 'nebulosa/src/indi.device'
import { memo } from 'react'
import indiIcon from '@/assets/indi.webp'
import { useStore } from '../hooks/store.hook'
import { IndiPanelControlStoreContext } from '../shared/context'
import { indiPanelControlStore } from '../store/indi.panelcontrol.store'
import { Button, type ButtonProps } from './components/Button'
import { IndiPanelControl } from './IndiPanelControl'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'children'> {
	readonly device: Device
}

export function IndiPanelControlButton({ device, color = 'primary', size = 'md', variant = 'ghost', ...props }: IndiPanelControlButtonProps) {
	const panel = useStore(() => indiPanelControlStore(device), [device])

	return (
		<IndiPanelControlStoreContext value={panel}>
			<Button children={<img className={size === 'md' ? 'w-6' : 'w-9'} src={indiIcon} />} rounded color={color} onClick={panel.show} size={size} tooltipContent="INDI" variant={variant} {...props} />
			<IndiPanelControl />
		</IndiPanelControlStoreContext>
	)
}
