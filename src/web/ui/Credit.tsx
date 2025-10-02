import clsx from 'clsx'
import { memo } from 'react'

export interface CreditProps {
	readonly href: string
	readonly label?: string
	readonly children?: React.ReactNode
	readonly className?: string
}

export const Credit = memo(({ href, children, className, label }: CreditProps) => {
	return (
		<div className={clsx('w-full text-center text-xs text-neutral-500 hover:text-neutral-300', className)}>
			<a href={href} rel='noopener' target='_blank'>
				{children ?? label}
			</a>
		</div>
	)
})
