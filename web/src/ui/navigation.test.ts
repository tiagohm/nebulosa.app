import { describe, expect, test } from 'bun:test'
import { closeFrom, moveIndex, moveInRows, openAt } from './navigation'

describe('moveIndex', () => {
	test('moves forward and wraps', () => {
		expect(moveIndex(0, 3, 'ArrowDown')).toBe(1)
		expect(moveIndex(2, 3, 'ArrowDown')).toBe(0)
		expect(moveIndex(2, 3, 'ArrowRight')).toBe(0)
	})

	test('moves back and wraps', () => {
		expect(moveIndex(1, 3, 'ArrowUp')).toBe(0)
		expect(moveIndex(0, 3, 'ArrowUp')).toBe(2)
		expect(moveIndex(0, 3, 'ArrowLeft')).toBe(2)
	})

	test('starts from the ends when nothing is current', () => {
		expect(moveIndex(-1, 3, 'ArrowDown')).toBe(0)
		expect(moveIndex(-1, 3, 'ArrowUp')).toBe(2)
	})

	test('jumps to the ends', () => {
		expect(moveIndex(1, 3, 'Home')).toBe(0)
		expect(moveIndex(1, 3, 'End')).toBe(2)
	})

	test('ignores other keys and empty lists', () => {
		expect(moveIndex(1, 3, 'a')).toBeUndefined()
		expect(moveIndex(0, 0, 'ArrowDown')).toBeUndefined()
	})
})

describe('menu path', () => {
	test('opens a root menu and cascading submenus', () => {
		const root = openAt([], 0, 'devices')
		expect(root).toEqual(['devices'])
		expect(openAt(root, 1, 'mount')).toEqual(['devices', 'mount'])
	})

	test('opening a sibling closes its submenus', () => {
		expect(openAt(['devices', 'mount', 'guide'], 0, 'tools')).toEqual(['tools'])
		expect(openAt(['devices', 'mount', 'guide'], 1, 'camera')).toEqual(['devices', 'camera'])
	})

	test('closes a level and everything below it', () => {
		expect(closeFrom(['devices', 'mount', 'guide'], 1)).toEqual(['devices'])
		expect(closeFrom(['devices', 'mount'], 0)).toEqual([])
	})
})

describe('moveInRows', () => {
	// Two rows of three 100 px items, then a short row of one under the first column, as a grid of two sections lays out.
	const boxes = [
		{ top: 0, left: 0, width: 100 },
		{ top: 0, left: 110, width: 100 },
		{ top: 0, left: 220, width: 100 },
		{ top: 80, left: 0, width: 100 },
		{ top: 80, left: 110, width: 100 },
		{ top: 80.4, left: 220, width: 100 },
		{ top: 200, left: 0, width: 100 },
	]

	test('ArrowDown and ArrowUp keep the column', () => {
		expect(moveInRows(boxes, 1, 'ArrowDown')).toBe(4)
		expect(moveInRows(boxes, 5, 'ArrowUp')).toBe(2)
	})

	test('a shorter row takes the closest item', () => {
		expect(moveInRows(boxes, 5, 'ArrowDown')).toBe(6)
	})

	test('the first and last rows stay put', () => {
		expect(moveInRows(boxes, 2, 'ArrowUp')).toBe(2)
		expect(moveInRows(boxes, 6, 'ArrowDown')).toBe(6)
	})

	test('ArrowLeft, ArrowRight, Home, and End move in reading order', () => {
		expect(moveInRows(boxes, 2, 'ArrowRight')).toBe(3)
		expect(moveInRows(boxes, 3, 'ArrowLeft')).toBe(2)
		expect(moveInRows(boxes, 4, 'Home')).toBe(0)
		expect(moveInRows(boxes, 0, 'End')).toBe(6)
		expect(moveInRows(boxes, 0, 'Tab')).toBeUndefined()
	})

	test('without a current item, arrows start at an end', () => {
		expect(moveInRows(boxes, -1, 'ArrowDown')).toBe(0)
		expect(moveInRows([], 0, 'ArrowDown')).toBeUndefined()
	})
})
