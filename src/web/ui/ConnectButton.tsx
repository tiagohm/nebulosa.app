import { Button, type ButtonProps } from './components/Button'
import { Icons } from './Icon'

export interface ConnectButtonProps extends Omit<ButtonProps, 'color' | 'children'> {
	readonly isConnected: boolean
}

export function ConnectButton({ isConnected, ...props }: ConnectButtonProps) {
	return <Button children={isConnected ? <Icons.Close /> : <Icons.Connect />} color={isConnected ? 'danger' : 'primary'} hideChildrenOnLoading tooltipContent={isConnected ? 'Disconnect' : 'Connect'} {...props} />
}
