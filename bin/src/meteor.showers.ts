import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { IAU_METEOR_SHOWER_CATALOG_URL, normalizeIauMeteorShowerCatalog, parseIauMeteorShowerCatalog } from 'nebulosa/src/adapters/catalogs/iau.meteor.showers'

// Generates the IAU meteor shower catalog bundled with the application, api/data/meteor.showers.json.gz (not committed):
// the stream catalog of the IAU Meteor Data Center (streamfulldata.json) exactly as published, gzipped, which the Meteor
// Showers service uses until the operator downloads a newer one. The document is validated with the toolkit's adapter
// before it is written, through a temporary file that only replaces the previous one when everything succeeded. With
// --empty, an empty catalog (version "empty") is written without downloading anything, which is enough to build and test;
// a later run replaces it without --force.
// Usage: bun make:meteors [--force] [--empty]

// Generated file, imported by api/src/meteorshowers.ts.
const OUTPUT = join(import.meta.dir, '../../api/data/meteor.showers.json.gz')

// Version of the placeholder written by --empty.
const EMPTY_VERSION = 'empty'

// Most time the download may take, milliseconds.
const DOWNLOAD_TIMEOUT_MS = 120_000

// Writes a file through a temporary one, so a failed run never leaves a truncated catalog.
async function writeAtomically(path: string, data: Uint8Array) {
	await Bun.write(`${path}.tmp`, data)

	try {
		await fs.rename(`${path}.tmp`, path)
	} catch (error) {
		await fs.rm(`${path}.tmp`, { force: true })
		throw new Error(`Cannot replace ${path}; stop the development server, which keeps it open, and run again`, { cause: error })
	}
}

// Version of the catalog in place; undefined when there is none or it cannot be read.
async function versionInPlace() {
	try {
		const text = new TextDecoder().decode(Bun.gunzipSync(await Bun.file(OUTPUT).bytes()))
		return parseIauMeteorShowerCatalog(text).version
	} catch {
		return undefined
	}
}

const force = process.argv.includes('--force')
const empty = process.argv.includes('--empty')
const current = await versionInPlace()

if (!force && current !== undefined) {
	if (empty || current !== EMPTY_VERSION) {
		console.info(`The meteor shower catalog (version ${current}) already exists! Use --force to download it again.`)
		exit(0)
	}

	console.info('The meteor shower catalog is the empty placeholder; downloading the real one...')
}

if (empty) {
	const placeholder = { source: 'IAU Meteor Data Center', version: EMPTY_VERSION, count: 0, data: [] }
	await writeAtomically(OUTPUT, Bun.gzipSync(JSON.stringify(placeholder)))
	console.info(`written an empty meteor shower catalog to ${OUTPUT}`)
	exit(0)
}

const response = await fetch(IAU_METEOR_SHOWER_CATALOG_URL, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
if (!response.ok) throw new Error(`${IAU_METEOR_SHOWER_CATALOG_URL} answered ${response.status}`)
const text = await response.text()
const { metadata, showers } = normalizeIauMeteorShowerCatalog(parseIauMeteorShowerCatalog(text))
if (metadata.count !== undefined && metadata.count !== showers.length) throw new Error(`the catalog publishes ${metadata.count} records but holds ${showers.length}`)
if (showers.length === 0) throw new Error('the catalog has no records')

await fs.mkdir(join(OUTPUT, '..'), { recursive: true })
await writeAtomically(OUTPUT, Bun.gzipSync(text))
console.info(`written the IAU meteor shower catalog version ${metadata.version} (${showers.length} showers) to ${OUTPUT}`)
