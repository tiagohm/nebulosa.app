import { describe, expect, test } from 'bun:test'
import { copyText } from './clipboard'

describe('copy', () => {
	test('uses the Clipboard API when it exists', async () => {
		const written: string[] = []
		const selected: string[] = []

		expect(await copyText('a', { writeText: (text) => Promise.resolve(void written.push(text)), copySelection: (text) => selected.push(text) > 0 })).toBeTrue()
		expect(written).toEqual(['a'])
		expect(selected).toEqual([])
	})

	test('falls back to a selection outside a secure context or when refused', async () => {
		const selected: string[] = []
		const copySelection = (text: string) => selected.push(text) > 0

		expect(await copyText('b', { copySelection })).toBeTrue()
		expect(await copyText('c', { writeText: () => Promise.reject(new Error('denied')), copySelection })).toBeTrue()
		expect(selected).toEqual(['b', 'c'])
	})

	test('says when nothing copied', async () => {
		expect(await copyText('d', { copySelection: () => false })).toBeFalse()
		expect(
			await copyText('e', {
				copySelection: () => {
					throw new Error('unsupported')
				},
			}),
		).toBeFalse()
	})
})
