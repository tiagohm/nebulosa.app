import { Button } from './Button'

// Previous and next buttons of a paged list, with the position among its pages.

export interface PagerProps {
	// Page shown, from 0.
	readonly page: number
	// Number of items of every page together.
	readonly total: number
	// Number of items of a page.
	readonly pageSize: number
	// Plural name of the items, for the caption.
	readonly noun: string
	// Whether a page is being fetched, which disables both buttons.
	readonly loading?: boolean
	// Receives the page to show, from 0.
	readonly onPage: (page: number) => void
}

// Previous and next page of a list, shown only when it has more than one page.
export function Pager({ page, total, pageSize, noun, loading = false, onPage }: PagerProps) {
	const pages = Math.ceil(total / pageSize)
	if (pages < 2) return null

	return (
		<div className="flex items-center gap-2 text-xs text-ink-300 tabular-nums">
			<Button variant="secondary" disabled={page === 0 || loading} onClick={() => onPage(page - 1)}>
				Previous
			</Button>
			<span>{`Page ${page + 1} of ${pages} · ${total} ${noun}`}</span>
			<Button variant="secondary" disabled={page + 1 >= pages || loading} onClick={() => onPage(page + 1)}>
				Next
			</Button>
		</div>
	)
}
