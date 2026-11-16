// Pure keyboard and open-state helpers shared by the navigation menu components, the lists, and the wrapping grids.

// Ids of the open root menu followed by its open cascading submenus, outermost first. Empty when every menu is closed.
export type MenuPath = readonly string[]

// Returns the index a navigation key moves to among count items, wrapping at both ends. ArrowDown and
// ArrowRight move forward, ArrowUp and ArrowLeft move back, Home and End jump to the ends. An index of -1
// means no item is current yet, so forward keys land on the first item and back keys on the last.
// Returns undefined for other keys or when there are no items.
export function moveIndex(index: number, count: number, key: string): number | undefined {
	if (count <= 0) return undefined

	switch (key) {
		case 'ArrowDown':
		case 'ArrowRight':
			return index < 0 ? 0 : (index + 1) % count
		case 'ArrowUp':
		case 'ArrowLeft':
			return index < 0 ? count - 1 : (index - 1 + count) % count
		case 'Home':
			return 0
		case 'End':
			return count - 1
		default:
			return undefined
	}
}

// Box of an item of a wrapping grid, in CSS pixels relative to the viewport (getBoundingClientRect).
export interface GridItemBox {
	// Distance of the item's top edge from the top of the viewport.
	readonly top: number
	// Distance of the item's left edge from the left of the viewport.
	readonly left: number
	// Width of the item.
	readonly width: number
}

// Items whose tops differ by at most this many CSS pixels sit in one row, which absorbs subpixel layout.
const SAME_ROW_TOLERANCE = 1

// Returns the index a navigation key moves to among the items of a wrapping grid, listed in reading order: ArrowUp and
// ArrowDown move to the item of the row above or below whose center is closest horizontally to the current one's, and
// stay at the first or last row, while ArrowLeft, ArrowRight, Home, and End move in reading order as moveIndex does.
// Rows are read from the boxes, so the grid may reflow at any width and span several sections. Returns undefined for
// other keys or when there are no items.
export function moveInRows(boxes: readonly GridItemBox[], index: number, key: string): number | undefined {
	const current = boxes[index]
	if ((key !== 'ArrowUp' && key !== 'ArrowDown') || current === undefined) return moveIndex(index, boxes.length, key)

	const down = key === 'ArrowDown'
	const candidates = boxes.map((box, i) => ({ box, i })).filter(({ box }) => (down ? box.top > current.top + SAME_ROW_TOLERANCE : box.top < current.top - SAME_ROW_TOLERANCE))
	if (candidates.length === 0) return index

	const rowTop = down ? Math.min(...candidates.map(({ box }) => box.top)) : Math.max(...candidates.map(({ box }) => box.top))
	const center = current.left + current.width / 2
	const distance = (box: GridItemBox) => Math.abs(box.left + box.width / 2 - center)
	let closest = index
	let closestDistance = Infinity
	for (const { box, i } of candidates) {
		if (Math.abs(box.top - rowTop) > SAME_ROW_TOLERANCE || distance(box) >= closestDistance) continue
		closest = i
		closestDistance = distance(box)
	}
	return closest
}

// Opens the menu id at depth, where 0 is the root menu bar: menus at depth and deeper are closed first,
// so opening a sibling replaces it and any submenus it had open.
export function openAt(path: MenuPath, depth: number, id: string): MenuPath {
	return [...path.slice(0, depth), id]
}

// Closes the menu at depth and every submenu below it; depth 0 closes everything.
export function closeFrom(path: MenuPath, depth: number): MenuPath {
	return path.slice(0, depth)
}
