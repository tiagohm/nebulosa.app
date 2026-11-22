import { cn } from 'cn'
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Field, inputClassName } from './Field'
import { LIST_MAX_HEIGHT, listPlacement, type SelectProps } from './Select'
import { selectRows, useRowWindow, useSearch } from './virtual'

// Select of any number of options: the same trigger and floating list as Select, but the list draws only the options in
// view, each one line of one fixed height (the reason an option cannot be chosen sits at its right end, whole in its
// tooltip), and may lead with a search field that narrows the options to the ones whose text has every word typed. While
// searchable, the field takes the focus as the list opens, a letter typed on the closed trigger opens it with that letter
// searched, and the arrow keys, Page Up, Page Down, Enter, Escape, and Tab work from the field; otherwise the trigger keeps
// the focus and also takes Home, End, Space, and type-ahead, as in Select.

// Height of an option or a group heading, in pixels: one 17.5 px line between 7 px paddings.
const OPTION_HEIGHT = 31.5

// Space between the list's edge and its first and last rows, in pixels.
const LIST_INSET = 3.5

// Time after which a typed letter starts a new type-ahead search instead of extending it, in milliseconds.
const TYPE_AHEAD_MS = 600

// Properties of a virtual select.
export interface VirtualSelectProps<T extends string> extends SelectProps<T> {
	// Whether the open list leads with a field that searches the options by their display text; keep `format` stable
	// (memoized on what it reads) so the texts are not rebuilt on every render.
	readonly searchable?: boolean
	// Placeholder of the search field.
	readonly searchPlaceholder?: string
}

// Virtual select with an optional search.
export function VirtualSelect<T extends string>({ label, options, value, onChange, className, format = String, disabledReason, disabled = false, group, title, searchable = false, searchPlaceholder = 'Search…' }: VirtualSelectProps<T>) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [active, setActive] = useState(-1)
	const [up, setUp] = useState(false)
	// Height available to the open list on its side, in pixels; undefined keeps the default maximum.
	const [room, setRoom] = useState<number>()
	const rootRef = useRef<HTMLDivElement>(null)
	const triggerRef = useRef<HTMLButtonElement>(null)
	const searchRef = useRef<HTMLInputElement>(null)
	const typed = useRef({ text: '', time: 0 })
	const shown = useSearch(options, searchable ? format : undefined, query)
	const total = shown?.length ?? options.length
	const selectedIndex = options.indexOf(value)
	const selectedPosition = shown ? shown.indexOf(selectedIndex) : selectedIndex
	// Rows with the group headings; absent when ungrouped, where the row of an option is its position.
	const grouped = useMemo(() => group && selectRows(total, (position) => group(options[shown ? shown[position] : position])), [group, total, options, shown])
	const rowCount = grouped?.rows.length ?? total
	const { first, last, frameRef, onScroll, reveal, rewind } = useRowWindow(rowCount, OPTION_HEIGHT, LIST_INSET)
	const current = active < total ? active : -1

	function optionAt(position: number) {
		return options[shown ? shown[position] : position]
	}

	function rowOf(position: number) {
		return grouped ? grouped.rowOf[position] : position
	}

	function moveTo(position: number) {
		setActive(position)
		reveal(rowOf(position))
	}

	function openList(at: number, search: string = '') {
		const trigger = triggerRef.current

		if (trigger) {
			const placement = listPlacement(trigger)
			setUp(placement.up)
			setRoom(placement.room)
		}

		setQuery(search)
		setActive(search ? 0 : at)
		setOpen(true)
	}

	function close(refocus: boolean) {
		setOpen(false)
		setQuery('')
		if (refocus) triggerRef.current?.focus()
	}

	function choose(position: number) {
		const option = position >= 0 ? optionAt(position) : undefined
		if (option === undefined || disabledReason?.(option)) return
		if (option !== value) onChange(option)
		close(true)
	}

	function typeAhead(key: string) {
		const now = Date.now()
		const state = typed.current
		state.text = (now - state.time > TYPE_AHEAD_MS ? '' : state.text) + key.toLowerCase()
		state.time = now

		const from = open ? current : selectedIndex
		const offset = state.text.length > 1 ? 0 : 1

		for (let k = 0; k < options.length; k++) {
			const index = (((from + offset + k) % options.length) + options.length) % options.length
			const option = options[index]

			if (option !== undefined && format(option).toLowerCase().startsWith(state.text)) {
				if (open) moveTo(index)
				else choose(index)
				return
			}
		}
	}

	// Keys of the open list, from the trigger or the search field; returns whether the key was handled.
	function handleListKey(e: KeyboardEvent<HTMLElement>) {
		const { key } = e
		const page = Math.max(1, Math.floor(((room === undefined ? LIST_MAX_HEIGHT : Math.min(room, LIST_MAX_HEIGHT)) - LIST_INSET * 2) / OPTION_HEIGHT) - 1)

		if (key === 'ArrowDown' || key === 'PageDown') {
			if (total > 0) moveTo(Math.min(total - 1, current + (key === 'PageDown' ? page : 1)))
		} else if (key === 'ArrowUp' && e.altKey) {
			choose(current)
		} else if (key === 'ArrowUp' || key === 'PageUp') {
			if (total > 0) moveTo(Math.max(0, current - (key === 'PageUp' ? page : 1)))
		} else if (key === 'Enter') {
			choose(current)
		} else if (key === 'Escape') {
			// Also keeps an enclosing dialog from closing.
			close(true)
		} else if (key === 'Tab') {
			if (current >= 0 && optionAt(current) !== value) choose(current)
			else close(false)
			return true
		} else {
			return false
		}

		e.preventDefault()
		return true
	}

	function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
		const { key } = e
		const printable = key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

		if (!open) {
			if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
				e.preventDefault()
				openList(Math.max(0, selectedIndex))
			} else if (key === 'Home' || key === 'End') {
				e.preventDefault()
				openList(key === 'Home' ? 0 : options.length - 1)
			} else if (printable && searchable) {
				e.preventDefault()
				openList(0, key)
			} else if (printable) {
				typeAhead(key)
			}

			return
		}

		if (handleListKey(e)) return

		if (key === 'Home' || key === 'End') {
			e.preventDefault()
			moveTo(key === 'Home' ? 0 : total - 1)
		} else if (key === ' ') {
			e.preventDefault()
			choose(current)
		} else if (printable) {
			typeAhead(key)
		}
	}

	useEffect(() => {
		if (!open) return

		function handlePointerDown(e: MouseEvent) {
			if (e.target instanceof Node && !rootRef.current?.contains(e.target)) close(false)
		}

		document.addEventListener('mousedown', handlePointerDown)
		return () => document.removeEventListener('mousedown', handlePointerDown)
	}, [open])

	// As the list opens, centres its active option and gives the focus to the search field.
	useLayoutEffect(() => {
		if (!open) return
		reveal(rowOf(active), true)
		searchRef.current?.focus()
		// Runs only as the list opens; the keys reveal the options they move to themselves.
	}, [open])

	const rows: ReactNode[] = []

	if (open) {
		for (let row = first; row < last; row++) {
			const item = grouped?.rows[row]
			const top = LIST_INSET + row * OPTION_HEIGHT

			if (item?.kind === 'heading') {
				rows.push(
					<div key={`group:${row}`} style={{ top, height: OPTION_HEIGHT }} className={cn('absolute inset-x-1 box-border flex items-end truncate px-2 pb-1.5 text-xs font-medium tracking-wide text-ink-300 uppercase select-none', row > 0 && 'border-t border-line-100')}>
						{item.text}
					</div>,
				)
				continue
			}

			const position = item?.kind === 'option' ? item.position : row
			const index = shown ? shown[position] : position
			const option = options[index]
			const reason = disabledReason?.(option)
			const isSelected = index === selectedIndex

			rows.push(
				<div
					key={option}
					title={reason}
					onMouseMove={() => position !== current && setActive(position)}
					onClick={() => choose(position)}
					style={{ top, height: OPTION_HEIGHT }}
					className={cn(
						'absolute inset-x-1 box-border flex items-center gap-2 rounded-sm pr-3 pl-2 select-none',
						reason ? 'cursor-not-allowed text-ink-300' : 'cursor-pointer',
						position === current && (isSelected && !reason ? 'bg-accent-subtle' : 'bg-base-300'),
						!reason && (isSelected ? 'text-accent' : 'text-ink-100'),
					)}
				>
					<span className={cn('relative h-5 flex-[0_0_16px]', isSelected && "after:absolute after:top-1 after:left-2 after:h-3 after:w-1 after:rotate-45 after:border-r-2 after:border-b-2 after:border-accent after:content-['']")} />
					<span className="min-w-0 flex-auto truncate">{format(option)}</span>
					{reason && <span className="max-w-1/2 flex-none truncate text-xs leading-4">{reason}</span>}
				</div>,
			)
		}
	}

	return (
		<Field label={label} className={cn('min-w-0 flex-1', className)}>
			<div ref={rootRef} className="relative">
				<button
					ref={triggerRef}
					type="button"
					role="combobox"
					title={title ?? label}
					disabled={disabled}
					onClick={() => (open ? close(false) : openList(Math.max(0, selectedIndex)))}
					onKeyDown={handleTriggerKeyDown}
					className={cn(inputClassName, 'flex cursor-pointer items-center gap-2 pr-9 text-left select-none', open && 'border-accent outline-2 -outline-offset-1 outline-accent')}
				>
					<span className="min-w-0 flex-1 truncate">{format(value)}</span>
					<span className={cn('pointer-events-none absolute top-1/2 right-3.5 size-2 rotate-45 border-r-[1.5px] border-b-[1.5px] border-ink-200 transition-[rotate,margin-top] duration-150', open ? '-mt-0.5 -rotate-135 border-accent' : '-mt-1.5')} />
				</button>
				{open && (
					<div
						style={{ maxHeight: room === undefined ? LIST_MAX_HEIGHT : Math.min(room, LIST_MAX_HEIGHT) }}
						className={cn('absolute inset-x-0 z-20 box-border flex flex-col overflow-hidden rounded-md border border-line-100 bg-base-200 text-sm leading-5 shadow-[0_12px_32px_rgb(0_0_0/0.45)]', up ? 'bottom-[calc(100%+4px)]' : 'top-[calc(100%+4px)]')}
					>
						{searchable && (
							<div className="flex-none border-b border-line-100 p-1">
								<input
									ref={searchRef}
									type="text"
									value={query}
									placeholder={searchPlaceholder}
									title={`Search ${label ?? title ?? 'the options'}`}
									autoCapitalize="off"
									autoComplete="off"
									spellCheck={false}
									onChange={(e) => {
										setQuery(e.target.value)
										setActive(0)
										rewind()
									}}
									onKeyDown={handleListKey}
									className={inputClassName}
									data-1p-ignore
								/>
							</div>
						)}
						{total > 0 ? (
							<div ref={frameRef} tabIndex={-1} onScroll={onScroll} onMouseDown={(e) => e.preventDefault()} className="min-h-0 overflow-y-auto overscroll-contain">
								<div className="relative" style={{ height: rowCount * OPTION_HEIGHT + LIST_INSET * 2 }}>
									{rows}
								</div>
							</div>
						) : (
							<p className="m-0 px-3 py-2 text-ink-300">{query.trim() ? `Nothing matches “${query.trim()}”.` : 'No options.'}</p>
						)}
					</div>
				)}
			</div>
		</Field>
	)
}
