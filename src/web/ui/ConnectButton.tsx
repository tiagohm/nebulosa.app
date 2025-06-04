import { Button, type ButtonProps, Tooltip } from '@heroui/react'
import * as Lucide from 'lucide-react'

export interface ConnectButtonProps extends Omit<ButtonProps, 'isIconOnly' | 'isLoading' | 'color' | 'variant'> {
	readonly isConnected: boolean
}

export function ConnectButton({ isConnected, isDisabled = false, onPress, ...props }: ConnectButtonProps) {
	return (
		<Tooltip content={isConnected ? 'Disconnect' : 'Connect'} showArrow>
			<Button {...props} isIconOnly isDisabled={isDisabled} color={isConnected ? 'danger' : 'primary'} variant='light' onPress={onPress}>
				{isConnected ? <Lucide.X /> : <Lucide.Plug />}
			</Button>
		</Tooltip>
	)
}
