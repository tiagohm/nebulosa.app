import { describe, expect, test } from 'bun:test'
import type { IndiNumberProperty, IndiProperty, IndiTextProperty } from 'api'
import { changedOnDevice, draftElements, editDraft, reportedTexts } from './indi.draft'
import { blobText, groupVectors, numberText, OTHER_GROUP, parseNumberText, rangeText, searchVectors } from './indi.format'

function number(name: string, group: string | undefined, value: number, format = '%g', permission: 'rw' | 'wo' = 'rw'): IndiNumberProperty {
	return { type: 'NUMBER', device: 'D', name, group, state: 'Idle', permission, elementNames: ['A', 'B'], revision: 1, elements: { A: { name: 'A', label: 'Alpha', format, min: 0, max: 100, step: 1, value }, B: { name: 'B', format, min: 0, max: 0, step: 0, value: 2 } } }
}

function text(permission: 'rw' | 'wo'): IndiTextProperty {
	return { type: 'TEXT', device: 'D', name: 'SECRET', state: 'Idle', permission, elementNames: ['USER', 'KEY'], revision: 1, elements: { USER: { name: 'USER', value: 'me' }, KEY: { name: 'KEY', label: 'Key', value: '' } } }
}

describe('format', () => {
	test('groups vectors in driver order, unnamed ones under Other', () => {
		const vectors: IndiProperty[] = [number('X', 'Main', 1), number('Y', undefined, 1), number('Z', 'Main', 1)]
		expect(groupVectors(vectors).map((group) => [group.name, group.vectors.map((vector) => vector.name)])).toEqual([
			['Main', ['X', 'Z']],
			[OTHER_GROUP, ['Y']],
		])
	})

	test('searches group, vector, and element names and labels', () => {
		const groups = groupVectors([number('FOCUS', 'Main', 1), number('TEMPERATURE', 'Sensors', 1)])
		expect(searchVectors(groups, ' sens ').map((group) => group.name)).toEqual(['Sensors'])
		expect(searchVectors(groups, 'focus').map((group) => group.vectors.map((vector) => vector.name))).toEqual([['FOCUS']])
		expect(searchVectors(groups, 'alpha')).toHaveLength(2)
		expect(searchVectors(groups, 'none')).toEqual([])
		expect(searchVectors(groups, '')).toBe(groups)
	})

	test('numbers keep the driver format and read decimal or sexagesimal text', () => {
		expect(numberText(number('RA', 'Main', 5.5, '%10.6m').elements.A)).toBe('5:30:00')
		expect(parseNumberText(' 5:30 ')).toBe(5.5)
		expect(parseNumberText('-0.25')).toBe(-0.25)
		expect(parseNumberText('')).toBeUndefined()
		expect(parseNumberText('abc')).toBeUndefined()
		expect(rangeText(number('X', 'Main', 1).elements.A)).toBe('0 to 100, step 1')
		expect(rangeText(number('X', 'Main', 1).elements.B)).toBeUndefined()
	})

	test('a BLOB shows its latest delivery or nothing', () => {
		expect(blobText({ name: 'CCD1' })).toBeUndefined()
		expect(blobText({ name: 'CCD1', format: '.fits', size: 2_100_000 })).toBe('.fits · 2.1 MB')
		expect(blobText({ name: 'CCD1', format: '.txt', size: 5 })).toBe('.txt · 5 B')
	})
})

describe('draft', () => {
	test('keeps the edited elements only and notices a change on the device', () => {
		const vector = number('X', 'Main', 1)
		const reported = reportedTexts(vector)
		const draft = editDraft(undefined, reported, 'A', '7:30')

		expect(draft).toEqual({ values: { A: '7:30' }, reported: { A: '1', B: '2' } })
		expect(draftElements(vector, draft)).toEqual({ elements: { A: 7.5 } })
		expect(changedOnDevice(draft, reported)).toBeFalse()
		expect(changedOnDevice(draft, reportedTexts(number('X', 'Main', 3)))).toBeTrue()
		expect(changedOnDevice(editDraft(draft, reported, 'B', '9'), { A: '1', B: '2' })).toBeFalse()
		expect(draftElements(vector, editDraft(draft, reported, 'B', 'x'))).toEqual({ error: 'B is not a number.' })
	})

	test('a write-only vector starts empty and needs every element', () => {
		const vector = text('wo')
		const reported = reportedTexts(vector)

		expect(reported).toEqual({ USER: '', KEY: '' })
		expect(draftElements(vector, editDraft(undefined, reported, 'USER', 'me'))).toEqual({ error: 'Type a value for Key; the driver does not report it.' })
		expect(draftElements(vector, editDraft(editDraft(undefined, reported, 'USER', 'me'), reported, 'KEY', ''))).toEqual({ elements: { USER: 'me', KEY: '' } })
		expect(reportedTexts(text('rw'))).toEqual({ USER: 'me', KEY: '' })
	})
})
