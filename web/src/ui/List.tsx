import { cn } from 'cn'
import { Children, type ReactNode } from 'react'

export interface ListProps {
	readonly emptyText: string
	readonly className?: string
	readonly children?: ReactNode
}

export function List({ emptyText, className, children }: ListProps) {
	return <section className={cn('min-w-0 text-ink-100', className)}>{Children.count(children) ? <ul className="m-0 list-none p-0">{children}</ul> : <p className="m-0 px-6 py-8 text-center text-[13px] leading-5 text-ink-300">{emptyText}</p>}</section>
}

export interface ListItemProps {
	readonly title: ReactNode
	readonly description?: ReactNode
	readonly meta?: ReactNode
	readonly selected?: boolean
	readonly onClick: () => void
}

export function ListItem({ title, description, meta, selected = false, onClick }: ListItemProps) {
	return (
		<li className="not-first:border-t not-first:border-line-100">
			<button
				type="button"
				onClick={onClick}
				className={cn(
					'group m-0 box-border flex w-full cursor-pointer items-center gap-4 rounded-md border-0 px-3 py-4 text-left font-mono text-inherit transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
					selected ? 'bg-accent-subtle shadow-[inset_2px_0_0_var(--color-accent)]' : 'bg-transparent hover:bg-base-300',
				)}
			>
				<span className="flex min-w-0 flex-auto flex-col gap-0.5">
					<span className={cn('text-[15px] leading-[22px] font-medium wrap-break-word', selected ? 'text-accent' : 'text-ink-100')}>{title}</span>
					{description && <span className="text-[13px] leading-5 text-ink-200">{description}</span>}
				</span>
				{meta && <span className="flex-none text-[13px] leading-5 whitespace-nowrap text-ink-300 tabular-nums">{meta}</span>}
				<span className="mr-0.5 size-[7px] flex-[0_0_8px] rotate-45 border-t-[1.5px] border-r-[1.5px] border-ink-300 transition-[translate,border-color] duration-150 group-hover:translate-x-0.5 group-hover:border-accent" />
			</button>
		</li>
	)
}
