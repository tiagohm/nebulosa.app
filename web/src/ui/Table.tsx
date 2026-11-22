import { cn } from 'cn'
import { Fragment, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icon'
import { moveIndex } from './navigation'
import { useRowWindow } from './virtual'

// Compact data tables of the tools: a frame that scrolls itself under a sticky header, header labels that may order the
// table, rows that may select what they show, rows that head a group of them, and cells of text or numbers. A selectable
// row is reached with Tab, moves to its selectable siblings with the arrow keys, Home, and End, skipping the group
// headings, and selects with Enter or Space, like every other list of the app; a key pressed on a control inside a row is
// left to that control. A virtual table holds any number of plain one-line rows and draws only the ones in view.

// Column of a table: a plain label, or a label with a stable key that may be a control (such as a sort button) and may hold
// numbers, aligned to the end.
export type TableColumn =
	| string
	| {
			// Identity of the column among its siblings.
			readonly key: string
			// Header content.
			readonly label: ReactNode
			// Whether the column holds numbers, aligned to the end.
			readonly numeric?: boolean
			// Classes of the header cell, such as the width below which the column is hidden; its cells take the same.
			readonly className?: string
	  }

export interface TableProps {
	// Columns, in order.
	readonly columns: readonly TableColumn[]
	// Classes of the scrolling frame, such as `shrink-0` to keep its height or `flex-1` to fill a column.
	readonly className?: string
	// Rows.
	readonly children: ReactNode
}

// Table with a sticky header, in a bordered frame that scrolls itself.
export function Table({ columns, className, children }: TableProps) {
	return (
		<div className={cn('min-h-0 overflow-auto rounded-md border border-line-100', className)}>
			<table className="w-full border-collapse text-xs text-ink-200 tabular-nums">
				<thead className="sticky top-0 z-1 bg-base-100">
					<tr className="border-b border-line-100">
						{columns.map((column) =>
							typeof column === 'string' ? (
								<HeaderCell key={column}>{column}</HeaderCell>
							) : (
								<HeaderCell key={column.key} numeric={column.numeric} className={column.className}>
									{column.label}
								</HeaderCell>
							),
						)}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	)
}

export interface VirtualTableProps<T> {
	// Columns, in order.
	readonly columns: readonly TableColumn[]
	// Rows, in order.
	readonly rows: readonly T[]
	// Identity of a row, stable across renders.
	readonly rowKey: (row: T) => string | number
	// The Row of an item, with one Cell per column; its cells stay on one line, so every row has the same height.
	readonly renderRow: (row: T) => ReactNode
	// Classes of the scrolling frame, which must bound its height, such as `h-96` or `min-h-48 flex-1` in a column.
	readonly className?: string
}

// Height of a row before one is measured, in pixels: a 14 px line between 5.25 px paddings and a 1 px border.
const ESTIMATED_ROW_HEIGHT = 25.5

// Table of any number of rows, in the frame and with the sticky header of Table, that draws only the rows in view between
// two empty rows standing for the others. The height of a row is measured from a drawn one, and each column keeps the
// widest width it has had since the rows changed, so the columns do not shift as other rows scroll into view.
export function VirtualTable<T>({ columns, rows, rowKey, renderRow, className }: VirtualTableProps<T>) {
	const [pitch, setPitch] = useState(ESTIMATED_ROW_HEIGHT)
	const [header, setHeader] = useState(0)
	const headRef = useRef<HTMLTableSectionElement>(null)
	const bodyRef = useRef<HTMLTableSectionElement>(null)
	// Widest width of each column since the rows changed, in pixels.
	const widths = useRef<{ rows: readonly T[]; values: number[] }>({ rows, values: [] })
	const { first, last, frameRef, onScroll } = useRowWindow(rows.length, pitch, header)

	// Measures the header and a drawn row, and keeps every column at the widest width it has had for these rows.
	useLayoutEffect(() => {
		const head = headRef.current
		const row = bodyRef.current?.querySelector<HTMLTableRowElement>(':scope > tr:not([data-spacer])')
		if (head && head.offsetHeight !== header) setHeader(head.offsetHeight)
		if (row) {
			const height = row.getBoundingClientRect().height
			if (Math.abs(height - pitch) > 0.01) setPitch(height)
		}

		if (widths.current.rows !== rows) widths.current = { rows, values: [] }
		const cells = head?.rows[0]?.cells

		if (cells) {
			const values = widths.current.values

			for (let i = 0; i < cells.length; i++) {
				const cell = cells[i]
				if (values[i] === undefined) cell.style.minWidth = ''
				const width = cell.getBoundingClientRect().width
				if (width > (values[i] ?? 0)) {
					values[i] = width
					cell.style.minWidth = `${width}px`
				}
			}
		}
	})

	const drawn: ReactNode[] = []
	for (let index = first; index < last; index++) drawn.push(<Fragment key={rowKey(rows[index])}>{renderRow(rows[index])}</Fragment>)

	return (
		<div ref={frameRef} onScroll={onScroll} className={cn('min-h-0 overflow-auto rounded-md border border-line-100', className)}>
			<table className="w-full border-collapse text-xs text-ink-200 tabular-nums">
				<thead ref={headRef} className="sticky top-0 z-1 bg-base-100">
					<tr className="border-b border-line-100">
						{columns.map((column) =>
							typeof column === 'string' ? (
								<HeaderCell key={column}>{column}</HeaderCell>
							) : (
								<HeaderCell key={column.key} numeric={column.numeric} className={column.className}>
									{column.label}
								</HeaderCell>
							),
						)}
					</tr>
				</thead>
				<tbody ref={bodyRef} className="[&_td]:whitespace-nowrap">
					{first > 0 && <tr data-spacer style={{ height: first * pitch }} />}
					{drawn}
					{last < rows.length && <tr data-spacer style={{ height: (rows.length - last) * pitch }} />}
				</tbody>
			</table>
		</div>
	)
}

// Header cell of a column.
function HeaderCell({ numeric = false, className, children }: { readonly numeric?: boolean; readonly className?: string; readonly children: ReactNode }) {
	return <th className={cn('px-2 py-1.5 font-medium whitespace-nowrap text-ink-300', numeric ? 'text-right' : 'text-left', className)}>{children}</th>
}

export interface SortHeaderProps {
	// Direction of the arrow while the column orders the table ('down' for descending, or the natural order of a column that
	// has one), or undefined while another column orders it.
	readonly direction?: 'up' | 'down'
	// Tooltip, saying what ordering by the column does.
	readonly title: string
	// Orders the table by the column, or reverses the order when it already does.
	readonly onClick: () => void
	// Header text.
	readonly children: ReactNode
}

// Label of a column header that orders the table: in the accent colour with an arrow of its direction while it orders it.
export function SortHeader({ direction, title, onClick, children }: SortHeaderProps) {
	return (
		<button
			type="button"
			title={title}
			onClick={onClick}
			className={cn('inline-flex cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent p-0 font-mono text-xs font-medium whitespace-nowrap hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent', direction ? 'text-accent' : 'text-ink-300')}
		>
			{children}
			{direction && <Icon name="arrow" className={cn('size-3', direction === 'down' && 'rotate-180')} />}
		</button>
	)
}

export interface RowProps {
	// Whether the row shows what is selected.
	readonly selected?: boolean
	// Selects what the row shows, by a click, Enter, or Space; without it the row is plain.
	readonly onSelect?: () => void
	// Tooltip of the row.
	readonly title?: string
	// Cells.
	readonly children: ReactNode
}

// Row of a table, selectable when it has onSelect.
export function Row({ selected = false, onSelect, title, children }: RowProps) {
	// Selects on Enter or Space, and moves the focus to a sibling row on a navigation key. Keys pressed on a control of
	// the row are that control's.
	function press(event: KeyboardEvent<HTMLTableRowElement>) {
		if (event.target !== event.currentTarget || !onSelect) return

		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault()
			onSelect()
			return
		}

		const siblings = event.currentTarget.parentElement?.children
		if (!siblings) return
		const rows = Array.from(siblings as HTMLCollectionOf<HTMLElement>).filter((row) => row.tabIndex >= 0)
		const next = moveIndex(rows.indexOf(event.currentTarget), rows.length, event.key)
		if (next === undefined) return
		event.preventDefault()
		rows[next].focus()
	}

	return (
		<tr
			title={title}
			data-selected={selected || undefined}
			tabIndex={onSelect ? 0 : undefined}
			onClick={onSelect}
			onKeyDown={onSelect ? press : undefined}
			className={cn('border-b border-line-100 last:border-b-0', onSelect && 'cursor-pointer hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', selected && 'bg-accent-subtle hover:bg-accent-subtle')}
		>
			{children}
		</tr>
	)
}

export interface GroupRowProps {
	// Number of columns the heading spans.
	readonly span: number
	// Heading of the group.
	readonly children: ReactNode
}

// Row heading the rows after it, such as the night they belong to, in the uppercase label style; not selectable.
export function GroupRow({ span, children }: GroupRowProps) {
	return (
		<tr className="border-b border-line-100">
			<th colSpan={span} className="bg-base-000 px-2 pt-3 pb-1 text-left text-xs font-medium tracking-[0.08em] whitespace-nowrap text-ink-300 uppercase">
				{children}
			</th>
		</tr>
	)
}

export interface CellProps {
	// Whether the cell holds a number, aligned to the end.
	readonly numeric?: boolean
	// Classes of the cell, such as a tone or a width.
	readonly className?: string
	// Tooltip of the cell, such as the full text of a truncated one.
	readonly title?: string
	// Content.
	readonly children?: ReactNode
}

// Cell of a row, on one line.
export function Cell({ numeric = false, className, title, children }: CellProps) {
	return (
		<td title={title} className={cn('px-2 py-1.5 whitespace-pre-wrap', numeric && 'text-right', className)}>
			{children}
		</td>
	)
}
