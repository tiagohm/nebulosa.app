import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type TanWcs, tanSkyToPixel } from 'nebulosa/src/astrometry/solvers/native.fit'
import { buildQuadBand } from 'nebulosa/src/astrometry/solvers/quad.builder'
import { encodeQuadIndexTile, quadIndexTileFileName, quadIndexTilesFromBand } from 'nebulosa/src/astrometry/solvers/quad.index.file'
import { eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { ASEC2RAD, DEG2RAD, PIOVERTWO, TAU } from 'nebulosa/src/core/constants'
import type { MutVec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { gaussian, mulberry32 } from 'nebulosa/src/math/numerical/random'
import { AppDatabase } from './database'
import { ExternalToolsStore } from './externaltools'
import { ImageStore } from './images'
import { type PlateSolveRequest, type PlateSolvingEvent, PlateSolvingService } from './platesolving'
import { findQuadIndexFiles, findStarDatabases, largestStarDatabase, NativePlateSolver, NativeSolveError } from './platesolving.native'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-native-solve-test-'))

const WINDOWS = process.platform === 'win32'

afterAll(() => rmSync(root, { recursive: true, force: true }))

let folders = 0

// Creates an empty folder.
function folder() {
	const path = join(root, `folder-${folders++}`)
	mkdirSync(path)
	return path
}

const WIDTH = 800
const HEIGHT = 600
const SCALE = 4 * ASEC2RAD
const RA = 1.2
const DEC = 0.4

// Stars uniformly spread in a cap, brightest first, with magnitudes from a power law (brighter stars rarer).
function syntheticSky(seed: number, radius: number, density: number) {
	const random = mulberry32(seed)
	const count = Math.round((density * TAU * (1 - Math.cos(radius))) / (DEG2RAD * DEG2RAD))
	const theta = PIOVERTWO - DEC
	const stars: { v: MutVec3; magnitude: number }[] = []

	for (let i = 0; i < count; i++) {
		const z = 1 - random() * (1 - Math.cos(radius))
		const phi = random() * TAU
		const r = Math.sqrt(1 - z * z)
		const lx = r * Math.cos(phi)
		const ly = r * Math.sin(phi)
		const x1 = lx * Math.cos(theta) + z * Math.sin(theta)
		const z1 = -lx * Math.sin(theta) + z * Math.cos(theta)
		stars.push({ v: [x1 * Math.cos(RA) - ly * Math.sin(RA), x1 * Math.sin(RA) + ly * Math.cos(RA), z1], magnitude: 14 + Math.log10(Math.max(1e-9, random())) / 0.35 })
	}

	stars.sort((a, b) => a.magnitude - b.magnitude)
	const vectors = new Float64Array(stars.length * 3)
	const magnitudes = new Float64Array(stars.length)

	for (const [i, star] of stars.entries()) {
		vectors.set(star.v, i * 3)
		magnitudes[i] = star.magnitude
	}

	return { vectors, magnitudes }
}

const SKY = syntheticSky(11, 2 * DEG2RAD, 400)

// TAN WCS of the image: north up rotated by 0.7 rad, centered near the sky center.
const TRUTH: TanWcs = (() => {
	const cos = Math.cos(0.7) * SCALE
	const sin = Math.sin(0.7) * SCALE
	return { crval: eraS2c(RA + 0.003, DEC - 0.002), crpix1: (WIDTH + 1) / 2, crpix2: (HEIGHT + 1) / 2, cd11: cos, cd12: -sin, cd21: sin, cd22: cos }
})()

// Renders the stars of the sky down to magnitude 13 through the WCS as Gaussian profiles over a noisy background, as a
// 16-bit FITS file, and returns its bytes.
function renderedImage() {
	const random = mulberry32(5)
	const noise = gaussian(random, 8)
	const samples = new Float64Array(WIDTH * HEIGHT).fill(1000)
	const pixel: [number, number] = [0, 0]
	const v: MutVec3 = [0, 0, 0]
	const sigma = 1.6

	for (let i = 0; i < SKY.magnitudes.length && SKY.magnitudes[i] <= 13; i++) {
		v[0] = SKY.vectors[i * 3]
		v[1] = SKY.vectors[i * 3 + 1]
		v[2] = SKY.vectors[i * 3 + 2]
		if (!tanSkyToPixel(TRUTH, v, pixel)) continue
		const cx = pixel[0] - 1
		const cy = pixel[1] - 1
		if (cx < -5 || cy < -5 || cx > WIDTH + 4 || cy > HEIGHT + 4) continue
		const peak = Math.min(50000, 40000 * 10 ** (-0.4 * (SKY.magnitudes[i] - 9)))

		for (let y = Math.max(0, Math.floor(cy - 8)); y <= Math.min(HEIGHT - 1, Math.ceil(cy + 8)); y++) {
			for (let x = Math.max(0, Math.floor(cx - 8)); x <= Math.min(WIDTH - 1, Math.ceil(cx + 8)); x++) {
				samples[y * WIDTH + x] += peak * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * sigma * sigma))
			}
		}
	}

	const cards = ['SIMPLE  =                    T', 'BITPIX  =                   16', 'NAXIS   =                    2', `NAXIS1  = ${String(WIDTH).padStart(20)}`, `NAXIS2  = ${String(HEIGHT).padStart(20)}`, 'BZERO   =                32768', 'BSCALE  =                    1', 'END']
		.map((card) => card.padEnd(80))
		.join('')
	const header = Buffer.from(cards.padEnd(2880), 'latin1')
	const data = Buffer.alloc(Math.ceil((WIDTH * HEIGHT * 2) / 2880) * 2880)
	for (let i = 0; i < samples.length; i++) data.writeInt16BE(Math.max(0, Math.min(65535, Math.round(samples[i] + noise()))) - 32768, i * 2)
	return new Uint8Array(Buffer.concat([header, data]))
}

const IMAGE = renderedImage()

// Writes the quad index of one band of the sky, sized for the field of the image, into a folder as .nqi tiles.
// With stars, only the brightest that many stars are used, and a whole-sky file (tileNside 0) is written under the name
// suffix given, as the -region file of a regional run.
function writeIndex(directory: string, fraction: number, tileNside: number = 16, stars?: number, suffix: string = '') {
	const shortSide = HEIGHT * SCALE
	const vectors = stars === undefined ? SKY.vectors : SKY.vectors.subarray(0, stars * 3)
	const band = buildQuadBand(vectors, { scaleLower: fraction * shortSide, scaleUpper: fraction * shortSide * Math.SQRT2 })

	for (const tile of quadIndexTilesFromBand(band, { tileNside, jitter: ASEC2RAD, epoch: 2000, magnitudes: SKY.magnitudes, catalog: 'synthetic' })) {
		writeFileSync(join(directory, quadIndexTileFileName(tile).replace('.nqi', `${suffix}.nqi`)), encodeQuadIndexTile(tile))
	}
}

// A folder of index files of two bands that serve the image.
const INDEXES = folder()
writeIndex(INDEXES, 0.2)
writeIndex(INDEXES, 0.28)

// Creates a service whose built-in solver reads the folders.
async function setup(indexDirectory: string, catalogDirectory = '', defaultIndexDirectory?: string) {
	const images = new ImageStore()
	const tools = new ExternalToolsStore(AppDatabase.memory(), undefined, undefined, defaultIndexDirectory)
	await tools.save('nebulosa', { executable: '', timeout: 60000, indexDirectory, catalogDirectory }, 0)
	const events: PlateSolvingEvent[] = []
	const service = new PlateSolvingService(images, tools, (event) => events.push(event))
	const path = join(root, `image-${folders++}.fits`)
	writeFileSync(path, IMAGE)
	const info = await images.open(path)
	return { images, service, events, info }
}

// Angular distance between the center of a solution and the true center, arcseconds.
function centerError(rightAscension: number, declination: number) {
	const [x, y, z] = TRUTH.crval
	const truth = eraS2c(Math.atan2(y, x), Math.atan2(z, Math.hypot(x, y)))
	const solved = eraS2c(rightAscension, declination)
	return Math.acos(Math.min(1, truth[0] * solved[0] + truth[1] * solved[1] + truth[2] * solved[2])) / ASEC2RAD
}

const BLIND: PlateSolveRequest = { provider: 'nebulosa', strategy: 'blind' }

describe('files', () => {
	test('finds the .nqi tiles and Astrometry.net index files of the subfolders', async () => {
		const directory = folder()
		mkdirSync(join(directory, 'sub'))
		for (const name of ['a.nqi', 'sub/B.NQI', 'sub/index-4110.fits', 'index-5203-07.fit', 'other.fits', 'index-notes.txt']) writeFileSync(join(directory, name), '')
		const files = await findQuadIndexFiles(directory)

		expect(files.nebulosa).toEqual([join(directory, 'a.nqi'), join(directory, 'sub', 'B.NQI')])
		expect(files.astrometryNet).toEqual([join(directory, 'index-5203-07.fit'), join(directory, 'sub', 'index-4110.fits')])
		expect(files.unreadable).toEqual([])
	})

	test('follows linked folders once, even through a cycle', async () => {
		const directory = folder()
		const outside = folder()
		writeFileSync(join(outside, 'index-4116.fits'), '')
		// Junctions need no privilege on Windows; elsewhere they are plain directory links.
		symlinkSync(outside, join(directory, 'linked'), 'junction')
		symlinkSync(directory, join(directory, 'cycle'), 'junction')
		const files = await findQuadIndexFiles(directory)

		expect(files.astrometryNet).toEqual([join(directory, 'linked', 'index-4116.fits')])
	})

	test('follows linked files', async () => {
		const directory = folder()
		const target = join(folder(), 'tile.nqi')
		writeFileSync(target, '')

		try {
			symlinkSync(target, join(directory, 'tile.nqi'), 'file')
		} catch {
			// Windows refuses file links without developer mode; the folder test covers the walk there.
			return
		}

		expect((await findQuadIndexFiles(directory)).nebulosa).toEqual([join(directory, 'tile.nqi')])
	})

	test.skipIf(WINDOWS || process.getuid?.() === 0)('an unreadable subfolder is left out instead of failing the search', async () => {
		const directory = folder()
		mkdirSync(join(directory, 'locked'))
		writeFileSync(join(directory, 'a.nqi'), '')
		chmodSync(join(directory, 'locked'), 0)

		try {
			const files = await findQuadIndexFiles(directory)
			expect(files.nebulosa).toEqual([join(directory, 'a.nqi')])
			expect(files.unreadable).toEqual([join(directory, 'locked')])
		} finally {
			chmodSync(join(directory, 'locked'), 0o755)
		}
	})

	test('finds the supported star databases, shallowest first, ASTAP first', async () => {
		const directory = folder()
		for (const name of ['D80_0101.1476', 'd20_0101.1476', 'g14_0101.290', 'v50_0101.1476', 'readme.txt']) writeFileSync(join(directory, name), '')

		expect((await findStarDatabases(directory)).map(({ kind, database }) => `${kind}:${database}`)).toEqual(['astap:d20', 'astap:d80', 'hnsky:g14'])
	})

	test('the largest star database is chosen, whatever its kind', async () => {
		const directory = folder()
		writeFileSync(join(directory, 'd80_0101.1476'), Buffer.alloc(300))
		writeFileSync(join(directory, 'd80_0102.1476'), Buffer.alloc(300))
		writeFileSync(join(directory, 'g14_0101.290'), Buffer.alloc(100))
		const databases = await findStarDatabases(directory)

		expect(databases.map(({ database, bytes }) => `${database}:${bytes}`)).toEqual(['d80:600', 'g14:100'])
		expect(largestStarDatabase(databases)?.database).toBe('d80')
		expect(
			largestStarDatabase([
				{ bytes: 10, database: 'd20' },
				{ bytes: 50, database: 'g16' },
			])?.database,
		).toBe('g16')
		expect(largestStarDatabase([])).toBeUndefined()
	})
})

describe('solve', () => {
	test('solves an image blind over the index files of its folder', async () => {
		const { service, info } = await setup(INDEXES)
		const result = await service.solve(info.id, BLIND)

		expect(result.outcome).toBe('solved')
		expect(result.tool).toEqual({ executable: '', timeout: 60000, indexDirectory: INDEXES, catalogDirectory: '' })
		expect(result.solution!.parity).toBe('NORMAL')
		expect(result.scale! / SCALE).toBeCloseTo(1, 3)
		expect(centerError(result.rightAscension!, result.declination!)).toBeLessThan(2)
		service[Symbol.dispose]()
	})

	test('solves the private pixels of an image within the scale tolerance', async () => {
		const { service, info } = await setup(INDEXES)
		const pixels = { bytes: IMAGE.slice(), fingerprint: 'test:copy' }
		const result = await service.solve(info.id, { ...BLIND, hints: { scale: SCALE * 1.1 }, scaleTolerance: 0.15 }, undefined, undefined, pixels)

		expect(result.outcome).toBe('solved')
		expect(result.warnings).not.toContain('Nebulosa applies its own scale tolerance.')
		expect(centerError(result.rightAscension!, result.declination!)).toBeLessThan(2)
		// The pixels were copied to the worker, never taken from the caller.
		expect(pixels.bytes.byteLength).toBe(IMAGE.byteLength)
		service[Symbol.dispose]()
	})

	test('a scale the bands cannot serve ends without a solution and says why', async () => {
		const { service, info } = await setup(INDEXES)
		const result = await service.solve(info.id, { ...BLIND, hints: { scale: SCALE * 20 } })

		expect(result.outcome).toBe('noSolution')
		expect(result.warnings).toContain('The index folder holds no index file that serves this field and scale.')
		service[Symbol.dispose]()
	})

	test('an empty Index Folder searches the default index folder, which may not exist yet', async () => {
		const missing = join(root, `default-${folders++}`)
		const { service, info } = await setup('', '', missing)
		const result = await service.solve(info.id, BLIND)

		expect(result.outcome).toBe('noSolution')
		expect(result.warnings).toContain(`The index folder ${missing} does not exist: download index bands in the settings of the Nebulosa solver, or set another folder.`)

		mkdirSync(missing)
		writeIndex(missing, 0.28)
		const { service: other, info: image } = await setup('', '', missing)
		expect((await other.solve(image.id, BLIND)).outcome).toBe('solved')
		service[Symbol.dispose]()
		other[Symbol.dispose]()
	})

	test('a damaged index file is skipped with a warning', async () => {
		const directory = folder()
		writeIndex(directory, 0.28)
		writeFileSync(join(directory, 'broken.nqi'), 'not an index')
		const { service, info } = await setup(directory)
		const result = await service.solve(info.id, BLIND)

		expect(result.outcome).toBe('solved')
		expect(result.warnings.some((warning) => warning.includes('broken.nqi was skipped'))).toBeTrue()
		service[Symbol.dispose]()
	})

	test('of two files of one tile, the one holding more quads is searched', async () => {
		const directory = folder()
		// The whole-sky file of a regional run sorts before the complete one, and holds a fraction of its stars.
		writeIndex(directory, 0.28, 0, 40, '-region')
		writeIndex(directory, 0.28, 0)
		const { service, info } = await setup(directory)
		const result = await service.solve(info.id, BLIND)

		expect(result.outcome).toBe('solved')
		expect(result.warnings.some((warning) => /-region\.nqi was skipped: .*\d\.nqi holds more of the same tile/.test(warning))).toBeTrue()
		service[Symbol.dispose]()
	})

	test('the star database is searched only around a known position and scale', async () => {
		const catalog = folder()
		const { service, info } = await setup('', catalog)
		const result = await service.solve(info.id, BLIND)

		expect(result.outcome).toBe('noSolution')
		expect(result.warnings).toContain('The star database is searched only around a known position with a known scale.')
		service[Symbol.dispose]()
	})
})

describe('worker', () => {
	// Points the client at a worker script written for the test.
	function fakeWorker(source: string) {
		const path = join(root, `worker-${folders++}.ts`)
		writeFileSync(path, source)
		return path
	}

	// Runs a solve of nothing on a client of the fake worker, restoring the path of the real one afterwards.
	async function solveOn(path: string, signal: AbortSignal) {
		const previous = process.env.NEBULOSA_PLATESOLVING_WORKER
		process.env.NEBULOSA_PLATESOLVING_WORKER = path
		const solver = new NativePlateSolver()

		try {
			return await solver.solve({ pixels: { kind: 'fits', bytes: new Uint8Array(0) }, indexDirectory: '', catalogDirectory: '', width: 1, height: 1, timeout: 60000 }, signal)
		} finally {
			solver[Symbol.dispose]()
			if (previous === undefined) delete process.env.NEBULOSA_PLATESOLVING_WORKER
			else process.env.NEBULOSA_PLATESOLVING_WORKER = previous
		}
	}

	test('a cancel asks the worker to stop the solve', async () => {
		const path = fakeWorker("declare const self: Worker\nself.addEventListener('message', ({ data }) => { if (data.type === 'cancel') self.postMessage({ jobId: data.jobId, status: 'failed', code: 'cancelled', error: 'stopped by the worker' }, []) })\n")
		const controller = new AbortController()
		const solving = solveOn(path, controller.signal)
		setTimeout(() => controller.abort(), 50)

		const error = await solving.catch((error: unknown) => error)
		expect(error).toBeInstanceOf(NativeSolveError)
		expect(error).toMatchObject({ code: 'cancelled', message: 'stopped by the worker' })
	})

	test('a worker that dies fails its solve', async () => {
		const path = fakeWorker("self.addEventListener('message', () => { throw new Error('boom') })\n")
		const error = await solveOn(path, new AbortController().signal).catch((error: unknown) => error)

		expect(error).toBeInstanceOf(NativeSolveError)
		expect(error).toMatchObject({ code: 'workerFailed' })
	})
})
