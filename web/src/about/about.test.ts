import { describe, expect, test } from 'bun:test'
import type { AboutInfo } from 'api'
import { ApiResponseError } from '../http'
import { type AboutIo, fetchAbout, versionInfoText } from './about'

const INFO: AboutInfo = { description: 'Astronomical imaging application', version: '0.1.0', commit: 'abc123', coreCommit: 'def456', builtAt: '2026-10-27T12:00:00.000Z', runtime: 'Bun 1.4.0', platform: 'linux/x64' }

function fakeIo(body: unknown, status = 200) {
	const requested: string[] = []
	const io: AboutIo = {
		fetch: (input) => {
			requested.push(input)
			return Promise.resolve(Response.json(body, { status }))
		},
	}
	return { io, requested }
}

describe('fetch', () => {
	test('reads the identity of the server', async () => {
		const { io, requested } = fakeIo(INFO)

		expect(await fetchAbout(io)).toEqual(INFO)
		expect(requested).toEqual(['/api/about'])
	})

	test('rejects a failed response with its message', async () => {
		const { io } = fakeIo({ error: 'Boom', code: 'internal' }, 500)

		const error = await fetchAbout(io).catch((e: unknown) => e)
		expect(error).toBeInstanceOf(ApiResponseError)
		expect(error).toMatchObject({ message: 'Boom', status: 500 })
	})
})

describe('version info', () => {
	test('lists every field', () => {
		expect(versionInfoText(INFO)).toBe('Nebulosa\nVersion: 0.1.0\nCommit: abc123\nCore commit: def456\nBuilt: 2026-10-27T12:00:00.000Z\nRuntime: Bun 1.4.0\nServer platform: linux/x64')
	})

	test('names the fields the build did not record', () => {
		expect(versionInfoText({ version: '0.1.0', runtime: 'Bun 1.4.0', platform: 'win32/x64', description: 'Astronomical imaging application' })).toBe(
			'Nebulosa\nVersion: 0.1.0\nCommit: Not available in this build\nCore commit: Not available in this build\nBuilt: Not available in this build\nRuntime: Bun 1.4.0\nServer platform: win32/x64',
		)
	})
})
