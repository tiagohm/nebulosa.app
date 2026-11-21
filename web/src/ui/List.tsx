import { cn } from 'cn'
import { Children, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef } from 'react'
import { moveIndex } from './navigation'

// Selectable list of items, each a button with a title, an optional description and trailing meta, and a chevron when
// choosing it opens the item beside or in place of the list. The list is one Tab stop, the focused item, else the
// selected one, else the first; the arrow keys, Home, and End move the focus between its items, and Enter or Space
// activates the focused one.

// Properties of a list.
export interface ListProps {
	// Text shown in place of the list when it has no items.
	readonly emptyText: string
	// Classes of the list's root.
	readonly className?: string
	// The list's ListItem elements.
	readonly children?: ReactNode
}

// Returns the item buttons of a list, in order.
function itemButtons(list: HTMLUListElement): HTMLButtonElement[] {
	return Array.from(list.querySelectorAll<HTMLButtonElement>(':scope > li > button'))
}

// Leaves one item of a list in the Tab order: the focused item, else the selected one, else the first.
function setTabStop(list: HTMLUListElement | null) {
	if (!list) return
	const buttons = itemButtons(list)
	const stop = buttons.find((b) => b === document.activeElement) ?? buttons.find((b) => b.dataset.selected !== undefined) ?? buttons[0]
	for (const button of buttons) button.tabIndex = button === stop ? 0 : -1
}

// Moves the focus between the item buttons of a list with the arrow keys, Home, and End, wrapping at both ends.
function handleKeyDown(e: KeyboardEvent<HTMLUListElement>) {
	const buttons = itemButtons(e.currentTarget)
	const index = moveIndex(buttons.indexOf(document.activeElement as HTMLButtonElement), buttons.length, e.key)
	if (index === undefined) return
	e.preventDefault()
	buttons[index]?.focus()
}

// List of items, or its empty text when it has none.
export function List({ emptyText, className, children }: ListProps) {
	const listRef = useRef<HTMLUListElement>(null)

	// Moves the Tab stop after every render, as items come, go, or change their selection.
	useLayoutEffect(() => setTabStop(listRef.current))

	return (
		<section className={cn('min-w-0 text-ink-100', className)}>
			{Children.count(children) ? (
				<ul ref={listRef} onKeyDown={handleKeyDown} onFocus={(e) => setTabStop(e.currentTarget)} className="m-0 list-none p-0">
					{children}
				</ul>
			) : (
				<p className="m-0 px-6 py-8 text-center text-sm leading-5 text-ink-300">{emptyText}</p>
			)}
		</section>
	)
}

// Properties of a list item.
export interface ListItemProps {
	// Name of the item.
	readonly title: ReactNode
	// Secondary line under the title.
	readonly description?: ReactNode
	// Trailing content before the chevron, such as a count or a status badge.
	readonly meta?: ReactNode
	// Whether the item is the selected one, marked in Ember and named "Selected" for screen readers.
	readonly selected?: boolean
	// Whether the item takes the focus when it mounts and when the modal holding it opens.
	readonly autoFocus?: boolean
	// Whether choosing the item opens it, such as in the detail pane beside a sidebar list, which draws a chevron; a list
	// whose items are only highlighted for the actions under it has none.
	readonly opens?: boolean
	// Activates the item.
	readonly onClick: () => void
}

// Item of a list: one button, highlighted while selected, in the Tab order only while it is the list's Tab stop.
export function ListItem({ title, description, meta, selected = false, autoFocus = false, opens = false, onClick }: ListItemProps) {
	return (
		<li className="mb-1">
			<button
				type="button"
				onClick={onClick}
				autoFocus={autoFocus}
				data-autofocus={autoFocus || undefined}
				data-selected={selected || undefined}
				className={cn(
					'group m-0 box-border flex w-full cursor-pointer items-center gap-4 rounded-md border-0 px-3 py-3 text-left font-mono text-inherit transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
					selected ? 'bg-accent-subtle' : 'bg-transparent hover:bg-base-300',
				)}
			>
				<span className="flex min-w-0 flex-auto flex-col gap-0.5">
					<span className={cn('leading-6 font-medium wrap-break-word', selected ? 'text-accent' : 'text-ink-100')}>{title}</span>
					{description && <span className="text-sm leading-5 text-ink-200">{description}</span>}
				</span>
				{meta && <span className="flex-none text-sm leading-5 whitespace-nowrap text-ink-300 tabular-nums">{meta}</span>}
				{opens && <span className="mr-0.5 size-2 flex-[0_0_8px] rotate-45 border-t-[1.5px] border-r-[1.5px] border-ink-300 transition-[translate,border-color] duration-150 group-hover:translate-x-0.5 group-hover:border-accent" />}
			</button>
		</li>
	)
}
