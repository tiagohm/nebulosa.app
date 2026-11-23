import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

// Windowing and filtering shared by the virtual list and the virtual select: rows of one fixed height in a frame that
// scrolls itself, of which only the rows in view (and a few around them) are drawn, so a list of any length costs the
// same to render and to scroll; and the word search that narrows the items to the ones whose text has every word.

// Rows drawn beyond each edge of the frame, so a fast scroll or a key press shows drawn rows before the next render.
export const OVERSCAN_ROWS = 6

// Rows of a list to draw, from first (inclusive) to last (exclusive); last may exceed the row count, which clamps it.
export interface RowRange {
	// Index of the first row to draw, at least 0.
	readonly first: number
	// Index after the last row to draw.
	readonly last: number
}

// Returns the rows to draw in a frame scrolled to `top` and `height` tall, in pixels, whose rows are `pitch` pixels apart
// below an `inset` of empty space, with `overscan` more rows beyond each edge.
export function rowRange(top: number, height: number, pitch: number, inset: number, overscan: number = OVERSCAN_ROWS): RowRange {
	const first = Math.max(0, Math.floor((top - inset) / pitch) - overscan)
	const last = Math.max(first, Math.ceil((top + height - inset) / pitch) + overscan)
	return { first, last }
}

// Returns the scroll offset, in pixels, that brings row `index` wholly into a frame scrolled to `top` and `height` tall,
// moving it as little as possible, or centred in the frame when `center`; undefined when the row is already in view and
// not to be centred.
export function revealOffset(index: number, top: number, height: number, pitch: number, inset: number, center: boolean = false): number | undefined {
	const start = inset + index * pitch
	const end = start + pitch
	if (center) return Math.max(0, start - (height - pitch) / 2)
	if (start < top) return start
	if (end > top + height) return end - height
	return undefined
}

// Returns text as the search compares it: lowercase, with the minus sign (U+2212) of typeset offsets and signed values
// read as the hyphen-minus a keyboard types, so "-03" finds "UTC−03:00".
export function searchText(text: string): string {
	return text.toLowerCase().replaceAll('−', '-')
}

// Returns the words of a search query as searchText compares them, split at white space; empty for a blank query.
export function searchWords(query: string): string[] {
	return searchText(query).split(/\s+/).filter(Boolean)
}

// Returns the indices, in order, of the texts, as searchText gives them, that contain every word, or undefined when there are no words,
// which keeps every item without allocating an index per item.
export function matchingIndices(texts: readonly string[], words: readonly string[]): readonly number[] | undefined {
	if (words.length === 0) return undefined
	const indices: number[] = []

	for (let i = 0; i < texts.length; i++) {
		const text = texts[i]
		if (words.every((word) => text.includes(word))) indices.push(i)
	}

	return indices
}

// Returns the indices, in order, of the items whose text (passed through searchText once per item, and only while the query has words)
// contains every word of `query`, or undefined while the query is blank or `text` is absent, which keeps every item. The
// search runs on every change of the query, never deferred, so what is shown always matches the field and a key pressed
// right after typing acts on it; pass a stable `text` (memoized on what it reads) so the texts are not rebuilt on every
// render.
export function useSearch<T>(items: readonly T[], text: ((item: T) => string) | undefined, query: string): readonly number[] | undefined {
	const words = useMemo(() => searchWords(query), [query])
	const searching = text !== undefined && words.length > 0
	const texts = useMemo(() => (searching ? items.map((item) => searchText(text(item))) : undefined), [items, text, searching])
	return useMemo(() => texts && matchingIndices(texts, words), [texts, words])
}

// Row of a virtual select: the heading of a group, or an option by its index among the shown options.
export type SelectRow = { readonly kind: 'heading'; readonly text: string } | { readonly kind: 'option'; readonly position: number }

// Rows of a virtual select and, for each shown option, the index of its row.
export interface SelectRows {
	readonly rows: readonly SelectRow[]
	// Row of each shown option, by its position among them.
	readonly rowOf: Int32Array
}

// Returns the rows of `count` shown options, the heading of a group drawn once above each run of options that `groupOf`
// (by position) places in it, or the options alone when `groupOf` is absent.
export function selectRows(count: number, groupOf?: (position: number) => string | undefined): SelectRows {
	const rowOf = new Int32Array(count)

	if (!groupOf) {
		const rows = new Array<SelectRow>(count)

		for (let i = 0; i < count; i++) {
			rows[i] = { kind: 'option', position: i }
			rowOf[i] = i
		}

		return { rows, rowOf }
	}

	const rows: SelectRow[] = []
	let previous: string | undefined

	for (let i = 0; i < count; i++) {
		const heading = groupOf(i)
		if (heading !== undefined && (i === 0 || heading !== previous)) rows.push({ kind: 'heading', text: heading })
		previous = heading
		rowOf[i] = rows.length
		rows.push({ kind: 'option', position: i })
	}

	return { rows, rowOf }
}

// Window of a frame of rows: the rows to draw, the ref and scroll handler of the frame, and how to scroll it.
export interface RowWindow {
	// First row to draw.
	readonly first: number
	// Row after the last one to draw, at most the row count.
	readonly last: number
	// The scrolling frame while it is mounted.
	readonly frame: RefObject<HTMLDivElement | null>
	// Ref of the scrolling frame; it measures the frame as it mounts and whenever it is resized.
	readonly frameRef: (element: HTMLDivElement | null) => (() => void) | undefined
	// Scroll handler of the frame.
	readonly onScroll: () => void
	// Scrolls the frame so the row of that index is wholly in view, or centred when `center`.
	readonly reveal: (index: number, center?: boolean) => void
	// Scrolls the frame back to its first row.
	readonly rewind: () => void
}

// Tracks which of `count` rows, `pitch` pixels apart below an `inset` of empty space, a scrolling frame shows. It renders
// again only when the range of rows to draw changes, not on every scrolled pixel, and a scroll it makes itself updates the
// range before the frame is painted, so the frame never shows a blank stretch.
export function useRowWindow(count: number, pitch: number, inset: number): RowWindow {
	const frame = useRef<HTMLDivElement | null>(null)
	const [range, setRange] = useState<RowRange>(() => rowRange(0, 0, pitch, inset))

	const update = useCallback(() => {
		const element = frame.current
		if (!element) return
		const next = rowRange(element.scrollTop, element.clientHeight, pitch, inset)
		setRange((current) => (current.first === next.first && current.last === next.last ? current : next))
	}, [pitch, inset])

	const frameRef = useCallback(
		(element: HTMLDivElement | null) => {
			frame.current = element
			if (!element) return undefined
			update()
			const observer = new ResizeObserver(update)
			observer.observe(element)
			return () => {
				observer.disconnect()
				if (frame.current === element) frame.current = null
			}
		},
		[update],
	)

	const reveal = useCallback(
		(index: number, center: boolean = false) => {
			const element = frame.current
			if (!element || index < 0) return
			const top = revealOffset(index, element.scrollTop, element.clientHeight, pitch, inset, center)
			if (top === undefined) return
			element.scrollTop = top
			update()
		},
		[pitch, inset, update],
	)

	const rewind = useCallback(() => {
		const element = frame.current
		if (!element || element.scrollTop === 0) return
		element.scrollTop = 0
		update()
	}, [update])

	// Keeps the range current when the frame keeps its scroll but the rows change, such as a filter shortening them.
	useLayoutEffect(update, [count, update])

	return { first: Math.min(range.first, count), last: Math.min(range.last, count), frame, frameRef, onScroll: update, reveal, rewind }
}
