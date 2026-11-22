import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { findStarDatabases, type StarDatabaseKind, SUPPORTED_STAR_DATABASES } from 'api/platesolving.native'
import { DEFAULT_QUAD_STARS_PER_CELL, healpixCellSize, quadCellNside } from 'nebulosa/src/astrometry/solvers/quad.builder'
import type { SkyCone } from 'nebulosa/src/astrometry/solvers/quad.index'
import { catalogQuadIndexStars } from 'nebulosa/src/astrometry/solvers/quad.index.ephemeral'
import { buildQuadIndexTile, decodeQuadIndexHeader, encodeQuadIndexTile, QUAD_INDEX_EXTENSION, type QuadIndexStars, quadIndexTileCone, quadIndexTileFileName, verifyQuadIndexTile } from 'nebulosa/src/astrometry/solvers/quad.index.file'
import { eraC2s, eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { circleToPixels, coordToPixel } from 'nebulosa/src/astronomy/sky/spatial/healpix'
import type { StarCatalog } from 'nebulosa/src/catalogs/stars/catalog'
import { ASEC2RAD, DEG2RAD, MILLIASEC2RAD } from 'nebulosa/src/core/constants'

// Generates the quad index files of the built-in plate solver (not committed): one set of HEALPix tiles per band of
// quad sizes, from 8' up in steps of sqrt(2) by default, and manifest.json describing them, in bin/data/quads/<source>.
// The stars come from Gaia DR3 by default, or from a local ASTAP (.1476) or HNSKY (.290) star database with --catalog,
// read through the toolkit's catalog readers, which needs no download (those databases have no proper motions, so the
// positions stay at their epoch; --magnitude then limits the stars read, and the catalog is reopened for every tile so
// that its cache of tile buffers never holds the whole database). The Gaia stars come from the ESA Gaia archive (gaiadr3.gaia_source, positions at J2016.0 with proper
// motions), queried by chunks of source_id, which encodes the HEALPix level-12 cell of each source, and cached in
// bin/data/gaia so that an interrupted run resumes and every band reuses the same download. Each tile is built from the
// stars of its cone only, keeping per uniformization cell no more stars than the builder can use, so memory stays
// bounded even for the whole-sky files of the widest bands. Tile files are written through temporary files and checked;
// existing ones at the same magnitude limit are kept unless --force, which also downloads the chunks again. A region
// run writes the whole-sky files of the widest bands under a -region name, so a later full run builds the real ones. The
// manifest lists every file of the output directory at the magnitude limit. With --empty, an empty manifest is
// written without downloading anything. A full run downloads the whole Gaia catalog to the magnitude limit (hours, and
// gigabytes of cache) and needs a few gigabytes of memory for the smallest band; --region restricts it to a cone.
// Usage: bun make:quads [--force] [--empty] [--bands 480,679] [--magnitude 17] [--region ra,dec,radius] [--concurrency 4]
//        bun make:quads --catalog astap|hnsky --path <directory> [--database d20] [--magnitude 15] [--force] [--bands ...] [--region ...]
// (band minima in arcseconds; region in degrees; --output replaces the output directory)

// Root of the generated files, one directory per star source; not yet read by the application.
const QUADS = join(import.meta.dir, '../data/quads')

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

// File name suffix of the whole-sky file of a region-restricted run, before the extension.
const PARTIAL_SUFFIX = '-region'

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
	// Whether the band is the whole-sky file of a region-restricted run, holding that region only.
	readonly partial: boolean
	readonly files: string[]
}

// Description of the generated files, read by the solver set-up.
interface Manifest {
	readonly schema: 1
	readonly catalog: string
	readonly epoch: number
	// Faintest magnitude of the source, when known.
	readonly magnitudeLimit?: number
	readonly bands: ManifestBand[]
}

// Where the stars of the tiles come from.
interface StarSource {
	// Catalog name written into the tiles, ASCII, at most 32 characters.
	readonly catalog: string
	// Faintest magnitude of the source, NaN when unknown.
	readonly magnitudeLimit: number
	// Epoch of the positions when the stars do not state one, Julian year.
	readonly epoch: number
	// Output directory.
	readonly output: string
	// The stars of a cone, brightest first, at most perCell per cell of nside (twice that, for the builder's dedup).
	readonly coneStars: (cone: SkyCone, nside: number, perCell: number) => Promise<QuadIndexStars & { readonly epoch?: number }>
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
const magnitudeOption = option('--magnitude')
const magnitudeLimit = Number(magnitudeOption ?? DEFAULT_MAGNITUDE)
const bands = (option('--bands')?.split(',').map(Number) ?? DEFAULT_BANDS).map((arcsec) => arcsec * ASEC2RAD)
const concurrency = Math.max(1, Number(option('--concurrency') ?? 4))
const regionOption = option('--region')?.split(',').map(Number)
const region = regionOption === undefined ? undefined : { center: eraS2c(regionOption[0] * DEG2RAD, regionOption[1] * DEG2RAD), radius: regionOption[2] * DEG2RAD }
const catalogKind = option('--catalog')
const usage = 'Usage: bun make:quads [--catalog astap|hnsky --path <directory> [--database d20]] [--force] [--empty] [--bands 480,679] [--magnitude 17] [--region ra,dec,radius] [--concurrency 4] [--output <directory>]'

if (!(magnitudeLimit > 0) || bands.some((band) => !(band > 0)) || (region !== undefined && !(region.radius > 0)) || (catalogKind !== undefined && catalogKind !== 'astap' && catalogKind !== 'hnsky') || (catalogKind !== undefined && (option('--path') === undefined || option('--concurrency') !== undefined))) {
	console.error(usage)
	exit(1)
}

// Finds a local ASTAP or HNSKY star database: one supported database of a directory, the requested one or else the only
// one of that kind, whose open makes a fresh reader over its files (a reader caches every tile it reads until closed).
async function localCatalog(kind: StarDatabaseKind, directory: string, requested?: string) {
	const supported: readonly string[] = SUPPORTED_STAR_DATABASES[kind]
	const databases = (await findStarDatabases(directory)).filter((database) => database.kind === kind)
	const found = requested === undefined ? (databases.length === 1 ? databases[0] : undefined) : databases.find(({ database }) => database === requested.toLowerCase())
	if (found === undefined) throw new Error(`choose a database of ${directory} with --database: ${databases.map(({ database }) => database).join(', ') || 'none found'} (supported: ${supported.join(', ')})`)
	return found
}

let source: StarSource

if (catalogKind === undefined) {
	source = { catalog: 'Gaia DR3', magnitudeLimit, epoch: GAIA_EPOCH, output: option('--output') ?? join(QUADS, 'gaia-dr3'), coneStars: gaiaConeStars }
} else {
	const { open, database } = await localCatalog(catalogKind, option('--path')!, option('--database'))
	const name = `${catalogKind.toUpperCase()} ${database.toUpperCase()}`
	const magnitudeMax = magnitudeOption === undefined ? undefined : magnitudeLimit
	source = {
		catalog: name,
		magnitudeLimit: magnitudeMax ?? Number.NaN,
		epoch: 2000,
		output: option('--output') ?? join(QUADS, `${catalogKind}-${database}`),
		// A fresh reader per tile, closed afterwards, keeps the tile-buffer cache to the tiles of one cone.
		coneStars: async (cone, nside, perCell) => {
			const catalog: StarCatalog & Disposable = open()

			try {
				return await catalogQuadIndexStars(catalog, cone, { nside, perCell: 2 * perCell, magnitudeMax })
			} finally {
				catalog[Symbol.dispose]()
			}
		},
	}
}

const OUTPUT = source.output
const manifestPath = join(OUTPUT, 'manifest.json')
await fs.mkdir(OUTPUT, { recursive: true })

if (empty) {
	if (!force && (await Bun.file(manifestPath).exists())) {
		console.info('The quad index manifest already exists! Use --force to replace it.')
		exit(0)
	}

	const manifest: Manifest = { schema: 1, catalog: source.catalog, epoch: source.epoch, magnitudeLimit: Number.isNaN(source.magnitudeLimit) ? undefined : source.magnitudeLimit, bands: [] }
	await writeAtomically(manifestPath, JSON.stringify(manifest, null, '\t'))
	console.info(`written an empty quad index manifest to ${manifestPath}`)
	exit(0)
}

if (catalogKind === undefined) await fs.mkdir(CACHE, { recursive: true })

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

// A star selected for a cone, copied out of its chunk so that the chunk can be released.
interface SelectedStar {
	readonly magnitude: number
	readonly ra: number
	readonly dec: number
	readonly pmRA: number
	readonly pmDEC: number
	readonly source: bigint
}

// Orders selected stars brightest first, then by source id.
function SelectedStarComparator(a: SelectedStar, b: SelectedStar) {
	return a.magnitude - b.magnitude || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
}

// The Gaia stars of a cone, brightest first, keeping per cell of the band at most what the builder keeps (twice, for its
// dedup). Only the selected stars are kept, never their chunks, so a whole-sky cone holds no more than the band can use.
async function gaiaConeStars(cone: SkyCone, nside: number, perCell: number) {
	const [ra, dec] = eraC2s(cone.center[0], cone.center[1], cone.center[2])
	const chunks = circleToPixels(CHUNK_NSIDE, ra, dec, cone.radius)
	await downloadChunks(chunks.filter((chunk) => !downloaded.has(chunk)))
	for (const chunk of chunks) downloaded.add(chunk)

	const cosRadius = Math.cos(cone.radius)
	const byCell = new Map<number, SelectedStar[]>()

	for (const chunk of chunks) {
		const stars = await chunkStars(chunk)

		for (let i = 0; i < stars.count; i++) {
			const alpha = stars.positions[i * 2]
			const delta = stars.positions[i * 2 + 1]
			const cosDelta = Math.cos(delta)
			const dot = cosDelta * Math.cos(alpha) * cone.center[0] + cosDelta * Math.sin(alpha) * cone.center[1] + Math.sin(delta) * cone.center[2]
			if (dot < cosRadius) continue

			const cell = coordToPixel(nside, alpha, delta)
			let list = byCell.get(cell)
			if (list === undefined) byCell.set(cell, (list = []))

			list.push({ magnitude: stars.magnitudes[i], ra: alpha, dec: delta, pmRA: stars.properMotions[i * 2], pmDEC: stars.properMotions[i * 2 + 1], source: stars.sources[i] })
			if (list.length > 4 * perCell) {
				list.sort(SelectedStarComparator)
				list.length = 2 * perCell
			}
		}
	}

	const selected = [...byCell.values()].flatMap((list) => list.sort(SelectedStarComparator).slice(0, 2 * perCell))
	selected.sort(SelectedStarComparator)

	const n = selected.length
	const vectors = new Float64Array(n * 3)
	const magnitudes = new Float64Array(n)
	const properMotions = new Float64Array(n * 2)
	const sources = new BigUint64Array(n)

	for (let k = 0; k < n; k++) {
		const star = selected[k]
		vectors.set(eraS2c(star.ra, star.dec), k * 3)
		magnitudes[k] = star.magnitude
		properMotions[k * 2] = star.pmRA
		properMotions[k * 2 + 1] = star.pmDEC
		sources[k] = star.source
	}

	return { vectors, magnitudes, properMotions, sources, epoch: GAIA_EPOCH }
}

// Whether a tile header belongs to the source of this run: its catalog and, when known, its magnitude limit.
function fromSource(header: { readonly catalog: string; readonly magnitudeLimit: number }) {
	return header.catalog === source.catalog && (Number.isNaN(source.magnitudeLimit) || header.magnitudeLimit === source.magnitudeLimit)
}

// Whether a tile file exists and was built from the source of this run.
async function tileInPlace(path: string) {
	try {
		return fromSource(decodeQuadIndexHeader(await Bun.file(path).slice(0, 512).bytes()))
	} catch {
		return false
	}
}

for (const scaleLower of bands) {
	const scaleUpper = scaleLower * Math.SQRT2
	const nside = quadCellNside(scaleLower)
	const tileNside = nside >= 2 * TILE_CELLS_PER_SIDE ? nside / TILE_CELLS_PER_SIDE : 0
	const perCell = Math.min(255, Math.round(DEFAULT_QUAD_STARS_PER_CELL * (healpixCellSize(nside) / scaleLower) ** 2))
	const allTiles = tileNside === 0 ? [0] : Array.from({ length: 12 * tileNside * tileNside }, (_, i) => i)
	const tiles = region === undefined || tileNside === 0 ? allTiles : circleToPixels(tileNside, ...eraC2s(...region.center), region.radius)
	// The whole-sky file of a region-restricted run holds the region only: it gets its own name, which a full run never takes for its own.
	const partial = tileNside === 0 && region !== undefined
	const started = performance.now()
	let written = 0

	for (const [k, tileId] of tiles.entries()) {
		const name = quadIndexTileFileName({ scaleLower, tileNside, tileId }).replace(QUAD_INDEX_EXTENSION, partial ? `${PARTIAL_SUFFIX}${QUAD_INDEX_EXTENSION}` : QUAD_INDEX_EXTENSION)
		const path = join(OUTPUT, name)
		if (!force && (await tileInPlace(path))) continue

		const cone = partial ? { center: region.center, radius: Math.min(Math.PI, region.radius + scaleUpper) } : quadIndexTileCone(tileNside, tileId, scaleUpper)
		const stars = await source.coneStars(cone, nside, perCell)
		const tile = buildQuadIndexTile(stars, { scaleLower, scaleUpper }, tileNside, tileId, { jitter: JITTER, epoch: stars.epoch ?? source.epoch, magnitudeLimit: source.magnitudeLimit, catalog: source.catalog })
		if (tile === undefined) continue

		const bytes = encodeQuadIndexTile(tile)
		if (!verifyQuadIndexTile(bytes)) throw new Error(`the tile ${name} failed its own check`)
		await writeAtomically(path, bytes)
		written++
		console.info(`${name}: ${tile.quadStars.length / 4} quads, ${tile.ownStarCount} stars (${k + 1}/${tiles.length})`)
	}

	console.info(`band ${Math.round(scaleLower / ASEC2RAD)}": ${written} files written in ${Math.round((performance.now() - started) / 1000)} s`)
}

// The manifest lists every file in the output directory at this magnitude limit, so a restricted run never hides the
// files of earlier runs. Bands are keyed by their limits and tiling; a region's whole-sky file is a band of its own,
// marked partial.
const manifestBands = new Map<string, ManifestBand>()
let epoch: number | undefined

for (const name of (await fs.readdir(OUTPUT)).filter((file) => file.endsWith(QUAD_INDEX_EXTENSION)).sort()) {
	const header = decodeQuadIndexHeader(await Bun.file(join(OUTPUT, name)).slice(0, 512).bytes())
	if (!fromSource(header)) continue
	epoch ??= header.epoch
	const partial = name.endsWith(`${PARTIAL_SUFFIX}${QUAD_INDEX_EXTENSION}`)
	const key = `${header.scaleLower}:${header.tileNside}:${partial}`
	const band = manifestBands.get(key)
	if (band === undefined) manifestBands.set(key, { scaleLower: header.scaleLower, scaleUpper: header.scaleUpper, nside: header.nside, tileNside: header.tileNside, partial, files: [name] })
	else band.files.push(name)
}

const manifest: Manifest = { schema: 1, catalog: source.catalog, epoch: epoch ?? source.epoch, magnitudeLimit: Number.isNaN(source.magnitudeLimit) ? undefined : source.magnitudeLimit, bands: [...manifestBands.values()].sort((a, b) => a.scaleLower - b.scaleLower || Number(a.partial) - Number(b.partial)) }
await writeAtomically(manifestPath, JSON.stringify(manifest, null, '\t'))
console.info(`written the quad index manifest to ${manifestPath}`)
