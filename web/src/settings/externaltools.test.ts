import { expect, test } from 'bun:test'
import type { ExternalToolCheck, ExternalToolState } from 'api'
import { proxy } from 'valtio'
import { checkMatches, type ExternalToolsState, handleExternalToolEvent, refreshExternalTools, sameConfig, saveExternalTool, testExternalTool } from './externaltools'

function mediamtx(patch: Partial<ExternalToolState> = {}): ExternalToolState {
	return {
		id: 'mediamtx',
		name: 'MediaMTX',
		description: 'Media gateway',
		requirements: 'MediaMTX 1.21',
		capabilities: ['video-gateway'],
		fields: ['executable'],
		timeoutLimits: { min: 1000, max: 60000 },
		defaultTimeout: 300000,
		status: 'notConfigured',
		config: { executable: '', timeout: 300000 },
		revision: 0,
		...patch,
	}
}

function check(patch: Partial<ExternalToolCheck> = {}): ExternalToolCheck {
	return { status: 'available', code: 'ok', config: { executable: '/opt/mediamtx', timeout: 300000 }, resolvedPath: '/opt/mediamtx', checkedAt: 1000, duration: 1, message: 'ok', ...patch }
}

function newState(tools: ExternalToolState[] = []): ExternalToolsState {
	return proxy<ExternalToolsState>({ tools, loading: false })
}

// Fetch fake answering each request with the response its handler builds, recording the requests.
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	const requests: { url: string; init?: RequestInit }[] = []
	const request = ((url: string, init?: RequestInit) => {
		requests.push({ url, init })
		return Promise.resolve(respond(url, init))
	}) as typeof fetch
	return { requests, request }
}

test('the snapshot fills the store', async () => {
	const state = newState()
	const { requests, request } = fakeFetch(() => Response.json([mediamtx()]))
	await refreshExternalTools(state, request)

	expect(requests[0].url).toBe('/api/settings/external-tools')
	expect(state.tools).toEqual([mediamtx()])
	expect(state.loading).toBeFalse()
	expect(state.loadError).toBeUndefined()
})

test('a failed snapshot reports its error', async () => {
	const state = newState()
	await refreshExternalTools(state, fakeFetch(() => Response.json({ error: 'Broken' }, { status: 500 })).request)
	expect(state.loadError).toBe('Broken')
})

test('an event received while the snapshot loads is not overwritten by it', async () => {
	const state = newState([mediamtx()])
	const { promise, resolve } = Promise.withResolvers<Response>()
	const refresh = refreshExternalTools(state, fakeFetch(() => promise).request)

	handleExternalToolEvent(state, { type: 'externalTool:updated', tool: mediamtx({ revision: 2, status: 'configured' }) })
	resolve(Response.json([mediamtx({ revision: 1 })]))
	await refresh

	expect(state.tools[0].revision).toBe(2)
})

test('an event replaces an older state only', () => {
	const state = newState([mediamtx({ revision: 3 })])
	handleExternalToolEvent(state, { type: 'externalTool:updated', tool: mediamtx({ revision: 2 }) })
	expect(state.tools[0].revision).toBe(3)

	handleExternalToolEvent(state, { type: 'externalTool:updated', tool: mediamtx({ revision: 3, lastCheck: check() }) })
	expect(state.tools[0].lastCheck).toEqual(check())
})

test('a save sends the draft and its revision, then stores the new state', async () => {
	const state = newState([mediamtx()])
	const saved = mediamtx({ status: 'configured', revision: 1, config: { executable: '/opt/mediamtx', timeout: 60000 } })
	const { requests, request } = fakeFetch(() => Response.json(saved))
	const result = await saveExternalTool(state, 'mediamtx', { executable: '/opt/mediamtx', timeout: 60000 }, 0, request)

	expect(result).toEqual({ status: 'saved', tool: saved })
	expect(requests[0].url).toBe('/api/settings/external-tools/mediamtx')
	expect(requests[0].init?.method).toBe('PUT')
	expect(JSON.parse(requests[0].init?.body as string)).toEqual({ config: { executable: '/opt/mediamtx', timeout: 60000 }, revision: 0 })
	expect(state.tools[0]).toEqual(saved)
})

test('a conflicting save stores the newer settings', async () => {
	const state = newState([mediamtx()])
	const newer = mediamtx({ status: 'configured', revision: 1, config: { executable: '/usr/bin/mediamtx', timeout: 300000 } })
	const result = await saveExternalTool(state, 'mediamtx', { executable: '/opt/mediamtx', timeout: 60000 }, 0, fakeFetch(() => Response.json({ error: 'Changed', code: 'conflict', tool: newer }, { status: 409 })).request)

	expect(result).toEqual({ status: 'conflict' })
	expect(state.tools[0]).toEqual(newer)
})

test('a failed save reports its error', async () => {
	const state = newState([mediamtx()])
	expect(await saveExternalTool(state, 'mediamtx', mediamtx().config, 0, fakeFetch(() => Response.json({ error: 'Unable to write' }, { status: 500 })).request)).toEqual({ status: 'error', error: 'Unable to write' })
	expect(await saveExternalTool(state, 'mediamtx', mediamtx().config, 0, fakeFetch(() => Promise.reject(new Error('offline'))).request)).toEqual({ status: 'error', error: 'Unable to reach the server' })
})

test('a test sends the draft and never changes the store', async () => {
	const state = newState([mediamtx()])
	const { requests, request } = fakeFetch(() => Response.json(check()))
	const result = await testExternalTool('mediamtx', { executable: '/opt/mediamtx', timeout: 300000 }, request)

	expect(result).toEqual({ check: check() })
	expect(requests[0].url).toBe('/api/settings/external-tools/mediamtx/test')
	expect(requests[0].init?.method).toBe('POST')
	expect(state.tools[0]).toEqual(mediamtx())
})

test('a check describes only the values it checked', () => {
	expect(checkMatches(check(), { executable: '/opt/mediamtx', timeout: 300000 })).toBeTrue()
	expect(checkMatches(check(), { executable: '/opt/mediamtx', timeout: 60000 })).toBeFalse()
	expect(checkMatches(check(), { executable: '/usr/bin/mediamtx', timeout: 300000 })).toBeFalse()
})

test('the index folder of the built-in solver is part of a configuration', () => {
	expect(sameConfig({ executable: '', timeout: 1000 }, { executable: '', timeout: 1000, indexDirectory: '' })).toBeTrue()
	expect(sameConfig({ executable: '', timeout: 1000, indexDirectory: 'a' }, { executable: '', timeout: 1000, indexDirectory: 'b' })).toBeFalse()
})
