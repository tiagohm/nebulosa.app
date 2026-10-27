import { expect, test } from 'bun:test'
import { CALCULATOR_IDS, CALCULATORS, calculatorDefinition } from './catalog'

test('every calculator has a unique id and opens on Imaging Setup', () => {
	expect(new Set(CALCULATOR_IDS).size).toBe(CALCULATORS.length)
	expect(CALCULATOR_IDS[0]).toBe('imaging-setup')
	for (const id of CALCULATOR_IDS) expect(calculatorDefinition(id).id).toBe(id)
})

test('the calculators of a category are consecutive', () => {
	const seen = new Set<string>()

	for (let i = 0; i < CALCULATORS.length; i++) {
		const { category } = CALCULATORS[i]
		if (i > 0 && CALCULATORS[i - 1].category !== category) expect(seen.has(category)).toBe(false)
		seen.add(category)
	}
})
