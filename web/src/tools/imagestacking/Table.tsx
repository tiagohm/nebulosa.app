import { cn } from 'cn'

// Compact tables of Image Stacking: a sticky header over rows that may select what they show.

// Table with a sticky header. It shrinks to scroll inside its column unless `className` says otherwise.
export function Table({ headers, className, children }: { readonly headers: readonly string[]; readonly className?: string; readonly children: React.ReactNode }) {
	return (
		<div className={cn('min-h-0 overflow-auto rounded-md border border-line-100', className)}>
			<table className="w-full border-collapse text-xs text-ink-200 tabular-nums">
				<thead className="sticky top-0 z-1 bg-base-100">
					<tr className="border-b border-line-100">
						{headers.map((header) => (
							<th key={header} className="px-2 py-1.5 text-left font-medium whitespace-nowrap text-ink-300">
								{header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	)
}

// Row that selects what it shows, when it can.
export function Row({ selected = false, onClick, children }: { readonly selected?: boolean; readonly onClick?: () => void; readonly children: React.ReactNode }) {
	return (
		<tr onClick={onClick} className={cn('border-b border-line-100 last:border-b-0', onClick && 'cursor-pointer hover:bg-base-200', selected && 'bg-accent-subtle')}>
			{children}
		</tr>
	)
}

// Cell of a row.
export function Cell({ children, className }: { readonly children?: React.ReactNode; readonly className?: string }) {
	return <td className={cn('px-2 py-1.5 whitespace-nowrap', className)}>{children}</td>
}
