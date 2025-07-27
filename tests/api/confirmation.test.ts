import { expect, test } from 'bun:test'
import { getDefaultInjector } from 'bunshi'
import { ConfirmationMolecule } from 'src/api/confirmation'

const injector = getDefaultInjector()
const confirmation = injector.get(ConfirmationMolecule)

test('confirm', async () => {
	for (let i = 0; i < 2; i++) {
		setTimeout(() => confirmation.confirm({ key: 'test', accepted: i === 0 }), 10)
		const result = await confirmation.ask({ key: 'test', message: 'Test confirmation' })
		expect(result).toBe(i === 0)
	}
})

test('timed out', async () => {
	const result = await confirmation.ask({ key: 'test', message: 'Test confirmation' }, 100)
	expect(result).toBe(false)
})
