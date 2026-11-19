import { expect, test } from 'bun:test'
import type { SpiceElementsObject } from 'api'
import { ELEMENTS_PAGE_SIZE, elementsEstimate, elementsPage, filterElements, MAX_IMPORTED_OBJECTS, markAll, markedElements, toggleMarked } from './elements'

function object(number: number, name: string): SpiceElementsObject {
	return { number, name, epoch: 2461200.5, a: 2, e: 0.1, i: 5, node: 10, peri: 20, meanAnomaly: 30 }
}

const OBJECTS = [object(1, '(1) Ceres'), object(4, '(4) Vesta'), object(433, '(433) Eros'), object(1036, '(1036) Ganymed')]

test('the filter matches every word in the number or the name', () => {
	expect(filterElements(OBJECTS, '').map((e) => e.number)).toEqual([1, 4, 433, 1036])
	expect(filterElements(OBJECTS, 'eros').map((e) => e.number)).toEqual([433])
	expect(filterElements(OBJECTS, '43').map((e) => e.number)).toEqual([433])
	expect(filterElements(OBJECTS, '(1 ganymed').map((e) => e.number)).toEqual([1036])
	expect(filterElements(OBJECTS, 'pluto')).toEqual([])
})

test('pages hold ELEMENTS_PAGE_SIZE objects', () => {
	const many = Array.from({ length: ELEMENTS_PAGE_SIZE + 3 }, (_, i) => object(i + 1, `(${i + 1})`))
	expect(elementsPage(many, 0)).toHaveLength(ELEMENTS_PAGE_SIZE)
	expect(elementsPage(many, 1).map((e) => e.number)).toEqual([ELEMENTS_PAGE_SIZE + 1, ELEMENTS_PAGE_SIZE + 2, ELEMENTS_PAGE_SIZE + 3])
})

test('marks are toggled, added for the shown objects, and kept in the order of the preview', () => {
	let marked: ReadonlySet<number> = new Set()
	marked = toggleMarked(marked, 433, true)
	marked = markAll(marked, filterElements(OBJECTS, 'ceres'))
	expect(markedElements(OBJECTS, marked).map((e) => e.number)).toEqual([1, 433])
	expect([...toggleMarked(marked, 433, false)]).toEqual([1])

	const many = Array.from({ length: MAX_IMPORTED_OBJECTS + 5 }, (_, i) => object(i + 1, `(${i + 1})`))
	expect(markAll(new Set(), many).size).toBe(MAX_IMPORTED_OBJECTS)
})

test('the estimate grows with the objects and the window', () => {
	const year = elementsEstimate(1000, 12)
	const twoYears = elementsEstimate(1000, 24)
	expect(year.seconds).toBeGreaterThan(0)
	expect(twoYears.bytes).toBe(2 * year.bytes)
	expect(elementsEstimate(0, 12)).toEqual({ seconds: 0, bytes: 0 })
})
