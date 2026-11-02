import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeAtomically } from './util'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-util-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

test('an atomic write creates the directory, replaces the file, and leaves no temporary file', async () => {
	const directory = join(root, 'replace', 'nested')
	const file = join(directory, 'settings.json')

	await writeAtomically(file, 'first')
	await writeAtomically(file, 'second')

	expect(readFileSync(file, 'utf-8')).toBe('second')
	expect(readdirSync(directory)).toEqual(['settings.json'])
})

test('a failed atomic write keeps what was there and removes its temporary file', async () => {
	const directory = join(root, 'failure')
	const target = join(directory, 'taken')
	mkdirSync(target, { recursive: true })
	writeFileSync(join(target, 'kept'), 'kept')

	await expect(writeAtomically(target, 'text')).rejects.toThrow()
	expect(readdirSync(directory)).toEqual(['taken'])
	expect(readFileSync(join(target, 'kept'), 'utf-8')).toBe('kept')
})

test.skipIf(process.platform === 'win32')('an atomic write is readable and writable by the server user only', async () => {
	const file = join(root, 'private.json')

	await writeAtomically(file, 'secret')

	expect(statSync(file).mode & 0o777).toBe(0o600)
})
