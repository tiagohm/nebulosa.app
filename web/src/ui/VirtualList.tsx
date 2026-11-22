import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { moveIndex } from './navigation'
import { TextInput } from './TextInput'
import { useRowWindow, useSearch } from './virtual'

// Selectable list of any number of items, in a bordered frame that scrolls itself and draws only the rows in view, each of
// one fixed height: a title, an optional description under it, both on one line cut with an ellipsis, trailing meta, and a
// chevron when choosing an item opens it. Without a selection handler it only shows its items. With a search text it leads with a search field that narrows the items to the
// ones whose text has every word typed, and a caption counting them. The frame is one Tab stop; the arrow keys, Page Up,
// Page Down, Home, and End move the focused row, Enter or Space selects it, and typing a letter goes to the search field,
// from which the down arrow comes back to the rows.

// Height of a row with a title alone, in pixels: one 17.5 px line between 7 px paddings.
const ROW_HEIGHT = 31.5

// Height of a row with a title and a description, in pixels: a 17.5 px and a 14 px line between 7 px paddings.
const DESCRIBED_ROW_HEIGHT = 45.5

// Space between two rows, in pixels.
const ROW_GAP = 3.5

// Space between the frame's edge and its first and last rows, in pixels.
const FRAME_INSET = 3.5

// Identity of an item among its siblings.
export type VirtualListKey = string | number

// Properties of a virtual list.
export interface VirtualListProps<T> {
	// Items, in order.
	readonly items: readonly T[]
	// Identity of an item, stable across renders.
	readonly itemKey: (item: T) => VirtualListKey
	// Name of an item, on one line.
	readonly title: (item: T) => ReactNode
	// Secondary line under the title; every row is the taller height when present.
	readonly description?: (item: T) => ReactNode
	// Trailing content of an item, such as a count, dates, or a status badge, at most 21 px tall.
	readonly meta?: (item: T) => ReactNode
	// Tooltip of an item, such as a name too long for its row.
	readonly tooltip?: (item: T) => string | undefined
	// Key of the selected item, marked in Ember.
	readonly selected?: VirtualListKey
	// Selects an item; without it the list only shows its items, which are neither highlighted nor focused one by one, and
	// the frame scrolls with the arrow keys as any other.
	readonly onSelect?: (item: T) => void
	// Whether choosing an item opens it beside or in place of the list, which draws a chevron.
	readonly opens?: boolean
	// Text shown in place of the list when it has no items.
	readonly emptyText: string
	// Text an item is searched by, which shows the search field; keep it stable (memoized on what it reads), since the
	// texts of every item are rebuilt when it changes.
	readonly search?: (item: T) => string
	// Placeholder of the search field.
	readonly searchPlaceholder?: string
	// Caption beside the search field from the shown and the total number of items; "shown of total" by default.
	readonly count?: (shown: number, total: number) => string
	// Text shown in place of the rows when no item matches the query; "Nothing matches “query”." by default.
	readonly noMatchText?: (query: string) => string
	// Classes of the root, which must bound its height, such as `h-96` or `min-h-0 flex-1` in a column.
	readonly className?: string
}

// Default caption of the search field.
function defaultCount(shown: number, total: number) {
	return shown === total ? `${total}` : `${shown} of ${total}`
}

// Default text of a search without matches.
function defaultNoMatch(query: string) {
	return `Nothing matches “${query}”.`
}

// Returns the position among the shown items of the item whose key is `key`, or -1 when it is not shown.
function positionOf<T>(items: readonly T[], shown: readonly number[] | undefined, itemKey: (item: T) => VirtualListKey, key: VirtualListKey | undefined) {
	if (key === undefined) return -1
	if (!shown) return items.findIndex((item) => itemKey(item) === key)
	return shown.findIndex((index) => itemKey(items[index]) === key)
}

// Virtual list of items, or its empty text when it has none.
export function VirtualList<T>({ items, itemKey, title, description, meta, tooltip, selected, onSelect, opens = false, emptyText, search, searchPlaceholder, count = defaultCount, noMatchText = defaultNoMatch, className }: VirtualListProps<T>) {
	const [query, setQuery] = useState('')
	const [active, setActive] = useState(-1)
	const searchRef = useRef<HTMLInputElement>(null)
	const shown = useSearch(items, search, query)
	const total = shown?.length ?? items.length
	const pitch = (description ? DESCRIBED_ROW_HEIGHT : ROW_HEIGHT) + ROW_GAP
	const { first, last, frame, frameRef, onScroll, reveal, rewind } = useRowWindow(total, pitch, FRAME_INSET)
	const selectedPosition = useMemo(() => positionOf(items, shown, itemKey, selected), [items, shown, itemKey, selected])
	// Row that the keys move from: the focused one while it is shown, else the selected one, else none.
	const current = active >= 0 && active < total ? active : selectedPosition
	const revealed = useRef<VirtualListKey | undefined>(undefined)

	// Brings the selected item into view when it mounts and whenever another item is selected, such as from another
	// screen, but not while the search changes what is shown.
	useLayoutEffect(() => {
		if (selected === revealed.current || selectedPosition < 0) return
		revealed.current = selected
		reveal(selectedPosition)
	}, [selected, selectedPosition, reveal])

	function itemAt(position: number) {
		return items[shown ? shown[position] : position]
	}

	function focusRow(position: number) {
		setActive(position)
		reveal(position)
	}

	function handleQuery(value: string) {
		setQuery(value)
		setActive(-1)
		rewind()
	}

	function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
		const { key } = e
		const page = Math.max(1, Math.floor((e.currentTarget.clientHeight - FRAME_INSET * 2) / pitch))
		const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

		if (!onSelect) {
			// Moves the focus before the key is handled, so the letter is typed in the search field.
			if (search && printable) searchRef.current?.focus()
		} else if (key === 'PageDown' || key === 'PageUp') {
			e.preventDefault()
			if (total > 0) focusRow(Math.min(total - 1, Math.max(0, Math.max(0, current) + (key === 'PageDown' ? page : -page))))
		} else if (key === 'Enter' || key === ' ') {
			e.preventDefault()
			const item = current >= 0 ? itemAt(current) : undefined
			if (item !== undefined) onSelect(item)
		} else if (search && printable) {
			searchRef.current?.focus()
		} else {
			const next = moveIndex(current, total, key)
			if (next === undefined) return
			e.preventDefault()
			focusRow(next)
		}
	}

	function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
		if (e.key !== 'ArrowDown' || total === 0) return
		e.preventDefault()
		if (onSelect) focusRow(Math.max(0, current))
		frame.current?.focus()
	}

	if (items.length === 0) return <p className={cn('m-0 px-6 py-8 text-center text-sm leading-5 text-ink-300', className)}>{emptyText}</p>

	const rows: ReactNode[] = []

	for (let position = first; position < last; position++) {
		const item = itemAt(position)
		const isSelected = position === selectedPosition

		rows.push(
			<div
				key={itemKey(item)}
				title={tooltip?.(item)}
				onClick={
					onSelect &&
					(() => {
						setActive(position)
						onSelect(item)
					})
				}
				style={{ top: FRAME_INSET + position * pitch, height: pitch - ROW_GAP }}
				className={cn(
					'group/row absolute inset-x-1 box-border flex items-center gap-4 rounded-md px-3',
					onSelect && 'cursor-pointer transition-colors duration-150 select-none',
					onSelect && (isSelected ? 'bg-accent-subtle' : 'hover:bg-base-300'),
					onSelect && position === current && 'group-focus-visible/list:outline-2 group-focus-visible/list:-outline-offset-2 group-focus-visible/list:outline-accent',
				)}
			>
				<span className="flex min-w-0 flex-auto flex-col">
					<span className={cn('truncate text-sm leading-5 font-medium', isSelected ? 'text-accent' : 'text-ink-100')}>{title(item)}</span>
					{description && <span className="truncate text-xs leading-4 text-ink-200">{description(item)}</span>}
				</span>
				{meta && <span className="flex flex-none items-center gap-2 text-xs leading-4 whitespace-nowrap text-ink-300 tabular-nums">{meta(item)}</span>}
				{opens && <span className="mr-0.5 size-2 flex-[0_0_8px] rotate-45 border-t-[1.5px] border-r-[1.5px] border-ink-300 transition-[translate,border-color] duration-150 group-hover/row:translate-x-0.5 group-hover/row:border-accent motion-reduce:transition-none" />}
			</div>,
		)
	}

	return (
		<section className={cn('flex min-h-0 min-w-0 flex-col gap-2 text-ink-100', className)}>
			{search && (
				<div className="flex flex-wrap items-end gap-x-3 gap-y-2">
					<TextInput ref={searchRef} label="Search" className="w-60 max-sm:w-full" value={query} placeholder={searchPlaceholder} onChange={(e) => handleQuery(e.target.value)} onKeyDown={handleSearchKeyDown} />
					<span className="pb-2 text-xs text-ink-300 tabular-nums">{count(total, items.length)}</span>
				</div>
			)}
			{total > 0 ? (
				<div
					ref={frameRef}
					tabIndex={0}
					onScroll={onScroll}
					onKeyDown={handleKeyDown}
					onFocus={(e) => onSelect && e.target === e.currentTarget && active < 0 && setActive(Math.max(0, selectedPosition))}
					className={cn(
						'group/list min-h-0 overflow-y-auto overscroll-contain rounded-md border border-line-100 transition-colors duration-150',
						// A selectable list rings its focused row; a list that only shows its items rings the frame.
						onSelect ? 'focus-visible:border-line-200 focus-visible:outline-none' : 'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-accent',
					)}
				>
					<div className="relative" style={{ height: total * pitch - ROW_GAP + FRAME_INSET * 2 }}>
						{rows}
					</div>
				</div>
			) : (
				<p className="m-0 rounded-md border border-line-100 px-6 py-8 text-center text-sm leading-5 text-ink-300">{noMatchText(query.trim())}</p>
			)}
		</section>
	)
}
