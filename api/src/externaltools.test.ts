import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase } from './database'
import { createExternalToolsRoutes, DEFAULT_EXTERNAL_TOOL_TIMEOUT, DEFAULT_MEDIAMTX_TIMEOUT, EXTERNAL_TOOLS, type ExternalToolCheck, type ExternalToolEvent, type ExternalToolState, ExternalToolsStore, inspectExecutable, type ProbeOutcome, type ProgramProbe, probeProgram, programVersion } from './externaltools'

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

// Default index folder of the built-in solver in the tests, missing until a test creates it.
const defaultIndexes = join(root, 'default-indexes')

// Creates a store over a fresh database in memory, recording its events; programs are started by probe.
function store(database = AppDatabase.memory(), probe: ProgramProbe = fakeProbe().probe) {
	const events: ExternalToolEvent[] = []
	return { store: new ExternalToolsStore(database, (event) => events.push(event), probe, defaultIndexes), events, database }
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
	test('lists the built-in solver and MediaMTX, with their capabilities and settings', async () => {
		const routes = createExternalToolsRoutes(store().store)
		const tools = (await (await call(routes, '/api/settings/external-tools', 'GET')).json()) as ExternalToolState[]

		expect(tools.map((tool) => tool.id)).toEqual(['nebulosa', 'mediamtx'])
		expect(tools[0]).toMatchObject({ name: 'Nebulosa', capabilities: ['plate-solving'], fields: ['indexDirectory', 'catalogDirectory'], status: 'configured', revision: 0, config: { executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT, indexDirectory: '', catalogDirectory: '' } })
		expect(tools[0].lastCheck).toBeUndefined()
		expect(tools[1]).toMatchObject({ name: 'MediaMTX', capabilities: ['video-gateway'], fields: ['executable'], status: 'notConfigured', timeoutLimits: { min: 1000, max: 60000 }, config: { executable: '', timeout: DEFAULT_MEDIAMTX_TIMEOUT } })
	})

	test('the external solvers and star detectors are not external tools', () => {
		const ids: readonly string[] = EXTERNAL_TOOLS.map((tool) => tool.id)
		expect(ids).not.toContain('astap')
		expect(ids).not.toContain('astrometryLocal')
		expect(ids).not.toContain('nova')
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
		const path = executable('mediamtx one')
		const outcome = await first.save('mediamtx', { executable: path, timeout: 60000 }, 0)

		expect(outcome).toMatchObject({ status: 'saved', tool: { status: 'configured', revision: 1, config: { executable: path, timeout: 60000 } } })
		expect(events).toHaveLength(1)
		database.close()

		const reopened = new AppDatabase(file)
		const second = new ExternalToolsStore(reopened)
		expect(await second.get('mediamtx')).toMatchObject({ status: 'configured', revision: 1, config: { executable: path, timeout: 60000 } })
		expect(rows(reopened)).toEqual([{ tool_id: 'mediamtx', executable: path, timeout: 60000, index_directory: null, catalog_directory: null, revision: 1, updated_at: expect.any(Number) }])
		reopened.close()
	})

	test('a save from an outdated revision is refused', async () => {
		const routes = createExternalToolsRoutes(store().store)
		const config = { executable: '/opt/mediamtx/mediamtx', timeout: 30000 }
		const [a, b] = await Promise.all([call(routes, '/api/settings/external-tools/:id', 'PUT', 'mediamtx', { config, revision: 0 }), call(routes, '/api/settings/external-tools/:id', 'PUT', 'mediamtx', { config: { ...config, timeout: 40000 }, revision: 0 })])

		expect(a.status).toBe(200)
		expect(b.status).toBe(409)
		expect(await b.json()).toMatchObject({ code: 'conflict', tool: { revision: 1, config } })
	})

	test('a database that cannot be written is 500 and changes nothing', async () => {
		const { store: blocked, database } = store()
		database.db.run('PRAGMA query_only = ON')
		const routes = createExternalToolsRoutes(blocked)
		const response = await call(routes, '/api/settings/external-tools/:id', 'PUT', 'mediamtx', { config: { executable: 'mediamtx', timeout: 5000 }, revision: 0 })

		expect(response.status).toBe(500)
		expect(await response.json()).toMatchObject({ code: 'writeFailed' })
		expect(await blocked.get('mediamtx')).toMatchObject({ status: 'notConfigured', revision: 0 })
	})
})

describe('executable check', () => {
	test('an executable file is available', async () => {
		const path = executable('program')
		expect(await inspectExecutable(path)).toEqual({ status: 'available', code: 'ok', resolvedPath: path, message: expect.any(String) })
	})

	test('paths with spaces and shell characters are literal names', async () => {
		const path = executable("program $(touch pwned); & 'x'")
		expect(await inspectExecutable(path)).toMatchObject({ status: 'available', resolvedPath: path })
		expect(await inspectExecutable(join(root, 'missing $(id)'))).toMatchObject({ status: 'unavailable', code: 'missing' })
	})

	test('an empty path fails', async () => {
		expect(await inspectExecutable('')).toMatchObject({ status: 'failed', code: 'empty' })
		expect(await inspectExecutable('   ')).toMatchObject({ status: 'failed', code: 'empty' })
	})

	test('a missing path is unavailable', async () => {
		expect(await inspectExecutable(join(root, 'nothing', 'program'))).toMatchObject({ status: 'unavailable', code: 'missing' })
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
		const { store: tools, events, database } = store(undefined, fakeProbe({ status: 'answered', output: 'v1.21.3\n' }).probe)
		const routes = createExternalToolsRoutes(tools)
		const response = await call(routes, '/api/settings/external-tools/:id/test', 'POST', 'mediamtx', { config: { executable: executable('draft'), timeout: 5000 } })
		const check = (await response.json()) as ExternalToolCheck

		expect(response.status).toBe(200)
		expect(check).toMatchObject({ status: 'available', code: 'ok', version: '1.21.3', config: { timeout: 5000 }, checkedAt: expect.any(Number), duration: expect.any(Number) })
		expect(rows(database)).toEqual([])
		expect((await tools.get('mediamtx')).lastCheck).toBeUndefined()
		expect(events).toHaveLength(0)
	})

	test('a check of the saved settings becomes the latest check until they change', async () => {
		const { store: tools, events } = store(undefined, fakeProbe({ status: 'answered', output: 'v1.21.3\n' }).probe)
		const config = { executable: executable('saved'), timeout: 5000 }
		await tools.save('mediamtx', config, 0)
		await tools.check('mediamtx', config)

		expect((await tools.get('mediamtx')).lastCheck).toMatchObject({ status: 'available', config })
		expect(events.at(-1)?.tool.lastCheck).toMatchObject({ status: 'available' })

		await tools.save('mediamtx', config, 1)
		expect((await tools.get('mediamtx')).lastCheck).toBeDefined()

		await tools.save('mediamtx', { ...config, timeout: 6000 }, 2)
		expect((await tools.get('mediamtx')).lastCheck).toBeUndefined()
	})

	test('a check of settings replaced during it is not recorded', async () => {
		const { store: tools } = store()
		const config = { executable: executable('racing'), timeout: 5000 }
		await tools.save('mediamtx', config, 0)
		const checking = tools.check('mediamtx', config)
		await tools.save('mediamtx', { ...config, executable: 'other' }, 1)
		await checking

		expect((await tools.get('mediamtx')).lastCheck).toBeUndefined()
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
		expect(programVersion('program version 2026.06.29\n')).toBe('2026.06.29')
		expect(programVersion('Revision 0.93, date Mon_Jun_1\n')).toBe('0.93')
		expect(programVersion('v1.21.3\n')).toBe('1.21.3')
		expect(programVersion('Usage: tool [options]')).toBeUndefined()
	})

	test('MediaMTX is started with the argument that prints its version', async () => {
		const { probe, calls } = fakeProbe()
		const { store: tools } = store(undefined, probe)
		const path = executable(`probed-${files++}`)
		await tools.check('mediamtx', { executable: path, timeout: 5000 })

		expect(calls).toEqual([{ executable: path, args: ['--version'] }])
	})

	test('a program that cannot start or does not answer fails', async () => {
		const path = executable(`failing-${files++}`)
		const notStarted = store(undefined, fakeProbe({ status: 'notStarted', message: 'bad format' }).probe).store
		const noAnswer = store(undefined, fakeProbe({ status: 'noAnswer' }).probe).store

		expect(await notStarted.check('mediamtx', { executable: path, timeout: 5000 })).toMatchObject({ status: 'failed', code: 'notStarted', resolvedPath: path })
		expect(await noAnswer.check('mediamtx', { executable: path, timeout: 5000 })).toMatchObject({ status: 'failed', code: 'noAnswer', resolvedPath: path })
	})

	test('MediaMTX must be a version the gateway supports', async () => {
		const path = executable(`mediamtx-${files++}`)
		const old = store(undefined, fakeProbe({ status: 'answered', output: 'v1.9.0\n' }).probe).store
		const current = store(undefined, fakeProbe({ status: 'answered', output: 'v1.21.3\n' }).probe).store

		expect(await old.check('mediamtx', { executable: path, timeout: 5000 })).toMatchObject({ status: 'failed', code: 'incompatibleVersion', version: '1.9.0' })
		expect(await current.check('mediamtx', { executable: path, timeout: 5000 })).toMatchObject({ status: 'available', code: 'ok', version: '1.21.3' })
	})

	test('the saved programs are checked at startup, the unset ones are not', async () => {
		const { probe, calls } = fakeProbe({ status: 'answered', output: 'v1.21.3\n' })
		const { store: tools } = store(undefined, probe)
		const path = executable(`startup-${files++}`)

		await tools.checkSaved()
		expect(calls).toEqual([])
		expect((await tools.get('mediamtx')).lastCheck).toBeUndefined()

		await tools.save('mediamtx', { executable: path, timeout: 5000 }, 0)
		await tools.checkSaved()

		expect(calls).toEqual([{ executable: path, args: ['--version'] }])
		expect((await tools.get('mediamtx')).lastCheck).toMatchObject({ status: 'available' })
	})
})

describe('resolve', () => {
	test('nothing configured resolves undefined', async () => {
		expect(await store().store.resolve('mediamtx')).toBeUndefined()
	})

	test('a resolved snapshot keeps its values after a later save', async () => {
		const { store: tools } = store()
		await tools.save('mediamtx', { executable: '/opt/mediamtx/mediamtx', timeout: 5000 }, 0)
		const snapshot = await tools.resolve('mediamtx')
		await tools.save('mediamtx', { executable: '/usr/bin/mediamtx', timeout: 9000 }, 1)

		expect(snapshot).toEqual({ executable: '/opt/mediamtx/mediamtx', timeout: 5000 })
		expect(Object.isFrozen(snapshot)).toBeTrue()
		expect(await tools.resolve('mediamtx')).toEqual({ executable: '/usr/bin/mediamtx', timeout: 9000 })
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

	test('is always configured, searching the default index folder for an empty Index Folder, and never starts anything', async () => {
		const { probe, calls } = fakeProbe()
		const { store: tools } = store(undefined, probe)
		const indexes = folder('nqi-480-4-0001.nqi')

		expect(await tools.resolve('nebulosa')).toEqual({ executable: '', timeout: DEFAULT_EXTERNAL_TOOL_TIMEOUT, indexDirectory: defaultIndexes, catalogDirectory: '' })
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

		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: ' ', catalogDirectory: '' })).toMatchObject({ status: 'unavailable', code: 'noIndexes', resolvedPath: defaultIndexes, message: expect.stringContaining('Download the index bands') })
		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: join(root, 'nowhere') })).toMatchObject({ status: 'unavailable', code: 'missing' })
		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, catalogDirectory: file })).toMatchObject({ status: 'failed', code: 'notDirectory' })
		expect(await tools.check('nebulosa', { executable: '', timeout: 60000, indexDirectory: folder('readme.txt'), catalogDirectory: folder('v50_0101.1476') })).toMatchObject({ status: 'unavailable', code: 'noIndexes' })
	})

	test('an empty Index Folder checks the default index folder once a band is installed there', async () => {
		const { store: tools } = store()
		mkdirSync(join(defaultIndexes, 'astap-d20'), { recursive: true })
		writeFileSync(join(defaultIndexes, 'astap-d20', 'nqi-480-8-0000.nqi'), '')

		try {
			expect(await tools.check('nebulosa', { executable: '', timeout: 60000 })).toMatchObject({ status: 'available', code: 'ok', resolvedPath: defaultIndexes, message: expect.stringContaining('Found 1 Nebulosa index file') })
		} finally {
			rmSync(defaultIndexes, { recursive: true, force: true })
		}
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
