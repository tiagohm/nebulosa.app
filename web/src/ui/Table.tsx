import { cn } from 'cn'
import type { KeyboardEvent, ReactNode } from 'react'
import { moveIndex } from './navigation'

// Compact data tables of the tools: a frame that scrolls itself under a sticky header, rows that may select what they show,
// and cells of text or numbers. A selectable row is reached with Tab, moves to its siblings with the arrow keys, Home, and
// End, and selects with Enter or Space, like every other list of the app; a key pressed on a control inside a row is left to
// that control.

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
								<HeaderCell key={column.key} numeric={column.numeric}>
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

// Header cell of a column.
function HeaderCell({ numeric = false, children }: { readonly numeric?: boolean; readonly children: ReactNode }) {
	return <th className={cn('px-2 py-1.5 font-medium whitespace-nowrap text-ink-300', numeric ? 'text-right' : 'text-left')}>{children}</th>
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

		const rows = event.currentTarget.parentElement?.children
		if (!rows) return
		const next = moveIndex(Array.prototype.indexOf.call(rows, event.currentTarget), rows.length, event.key)
		if (next === undefined) return
		event.preventDefault()
		;(rows[next] as HTMLElement).focus()
	}

	return (
		<tr
			title={title}
			tabIndex={onSelect ? 0 : undefined}
			onClick={onSelect}
			onKeyDown={onSelect ? press : undefined}
			className={cn('border-b border-line-100 last:border-b-0', onSelect && 'cursor-pointer hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent', selected && 'bg-accent-subtle hover:bg-accent-subtle')}
		>
			{children}
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
		<td title={title} className={cn('px-2 py-1.5 whitespace-nowrap', numeric && 'text-right', className)}>
			{children}
		</td>
	)
}
