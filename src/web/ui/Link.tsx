import clsx from 'clsx'

export interface LinkProps extends Omit<React.ComponentProps<'a'>, 'rel' | 'target'> {
	readonly label?: React.ReactNode
}

export function Link({ label, className, children, ...props }: LinkProps) {
	return (
		<a {...props} className={clsx('w-full text-center text-xs text-neutral-500 hover:text-neutral-300', className)} rel='noreferrer' target='_blank'>
			{children ?? label}
		</a>
	)
}
