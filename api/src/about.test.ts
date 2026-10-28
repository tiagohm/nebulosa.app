import { describe, expect, test } from 'bun:test'
import { type AboutInfo, createAboutRoutes } from './about'

async function get(info: AboutInfo) {
	const response = createAboutRoutes(info)['/api/about'].GET()
	return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('about', () => {
	test('serves the identity it was given', async () => {
		const info: AboutInfo = { description: 'Astronomical imaging application', version: '0.1.0', commit: 'a'.repeat(40), coreCommit: 'b'.repeat(40), builtAt: '2026-10-27T12:00:00.000Z', runtime: 'Bun 1.4.0', platform: 'linux/x64' }
		const { status, body } = await get(info)

		expect(status).toBe(200)
		expect(body).toEqual({ ...info })
	})

	test('omits the build fields it was not given', async () => {
		const { body } = await get({ description: 'Astronomical imaging application', version: '0.1.0', runtime: 'Bun 1.4.0', platform: 'win32/x64' })

		expect(body).toEqual({ description: 'Astronomical imaging application', version: '0.1.0', runtime: 'Bun 1.4.0', platform: 'win32/x64' })
		expect(Object.keys(body)).not.toContain('commit')
		expect(Object.keys(body)).not.toContain('builtAt')
	})
})
