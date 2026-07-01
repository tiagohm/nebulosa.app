import { Children, Fragment, isValidElement, useCallback, useMemo } from 'react'
import { type ClassValue, tv } from 'tailwind-variants'
import { tw } from '@/shared/util'
import { List } from './List'

const tableStyles = tv({
	slots: {
		base: 'block min-w-0 overflow-hidden rounded-lg bg-neutral-900/70 text-sm text-neutral-100',
		header: 'grid min-w-0 grid-cols-(--table-columns) bg-neutral-950/70 text-xs font-bold text-neutral-500 uppercase',
		headerCell: 'min-w-0 truncate px-3 py-2',
		list: 'max-h-80 rounded-none bg-transparent text-neutral-100',
		row: 'grid grid-cols-(--table-columns) text-neutral-200',
		cell: 'flex min-w-0 items-center truncate px-3',
		empty: 'min-h-10',
	},
	variants: {
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
})

type TableStyle = React.CSSProperties & {
	readonly '--table-columns': string
}

export interface TableClassNames {
	readonly base?: ClassValue
	readonly header?: ClassValue
	readonly headerCell?: ClassValue
	readonly list?: ClassValue
	readonly row?: ClassValue
	readonly cell?: ClassValue
	readonly empty?: ClassValue
}

export interface TableProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'onChange'> {
	readonly children?: React.ReactNode
	readonly classNames?: TableClassNames
	readonly columnCount: number
	readonly emptyContent?: React.ReactNode
	readonly fullWidth?: boolean
	readonly onAction?: (rowIndex: number, cellIndex: number) => void
	readonly overscan?: number
	readonly rowCount: number
	readonly rowHeight?: number
}

// Normalizes columns to a valid grid column count.
function normalizeColumnCount(columnCount: number) {
	return Number.isFinite(columnCount) ? Math.max(1, Math.trunc(columnCount)) : 1
}

// Normalizes rows to the non-negative body count expected by List.
function normalizeRowCount(rowCount: number) {
	return Number.isFinite(rowCount) ? Math.max(0, Math.trunc(rowCount)) : 0
}

// Collects cell children while allowing fragments to group cells naturally.
function collectCells(children: React.ReactNode, cells: React.ReactNode[] = []) {
	for (const child of Children.toArray(children)) {
		if (isValidElement(child) && child.type === Fragment) {
			void collectCells((child.props as { children?: React.ReactNode }).children, cells)
			continue
		}

		cells.push(child)
	}

	return cells
}

// Reuses explicit React keys from cells when callers provide them.
function cellKey(cell: React.ReactNode, index: number) {
	return isValidElement(cell) && cell.key !== null ? cell.key : index
}

// Renders a fixed number of grid cells, leaving missing cells blank.
function renderCells(cells: readonly React.ReactNode[], startIndex: number, columnCount: number, className: string, rowIndex: number, onClick?: React.MouseEventHandler) {
	return Array.from({ length: columnCount }, (_, columnIndex) => {
		const cellIndex = startIndex + columnIndex
		const cell = cells[cellIndex]

		return (
			<div className={className} data-row={rowIndex} data-col={columnIndex} key={cellKey(cell, cellIndex)} onClick={onClick}>
				{cell}
			</div>
		)
	})
}

// Renders a simple virtualized table with a static header row and List-backed body rows.
export function Table({ children, className, classNames, columnCount, emptyContent = 'No rows', fullWidth, onAction, overscan, ref, rowCount, rowHeight, style, ...props }: TableProps) {
	const normalizedColumnCount = normalizeColumnCount(columnCount)
	const normalizedRowCount = normalizeRowCount(rowCount)
	const cells = useMemo(() => collectCells(children), [children])
	const styles = tableStyles({ fullWidth })
	const headerCellClassName = tw(styles.headerCell(), classNames?.headerCell)
	const cellClassName = tw(styles.cell(), classNames?.cell)
	const rowClassName = tw(styles.row(), onAction !== undefined && 'cursor-pointer', classNames?.row)
	const tableStyle = useMemo(() => ({ ...style, '--table-columns': `repeat(${normalizedColumnCount}, minmax(0, 1fr))` }), [normalizedColumnCount, style])

	function handleClick(event: React.MouseEvent<HTMLElement>) {
		const row = event.currentTarget.dataset.row
		const col = event.currentTarget.dataset.col

		if (row !== undefined && col !== undefined) {
			event.stopPropagation()
			onAction!(+row, +col)
		}
	}

	// Renders one body row from the flattened cell list after the header cells.
	const renderRow = useCallback(
		(rowIndex: number) => {
			const startIndex = normalizedColumnCount + rowIndex * normalizedColumnCount
			return renderCells(cells, startIndex, normalizedColumnCount, cellClassName, rowIndex, handleClick)
		},
		[normalizedColumnCount, cells, cellClassName, onAction],
	)

	return (
		<div {...props} className={tw(styles.base(), className, classNames?.base)} ref={ref} style={tableStyle}>
			<div className={tw(styles.header(), classNames?.header)}>{renderCells(cells, 0, normalizedColumnCount, headerCellClassName, -1)}</div>
			<List className={tw(styles.list(), classNames?.list)} classNames={{ empty: tw(styles.empty(), classNames?.empty), item: rowClassName }} emptyContent={emptyContent} itemCount={normalizedRowCount} itemHeight={rowHeight} overscan={overscan}>
				{renderRow}
			</List>
		</div>
	)
}
