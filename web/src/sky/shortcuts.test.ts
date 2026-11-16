import { expect, test } from 'bun:test'
import { skyShortcut } from './shortcuts'

test('keys map to their Sky commands', () => {
	expect(skyShortcut('/', false)).toBe('search')
	expect(skyShortcut('+', false)).toBe('zoomIn')
	expect(skyShortcut('=', false)).toBe('zoomIn')
	expect(skyShortcut('-', false)).toBe('zoomOut')
	expect(skyShortcut('n', false)).toBe('now')
	expect(skyShortcut('N', false)).toBe('now')
})

test('modified and unmapped keys do nothing', () => {
	expect(skyShortcut('n', true)).toBeUndefined()
	expect(skyShortcut('+', true)).toBeUndefined()
	expect(skyShortcut('a', false)).toBeUndefined()
	expect(skyShortcut('Enter', false)).toBeUndefined()
})
