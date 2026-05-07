import type { ButtonProps } from './components/Button'
import { ToggleButton } from './components/ToggleButton'
import { Icons } from './Icon'

export interface ConnectButtonProps extends Omit<ButtonProps, 'color' | 'children'> {
	readonly connected: boolean
}

export function ConnectButton({ connected, ...props }: ConnectButtonProps) {
	return <ToggleButton onVariant="flat" onIcon={Icons.Close} offIcon={Icons.Connect} color={connected ? 'danger' : 'primary'} hideChildrenOnLoading tooltipContent={connected ? 'Disconnect' : 'Connect'} {...props} />
}
