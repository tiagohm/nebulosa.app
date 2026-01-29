export interface LinkProps extends Omit<React.ComponentProps<'a'>, 'rel' | 'target'> {
	readonly label?: React.ReactNode
}

export function Link({ label, children, ...props }: LinkProps) {
	return (
		<a {...props} rel='noreferrer' target='_blank'>
			{children ?? label}
		</a>
	)
}
