import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createExternalToolsRoutes, DEFAULT_EXTERNAL_TOOL_TIMEOUT, EXTERNAL_TOOLS, type ExternalToolCheck, type ExternalToolEvent, type ExternalToolState, ExternalToolsStore, inspectExecutable, parseSettings } from './externaltools'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-external-tools-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const WINDOWS = process.platform === 'win32'

let files = 0

// Returns a settings file path of a fresh directory.
function settingsFile() {
	return join(root, `settings-${files++}`, 'settings.json')
}

// Creates a file the server may execute.
function executable(name: string) {
	const path = join(root, name)
	writeFileSync(path, '#!/bin/sh\nexit 0\n')
	chmodSync(path, 0o755)
	return path
}

// Creates a store over a fresh settings file, recording its events.
function store(file = settingsFile()) {
	const events: ExternalToolEvent[] = []
	return { store: new ExternalToolsStore(file, (event) => events.push(event)), events, file }
}

type Handler = (req: Request) => Promise<Response>

type ExternalToolsRoutes = ReturnType<typeof createExternalToolsRoutes>

// Calls a route of the external tools API.
function call(routes: ExternalToolsRoutes, path: keyof ExternalToolsRoutes, method: string, id?: string, body?: unknown) {
	const handler = (routes[path] as unknown as Record<string, Handler>)[method]
	const req = new Request(`http://localhost${path.replace(':id', id ?? '')}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
	return handler(Object.assign(req, { params: { id } }))
}

describe('catalog', () => {
	test('lists ASTAP, solve-field, and nova, with their capabilities and settings', async () => {
		const routes = createExternalToolsRoutes(store().store)
		const tools = (await (await call(routes, '/api/settings/external-tools', 'GET')).json()) as ExternalToolState[]

		expect(tools.map((tool) => tool.id)).toEqual(['astap', 'astrometryLocal', 'nova'])
		expect(tools[0]).toMatchObject({ name: 'ASTAP', capabilities: ['plate-solving', 'star-detection'], fields: ['executable'], session: false, status: 'notConfigured', revision: 0, config: { executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT } })
		expect(tools[0].lastCheck).toBeUndefined()
		expect(tools[0].signedIn).toBeUndefined()
		expect(tools[1]).toMatchObject({ capabilities: ['plate-solving'], fields: ['executable', 'config'], status: 'notConfigured', config: { executable: '', config: '' } })
		expect(tools[2]).toMatchObject({ capabilities: ['plate-solving'], fields: ['endpoint'], session: true, status: 'notConfigured', signedIn: false, config: { executable: '', endpoint: '' } })
	})

	test('native providers are not external tools', () => {
		const ids: readonly string[] = EXTERNAL_TOOLS.map((tool) => tool.id)
		expect(ids).not.toContain('detectStars')
		expect(ids).not.toContain('astrometry.net')
	})

	test('an unknown tool is 404', async () => {
		const routes = createExternalToolsRoutes(store().store)
		expect((await call(routes, '/api/settings/external-tools/:id', 'GET', 'bash')).status).toBe(404)
		expect((await call(routes, '/api/settings/external-tools/:id', 'PUT', 'bash', { config: { executable: '/bin/sh', timeout: 1000 }, revision: 0 })).status).toBe(404)
		expect((await call(routes, '/api/settings/external-tools/:id/test', 'POST', 'bash', { config: { executable: '/bin/sh', timeout: 1000 } })).status).toBe(404)
	})
})

describe('persistence', () => {
	test('saved settings survive a restart', async () => {
		const { store: first, events, file } = store()
		const path = executable('astap one')
		const outcome = await first.save('astap', { executable: path, timeout: 60000 }, 0)

		expect(outcome).toMatchObject({ status: 'saved', tool: { status: 'configured', revision: 1, config: { executable: path, timeout: 60000 } } })
		expect(events).toHaveLength(1)

		const second = new ExternalToolsStore(file)
		expect(await second.get('astap')).toMatchObject({ status: 'configured', revision: 1, config: { executable: path, timeout: 60000 } })
		expect(JSON.parse(readFileSync(file, 'utf-8')).tools.astap).toEqual({ executable: path, timeout: 60000, revision: 1 })
	})

	test('a save from an outdated revision is refused', async () => {
		const routes = createExternalToolsRoutes(store().store)
		const config = { executable: '/opt/astap/astap', timeout: 30000 }
		const [a, b] = await Promise.all([call(routes, '/api/settings/external-tools/:id', 'PUT', 'astap', { config, revision: 0 }), call(routes, '/api/settings/external-tools/:id', 'PUT', 'astap', { config: { ...config, timeout: 40000 }, revision: 0 })])

		expect(a.status).toBe(200)
		expect(b.status).toBe(409)
		expect(await b.json()).toMatchObject({ code: 'conflict', tool: { revision: 1, config } })
	})

	test('a corrupt file is reported and kept until saved', async () => {
		const file = settingsFile()
		mkdirSync(join(file, '..'), { recursive: true })
		writeFileSync(file, '{ not json')
		const { store: corrupt } = store(file)

		expect(await corrupt.get('astap')).toMatchObject({ status: 'invalid', error: 'The settings file is not valid JSON' })
		expect(await corrupt.resolve('astap')).toBeUndefined()
		expect(readFileSync(file, 'utf-8')).toBe('{ not json')

		expect(await corrupt.save('astap', { executable: 'astap', timeout: 5000 }, 0)).toMatchObject({ status: 'saved', tool: { status: 'configured', revision: 1 } })
	})

	test('a file of a newer version is never overwritten', async () => {
		const file = settingsFile()
		mkdirSync(join(file, '..'), { recursive: true })
		writeFileSync(file, JSON.stringify({ version: 99, tools: { astap: { executable: 'astap', timeout: 5000, revision: 3 } } }))
		const { store: newer } = store(file)

		expect(await newer.get('astap')).toMatchObject({ status: 'invalid', revision: 3 })
		expect(await newer.save('astap', { executable: 'other', timeout: 5000 }, 3)).toEqual({ status: 'newerVersion' })
		expect(JSON.parse(readFileSync(file, 'utf-8')).version).toBe(99)
	})

	test('values out of the file are normalized', () => {
		const { tools } = parseSettings(JSON.stringify({ version: 1, tools: { astap: { executable: 42, timeout: 0, revision: -1 } } }))
		expect(tools.get('astap')).toEqual({ executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT, revision: 0 })
		expect(parseSettings(JSON.stringify({ version: 1, tools: { astap: { executable: 'astap', timeout: 2.5, revision: 1 } } })).tools.get('astap')?.timeout).toBe(DEFAULT_EXTERNAL_TOOL_TIMEOUT)
		expect(parseSettings(JSON.stringify({ version: 1, tools: { astap: { executable: 'astap', timeout: 7200000, revision: 1 } } })).tools.get('astap')?.timeout).toBe(DEFAULT_EXTERNAL_TOOL_TIMEOUT)
		expect(parseSettings('[]').error).toBe('The settings file is not a Nebulosa settings document')
	})

	test('a file that cannot be written is 500 and changes nothing', async () => {
		const blocker = join(root, 'blocker')
		writeFileSync(blocker, '')
		const { store: blocked } = store(join(blocker, 'settings.json'))
		const routes = createExternalToolsRoutes(blocked)
		const response = await call(routes, '/api/settings/external-tools/:id', 'PUT', 'astap', { config: { executable: 'astap', timeout: 5000 }, revision: 0 })

		expect(response.status).toBe(500)
		expect(await blocked.get('astap')).toMatchObject({ status: 'notConfigured', revision: 0 })
	})
})

describe('executable check', () => {
	test('an executable file is available', async () => {
		const path = executable('astap')
		expect(await inspectExecutable(path)).toEqual({ status: 'available', code: 'ok', resolvedPath: path, message: expect.any(String) })
	})

	test('paths with spaces and shell characters are literal names', async () => {
		const path = executable("astap $(touch pwned); & 'x'")
		expect(await inspectExecutable(path)).toMatchObject({ status: 'available', resolvedPath: path })
		expect(await inspectExecutable(join(root, 'missing $(id)'))).toMatchObject({ status: 'unavailable', code: 'missing' })
	})

	test('an empty path fails', async () => {
		expect(await inspectExecutable('')).toMatchObject({ status: 'failed', code: 'empty' })
		expect(await inspectExecutable('   ')).toMatchObject({ status: 'failed', code: 'empty' })
	})

	test('a missing path is unavailable', async () => {
		expect(await inspectExecutable(join(root, 'nothing', 'astap'))).toMatchObject({ status: 'unavailable', code: 'missing' })
		expect(await inspectExecutable('nebulosa-no-such-program')).toMatchObject({ status: 'unavailable', code: 'missing' })
	})

	test('a directory fails', async () => {
		expect(await inspectExecutable(root)).toMatchObject({ status: 'failed', code: 'notFile', resolvedPath: root })
	})

	test.skipIf(WINDOWS)('a file without the execute permission fails', async () => {
		const path = join(root, 'plain')
		writeFileSync(path, '')
		chmodSync(path, 0o644)
		expect(await inspectExecutable(path)).toMatchObject({ status: 'failed', code: 'notExecutable' })
	})

	test('a bare name is looked up on the PATH', async () => {
		const name = WINDOWS ? 'cmd' : 'sh'
		const result = await inspectExecutable(name)
		expect(result).toMatchObject({ status: 'available', code: 'ok' })
		expect(result.resolvedPath).toBe(Bun.which(name)!)
	})
})

describe('test configuration', () => {
	test('testing never saves, and an unsaved draft is not the latest check', async () => {
		const { store: tools, events, file } = store()
		const routes = createExternalToolsRoutes(tools)
		const response = await call(routes, '/api/settings/external-tools/:id/test', 'POST', 'astap', { config: { executable: executable('draft'), timeout: 5000 } })
		const check = (await response.json()) as ExternalToolCheck

		expect(response.status).toBe(200)
		expect(check).toMatchObject({ status: 'available', config: { timeout: 5000 }, checkedAt: expect.any(Number), duration: expect.any(Number) })
		expect(check.version).toBeUndefined()
		expect(await Bun.file(file).exists()).toBeFalse()
		expect((await tools.get('astap')).lastCheck).toBeUndefined()
		expect(events).toHaveLength(0)
	})

	test('a check of the saved settings becomes the latest check until they change', async () => {
		const { store: tools, events } = store()
		const config = { executable: executable('saved'), timeout: 5000 }
		await tools.save('astap', config, 0)
		await tools.check('astap', config)

		expect((await tools.get('astap')).lastCheck).toMatchObject({ status: 'available', config })
		expect(events.at(-1)?.tool.lastCheck).toMatchObject({ status: 'available' })

		await tools.save('astap', config, 1)
		expect((await tools.get('astap')).lastCheck).toBeDefined()

		await tools.save('astap', { ...config, timeout: 6000 }, 2)
		expect((await tools.get('astap')).lastCheck).toBeUndefined()
	})

	test('a check of settings replaced during it is not recorded', async () => {
		const { store: tools } = store()
		const config = { executable: executable('racing'), timeout: 5000 }
		await tools.save('astap', config, 0)
		const checking = tools.check('astap', config)
		await tools.save('astap', { ...config, executable: 'other' }, 1)
		await checking

		expect((await tools.get('astap')).lastCheck).toBeUndefined()
	})
})

describe('resolve', () => {
	test('nothing configured resolves undefined', async () => {
		expect(await store().store.resolve('astap')).toBeUndefined()
	})

	test('a resolved snapshot keeps its values after a later save', async () => {
		const { store: tools } = store()
		await tools.save('astap', { executable: '/opt/astap/astap', timeout: 5000 }, 0)
		const snapshot = await tools.resolve('astap')
		await tools.save('astap', { executable: '/usr/bin/astap', timeout: 9000 }, 1)

		expect(snapshot).toEqual({ executable: '/opt/astap/astap', timeout: 5000 })
		expect(Object.isFrozen(snapshot)).toBeTrue()
		expect(await tools.resolve('astap')).toEqual({ executable: '/usr/bin/astap', timeout: 9000 })
	})
})

describe('solve-field', () => {
	test('checks the configuration file besides the executable', async () => {
		const { store: tools } = store()
		const path = executable('solve-field')
		const config = join(root, `backend-${files++}.cfg`)

		expect(await tools.check('astrometryLocal', { executable: path, timeout: 60000, config })).toMatchObject({ status: 'unavailable', code: 'configMissing' })

		writeFileSync(config, 'add_path /data/indexes\n')
		expect(await tools.check('astrometryLocal', { executable: path, timeout: 60000, config })).toMatchObject({ status: 'available', code: 'ok' })
		expect(await tools.check('astrometryLocal', { executable: path, timeout: 60000, config: '' })).toMatchObject({ status: 'available', code: 'ok' })
	})

	test('saves and resolves the configuration file', async () => {
		const { store: tools } = store()
		const path = executable('solve-field-saved')
		await tools.save('astrometryLocal', { executable: path, timeout: 60000, config: '/etc/astrometry.cfg', endpoint: 'ignored' }, 0)

		expect(await tools.resolve('astrometryLocal')).toEqual({ executable: path, timeout: 60000, config: '/etc/astrometry.cfg' })
	})
})

describe('nova', () => {
	// Starts a fake nova service accepting the API key "good", recording the request-json bodies of its sign-ins.
	function nova() {
		const logins: unknown[] = []

		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				if (new URL(req.url).pathname !== '/api/login') return new Response(undefined, { status: 404 })
				const body = JSON.parse((await req.formData()).get('request-json') as string) as { apikey: string }
				logins.push(body)
				return Response.json(body.apikey === 'good' ? { status: 'success', session: 'session-1' } : { status: 'error', errormessage: 'bad apikey' })
			},
		})

		return { server, logins, endpoint: server.url.origin }
	}

	test('signs in with the API key and saves only the session', async () => {
		using service = nova().server
		const { store: tools, events, file } = store()
		const endpoint = service.url.origin
		await tools.save('nova', { executable: '', timeout: 60000, endpoint }, 0)

		const outcome = await tools.login('nova', 'good')

		expect(outcome).toMatchObject({ status: 'signedIn', tool: { status: 'configured', signedIn: true, revision: 2 } })
		expect(JSON.stringify(events)).not.toContain('session-1')
		expect(JSON.stringify(await tools.list())).not.toContain('session-1')

		const saved = readFileSync(file, 'utf-8')
		expect(saved).toContain('session-1')
		expect(saved).not.toContain('good')

		expect(await tools.resolve('nova')).toEqual({ executable: '', timeout: 60000, endpoint, session: 'session-1' })
		expect(await tools.check('nova', { executable: '', timeout: 60000, endpoint })).toMatchObject({ status: 'available', code: 'ok' })
	})

	test('keeps the settings when the service refuses the key', async () => {
		const { server, logins, endpoint } = nova()
		using _ = server
		const { store: tools } = store()
		await tools.save('nova', { executable: '', timeout: 60000, endpoint }, 0)
		const routes = createExternalToolsRoutes(tools)

		const response = await call(routes, '/api/settings/external-tools/:id/login', 'POST', 'nova', { apiKey: 'wrong' })

		expect(response.status).toBe(422)
		expect(await response.json()).toMatchObject({ code: 'refused', error: 'bad apikey' })
		expect(logins).toEqual([{ apikey: 'wrong' }])
		expect(await tools.get('nova')).toMatchObject({ status: 'notConfigured', signedIn: false, revision: 1 })
		expect(await tools.resolve('nova')).toBeUndefined()
	})

	test('reports an unreachable service', async () => {
		const { server, endpoint } = nova()
		await server.stop(true)
		const { store: tools } = store()
		await tools.save('nova', { executable: '', timeout: 60000, endpoint }, 0)

		expect(await tools.login('nova', 'good')).toMatchObject({ status: 'unreachable' })
	})

	test('signs out, and a new endpoint signs out too', async () => {
		const { server, endpoint } = nova()
		using _ = server
		const { store: tools } = store()
		await tools.save('nova', { executable: '', timeout: 60000, endpoint }, 0)
		await tools.login('nova', 'good')

		// A save keeping the endpoint keeps the session.
		const kept = await tools.save('nova', { executable: '', timeout: 120000, endpoint }, 2)
		expect(kept).toMatchObject({ status: 'saved', tool: { signedIn: true } })

		const moved = await tools.save('nova', { executable: '', timeout: 120000, endpoint: 'https://example.com' }, 3)
		expect(moved).toMatchObject({ status: 'saved', tool: { signedIn: false, status: 'notConfigured' } })

		await tools.save('nova', { executable: '', timeout: 120000, endpoint }, 4)
		await tools.login('nova', 'good')
		const routes = createExternalToolsRoutes(tools)
		const response = await call(routes, '/api/settings/external-tools/:id/logout', 'POST', 'nova')

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject({ signedIn: false, status: 'notConfigured' })
		expect(await tools.resolve('nova')).toBeUndefined()
	})

	test('refuses to sign in to a program or with an invalid endpoint', async () => {
		const { store: tools } = store()
		const routes = createExternalToolsRoutes(tools)

		expect((await call(routes, '/api/settings/external-tools/:id/login', 'POST', 'astap', { apiKey: 'good' })).status).toBe(404)

		await tools.save('nova', { executable: '', timeout: 60000, endpoint: 'ftp://example.com' }, 0)
		expect(await tools.login('nova', 'good')).toMatchObject({ status: 'refused' })
		expect(await tools.check('nova', { executable: '', timeout: 60000, endpoint: 'ftp://example.com' })).toMatchObject({ status: 'failed', code: 'invalidEndpoint' })
	})

	test('ignores a session stored for a program', () => {
		const { tools } = parseSettings(JSON.stringify({ version: 1, tools: { astap: { executable: '/opt/astap', timeout: 60000, revision: 1, session: 'x' }, nova: { timeout: 60000, endpoint: 7, session: 'y', revision: 1 } } }))

		expect(tools.get('astap')).toEqual({ executable: '/opt/astap', timeout: 60000, revision: 1 })
		expect(tools.get('nova')).toEqual({ executable: '', timeout: 60000, endpoint: '', revision: 1, session: 'y' })
	})
})
