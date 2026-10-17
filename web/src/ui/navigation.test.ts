import { describe, expect, test } from 'bun:test'
import { closeFrom, moveIndex, openAt } from './navigation'

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
