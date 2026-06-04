import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { fileSystem as fileSystemEndpoints, FileSystemHandler } from 'src/api/filesystem'
import type { FileSystem } from 'src/shared/types'
import { json } from './util'

const fileSystemHandler = new FileSystemHandler()
const endpoints = fileSystemEndpoints(fileSystemHandler)
const previousHomeDir = Bun.env.homeDir

let root = ''
let fixture = ''

beforeAll(async () => {
	root = await mkdtemp(join(tmpdir(), 'filesystem-'))
	fixture = join(root, 'fixture')
	Bun.env.homeDir = root

	await mkdir(join(fixture, 'a'), { recursive: true })
	await mkdir(join(fixture, 'b'), { recursive: true })
	await writeFile(join(fixture, 'alpha.fit'), 'alpha')
	await writeFile(join(fixture, 'beta.txt'), 'beta')
	await writeFile(join(fixture, 'zeta.fit'), 'zeta')
})

afterAll(async () => {
	if (!previousHomeDir) {
		Bun.env.homeDir = ''
	} else {
		Bun.env.homeDir = previousHomeDir
	}

	await rm(root, { recursive: true, force: true })
})

function request(body?: unknown) {
	return {
		url: 'http://localhost/filesystem',
		params: {},
		json: () => body,
	} as unknown as Bun.BunRequest
}

function entryNames(fileSystem: FileSystem) {
	return fileSystem.entries.map((entry) => ({ name: entry.name, directory: entry.directory }))
}

describe('file system handler', () => {
	test('list endpoint returns sorted directories first and filters files by glob', async () => {
		const result = await json<FileSystem>(await endpoints['/filesystem/list'].POST(request({ path: fixture, filter: '*.fit' })))

		expect(result.path).toBe(fixture)
		expect(result.tree.at(-1)).toEqual({ name: basename(fixture), path: fixture })
		expect(entryNames(result)).toEqual([
			{ name: 'a', directory: true },
			{ name: 'b', directory: true },
			{ name: 'alpha.fit', directory: false },
			{ name: 'zeta.fit', directory: false },
		])
		expect(result.entries.find((entry) => entry.name === 'alpha.fit')?.size).toBe(5)
		expect(result.entries.find((entry) => entry.name === 'alpha.fit')?.updatedAt).toBeGreaterThan(0)
	})

	test('list supports directory-only mode and keeps directories when glob filters all files', async () => {
		const directories = await fileSystemHandler.list({ path: fixture, directoryOnly: true })
		const filtered = await fileSystemHandler.list({ path: fixture, filter: '*.missing' })

		expect(entryNames(directories)).toEqual([
			{ name: 'a', directory: true },
			{ name: 'b', directory: true },
		])
		expect(filtered.entries.map((entry) => entry.name)).toEqual(['a', 'b'])
	})

	test('create endpoint trims directory name and creates it under the nearest existing directory', async () => {
		const parent = join(root, 'create-parent')
		const filePath = join(parent, 'source.fit')
		await mkdir(parent)
		await writeFile(filePath, 'source')

		const result = await json<{ path: string }>(await endpoints['/filesystem/create'].POST(request({ path: filePath, name: ' created ', recursive: false })))

		expect(result).toEqual({ path: join(parent, 'created') })
		expect((await stat(result.path)).isDirectory()).toBeTrue()
		expect(await fileSystemHandler.directory(result.path)).toEqual(result)
	})

	test('create rejects invalid directory names', () => {
		expect(fileSystemHandler.create({ path: fixture, name: '' })).rejects.toThrow('invalid directory name')
		expect(fileSystemHandler.create({ path: fixture, name: '.' })).rejects.toThrow('invalid directory name')
		expect(fileSystemHandler.create({ path: fixture, name: '..' })).rejects.toThrow('invalid directory name')
		expect(fileSystemHandler.create({ path: fixture, name: 'nested/name' })).rejects.toThrow('invalid directory name')
		expect(fileSystemHandler.create({ path: fixture, name: join(fixture, 'absolute') })).rejects.toThrow('invalid directory name')
	})

	test('directory endpoint falls back to nearest existing directory and home directory', async () => {
		expect(await json<{ path?: string }>(await endpoints['/filesystem/directory'].POST(request(join(fixture, 'a', 'missing', 'file.fit'))))).toEqual({ path: join(fixture, 'a') })
		expect(await fileSystemHandler.directory(join(fixture, 'alpha.fit'))).toEqual({ path: fixture })
		expect(await fileSystemHandler.directory()).toEqual({ path: root })
	})

	test('exists endpoint validates directories and child file names', async () => {
		expect(await json<boolean>(await endpoints['/filesystem/exists'].POST(request({ path: fixture })))).toBeTrue()
		expect(await json<boolean>(await endpoints['/filesystem/exists'].POST(request({ path: fixture, name: ' alpha.fit ' })))).toBeTrue()
		expect(await json<boolean>(await endpoints['/filesystem/exists'].POST(request({ path: fixture, name: 'a' })))).toBeTrue()
		expect(await fileSystemHandler.exists({ path: fixture, name: 'missing.fit' })).toBeFalse()
		expect(await fileSystemHandler.exists({ path: fixture, name: '../alpha.fit' })).toBeFalse()
		expect(await fileSystemHandler.exists({ path: fixture, name: '' })).toBeFalse()
	})

	test('join endpoint filters non-string and empty path segments', async () => {
		const result = await json<{ path: string }>(await endpoints['/filesystem/join'].POST(request([fixture, '', 'child', 42, null, 'file.fit'])))

		expect(result).toEqual({ path: join(fixture, 'child', 'file.fit') })
		expect(fileSystemHandler.join([])).toEqual({ path: '' })
		expect(fileSystemHandler.join({ path: fixture } as never)).toEqual({ path: '' })
	})
})
