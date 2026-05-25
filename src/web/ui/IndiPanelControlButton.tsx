import type { Device } from 'nebulosa/src/indi.device'
import { useContext } from 'react'
import indiIcon from '@/assets/indi.webp'
import { useStore } from '../hooks/store.hook'
import { ConnectionStatusContext, IndiPanelControlStoreContext } from '../shared/context'
import { indiPanelControlStore } from '../store/indi.panelcontrol.store'
import { Button, type ButtonProps } from './components/Button'

export interface IndiPanelControlButtonProps extends Omit<ButtonProps, 'children'> {
	readonly device?: Device
}

export function IndiPanelControlButton({ device, color = 'primary', size = 'md', variant = 'ghost', ...props }: IndiPanelControlButtonProps) {
	const connection = useContext(ConnectionStatusContext)
	const panel = useStore(() => indiPanelControlStore(connection), [connection])

	return (
		<IndiPanelControlStoreContext value={panel}>
			<Button children={<img className={size === 'md' ? 'w-6' : 'w-9'} src={indiIcon} />} rounded color={color} onClick={() => panel.show(device)} size={size} tooltipContent="INDI" variant={variant} {...props} />
		</IndiPanelControlStoreContext>
	)
}
