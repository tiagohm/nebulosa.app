import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { DEFAULT_QUAD_STARS_PER_CELL, healpixCellSize, quadCellNside } from 'nebulosa/src/astrometry/solvers/quad.builder'
import { buildQuadIndexTile, encodeQuadIndexTile, quadIndexTileCone, quadIndexTileFileName, verifyQuadIndexTile } from 'nebulosa/src/astrometry/solvers/quad.index.file'
import { eraC2s, eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { circleToPixels, coordToPixel } from 'nebulosa/src/astronomy/sky/spatial/healpix'
import { ASEC2RAD, DEG2RAD, MILLIASEC2RAD } from 'nebulosa/src/core/constants'

// Generates the quad index files of the built-in plate solver, bin/data/quads/*.nqi (not committed), from Gaia DR3:
// one set of HEALPix tiles per band of quad sizes, from 8' up in steps of sqrt(2) by default, and manifest.json
// describing them. The stars come from the ESA Gaia archive (gaiadr3.gaia_source, positions at J2016.0 with proper
// motions), queried by chunks of source_id, which encodes the HEALPix level-12 cell of each source, and cached in
// bin/data/gaia so that an interrupted run resumes and every band reuses the same download. Each tile is built from the
// stars of its cone only, keeping per uniformization cell no more stars than the builder can use, so memory stays
// bounded even for the whole-sky files of the widest bands. Tile files are written through temporary files and checked;
// existing ones are kept unless --force, which also downloads the chunks again. With --empty, an empty manifest is
// written without downloading anything. A full run downloads the whole Gaia catalog to the magnitude limit (hours, and
// gigabytes of cache) and needs a few gigabytes of memory for the smallest band; --region restricts it to a cone.
// Usage: bun make:quads [--force] [--empty] [--bands 480,679] [--magnitude 17] [--region ra,dec,radius] [--concurrency 4]
// (band minima in arcseconds; region in degrees)

// Generated files, not yet read by the application.
const OUTPUT = join(import.meta.dir, '../data/quads')

// Downloaded Gaia chunks.
const CACHE = join(import.meta.dir, '../data/gaia')

// Synchronous TAP endpoint of the ESA Gaia archive.
const GAIA_TAP_URL = 'https://gea.esac.esa.int/tap-server/tap/sync'

// Gaia table queried.
const GAIA_TABLE = 'gaiadr3.gaia_source'

// Epoch of the Gaia DR3 positions, Julian year.
const GAIA_EPOCH = 2016

// HEALPix NSIDE of a download chunk (level 5, 12288 chunks of about 3.4 square degrees).
const CHUNK_NSIDE = 32

// Source ids per level-12 HEALPix cell: source_id = cell·2^35 + a running number.
const SOURCE_ID_PER_CELL = 2n ** 35n

// Level-12 cells per chunk: 4^(12 - 5).
const CELLS_PER_CHUNK = 4n ** 7n

// Default faintest G magnitude.
const DEFAULT_MAGNITUDE = 17

// Default band minima, arcseconds: 8' times sqrt(2)^k up to about 8.5°.
const DEFAULT_BANDS = Array.from({ length: 13 }, (_, k) => Math.round(480 * Math.SQRT2 ** k))

// Positional error of the stars, radians: Gaia is far better; this is the index jitter of Astrometry.net.
const JITTER = ASEC2RAD

// Uniformization cells per tile side: a tile is (TILE_CELLS_PER_SIDE)² cells; bands with fewer cells are one whole-sky file.
const TILE_CELLS_PER_SIDE = 32

// Most time one chunk query may take, milliseconds.
const QUERY_TIMEOUT_MS = 300_000

// Attempts of a chunk query before the run stops.
const QUERY_ATTEMPTS = 4

// Decoded chunks kept in memory.
const MAX_CACHED_CHUNKS = 1024

// Stars of one chunk: per star RA and Dec (radians, J2016), G magnitude, proper motion dα/dt and dδ/dt (radians per year), source id.
interface Chunk {
	readonly count: number
	readonly positions: Float64Array
	readonly magnitudes: Float32Array
	readonly properMotions: Float32Array
	readonly sources: BigUint64Array
}

// One band of the manifest.
interface ManifestBand {
	readonly scaleLower: number
	readonly scaleUpper: number
	readonly nside: number
	readonly tileNside: number
	readonly files: string[]
}

// Description of the generated files, read by the solver set-up.
interface Manifest {
	readonly schema: 1
	readonly catalog: string
	readonly epoch: number
	readonly magnitudeLimit: number
	readonly bands: ManifestBand[]
}

// Value of a command-line option, or undefined.
function option(name: string) {
	const index = process.argv.indexOf(name)
	return index >= 0 ? process.argv[index + 1] : undefined
}

// Writes a file through a temporary one, so a failed run never leaves a truncated file.
async function writeAtomically(path: string, data: Uint8Array | string) {
	await Bun.write(`${path}.tmp`, data)

	try {
		await fs.rename(`${path}.tmp`, path)
	} catch (error) {
		await fs.rm(`${path}.tmp`, { force: true })
		throw new Error(`Cannot replace ${path}`, { cause: error })
	}
}

const force = process.argv.includes('--force')
const empty = process.argv.includes('--empty')
const magnitudeLimit = Number(option('--magnitude') ?? DEFAULT_MAGNITUDE)
const bands = (option('--bands')?.split(',').map(Number) ?? DEFAULT_BANDS).map((arcsec) => arcsec * ASEC2RAD)
const concurrency = Math.max(1, Number(option('--concurrency') ?? 4))
const regionOption = option('--region')?.split(',').map(Number)
const region = regionOption === undefined ? undefined : { center: eraS2c(regionOption[0] * DEG2RAD, regionOption[1] * DEG2RAD), radius: regionOption[2] * DEG2RAD }
const manifestPath = join(OUTPUT, 'manifest.json')

if (!(magnitudeLimit > 0) || bands.some((band) => !(band > 0)) || (region !== undefined && !(region.radius > 0))) {
	console.error('Usage: bun make:quads [--force] [--empty] [--bands 480,679] [--magnitude 17] [--region ra,dec,radius] [--concurrency 4]')
	exit(1)
}

await fs.mkdir(OUTPUT, { recursive: true })

if (empty) {
	if (!force && (await Bun.file(manifestPath).exists())) {
		console.info('The quad index manifest already exists! Use --force to replace it.')
		exit(0)
	}

	const manifest: Manifest = { schema: 1, catalog: 'Gaia DR3', epoch: GAIA_EPOCH, magnitudeLimit, bands: [] }
	await writeAtomically(manifestPath, JSON.stringify(manifest, null, '\t'))
	console.info(`written an empty quad index manifest to ${manifestPath}`)
	exit(0)
}

await fs.mkdir(CACHE, { recursive: true })

// Cache file of a chunk at the magnitude limit.
function chunkPath(chunk: number) {
	return join(CACHE, `gaia-dr3-g${magnitudeLimit}-${chunk.toString().padStart(5, '0')}.bin`)
}

// Encodes a chunk: star count (u32, padded to 8 bytes), then positions, magnitudes, proper motions and source ids.
function encodeChunk(chunk: Chunk) {
	const n = chunk.count
	const bytes = new Uint8Array(8 + n * (16 + 4 + 8 + 8))
	new DataView(bytes.buffer).setUint32(0, n, true)
	let offset = 8
	for (const array of [chunk.positions, chunk.sources, chunk.magnitudes, chunk.properMotions]) {
		bytes.set(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), offset)
		offset += array.byteLength
	}
	return bytes
}

// Decodes a cached chunk.
function decodeChunk(bytes: Uint8Array): Chunk {
	const buffer = bytes.byteOffset % 8 === 0 ? bytes : bytes.slice()
	const n = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0, true)
	let offset = buffer.byteOffset + 8
	const positions = new Float64Array(buffer.buffer, offset, n * 2)
	offset += n * 16
	const sources = new BigUint64Array(buffer.buffer, offset, n)
	offset += n * 8
	const magnitudes = new Float32Array(buffer.buffer, offset, n)
	offset += n * 4
	const properMotions = new Float32Array(buffer.buffer, offset, n * 2)
	return { count: n, positions, magnitudes, properMotions, sources }
}

// Queries the stars of a chunk from the Gaia archive.
async function queryChunk(chunk: number): Promise<Chunk> {
	const lo = BigInt(chunk) * CELLS_PER_CHUNK * SOURCE_ID_PER_CELL
	const hi = lo + CELLS_PER_CHUNK * SOURCE_ID_PER_CELL - 1n
	const query = `SELECT source_id, ra, dec, phot_g_mean_mag, pmra, pmdec FROM ${GAIA_TABLE} WHERE source_id BETWEEN ${lo} AND ${hi} AND phot_g_mean_mag <= ${magnitudeLimit}`
	const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: query })
	const response = await fetch(GAIA_TAP_URL, { method: 'POST', body, signal: AbortSignal.timeout(QUERY_TIMEOUT_MS) })
	if (!response.ok) throw new Error(`the Gaia archive answered ${response.status} for chunk ${chunk}`)

	const lines = (await response.text()).trim().split('\n')
	if (lines[0]?.trim() !== 'source_id,ra,dec,phot_g_mean_mag,pmra,pmdec') throw new Error(`unexpected answer of the Gaia archive for chunk ${chunk}`)

	const n = lines.length - 1
	const positions = new Float64Array(n * 2)
	const magnitudes = new Float32Array(n)
	const properMotions = new Float32Array(n * 2)
	const sources = new BigUint64Array(n)

	for (let i = 0; i < n; i++) {
		const [source, ra, dec, g, pmra, pmdec] = lines[i + 1].split(',')
		const declination = Number(dec) * DEG2RAD
		positions[i * 2] = Number(ra) * DEG2RAD
		positions[i * 2 + 1] = declination
		magnitudes[i] = Number(g)
		sources[i] = BigInt(source)
		// pmra is μα·cos δ in mas/yr; a missing proper motion (two-parameter solutions) is zero.
		const cosDec = Math.cos(declination)
		properMotions[i * 2] = pmra !== '' && Math.abs(cosDec) > 1e-12 ? (Number(pmra) * MILLIASEC2RAD) / cosDec : 0
		properMotions[i * 2 + 1] = pmdec?.trim() !== '' ? Number(pmdec) * MILLIASEC2RAD : 0
	}

	return { count: n, positions, magnitudes, properMotions, sources }
}

// Downloads a chunk unless it is cached, retrying with a growing delay.
async function downloadChunk(chunk: number) {
	const path = chunkPath(chunk)
	if (!force && (await Bun.file(path).exists())) return

	for (let attempt = 1; ; attempt++) {
		try {
			await writeAtomically(path, encodeChunk(await queryChunk(chunk)))
			return
		} catch (error) {
			if (attempt >= QUERY_ATTEMPTS) throw error
			console.warn(`chunk ${chunk} failed (${String(error)}); retrying`)
			await Bun.sleep(5000 * attempt)
		}
	}
}

// Downloads chunks with bounded concurrency.
async function downloadChunks(chunks: readonly number[]) {
	let next = 0
	const worker = async () => {
		while (next < chunks.length) await downloadChunk(chunks[next++])
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker))
}

const decoded = new Map<number, Chunk>()
const downloaded = new Set<number>()

// A decoded chunk, from memory or the cache, releasing the least recently used beyond MAX_CACHED_CHUNKS.
async function chunkStars(chunk: number) {
	const cached = decoded.get(chunk)

	if (cached !== undefined) {
		decoded.delete(chunk)
		decoded.set(chunk, cached)
		return cached
	}

	const stars = decodeChunk(await Bun.file(chunkPath(chunk)).bytes())
	decoded.set(chunk, stars)
	if (decoded.size > MAX_CACHED_CHUNKS) decoded.delete(decoded.keys().next().value!)
	return stars
}

// The stars of a cone, brightest first, keeping per cell of the band at most what the builder keeps (twice, for its dedup).
async function coneStars(cone: { readonly center: readonly [number, number, number]; readonly radius: number }, nside: number, perCell: number) {
	const [ra, dec] = eraC2s(cone.center[0], cone.center[1], cone.center[2])
	const chunks = circleToPixels(CHUNK_NSIDE, ra, dec, cone.radius)
	await downloadChunks(chunks.filter((chunk) => !downloaded.has(chunk)))
	for (const chunk of chunks) downloaded.add(chunk)

	const cosRadius = Math.cos(cone.radius)
	const byCell = new Map<number, { magnitude: number; chunk: Chunk; index: number }[]>()

	for (const chunk of chunks) {
		const stars = await chunkStars(chunk)

		for (let i = 0; i < stars.count; i++) {
			const alpha = stars.positions[i * 2]
			const delta = stars.positions[i * 2 + 1]
			const cosDelta = Math.cos(delta)
			const dot = cosDelta * Math.cos(alpha) * cone.center[0] + cosDelta * Math.sin(alpha) * cone.center[1] + Math.sin(delta) * cone.center[2]
			if (dot < cosRadius) continue

			const cell = coordToPixel(nside, alpha, delta)
			const list = byCell.get(cell)
			const entry = { magnitude: stars.magnitudes[i], chunk: stars, index: i }

			if (list === undefined) {
				byCell.set(cell, [entry])
			} else {
				list.push(entry)
				if (list.length > 4 * perCell) {
					list.sort((a, b) => a.magnitude - b.magnitude)
					list.length = 2 * perCell
				}
			}
		}
	}

	const selected = [...byCell.values()].flatMap((list) => list.sort((a, b) => a.magnitude - b.magnitude).slice(0, 2 * perCell))
	selected.sort((a, b) => a.magnitude - b.magnitude || (a.chunk.sources[a.index] < b.chunk.sources[b.index] ? -1 : 1))

	const n = selected.length
	const vectors = new Float64Array(n * 3)
	const magnitudes = new Float64Array(n)
	const properMotions = new Float64Array(n * 2)
	const sources = new BigUint64Array(n)

	for (let k = 0; k < n; k++) {
		const { chunk, index } = selected[k]
		vectors.set(eraS2c(chunk.positions[index * 2], chunk.positions[index * 2 + 1]), k * 3)
		magnitudes[k] = chunk.magnitudes[index]
		properMotions[k * 2] = chunk.properMotions[index * 2]
		properMotions[k * 2 + 1] = chunk.properMotions[index * 2 + 1]
		sources[k] = chunk.sources[index]
	}

	return { vectors, magnitudes, properMotions, sources }
}

const manifest: Manifest = { schema: 1, catalog: 'Gaia DR3', epoch: GAIA_EPOCH, magnitudeLimit, bands: [] }

for (const scaleLower of bands) {
	const scaleUpper = scaleLower * Math.SQRT2
	const nside = quadCellNside(scaleLower)
	const tileNside = nside >= 2 * TILE_CELLS_PER_SIDE ? nside / TILE_CELLS_PER_SIDE : 0
	const perCell = Math.min(255, Math.round(DEFAULT_QUAD_STARS_PER_CELL * (healpixCellSize(nside) / scaleLower) ** 2))
	const allTiles = tileNside === 0 ? [0] : Array.from({ length: 12 * tileNside * tileNside }, (_, i) => i)
	const tiles = region === undefined || tileNside === 0 ? allTiles : circleToPixels(tileNside, ...eraC2s(...region.center), region.radius)
	const files: string[] = []
	const started = performance.now()

	for (const [k, tileId] of tiles.entries()) {
		const name = quadIndexTileFileName({ scaleLower, tileNside, tileId })
		const path = join(OUTPUT, name)

		if (!force && (await Bun.file(path).exists())) {
			files.push(name)
			continue
		}

		// The whole-sky file of a region-restricted run is built from the region only.
		const cone = tileNside === 0 && region !== undefined ? { center: region.center, radius: Math.min(Math.PI, region.radius + scaleUpper) } : quadIndexTileCone(tileNside, tileId, scaleUpper)
		const stars = await coneStars(cone, nside, perCell)
		const tile = buildQuadIndexTile(stars, { scaleLower, scaleUpper }, tileNside, tileId, { jitter: JITTER, epoch: GAIA_EPOCH, magnitudeLimit, catalog: 'Gaia DR3' })
		if (tile === undefined) continue

		const bytes = encodeQuadIndexTile(tile)
		if (!verifyQuadIndexTile(bytes)) throw new Error(`the tile ${name} failed its own check`)
		await writeAtomically(path, bytes)
		files.push(name)
		console.info(`${name}: ${tile.quadStars.length / 4} quads, ${tile.ownStarCount} stars (${k + 1}/${tiles.length})`)
	}

	manifest.bands.push({ scaleLower, scaleUpper, nside, tileNside, files })
	console.info(`band ${Math.round(scaleLower / ASEC2RAD)}": ${files.length} files in ${Math.round((performance.now() - started) / 1000)} s`)
}

await writeAtomically(manifestPath, JSON.stringify(manifest, null, '\t'))
console.info(`written the quad index manifest to ${manifestPath}`)
