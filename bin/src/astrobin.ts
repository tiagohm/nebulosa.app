import fs from 'fs/promises'
import { join } from 'path'
import { type AstrobinEquipment, type AstrobinPage, BASE_URL } from 'nebulosa/src/adapters/imaging/astrobin'

// Shared run of the generators of the model catalogs read from the AstroBin equipment database through the toolkit's
// client (camera.models.ts, telescope.models.ts): every page of a listing, the names as AstroBin shows them, and a gzipped
// JSON catalog written through a temporary file that only replaces the previous one when everything succeeded. A catalog
// in place is kept unless --force, except the empty placeholder of --empty, which a later run replaces; --empty writes
// that placeholder without downloading anything, which is enough to build and test.

// Largest number of pages read from one listing, a guard against a listing that never ends.
const MAX_PAGES = 1000

// Layout every model catalog file shares.
export interface ModelCatalogFile<T> {
	// Layout version.
	readonly schema: number
	// When the file was generated, ISO 8601.
	readonly generatedAt: string
	// URL of the database the models were read from; absent for the empty placeholder.
	readonly source?: string
	// Models, sorted by name without regard to case.
	readonly models: readonly T[]
}

// What a generator writes.
export interface ModelCatalogRun<T extends { readonly model: string }> {
	// Path of the gzipped catalog, relative to the repository's bin/src.
	readonly output: string
	// Layout version written, and the only one a catalog in place is kept at.
	readonly schema: number
	// Name of a model, such as "camera model", for the messages.
	readonly name: string
	// Usage line of the generator, such as "bun make:cameras".
	readonly command: string
	// Reads every model from AstroBin, in any order; models listed twice keep the first one. Throws when a page cannot be
	// read.
	readonly read: () => Promise<readonly T[]>
}

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

// Catalog in place at path when it has the layout schema; undefined when there is none or it cannot be read.
async function catalogInPlace<T>(path: string, schema: number) {
	try {
		const catalog = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(path).bytes()))) as ModelCatalogFile<T>
		return catalog.schema === schema ? catalog : undefined
	} catch {
		return undefined
	}
}

// Reads every page of a listing, from page 1 until one names no next page. Throws when a page cannot be read.
export async function readAll<T extends AstrobinEquipment>(name: string, page: (index: number) => Promise<AstrobinPage<T> | undefined>) {
	const items: T[] = []

	for (let index = 1; index <= MAX_PAGES; index++) {
		const result = await page(index)
		if (!result) throw new Error(`The page ${index} of the ${name} of AstroBin could not be read`)
		items.push(...result.results)
		console.info(`read ${items.length} of ${result.count} ${name}`)
		if (!result.next) return items
	}

	throw new Error(`The ${name} of AstroBin have more than ${MAX_PAGES} pages`)
}

// Joins brand and name, as AstroBin shows them.
export function fullName({ brandName, name }: AstrobinEquipment) {
	return `${brandName ?? ''} ${name}`.trim()
}

// Returns a numeric spec AstroBin gives as text, or undefined when it is absent, not a number, or not positive.
export function positiveSpec(text: string | null | undefined) {
	const value = text ? +text : Number.NaN
	return Number.isFinite(value) && value > 0 ? value : undefined
}

// Runs a generator with the --force and --empty flags of the command line; throws when AstroBin gives no model.
export async function runModelCatalog<T extends { readonly model: string }>({ output, schema, name, command, read }: ModelCatalogRun<T>) {
	const path = join(import.meta.dir, output)
	const force = process.argv.includes('--force')
	const empty = process.argv.includes('--empty')
	const current = await catalogInPlace<T>(path, schema)

	if (!force && current !== undefined) {
		if (empty || current.source !== undefined) {
			console.info(`The ${name} catalog (${current.models.length} models) already exists! Use --force to download it again.`)
			return
		}

		console.info(`The ${name} catalog is the empty placeholder; downloading the real one...`)
	}

	await fs.mkdir(join(path, '..'), { recursive: true })

	if (empty) {
		const placeholder: ModelCatalogFile<T> = { schema, generatedAt: new Date().toISOString(), models: [] }
		await writeAtomically(path, Bun.gzipSync(JSON.stringify(placeholder)))
		console.info(`written an empty ${name} catalog to ${path}`)
		return
	}

	const models = new Map<string, T>()

	for (const model of await read()) {
		const key = model.model.toLowerCase()
		if (!models.has(key)) models.set(key, model)
	}

	if (models.size === 0) throw new Error(`AstroBin gave no ${name}s; ${command} wrote nothing`)

	const sorted = [...models.values()].sort((a, b) => a.model.localeCompare(b.model, 'en', { sensitivity: 'base' }))
	const catalog: ModelCatalogFile<T> = { schema, generatedAt: new Date().toISOString(), source: BASE_URL, models: sorted }
	await writeAtomically(path, Bun.gzipSync(JSON.stringify(catalog)))
	console.info(`written ${sorted.length} ${name}s to ${path}`)
}
