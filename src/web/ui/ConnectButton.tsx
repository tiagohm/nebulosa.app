import type { ButtonProps } from '@ui/components/Button'
import { ToggleButton } from '@ui/components/ToggleButton'
import { Icons } from '@ui/Icon'

export interface ConnectButtonProps extends Omit<ButtonProps, 'children'> {
	readonly connected: boolean
}

export function ConnectButton({ connected, ...props }: ConnectButtonProps) {
	return <ToggleButton value={connected} onVariant="flat" onIcon={Icons.Close} offIcon={Icons.Connect} color={connected ? 'danger' : 'primary'} hideChildrenOnLoading tooltipContent={connected ? 'Disconnect' : 'Connect'} {...props} />
}
