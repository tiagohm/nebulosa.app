import { Tooltip } from '@heroui/react'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface ConnectButtonProps extends Omit<IconButtonProps, 'icon' | 'color'> {
	readonly isConnected: boolean
}

export function ConnectButton({ isConnected, size = 'md', isDisabled = false, ...props }: ConnectButtonProps) {
	return (
		<Tooltip content={isConnected ? 'Disconnect' : 'Connect'} placement='bottom' showArrow>
			<IconButton {...props} color={isConnected ? 'danger' : 'primary'} icon={isConnected ? Icons.Close : Icons.Connect} isDisabled={isDisabled} size={size} />
		</Tooltip>
	)
}
