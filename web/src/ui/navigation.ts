// Pure keyboard and open-state helpers shared by the navigation menu components.

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

// Opens the menu id at depth, where 0 is the root menu bar: menus at depth and deeper are closed first,
// so opening a sibling replaces it and any submenus it had open.
export function openAt(path: MenuPath, depth: number, id: string): MenuPath {
	return [...path.slice(0, depth), id]
}

// Closes the menu at depth and every submenu below it; depth 0 closes everything.
export function closeFrom(path: MenuPath, depth: number): MenuPath {
	return path.slice(0, depth)
}
