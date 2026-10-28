import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { MOON_FEATURE_CATALOG_SCHEMA, type MoonFeatureCatalog } from 'api/sky/moon.features'
import { Jpeg } from 'nebulosa/src/bindings/imaging/libturbojpeg'
import { readDbf } from './moon/dbf'
import { normalizeLunarFeatures } from './moon/features'
import { readTiff } from './moon/tiff'
import { readZip } from './moon/zip'

// Generates the Moon assets bundled by the web client for the Moon Inspector and its Lunar Surface
// Explorer, into web/assets/moon (not committed): the NASA SVS CGI Moon Kit LROC color map at 2048×1024
// (the official JPEG, copied unchanged) and at 4096×2048 (the official 16-bit sRGB TIFF, reduced to 8 bits
// and encoded as JPEG), the catalog of the IAU-adopted lunar surface features from the USGS Gazetteer of
// Planetary Nomenclature, and a provenance manifest. Both maps are equirectangular, centered on 0°
// longitude with east to the right and north up. Source files are downloaded once into bin/data/moon and
// reused; the audit of the catalog (every record left out and why) is written there too. Each output is
// written to a temporary file and only replaces the previous one when generation succeeds. With --empty,
// small placeholders are written without downloading anything, which is enough to build and test.
// Usage: bun make:moon [--force] [--empty]

// Directory of the downloaded source files and of the audit.
const SOURCE_DIR = join(import.meta.dir, '../data/moon')

// Directory of the generated assets, imported by web/src/sky/moon.
const OUTPUT_DIR = join(import.meta.dir, '../../web/assets/moon')

// NASA SVS CGI Moon Kit (https://svs.gsfc.nasa.gov/4720/), the 2025 LROC color maps.
const CGI_MOON_KIT = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720'

// Source files and the URL each one is downloaded from when missing.
const SOURCE_FILES = {
	'lroc_color_2k.jpg': `${CGI_MOON_KIT}/lroc_color_2k.jpg`,
	'lroc_color_16bit_srgb_4k.tif': `${CGI_MOON_KIT}/lroc_color_16bit_srgb_4k.tif`,
	'MOON_nomenclature_center_pts.zip': 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.zip',
} as const

// Generated files.
const OUTPUT = {
	texture2k: 'moon.2k.jpg',
	texture4k: 'moon.4k.jpg',
	features: 'moon.features.json',
	provenance: 'moon.provenance.json',
} as const

// Size of the larger color map in pixels, width by height.
const TEXTURE_4K = [4096, 2048] as const

// JPEG quality of the larger color map: high enough that the 8-bit reduction, not the encoder, limits it.
const JPEG_QUALITY = 90

// Credit of the color maps, as the NASA SVS page asks.
const TEXTURE_CREDIT = "NASA's Scientific Visualization Studio, CGI Moon Kit (LRO LROC WAC color, LOLA albedo at high latitudes). Optimized for appearance, not science."

// Credit of the surface feature names.
const FEATURE_CREDIT = 'Gazetteer of Planetary Nomenclature, USGS Astrogeology Science Center and the International Astronomical Union.'

// Returns the path of a source file.
function sourceFile(name: keyof typeof SOURCE_FILES) {
	return join(SOURCE_DIR, name)
}

// Returns the path of a generated file.
function outputFile(name: string) {
	return join(OUTPUT_DIR, name)
}

// Writes a file through a temporary one, so a failed run never leaves a truncated asset.
async function writeAtomically(path: string, data: Uint8Array | string) {
	await Bun.write(`${path}.tmp`, data)
	await fs.rename(`${path}.tmp`, path)
}

// Returns the SHA-256 of data, hexadecimal.
function sha256(data: Uint8Array) {
	return new Bun.CryptoHasher('sha256').update(data).digest('hex')
}

// Encodes 8-bit RGB pixels as a JPEG of the given quality with 4:2:0 chroma, as browsers decode fastest.
function encodeJpeg(rgb: Uint8Array, width: number, height: number, quality: number) {
	const jpeg = new Jpeg().compress(rgb, width, height, 'RGB', quality, '4:2:0')
	if (!jpeg) throw new Error('JPEG encoding failed')
	return jpeg
}

const force = process.argv.includes('--force')
const empty = process.argv.includes('--empty')

const exists = await Promise.all(Object.values(OUTPUT).map((name) => Bun.file(outputFile(name)).exists()))

if (!force && exists.every(Boolean)) {
	console.info('Moon assets already exist! Use --force to regenerate them.')
	exit(0)
}

await fs.mkdir(OUTPUT_DIR, { recursive: true })

if (empty) {
	// A mid-gray map of 2×1 pixels and no features: the Moon is drawn plain and the explorer lists nothing.
	const placeholder = encodeJpeg(new Uint8Array([128, 128, 128, 128, 128, 128]), 2, 1, JPEG_QUALITY)
	const catalog: MoonFeatureCatalog = { schema: MOON_FEATURE_CATALOG_SCHEMA, generatedAt: new Date().toISOString(), features: [] }
	await writeAtomically(outputFile(OUTPUT.texture2k), placeholder)
	await writeAtomically(outputFile(OUTPUT.texture4k), placeholder)
	await writeAtomically(outputFile(OUTPUT.features), JSON.stringify(catalog))
	await writeAtomically(outputFile(OUTPUT.provenance), `${JSON.stringify({ empty: true, generatedAt: catalog.generatedAt, command: 'bun make:moon --empty' }, null, '\t')}\n`)
	console.info(`written empty Moon assets to ${OUTPUT_DIR}`)
	exit(0)
}

await fs.mkdir(SOURCE_DIR, { recursive: true })

const acquiredAt: Partial<Record<keyof typeof SOURCE_FILES, string>> = {}

for (const [name, url] of Object.entries(SOURCE_FILES) as [keyof typeof SOURCE_FILES, string][]) {
	const file = Bun.file(sourceFile(name))

	if (await file.exists()) {
		acquiredAt[name] = new Date((await fs.stat(sourceFile(name))).mtimeMs).toISOString()
		continue
	}

	console.info(`downloading ${name}...`)
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`)
	await Bun.write(file, await response.blob())
	acquiredAt[name] = new Date().toISOString()
}

const sources = Object.fromEntries(await Promise.all((Object.keys(SOURCE_FILES) as (keyof typeof SOURCE_FILES)[]).map(async (name) => [name, new Uint8Array(await Bun.file(sourceFile(name)).arrayBuffer())] as const))) as Record<keyof typeof SOURCE_FILES, Uint8Array>
const hashes = Object.fromEntries(Object.entries(sources).map(([name, data]) => [name, sha256(data)])) as Record<keyof typeof SOURCE_FILES, string>

// The official 2K map, unchanged.
const header = new Jpeg().readHeader(sources['lroc_color_2k.jpg'])
if (!header || header.width !== 2 * header.height) throw new Error('lroc_color_2k.jpg is not an equirectangular map')
await writeAtomically(outputFile(OUTPUT.texture2k), sources['lroc_color_2k.jpg'])
console.info(`written ${OUTPUT.texture2k}: ${header.width}×${header.height}, ${sources['lroc_color_2k.jpg'].byteLength} bytes`)

// The 4K map: 16-bit sRGB samples rounded to 8 bits (the transfer function is already sRGB).
const tiff = readTiff(sources['lroc_color_16bit_srgb_4k.tif'])
if (tiff.width !== TEXTURE_4K[0] || tiff.height !== TEXTURE_4K[1] || tiff.samplesPerPixel !== 3) throw new Error(`lroc_color_16bit_srgb_4k.tif is ${tiff.width}×${tiff.height} with ${tiff.samplesPerPixel} samples, not a 4096×2048 RGB map`)
const rgb = new Uint8Array(tiff.data.length)
const scale = tiff.bitsPerSample === 16 ? 255 / 65535 : 1
for (let i = 0; i < rgb.length; i++) rgb[i] = Math.round(tiff.data[i] * scale)
const texture4k = encodeJpeg(rgb, tiff.width, tiff.height, JPEG_QUALITY)
await writeAtomically(outputFile(OUTPUT.texture4k), texture4k)
console.info(`written ${OUTPUT.texture4k}: ${tiff.width}×${tiff.height}, ${texture4k.byteLength} bytes`)

// The surface feature catalog, from the attribute table of the center-point shapefile.
const archive = readZip(sources['MOON_nomenclature_center_pts.zip'])
const dbf = archive.get('MOON_nomenclature_center_pts.dbf')
if (!dbf) throw new Error('MOON_nomenclature_center_pts.zip has no attribute table')
const encoding = new TextDecoder().decode(archive.get('MOON_nomenclature_center_pts.cpg') ?? new Uint8Array())
const { rows, audit } = normalizeLunarFeatures(readDbf(dbf, encoding).records)
const generatedAt = new Date().toISOString()
const catalog: MoonFeatureCatalog = {
	schema: MOON_FEATURE_CATALOG_SCHEMA,
	generatedAt,
	source: { name: 'MOON_nomenclature_center_pts', url: SOURCE_FILES['MOON_nomenclature_center_pts.zip'], sha256: hashes['MOON_nomenclature_center_pts.zip'], acquiredAt: acquiredAt['MOON_nomenclature_center_pts.zip']!, credit: FEATURE_CREDIT },
	features: rows,
}
const features = JSON.stringify(catalog)
await writeAtomically(outputFile(OUTPUT.features), features)
await writeAtomically(join(SOURCE_DIR, 'moon.features.audit.json'), `${JSON.stringify(audit, null, '\t')}\n`)
console.info(`written ${OUTPUT.features}: ${rows.length} of ${audit.records} features, ${audit.rejected.length} left out, ${features.length} bytes`)

const provenance = {
	generatedAt,
	command: 'bun make:moon --force',
	sources: Object.fromEntries((Object.keys(SOURCE_FILES) as (keyof typeof SOURCE_FILES)[]).map((name) => [name, { url: SOURCE_FILES[name], sha256: hashes[name], bytes: sources[name].byteLength, acquiredAt: acquiredAt[name] }])),
	outputs: {
		[OUTPUT.texture2k]: { from: 'lroc_color_2k.jpg', width: header.width, height: header.height, bytes: sources['lroc_color_2k.jpg'].byteLength },
		[OUTPUT.texture4k]: { from: 'lroc_color_16bit_srgb_4k.tif', width: tiff.width, height: tiff.height, bytes: texture4k.byteLength, jpegQuality: JPEG_QUALITY },
		[OUTPUT.features]: { from: 'MOON_nomenclature_center_pts.dbf', schema: MOON_FEATURE_CATALOG_SCHEMA, features: rows.length, bytes: features.length },
	},
	credits: { textures: TEXTURE_CREDIT, features: FEATURE_CREDIT },
}

await writeAtomically(outputFile(OUTPUT.provenance), `${JSON.stringify(provenance, null, '\t')}\n`)
console.info(`written ${OUTPUT.provenance}`)
