import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { DirectoryListing } from './files'
import { routes } from './index'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-files-'))
mkdirSync(join(root, 'b-dir'))
mkdirSync(join(root, 'A-dir'))
writeFileSync(join(root, 'm31.FITS'), 'x')
writeFileSync(join(root, 'm42.xisf'), 'xy')
writeFileSync(join(root, 'notes.txt'), 'abc')
writeFileSync(join(root, 'frame10.fit'), '')
writeFileSync(join(root, 'frame9.fit'), '')

afterAll(() => rmSync(root, { recursive: true, force: true }))

const handler = (routes['/api/files'] as Record<string, (req: Request) => Promise<Response>>).GET

async function list(query: string) {
	return await handler(new Request(`http://localhost/api/files?${query}`))
}

describe('list directory', () => {
	test('lists directories first, then files, in natural order', async () => {
		const response = await list(`path=${encodeURIComponent(root)}`)
		const listing = (await response.json()) as DirectoryListing

		expect(response.status).toBe(200)
		expect(listing.path).toBe(root)
		expect(listing.parent).toBe(dirname(root))
		expect(listing.entries.map((e) => e.name)).toEqual(['A-dir', 'b-dir', 'frame9.fit', 'frame10.fit', 'm31.FITS', 'm42.xisf', 'notes.txt'])
		expect(listing.entries[0]).toMatchObject({ path: join(root, 'A-dir'), directory: true })
		expect(listing.entries.find((e) => e.name === 'notes.txt')).toMatchObject({ directory: false, size: 3, modifiedAt: expect.any(String) })
	})

	test('filters files by extension, keeping directories', async () => {
		const listing = (await (await list(`path=${encodeURIComponent(root)}&extensions=fits,xisf`)).json()) as DirectoryListing
		expect(listing.entries.map((e) => e.name)).toEqual(['A-dir', 'b-dir', 'm31.FITS', 'm42.xisf'])
	})

	test('a missing directory is 404', async () => {
		expect((await list(`path=${encodeURIComponent(join(root, 'missing'))}`)).status).toBe(404)
		expect((await list(`path=${encodeURIComponent(join(root, 'notes.txt'))}`)).status).toBe(404)
	})

	test.if(process.platform === 'win32')('a drive root goes up to the list of drives', async () => {
		const drive = root.slice(0, 3)
		const top = (await (await list(`path=${encodeURIComponent(drive)}`)).json()) as DirectoryListing
		const drives = (await (await list('path=')).json()) as DirectoryListing

		expect(top.parent).toBe('')
		expect(drives.path).toBe('')
		expect(drives.parent).toBeUndefined()
		expect(drives.entries.map((e) => e.path)).toContain(drive)
	})
})
