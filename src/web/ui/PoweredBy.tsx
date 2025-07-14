import { Chip, type ChipProps } from '@heroui/react'

export interface PoweredByProps extends Omit<ChipProps, 'children' | 'size'> {
	readonly label: string
	readonly href: string
}

export function PoweredBy({ label, href, ...props }: PoweredByProps) {
	return (
		<Chip size='sm' {...props}>
			<a className='flex flex-row items-center gap-1' href={href} rel='noopener' target='_blank'>
				{label}
			</a>
		</Chip>
	)
}
