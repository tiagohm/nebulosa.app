import { tw } from '@/shared/util'

export interface LinkProps extends Omit<React.ComponentProps<'a'>, 'rel' | 'target'> {
	readonly label?: React.ReactNode
}

export function Link({ label, className, children, ...props }: LinkProps) {
	return (
		<span className={tw('w-full text-center text-xs text-neutral-500 hover:text-neutral-300', className)}>
			<a {...props} rel='noreferrer' target='_blank'>
				{children ?? label}
			</a>
		</span>
	)
}
