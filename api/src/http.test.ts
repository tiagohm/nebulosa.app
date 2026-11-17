import { expect, spyOn, test } from 'bun:test'
import { unhandledErrorResponse } from './http'

test('a failure no route answered keeps the shape of every error response', async () => {
	const log = spyOn(console, 'error').mockImplementation(() => {})

	try {
		const response = unhandledErrorResponse(new Error('database is locked'))
		expect(response.status).toBe(500)
		expect(await response.json()).toEqual({ error: 'database is locked', code: 'internal' })
		expect(log).toHaveBeenCalledTimes(1)
	} finally {
		log.mockRestore()
	}
})
