import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import {
	createExternalToolsRoutes,
	DEFAULT_EXTERNAL_TOOL_TIMEOUT,
	DEFAULT_MEDIAMTX_TIMEOUT,
	EXTERNAL_TOOLS,
	type ExternalToolCheck,
	type ExternalToolEvent,
	type ExternalToolState,
	ExternalToolsStore,
	inspectExecutable,
	type ProbeOutcome,
	type ProgramProbe,
	probeProgram,
	programVersion,
	starDatabases,
} from './externaltools'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-external-tools-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const WINDOWS = process.platform === 'win32'

let files = 0

// Returns a database file path of a fresh directory.
function databaseFile() {
	return join(root, `database-${files++}`, 'nebulosa.sqlite')
}

// Rows of the saved settings, as the database holds them.
function rows(database: AppDatabase) {
	return database.db.query('SELECT * FROM external_tool_settings ORDER BY tool_id').all()
}

// Creates a file the server may execute.
function executable(name: string) {
	const path = join(root, name)
	writeFileSync(path, '#!/bin/sh\nexit 0\n')
	chmodSync(path, 0o755)
	return path
}

// Probe that never starts anything: every program answers with output, recording the arguments it was given.
function fakeProbe(outcome?: ProbeOutcome) {
	const calls: { executable: string; args: readonly string[] }[] = []
	const probe: ProgramProbe = (executable, args) => {
		calls.push({ executable, args })
		return Promise.resolve(outcome ?? { status: 'answered', output: '' })
	}
	return { probe, calls }
}

// Creates a store over a fresh database in memory, recording its events; programs are started by probe.
function store(database = AppDatabase.memory(), probe: ProgramProbe = fakeProbe().probe) {
	const events: ExternalToolEvent[] = []
	return { store: new ExternalToolsStore(database, (event) => events.push(event), probe), events, database }
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
	test('lists ASTAP, solve-field, nova, the built-in solver, and MediaMTX, with their capabilities and settings', async () => {
		const routes = createExternalToolsRoutes(store().store)
		const tools = (await (await call(routes, '/api/settings/external-tools', 'GET')).json()) as ExternalToolState[]

		expect(tools.map((tool) => tool.id)).toEqual(['astap', 'astrometryLocal', 'nova', 'nebulosa', 'mediamtx'])
		expect(tools[0]).toMatchObject({ name: 'ASTAP', capabilities: ['plate-solving', 'star-detection'], fields: ['executable'], session: false, status: 'notConfigured', revision: 0, config: { executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT } })
		expect(tools[0].lastCheck).toBeUndefined()
		expect(tools[0].signedIn).toBeUndefined()
		expect(tools[1]).toMatchObject({ capabilities: ['plate-solving'], fields: ['executable', 'config'], status: 'notConfigured', config: { executable: '', config: '' } })
		expect(tools[2]).toMatchObject({ capabilities: ['plate-solving'], fields: ['endpoint'], session: true, status: 'notConfigured', signedIn: false, config: { executable: '', endpoint: '' } })
		expect(tools[3]).toMatchObject({ name: 'Nebulosa', capabilities: ['plate-solving'], fields: ['indexDirectory', 'catalogDirectory'], session: false, status: 'notConfigured', config: { executable: '', indexDirectory: '', catalogDirectory: '' } })
		expect(tools[4]).toMatchObject({ name: 'MediaMTX', capabilities: ['video-gateway'], fields: ['executable'], session: false, status: 'notConfigured', timeoutLimits: { min: 1000, max: 60000 }, config: { executable: '', timeout: DEFAULT_MEDIAMTX_TIMEOUT } })
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
		const file = databaseFile()
		const database = new AppDatabase(file)
		const { store: first, events } = store(database)
		const path = executable('astap one')
		const outcome = await first.save('astap', { executable: path, timeout: 60000 }, 0)

		expect(outcome).toMatchObject({ status: 'saved', tool: { status: 'configured', revision: 1, config: { executable: path, timeout: 60000 } } })
		expect(events).toHaveLength(1)
		database.close()

		const reopened = new AppDatabase(file)
		const second = new ExternalToolsStore(reopened)
		expect(await second.get('astap')).toMatchObject({ status: 'configured', revision: 1, config: { executable: path, timeout: 60000 } })
		expect(rows(reopened)).toEqual([{ tool_id: 'astap', executable: path, timeout: 60000, config: null, endpoint: null, index_directory: null, catalog_directory: null, revision: 1, updated_at: expect.any(Number) }])
		reopened.close()
	})

	test('a save from an outdated revision is refused', async () => {
		const routes = createExternalToolsRoutes(store().store)
		const config = { executable: '/opt/astap/astap', timeout: 30000 }
		const [a, b] = await Promise.all([call(routes, '/api/settings/external-tools/:id', 'PUT', 'astap', { config, revision: 0 }), call(routes, '/api/settings/external-tools/:id', 'PUT', 'astap', { config: { ...config, timeout: 40000 }, revision: 0 })])

		expect(a.status).toBe(200)
		expect(b.status).toBe(409)
		expect(await b.json()).toMatchObject({ code: 'conflict', tool: { revision: 1, config } })
	})

	test('a database that cannot be written is 500 and changes nothing', async () => {
		const { store: blocked, database } = store()
		database.db.run('PRAGMA query_only = ON')
		const routes = createExternalToolsRoutes(blocked)
		const response = await call(routes, '/api/settings/external-tools/:id', 'PUT', 'astap', { config: { executable: 'astap', timeout: 5000 }, revision: 0 })

		expect(response.status).toBe(500)
		expect(await response.json()).toMatchObject({ code: 'writeFailed' })
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
		const { store: tools, events, database } = store()
		const routes = createExternalToolsRoutes(tools)
		const response = await call(routes, '/api/settings/external-tools/:id/test', 'POST', 'astap', { config: { executable: executable('draft'), timeout: 5000 } })
		const check = (await response.json()) as ExternalToolCheck

		expect(response.status).toBe(200)
		expect(check).toMatchObject({ status: 'available', code: 'noDatabase', config: { timeout: 5000 }, checkedAt: expect.any(Number), duration: expect.any(Number) })
		expect(check.version).toBeUndefined()
		expect(rows(database)).toEqual([])
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

describe('program start', () => {
	test('a program that prints its version answers', async () => {
		const outcome = await probeProgram(process.execPath, ['--version'], 10000)
		expect(outcome.status).toBe('answered')
		expect(outcome.status === 'answered' && programVersion(outcome.output)).toBe(Bun.version)
	})

	test('a program that does not end in time is stopped', async () => {
		expect(await probeProgram(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 300)).toEqual({ status: 'noAnswer' })
	})

	test('a file that is not a program is not started', async () => {
		const path = join(root, `not-a-program-${files++}.txt`)
		writeFileSync(path, 'text')
		chmodSync(path, 0o755)
		expect((await probeProgram(path, ['--version'], 10000)).status).toBe('notStarted')
	})

	test('reads the versions the programs print', () => {
		expect(programVersion('ASTAP astrometric solver version CLI-2026.06.29\n(C) 2018, 2025 by Han Kleijn.')).toBe('CLI-2026.06.29')
		expect(programVersion('This program is part of the Astrometry.net suite.\nRevision 0.93, date Mon_Jun_1\n')).toBe('0.93')
		expect(programVersion('v1.21.3\n')).toBe('1.21.3')
		expect(programVersion('Usage: tool [options]')).toBeUndefined()
	})

	test('each program is started with the argument that prints its help or version', async () => {
		const { probe, calls } = fakeProbe()
		const { store: tools } = store(undefined, probe)
		const path = executable(`probed-${files++}`)
		await tools.check('astap', { executable: path, timeout: 5000 })
		await tools.check('astrometryLocal', { executable: path, timeout: 5000, config: '' })
		await tools.check('mediamtx', { executable: path, timeout: 5000 })

		expect(calls).toEqual([
			{ executable: path, args: ['-h'] },
			{ executable: path, args: ['--help'] },
			{ executable: path, args: ['--version'] },
		])
	})

	test('a program that cannot start or does not answer fails', async () => {
		const path = executable(`failing-${files++}`)
		const notStarted = store(undefined, fakeProbe({ status: 'notStarted', message: 'bad format' }).probe).store
		const noAnswer = store(undefined, fakeProbe({ status: 'noAnswer' }).probe).store

		expect(await notStarted.check('astrometryLocal', { executable: path, timeout: 5000, config: '' })).toMatchObject({ status: 'failed', code: 'notStarted', resolvedPath: path })
		expect(await noAnswer.check('astrometryLocal', { executable: path, timeout: 5000, config: '' })).toMatchObject({ status: 'failed', code: 'noAnswer', resolvedPath: path })
	})

	test('ASTAP is available with a star database beside it', async () => {
		const folder = join(root, `astap-${files++}`)
		mkdirSync(folder)
		const path = join(folder, 'astap')
		writeFileSync(path, '')
		chmodSync(path, 0o755)
		const { store: tools } = store(undefined, fakeProbe({ status: 'answered', output: 'ASTAP astrometric solver version CLI-2026.06.29' }).probe)

		expect(await tools.check('astap', { executable: path, timeout: 5000 })).toMatchObject({ status: 'available', code: 'noDatabase', version: 'CLI-2026.06.29' })

		writeFileSync(join(folder, 'd50_0101.1476'), '')
		writeFileSync(join(folder, 'D20_0102.1476'), '')
		expect(await starDatabases(path)).toEqual(['D20', 'D50'])
		const check = await tools.check('astap', { executable: path, timeout: 5000 })
		expect(check).toMatchObject({ status: 'available', code: 'ok', version: 'CLI-2026.06.29' })
		expect(check.message).toContain('D20, D50')
	})

	test('MediaMTX must be a version the gateway supports', async () => {
		const path = executable(`mediamtx-${files++}`)
		const old = store(undefined, fakeProbe({ status: 'answered', output: 'v1.9.0\n' }).probe).store
		const current = store(undefined, fakeProbe({ status: 'answered', output: 'v1.21.3\n' }).probe).store

		expect(await old.check('mediamtx', { executable: path, timeout: 5000 })).toMatchObject({ status: 'failed', code: 'incompatibleVersion', version: '1.9.0' })
		expect(await current.check('mediamtx', { executable: path, timeout: 5000 })).toMatchObject({ status: 'available', code: 'ok', version: '1.21.3' })
	})

	test('the saved programs are checked at startup, the unset ones and the web services are not', async () => {
		const { probe, calls } = fakeProbe()
		const { store: tools } = store(undefined, probe)
		const path = executable(`startup-${files++}`)
		await tools.save('astap', { executable: path, timeout: 5000 }, 0)
		await tools.save('nova', { executable: '', timeout: 60000, endpoint: '' }, 0)

		await tools.checkSaved()

		expect(calls).toEqual([{ executable: path, args: ['-h'] }])
		expect((await tools.get('astap')).lastCheck).toMatchObject({ status: 'available' })
		expect((await tools.get('astrometryLocal')).lastCheck).toBeUndefined()
		expect((await tools.get('nova')).lastCheck).toBeUndefined()
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

describe('built-in solver', () => {
	// Creates a folder holding the named empty files.
	function folder(...names: string[]) {
		const path = join(root, `solver-${files++}`)
		mkdirSync(path)
		for (const name of names) {
			mkdirSync(join(path, name, '..'), { recursive: true })
			writeFileSync(join(path, name), '')
		}
		return path
	}

	test('is configured by a folder and never starts anything', async () => {
		const { probe, calls } = fakeProbe()
		const { store: tools } = store(undefined, probe)
		const indexes = folder('nqi-480-4-0001.nqi')

		expect(await tools.resolve('nebulosa')).toBeUndefined()
		expect(await tools.save('nebulosa', { executable: '/bin/sh', timeout: 60000, indexDirectory: indexes }, 0)).toMatchObject({ status: 'saved', tool: { status: 'configured' } })
		expect(await tools.resolve('nebulosa')).toEqual({ executable: '', timeout: 60000, indexDirectory: indexes, catalogDirectory: '' })

		await tools.checkSaved()
		expect(calls).toEqual([])
		expect((await tools.get('nebulosa')).lastCheck).toMatchObject({ status: 'available', code: 'ok' })
	})

	test('finds the index files with the subfolders and the supported star databases', async () => {
		const { store: tools } = store()
		const indexes = folder('gaia/nqi-480-4-0001.nqi', 'gaia/nqi-480-4-0002.nqi', 'an/index-4110.fits', 'an/notes.fits')
		const catalog = folder('d50_0101.1476', 'd50_0102.1476', 'g16_0101.290', 'v50_0101.1476')

		const check = await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: indexes, catalogDirectory: catalog })
		expect(check).toMatchObject({ status: 'available', code: 'ok', resolvedPath: indexes })
		expect(check.message).toBe('Found 2 Nebulosa index files, 1 Astrometry.net index file, star database ASTAP D50, HNSKY G16. The files are read once a solve needs them.')

		const catalogOnly = await tools.check('nebulosa', { executable: '', timeout: 60000, catalogDirectory: catalog })
		expect(catalogOnly.message).toContain('only images with a known position and scale are solved')
	})

	test('refuses folders that are unset, missing, files, or hold nothing it reads', async () => {
		const { store: tools } = store()
		const file = join(root, `solver-file-${files++}`)
		writeFileSync(file, '')

		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: ' ', catalogDirectory: '' })).toMatchObject({ status: 'failed', code: 'empty' })
		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: join(root, 'nowhere') })).toMatchObject({ status: 'unavailable', code: 'missing' })
		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, catalogDirectory: file })).toMatchObject({ status: 'failed', code: 'notDirectory' })
		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: folder('readme.txt'), catalogDirectory: folder('v50_0101.1476') })).toMatchObject({ status: 'unavailable', code: 'noIndexes' })
	})

	test('keeps its folders across a restart', async () => {
		const file = databaseFile()
		const database = new AppDatabase(file)
		await new ExternalToolsStore(database).save('nebulosa', { executable: '', timeout: 90000, indexDirectory: '/data/quads', catalogDirectory: '/opt/astap' }, 0)
		database.close()

		const reopened = new AppDatabase(file)
		expect(await new ExternalToolsStore(reopened).resolve('nebulosa')).toEqual({ executable: '', timeout: 90000, indexDirectory: '/data/quads', catalogDirectory: '/opt/astap' })
		reopened.close()
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

	test('signs in with the API key and keeps the session in memory only', async () => {
		using service = nova().server
		const { store: tools, events, database } = store()
		const endpoint = service.url.origin
		await tools.save('nova', { executable: '', timeout: 60000, endpoint }, 0)

		const outcome = await tools.login('nova', 'good')

		expect(outcome).toMatchObject({ status: 'signedIn', tool: { status: 'configured', signedIn: true, revision: 2 } })
		expect(JSON.stringify(events)).not.toContain('session-1')
		expect(JSON.stringify(await tools.list())).not.toContain('session-1')

		const saved = JSON.stringify(rows(database))
		expect(saved).not.toContain('session-1')
		expect(saved).not.toContain('good')

		expect(await tools.resolve('nova')).toEqual({ executable: '', timeout: 60000, endpoint, session: 'session-1' })
		expect(await tools.check('nova', { executable: '', timeout: 60000, endpoint })).toMatchObject({ status: 'available', code: 'ok' })

		// A restart keeps the settings and signs out.
		const restarted = new ExternalToolsStore(database)
		expect(await restarted.get('nova')).toMatchObject({ status: 'notConfigured', signedIn: false, revision: 2, config: { endpoint } })
		expect(await restarted.resolve('nova')).toBeUndefined()
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
})
