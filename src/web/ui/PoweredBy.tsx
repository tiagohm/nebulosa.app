import clsx from 'clsx'
import { memo } from 'react'

export interface PoweredByProps extends React.HTMLAttributes<HTMLDivElement> {
	readonly href: string
	readonly label?: string
}

export const PoweredBy = memo(({ href, children, className, label, ...props }: PoweredByProps) => {
	return (
		<div className={clsx('w-full text-center text-xs', className)} {...props}>
			<a className='text-neutral-500 hover:text-neutral-300' href={href} rel='noopener' target='_blank'>
				{children ?? label}
			</a>
		</div>
	)
})
