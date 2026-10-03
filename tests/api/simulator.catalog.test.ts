import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { Hnsky290Database } from 'nebulosa/src/catalogs/stars/hnsky'
import { deg } from 'nebulosa/src/math/units/angle'
import { simulatorCatalogSources } from 'src/api/simulator.catalog'
import { hnskyCatalogSource } from 'src/api/simulator.catalog.hnsky'
import { vizierCatalogSource } from 'src/api/simulator.catalog.vizier'

let appDir: string

beforeEach(async () => {
	appDir = await mkdtemp(join(tmpdir(), 'nebulosa-catalog-'))
})

afterEach(async () => {
	await rm(appDir, { recursive: true, force: true })
})

async function writeCatalog(database: Hnsky290Database, magnitude: number) {
	// HNSKY's 110-byte header and seven-byte full record: packed 24-bit RA/Dec and 0.1 mag.
	// The star at (5°, 5°) lies inside tile 1001.290, away from tile boundaries.
	const tile = Buffer.alloc(117, 0x20)
	tile[109] = 7
	tile.writeUIntLE(Math.round((5 / 360) * 0xffffff), 110, 3)
	tile.writeIntLE(Math.round((5 / 90) * 0x7fffff), 113, 3)
	tile.writeInt8(Math.round(magnitude * 10), 116)
	const archive = new Bun.Archive({ [`${database}_1001.290`]: tile })
	await Bun.write(join(appDir, `HNSKY_${database}.tar`), await archive.blob())
}

test('composition omits missing local catalogs and retains the remote source', async () => {
	const sources = await simulatorCatalogSources(appDir)
	expect(sources.HNSKY_G14).toBeUndefined()
	expect(sources.HNSKY_G16).toBeUndefined()
	expect(sources.VIZIER).toBeFunction()
})

test('discovery does not read archives and each database uses its explicit file prefix', async () => {
	await Bun.write(join(appDir, 'HNSKY_g14.tar'), 'not loaded during discovery')
	await Bun.write(join(appDir, 'HNSKY_g16.tar'), 'not loaded during discovery')
	const sources = await simulatorCatalogSources(appDir)
	await writeCatalog('g14', 2)
	await writeCatalog('g16', 3)
	const [g14, g16] = await Promise.all([sources.HNSKY_G14!(deg(5), deg(5), deg(1)), sources.HNSKY_G16!(deg(5), deg(5), deg(1))])
	expect(g14).toHaveLength(1)
	expect(g16).toHaveLength(1)
	expect(g14[0].rightAscension).toBeCloseTo(deg(5), 6)
	expect(g14[0].declination).toBeCloseTo(deg(5), 6)
	expect(g14[0]).toMatchObject({ magnitude: 2, hfd: 2.5, snr: 130, flux: 0.55 })
	expect(g16[0]).toMatchObject({ magnitude: 3, hfd: 2.5, snr: 130, flux: 0.55 })
})

test('failed archive reads can be retried and successful loads are retained by that source only', async () => {
	const path = join(appDir, 'HNSKY_g14.tar')
	await Bun.write(path, 'invalid archive')
	const source = await hnskyCatalogSource(appDir, 'g14')
	if (!source) throw new Error('expected detected archive')
	const failed = await Promise.allSettled([source(deg(5), deg(5), deg(1)), source(deg(5), deg(5), deg(1))])
	expect(failed.map((result) => result.status)).toEqual(['rejected', 'rejected'])
	await writeCatalog('g14', 2)
	const [first, second] = await Promise.all([source(deg(5), deg(5), deg(1)), source(deg(5), deg(5), deg(1))])
	expect(first).toHaveLength(1)
	expect(second).toEqual(first)
	await rm(path)
	expect(await source(deg(5), deg(5), deg(1))).toEqual(first)
	await writeCatalog('g14', 4)
	const freshSource = await hnskyCatalogSource(appDir, 'g14')
	expect((await freshSource!(deg(5), deg(5), deg(1)))[0]).toMatchObject({ magnitude: 4 })
	expect(await source(deg(5), deg(5), deg(1))).toEqual(first)
})

test('VizieR preserves the synthetic brightness model and solar-color fallback', async () => {
	const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Source\tRAJ2000\tDEJ2000\tGmag\tpmRA\tpmDE\tRV\n1\t5\t5\t-1.46\t0\t0\t0\n2\t5.1\t5\t10\t0\t0\t0'))
	try {
		const stars = await vizierCatalogSource(deg(5), deg(5), deg(1))
		expect(stars).toHaveLength(2)
		expect(stars[0].rightAscension).toBeCloseTo(deg(5), 12)
		expect(stars[0].declination).toBeCloseTo(deg(5), 12)
		expect(stars[0].colorIndex).toBe(0.65)
		expect(stars[0].flux).toBeCloseTo(1.048, 12)
		expect(stars[0].hfd).toBeCloseTo(1.2, 12)
		expect(stars[0].snr).toBeCloseTo(192, 12)
		expect(stars[1].flux).toBeLessThan(stars[0].flux)
		expect(stars[1].hfd).toBeGreaterThan(stars[0].hfd)
	} finally {
		fetch.mockRestore()
	}
})
