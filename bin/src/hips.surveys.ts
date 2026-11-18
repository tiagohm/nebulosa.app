import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { HIPS_SURVEY_CATALOG_SCHEMA, type HipsSurveyCatalog, sortHipsSurveys } from 'api/framings.surveys'
import { HIPS2FITS_BASE_URL, hipsSurveysUrl, parseHipsSurveys } from 'nebulosa/src/adapters/sky/hips2fits'

// Generates the survey catalog the Framing tool offers as the background of its preview, web/assets/hips.surveys.json.gz
// (not committed, gzipped): the CDS image surveys of the MocServer that hips2fits serves and that cover at least 99% of
// the sky, with their title and credit, ordered by regime, coverage, and id (sortHipsSurveys). The file is written
// through a temporary one that only replaces the previous one when everything succeeded. With --empty, an empty catalog
// is written without asking anything, which is enough to build and test; a later run replaces it without --force.
// Usage: bun make:surveys [--force] [--empty]

// Generated file, loaded by web/src/framing/surveys.ts.
const OUTPUT = join(import.meta.dir, '../../web/assets/hips.surveys.json.gz')

// Most time the query may take, milliseconds.
const DOWNLOAD_TIMEOUT_MS = 120_000

// Smallest fraction of the sky a survey covers to be listed: an all-sky survey, so every center has a background.
const MIN_SKY_FRACTION = 0.99

// Writes a file through a temporary one, so a failed run never leaves a truncated catalog.
async function writeAtomically(path: string, data: Uint8Array) {
	await Bun.write(`${path}.tmp`, data)

	try {
		await fs.rename(`${path}.tmp`, path)
	} catch (error) {
		await fs.rm(`${path}.tmp`, { force: true })
		throw new Error(`Cannot replace ${path}`, { cause: error })
	}
}

// Catalog in place when it has the current layout; undefined when there is none or it cannot be read.
async function catalogInPlace() {
	try {
		const catalog = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(OUTPUT).bytes()))) as HipsSurveyCatalog
		return catalog.schema === HIPS_SURVEY_CATALOG_SCHEMA ? catalog : undefined
	} catch {
		return undefined
	}
}

const force = process.argv.includes('--force')
const empty = process.argv.includes('--empty')
const current = await catalogInPlace()

if (!force && current !== undefined) {
	if (empty || current.source !== undefined) {
		console.info(`The survey catalog (${current.surveys.length} surveys) already exists! Use --force to download it again.`)
		exit(0)
	}

	console.info('The survey catalog is the empty placeholder; downloading the real one...')
}

await fs.mkdir(join(OUTPUT, '..'), { recursive: true })

if (empty) {
	const placeholder: HipsSurveyCatalog = { schema: HIPS_SURVEY_CATALOG_SCHEMA, generatedAt: new Date().toISOString(), surveys: [] }
	await writeAtomically(OUTPUT, Bun.gzipSync(JSON.stringify(placeholder)))
	console.info(`written an empty survey catalog to ${OUTPUT}`)
	exit(0)
}

const url = hipsSurveysUrl(MIN_SKY_FRACTION)
const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
if (!response.ok) throw new Error(`The MocServer answered ${response.status}; bun make:surveys wrote nothing`)
const surveys = sortHipsSurveys(parseHipsSurveys((await response.json()) as Record<string, unknown>[]))
if (surveys.length === 0) throw new Error('The MocServer listed no survey; bun make:surveys wrote nothing')

const catalog: HipsSurveyCatalog = { schema: HIPS_SURVEY_CATALOG_SCHEMA, generatedAt: new Date().toISOString(), source: `${HIPS2FITS_BASE_URL}MocServer`, surveys }
await writeAtomically(OUTPUT, Bun.gzipSync(JSON.stringify(catalog)))
console.info(`written ${surveys.length} surveys to ${OUTPUT}`)
