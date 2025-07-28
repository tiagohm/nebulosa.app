import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import { Icons } from './Icon'

export interface ConnectButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'color' | 'variant'> {
	readonly isConnected: boolean
}

export function ConnectButton({ isConnected, isDisabled = false, ...props }: ConnectButtonProps) {
	return (
		<Tooltip content={isConnected ? 'Disconnect' : 'Connect'} showArrow>
			<Button {...props} color={isConnected ? 'danger' : 'primary'} isDisabled={isDisabled} isIconOnly variant='light'>
				{isConnected ? <Icons.Close /> : <Icons.Connect />}
			</Button>
		</Tooltip>
	)
}
