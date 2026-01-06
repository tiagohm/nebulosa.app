import { Button, type ButtonProps } from '@heroui/react'

export interface TextButtonProps extends Omit<ButtonProps, 'children' | 'isIconOnly'> {
	readonly label: React.ReactNode
}

export function TextButton({ label, variant = 'flat', ...props }: TextButtonProps) {
	return (
		<Button variant={variant} {...props}>
			{label}
		</Button>
	)
}
