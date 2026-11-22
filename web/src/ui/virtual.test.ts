import { describe, expect, test } from 'bun:test'
import { matchingIndices, revealOffset, rowRange, searchWords, selectRows } from './virtual'

describe('rowRange', () => {
	test('draws the rows in view and the overscan around them', () => {
		expect(rowRange(0, 100, 10, 0, 2)).toEqual({ first: 0, last: 12 })
		expect(rowRange(500, 100, 10, 0, 2)).toEqual({ first: 48, last: 62 })
	})

	test('accounts for the inset above the first row', () => {
		expect(rowRange(25, 10, 10, 5, 0)).toEqual({ first: 2, last: 3 })
	})

	test('draws nothing past the overscan before the frame is measured', () => {
		expect(rowRange(0, 0, 10, 0, 3)).toEqual({ first: 0, last: 3 })
	})
})

describe('revealOffset', () => {
	test('leaves a row in view where it is', () => {
		expect(revealOffset(5, 0, 100, 10, 0)).toBeUndefined()
	})

	test('scrolls up to a row above the frame', () => {
		expect(revealOffset(2, 50, 100, 10, 4)).toBe(24)
	})

	test('scrolls down just enough to show a row below the frame', () => {
		expect(revealOffset(20, 0, 100, 10, 4)).toBe(114)
	})

	test('centres a row, never before the top', () => {
		expect(revealOffset(50, 0, 100, 10, 0, true)).toBe(455)
		expect(revealOffset(1, 0, 100, 10, 0, true)).toBe(0)
	})
})

describe('search', () => {
	test('splits a query into lowercase words', () => {
		expect(searchWords('  Saturn  BARY ')).toEqual(['saturn', 'bary'])
		expect(searchWords('   ')).toEqual([])
	})

	test('keeps every item for a blank query', () => {
		expect(matchingIndices(['a', 'b'], [])).toBeUndefined()
	})

	test('keeps, in order, the texts with every word', () => {
		const texts = ['saturn barycenter (6)', 'saturn (699)', 'mars (499)', 'titan (606)']
		expect(matchingIndices(texts, ['saturn'])).toEqual([0, 1])
		expect(matchingIndices(texts, ['bary', 'sat'])).toEqual([0])
		expect(matchingIndices(texts, ['99'])).toEqual([1, 2])
		expect(matchingIndices(texts, ['pluto'])).toEqual([])
	})
})

describe('selectRows', () => {
	test('maps each option to its own row when ungrouped', () => {
		const { rows, rowOf } = selectRows(3)
		expect(rows).toEqual([
			{ kind: 'option', position: 0 },
			{ kind: 'option', position: 1 },
			{ kind: 'option', position: 2 },
		])
		expect([...rowOf]).toEqual([0, 1, 2])
	})

	test('heads each run of a group once', () => {
		const groups = ['Planets', 'Planets', 'Moons', undefined]
		const { rows, rowOf } = selectRows(4, (position) => groups[position])
		expect(rows).toEqual([
			{ kind: 'heading', text: 'Planets' },
			{ kind: 'option', position: 0 },
			{ kind: 'option', position: 1 },
			{ kind: 'heading', text: 'Moons' },
			{ kind: 'option', position: 2 },
			{ kind: 'option', position: 3 },
		])
		expect([...rowOf]).toEqual([1, 2, 4, 5])
	})
})
