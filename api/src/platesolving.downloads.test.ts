import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createQuadIndexDownloadRoutes, extractTar, googleDriveUrl, type QuadIndexBand, type QuadIndexDownloadsEvent, type QuadIndexDownloadsSnapshot, QuadIndexDownloads, type QuadIndexSource } from './platesolving.downloads'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-quad-downloads-'))
let folders = 0

afterAll(() => rmSync(root, { recursive: true, force: true }))

const SOURCE: QuadIndexSource = { id: 'astap-d20', name: 'ASTAP D20', description: 'Test source.' }

const TILES = { 'nqi-480-8-0000.nqi': 'first tile', 'nqi-480-8-0001.nqi': 'second tile of the band' }

// Archive of the test band and its catalog entry.
async function archive(files: Record<string, string> = TILES) {
	const bytes = new Uint8Array(Bun.zstdCompressSync(await new Bun.Archive(files).bytes()))
	const band: QuadIndexBand = {
		id: 'astap-d20-480',
		source: 'astap-d20',
		prefix: 'nqi-480-8',
		scaleLower: 0.0023271056693257726,
		scaleUpper: 0.003291024398635827,
		tileNside: 8,
		files: Object.keys(files).length,
		bytes: Object.values(files).reduce((sum, text) => sum + text.length, 0),
		archiveBytes: bytes.byteLength,
		sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
		driveId: 'drive-id',
	}
	return { bytes, band }
}

// Downloads into a fresh folder with fetch, recording the snapshots it publishes.
function setup(band: QuadIndexBand, fetch: (url: string, init: RequestInit) => Promise<Response>, indexDirectory?: string) {
	const directory = join(root, `indexes-${folders++}`)
	const events: QuadIndexDownloadsSnapshot[] = []
	const downloads = new QuadIndexDownloads(directory, { indexDirectory: () => Promise.resolve(indexDirectory) }, (event: QuadIndexDownloadsEvent) => events.push(event.snapshot), { fetch, bands: [band], sources: [SOURCE] })

	// Resolves once a published snapshot satisfies done.
	async function until(done: (snapshot: QuadIndexDownloadsSnapshot) => boolean) {
		for (let i = 0; i < 500; i++) {
			const last = events.at(-1)
			if (last && done(last)) return last
			await Bun.sleep(10)
		}
		throw new Error('timed out')
	}

	return { directory, downloads, events, until }
}

// Answers the archive as Google Drive does.
function drive(bytes: Uint8Array<ArrayBuffer>, urls: string[] = []) {
	return (url: string) => {
		urls.push(url)
		return Promise.resolve(new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
	}
}

describe('download', () => {
	test('installs the files of a band from Google Drive into its source folder', async () => {
		const { bytes, band } = await archive()
		const urls: string[] = []
		const { directory, downloads, until } = setup(band, drive(bytes, urls))
		await downloads.start()

		expect((await downloads.snapshot()).bands[0]).toMatchObject({ installed: 'missing', published: true })
		await downloads.download(band.id)
		const snapshot = await until((e) => e.bands[0].installed === 'installed')

		expect(urls).toEqual([googleDriveUrl('drive-id')])
		expect(snapshot.bands[0]).toMatchObject({ installedFiles: 2, installedBytes: band.bytes })
		expect(snapshot.bands[0].job).toBeUndefined()
		expect(readFileSync(join(directory, 'astap-d20', 'nqi-480-8-0001.nqi'), 'utf-8')).toBe('second tile of the band')
		expect(readdirSync(join(directory, '.staging'))).toEqual([])
	})

	test('a damaged archive fails and keeps the installed files', async () => {
		const { bytes, band } = await archive()
		const { directory, downloads, until } = setup({ ...band, sha256: '0'.repeat(64) }, drive(bytes))
		mkdirSync(join(directory, 'astap-d20'), { recursive: true })
		writeFileSync(join(directory, 'astap-d20', 'nqi-480-8-0000.nqi'), 'old')

		await downloads.download(band.id)
		const snapshot = await until((e) => e.bands[0].job?.state === 'failed')

		expect(snapshot.bands[0].job?.error).toContain('damaged')
		expect(snapshot.bands[0]).toMatchObject({ installed: 'partial', installedFiles: 1 })
		expect(readFileSync(join(directory, 'astap-d20', 'nqi-480-8-0000.nqi'), 'utf-8')).toBe('old')
	})

	test('a page instead of the file fails, as when its download quota is reached', async () => {
		const { band } = await archive()
		const { downloads, until } = setup(band, () => Promise.resolve(new Response('<html>Quota exceeded</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })))

		await downloads.download(band.id)
		const snapshot = await until((e) => e.bands[0].job?.state === 'failed')

		expect(snapshot.bands[0].job?.error).toContain('download quota')
		expect(snapshot.bands[0].installed).toBe('missing')
	})

	test('a cancelled download installs nothing and is forgotten', async () => {
		const { band } = await archive()
		// A body that never ends until the request is aborted.
		const fetch = (_: string, init: RequestInit) => Promise.resolve(new Response(new ReadableStream({ start: (controller) => init.signal?.addEventListener('abort', () => controller.error(init.signal?.reason)) }), { headers: { 'content-type': 'application/octet-stream' } }))
		const { directory, downloads, until } = setup(band, fetch)

		await downloads.download(band.id)
		await until((e) => e.bands[0].job?.state === 'downloading')
		await downloads.cancel(band.id)
		const snapshot = await until((e) => e.bands[0].job === undefined)

		expect(snapshot.bands[0].installed).toBe('missing')
		expect(existsSync(join(directory, '.staging', band.id))).toBeFalse()
	})

	test('a band not shared yet cannot be downloaded, and an unknown one is 404', async () => {
		const { band } = await archive()
		const { driveId: _, ...unpublished } = band
		const routes = createQuadIndexDownloadRoutes(setup(unpublished, drive(new Uint8Array(new ArrayBuffer(0)))).downloads)
		const post = routes['/api/settings/external-tools/nebulosa/indexes/:band/download'].POST as unknown as (req: Request & { params: { band: string } }) => Promise<Response>

		const refused = await post(Object.assign(new Request('http://localhost/'), { params: { band: band.id } }))
		expect(refused.status).toBe(409)
		expect(await refused.json()).toMatchObject({ code: 'notPublished' })
		expect((await post(Object.assign(new Request('http://localhost/'), { params: { band: 'unknown' } }))).status).toBe(404)
	})

	test('removes the installed files of a band, leaving the other files of its folder', async () => {
		const { band } = await archive()
		const { directory, downloads } = setup(band, drive(new Uint8Array(new ArrayBuffer(0))))
		mkdirSync(join(directory, 'astap-d20'), { recursive: true })
		writeFileSync(join(directory, 'astap-d20', 'nqi-480-8-0000.nqi'), 'tile')
		writeFileSync(join(directory, 'astap-d20', 'nqi-679-8-0000.nqi'), 'other band')

		const snapshot = await downloads.remove(band.id)

		expect(snapshot.bands[0]).toMatchObject({ installed: 'missing', installedFiles: 0 })
		expect(readdirSync(join(directory, 'astap-d20'))).toEqual(['nqi-679-8-0000.nqi'])
	})
})

describe('snapshot', () => {
	test('describes the fields a band suits from its quad sizes', async () => {
		const { band } = await archive()
		const item = (await setup(band, drive(new Uint8Array(new ArrayBuffer(0)))).downloads.snapshot()).bands[0]

		expect(item.bestShortSide[0]).toBeCloseTo(band.scaleUpper / (0.4 * Math.SQRT2), 12)
		expect(item.bestShortSide[1]).toBeCloseTo(band.scaleLower / 0.2, 12)
		expect(item.minDiagonal).toBe(band.scaleLower)
		expect(item.maxShortSide).toBeCloseTo(10 * band.scaleUpper, 12)
		expect(item).not.toHaveProperty('driveId')
		expect(item).not.toHaveProperty('sha256')
	})

	test('the default index folder is searched while the Index Folder is empty or holds it', async () => {
		const { band } = await archive()
		const searched = async (indexDirectory?: string) => {
			const { downloads, directory } = setup(band, drive(new Uint8Array(new ArrayBuffer(0))), indexDirectory)
			return { directory, searched: (await downloads.snapshot()).searched }
		}

		expect((await searched()).searched).toBeTrue()
		expect((await searched(' ')).searched).toBeTrue()
		expect((await searched(root)).searched).toBeTrue()
		expect((await searched(join(root, 'elsewhere'))).searched).toBeFalse()
	})
})

describe('tar', () => {
	// Yields bytes in chunks of size, as a decompressor does.
	async function* chunks(bytes: Uint8Array, size: number) {
		for (let i = 0; i < bytes.length; i += size) yield await Promise.resolve(bytes.subarray(i, i + size))
	}

	test('writes the files of an archive read in chunks of any size', async () => {
		const files = { 'a.nqi': 'x'.repeat(1000), 'b.nqi': '', 'c.nqi': 'y'.repeat(513) }
		const bytes = await new Bun.Archive(files).bytes()

		for (const size of [1, 7, 512, 100000]) {
			const folder = join(root, `tar-${folders++}`)
			mkdirSync(folder)
			expect((await extractTar(chunks(bytes, size), folder)).sort()).toEqual(['a.nqi', 'b.nqi', 'c.nqi'])
			for (const [name, text] of Object.entries(files)) expect(readFileSync(join(folder, name), 'utf-8')).toBe(text)
		}
	})

	test('refuses a file outside its folder and a truncated archive', async () => {
		const folder = join(root, `tar-${folders++}`)
		mkdirSync(folder)
		const nested = await new Bun.Archive({ 'sub/a.nqi': 'x' }).bytes()
		const whole = await new Bun.Archive({ 'a.nqi': 'x'.repeat(2000) }).bytes()

		await expect(extractTar(chunks(nested, 512), folder)).rejects.toThrow('outside its folder')
		await expect(extractTar(chunks(whole.subarray(0, 1024), 512), folder)).rejects.toThrow('ends before')
	})
})
