import type { SpiceElementsObject } from 'api'

// Choices of the generations and the element imports of the SPICE Kernel Library: the durations a kernel covers from
// today, and the filtering, paging, marking, and estimate of the numbered asteroids of an imported file or MPC list. Pure,
// so the views keep only their transient state.

// Duration chosen first.
export const DEFAULT_WINDOW_MONTHS = 12

// Most objects one import integrates, as the server accepts them (MAX_IMPORTED_OBJECTS).
export const MAX_IMPORTED_OBJECTS = 10_000

// Rows of a page of the preview.
export const ELEMENTS_PAGE_SIZE = 50

// Approximate integration time of one object, in milliseconds per year integrated, over the server's workers together
// (11 perturbers, 3 workers; measured 16-34 ms per object over 2.5 years on one core).
const MS_PER_OBJECT_YEAR = 4

// Approximate size of one object in the kernel, in bytes per year written (about 60 states of 56 bytes a year).
const BYTES_PER_OBJECT_YEAR = 3500

// Years integrated besides the window: the elements' epoch usually lies months before today.
const EPOCH_LEAD_YEARS = 0.5

// Objects whose number or name contains every word of `query`, case-insensitive, in their order.
export function filterElements(objects: readonly SpiceElementsObject[], query: string) {
	const words = query.toLowerCase().split(/\s+/).filter(Boolean)
	if (words.length === 0) return objects
	return objects.filter((e) => {
		const text = `${e.number} ${e.name}`.toLowerCase()
		return words.every((word) => text.includes(word))
	})
}

// Objects of page `page` (from 0) of ELEMENTS_PAGE_SIZE.
export function elementsPage(objects: readonly SpiceElementsObject[], page: number) {
	return objects.slice(page * ELEMENTS_PAGE_SIZE, (page + 1) * ELEMENTS_PAGE_SIZE)
}

// Marks or unmarks one object by its number, as a new set.
export function toggleMarked(marked: ReadonlySet<number>, number: number, checked: boolean) {
	const next = new Set(marked)
	if (checked) next.add(number)
	else next.delete(number)
	return next
}

// Marks every object of `objects` (the filtered ones) besides those already marked, up to MAX_IMPORTED_OBJECTS in all, as a
// new set.
export function markAll(marked: ReadonlySet<number>, objects: readonly SpiceElementsObject[]) {
	const next = new Set(marked)

	for (const object of objects) {
		if (next.size >= MAX_IMPORTED_OBJECTS) break
		next.add(object.number)
	}

	return next
}

// The marked objects, in the order of the preview.
export function markedElements(objects: readonly SpiceElementsObject[], marked: ReadonlySet<number>) {
	return objects.filter((e) => marked.has(e.number))
}

// Approximate time (seconds) and kernel size (bytes) of integrating `count` objects over a window of `months`.
export function elementsEstimate(count: number, months: number) {
	const years = months / 12
	return { seconds: (count * MS_PER_OBJECT_YEAR * (years + EPOCH_LEAD_YEARS)) / 1000, bytes: count * BYTES_PER_OBJECT_YEAR * years }
}
