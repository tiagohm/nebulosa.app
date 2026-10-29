import { expect, test } from 'bun:test'
import { proxy } from 'valtio'
import { type CollapsibleSections, sectionOpen, setSectionOpen } from './collapsible'

test('a section shows its default until toggled, then keeps the state it was left in', () => {
	const sections = proxy<CollapsibleSections>({})
	expect(sectionOpen(sections, 'images.plate-solver.advanced', false)).toBe(false)
	expect(sectionOpen(sections, 'images.plate-solver.solver', true)).toBe(true)

	setSectionOpen(sections, 'images.plate-solver.advanced', true)
	setSectionOpen(sections, 'images.plate-solver.solver', false)
	expect(sectionOpen(sections, 'images.plate-solver.advanced', false)).toBe(true)
	expect(sectionOpen(sections, 'images.plate-solver.solver', true)).toBe(false)
})
