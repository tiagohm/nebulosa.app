import { expect, test } from 'bun:test'
import type { ExternalToolCheck, ExternalToolState } from 'api'
import { proxy } from 'valtio'
import { checkMatches, type ExternalToolsState, handleExternalToolEvent, refreshExternalTools, sameConfig, saveExternalTool, signInExternalTool, signOutExternalTool, testExternalTool } from './externaltools'

function astap(patch: Partial<ExternalToolState> = {}): ExternalToolState {
	return {
		id: 'astap',
		name: 'ASTAP',
		description: 'Astronomical software',
		capabilities: ['plate-solving', 'star-detection'],
		fields: ['executable'],
		session: false,
		timeoutLimits: { min: 1000, max: 3600000 },
		status: 'notConfigured',
		config: { executable: '', timeout: 300000 },
		revision: 0,
		...patch,
	}
}

function check(patch: Partial<ExternalToolCheck> = {}): ExternalToolCheck {
	return { status: 'available', code: 'ok', config: { executable: '/opt/astap', timeout: 300000 }, resolvedPath: '/opt/astap', checkedAt: 1000, duration: 1, message: 'ok', ...patch }
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
	const { requests, request } = fakeFetch(() => Response.json([astap()]))
	await refreshExternalTools(state, request)

	expect(requests[0].url).toBe('/api/settings/external-tools')
	expect(state.tools).toEqual([astap()])
	expect(state.loading).toBeFalse()
	expect(state.loadError).toBeUndefined()
})

test('a failed snapshot reports its error', async () => {
	const state = newState()
	await refreshExternalTools(state, fakeFetch(() => Response.json({ error: 'Broken' }, { status: 500 })).request)
	expect(state.loadError).toBe('Broken')
})

test('an event received while the snapshot loads is not overwritten by it', async () => {
	const state = newState([astap()])
	const { promise, resolve } = Promise.withResolvers<Response>()
	const refresh = refreshExternalTools(state, fakeFetch(() => promise).request)

	handleExternalToolEvent(state, { type: 'externalTool:updated', tool: astap({ revision: 2, status: 'configured' }) })
	resolve(Response.json([astap({ revision: 1 })]))
	await refresh

	expect(state.tools[0].revision).toBe(2)
})

test('an event replaces an older state only', () => {
	const state = newState([astap({ revision: 3 })])
	handleExternalToolEvent(state, { type: 'externalTool:updated', tool: astap({ revision: 2 }) })
	expect(state.tools[0].revision).toBe(3)

	handleExternalToolEvent(state, { type: 'externalTool:updated', tool: astap({ revision: 3, lastCheck: check() }) })
	expect(state.tools[0].lastCheck).toEqual(check())
})

test('a save sends the draft and its revision, then stores the new state', async () => {
	const state = newState([astap()])
	const saved = astap({ status: 'configured', revision: 1, config: { executable: '/opt/astap', timeout: 60000 } })
	const { requests, request } = fakeFetch(() => Response.json(saved))
	const result = await saveExternalTool(state, 'astap', { executable: '/opt/astap', timeout: 60000 }, 0, request)

	expect(result).toEqual({ status: 'saved', tool: saved })
	expect(requests[0].url).toBe('/api/settings/external-tools/astap')
	expect(requests[0].init?.method).toBe('PUT')
	expect(JSON.parse(requests[0].init?.body as string)).toEqual({ config: { executable: '/opt/astap', timeout: 60000 }, revision: 0 })
	expect(state.tools[0]).toEqual(saved)
})

test('a conflicting save stores the newer settings', async () => {
	const state = newState([astap()])
	const newer = astap({ status: 'configured', revision: 1, config: { executable: '/usr/bin/astap', timeout: 300000 } })
	const result = await saveExternalTool(state, 'astap', { executable: '/opt/astap', timeout: 60000 }, 0, fakeFetch(() => Response.json({ error: 'Changed', code: 'conflict', tool: newer }, { status: 409 })).request)

	expect(result).toEqual({ status: 'conflict' })
	expect(state.tools[0]).toEqual(newer)
})

test('a failed save reports its error', async () => {
	const state = newState([astap()])
	expect(await saveExternalTool(state, 'astap', astap().config, 0, fakeFetch(() => Response.json({ error: 'Unable to write' }, { status: 500 })).request)).toEqual({ status: 'error', error: 'Unable to write' })
	expect(await saveExternalTool(state, 'astap', astap().config, 0, fakeFetch(() => Promise.reject(new Error('offline'))).request)).toEqual({ status: 'error', error: 'Unable to reach the server' })
})

test('a test sends the draft and never changes the store', async () => {
	const state = newState([astap()])
	const { requests, request } = fakeFetch(() => Response.json(check()))
	const result = await testExternalTool('astap', { executable: '/opt/astap', timeout: 300000 }, request)

	expect(result).toEqual({ check: check() })
	expect(requests[0].url).toBe('/api/settings/external-tools/astap/test')
	expect(requests[0].init?.method).toBe('POST')
	expect(state.tools[0]).toEqual(astap())
})

test('a check describes only the values it checked', () => {
	expect(checkMatches(check(), { executable: '/opt/astap', timeout: 300000 })).toBeTrue()
	expect(checkMatches(check(), { executable: '/opt/astap', timeout: 60000 })).toBeFalse()
	expect(checkMatches(check(), { executable: '/usr/bin/astap', timeout: 300000 })).toBeFalse()
})

function nova(patch: Partial<ExternalToolState> = {}): ExternalToolState {
	return { ...astap(), id: 'nova', name: 'Nova Astrometry.net', capabilities: ['plate-solving'], fields: ['endpoint'], session: true, signedIn: false, config: { executable: '', timeout: 300000, endpoint: '' }, ...patch }
}

test('the endpoint and the configuration file are part of a configuration', () => {
	expect(sameConfig({ executable: '', timeout: 1000 }, { executable: '', timeout: 1000, endpoint: '' })).toBeTrue()
	expect(sameConfig({ executable: '', timeout: 1000, endpoint: 'a' }, { executable: '', timeout: 1000, endpoint: 'b' })).toBeFalse()
	expect(sameConfig({ executable: 'x', timeout: 1000, config: 'a.cfg' }, { executable: 'x', timeout: 1000 })).toBeFalse()
})

test('signing in sends the key once and stores the new state', async () => {
	const state = newState([nova()])
	const { requests, request } = fakeFetch(() => Response.json(nova({ signedIn: true, status: 'configured', revision: 1 })))
	const result = await signInExternalTool(state, 'nova', 'key', request)

	expect(requests[0].url).toBe('/api/settings/external-tools/nova/login')
	expect(JSON.parse(requests[0].init!.body as string)).toEqual({ apiKey: 'key' })
	expect('tool' in result && result.tool.signedIn).toBeTrue()
	expect(state.tools[0].signedIn).toBeTrue()
	expect(JSON.stringify(state)).not.toContain('key')
})

test('a refused sign-in reports the message of the service', async () => {
	const state = newState([nova()])
	const result = await signInExternalTool(state, 'nova', 'bad', fakeFetch(() => Response.json({ error: 'bad apikey', code: 'refused' }, { status: 422 })).request)

	expect(result).toEqual({ error: 'bad apikey' })
	expect(state.tools[0].signedIn).toBeFalse()
})

test('signing out stores the new state', async () => {
	const state = newState([nova({ signedIn: true, status: 'configured', revision: 1 })])
	const { requests, request } = fakeFetch(() => Response.json(nova({ revision: 2 })))
	await signOutExternalTool(state, 'nova', request)

	expect(requests[0].url).toBe('/api/settings/external-tools/nova/logout')
	expect(state.tools[0]).toMatchObject({ signedIn: false, revision: 2 })
})
