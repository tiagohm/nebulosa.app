import { expect, test } from 'bun:test'
import { join } from 'path'

// Operational state lives only in the database of api/src/database. These guards fail when a source file starts writing
// state another way: an atomic file write, an appended journal, a database of its own, or browser storage. A new use that
// is not operational state, such as a file of an external provider, joins the allowlist with the reason.

const ROOT = join(import.meta.dir, '..', '..')

// Uses each pattern allows, by path relative to the repository root, with why.
const ALLOWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
	'writeAtomically(': {
		'api/src/util.ts': 'the helper itself',
		'api/src/astronomicaltime.eop.ts': 'IERS tables, files of an external provider',
	},
	'appendFile(': {
		'api/src/calibrationlibrary.analysis.ts': 'a master and its spill files being written in the staging of a job',
	},
	'new Database(': {
		'api/src/database/connection.ts': 'the operational database',
		'api/src/sky/fixture.ts': 'an in-memory sky catalog for tests',
	},
}

// Source files of api and web, without tests, by path relative to the repository root.
async function sources() {
	const files: { path: string; text: string }[] = []

	for (const workspace of ['api/src', 'web/src']) {
		for await (const file of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: join(ROOT, workspace) })) {
			if (/\.test\.tsx?$/.test(file)) continue
			const path = `${workspace}/${file.replaceAll('\\', '/')}`
			files.push({ path, text: await Bun.file(join(ROOT, path)).text() })
		}
	}

	return files
}

test('no source writes operational state outside the database', async () => {
	const files = await sources()
	expect(files.length).toBeGreaterThan(100)

	for (const [pattern, allowed] of Object.entries(ALLOWED)) {
		const users = files.filter(({ text }) => text.includes(pattern)).map(({ path }) => path)
		expect({ pattern, users: users.filter((path) => !(path in allowed)) }).toEqual({ pattern, users: [] })
	}
})

test('the web keeps nothing in browser storage', async () => {
	const web = (await sources()).filter(({ path }) => path.startsWith('web/'))
	expect(web.filter(({ text }) => /\b(localStorage|sessionStorage|indexedDB)\b/.test(text)).map(({ path }) => path)).toEqual([])
})
