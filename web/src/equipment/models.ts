import { type ApiFetch, browserFetch } from '../http'

// Loading and searching of the model catalogs bundled with the web client (the cameras and the telescopes of the AstroBin
// equipment database, written by `bun make:cameras` and `bun make:telescopes`): each one is a gzipped JSON file loaded
// once on demand and searched word by word. Nothing here talks to AstroBin or to the server's API.

// Largest number of models a search returns.
export const MODEL_SEARCH_LIMIT = 8

// Layout every model catalog file shares.
interface ModelCatalogFile<T> {
	// Layout version.
	readonly schema: number
	// Models, sorted by name without regard to case.
	readonly models: readonly T[]
}

// Loads the models of a catalog bundled at a URL, through request.
export type ModelCatalogLoader<T> = (url: string, request?: ApiFetch) => Promise<readonly T[]>

// Decodes a catalog file, gzipped or already decoded by the server (a gzip stream starts with 1f 8b).
async function decodeCatalog<T>(buffer: ArrayBuffer) {
	const bytes = new Uint8Array(buffer)
	const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes)
	return JSON.parse(text) as ModelCatalogFile<T>
}

// Returns the loader of a catalog of the layout version schema, named name in its errors, such as "camera model
// catalog": it loads the file once, shared by every caller, rejects a file of another version, and after a failure asks
// again on the next call.
export function modelCatalogLoader<T>(schema: number, name: string): ModelCatalogLoader<T> {
	let loading: Promise<readonly T[]> | undefined

	return (url, request = browserFetch) => {
		loading ??= (async () => {
			const response = await request(url)
			if (!response.ok) throw new Error(`The ${name} could not be loaded (${response.status})`)
			const catalog = await decodeCatalog<T>(await response.arrayBuffer())
			if (catalog.schema !== schema) throw new Error(`Unsupported ${name} version ${catalog.schema}`)
			return catalog.models
		})().catch((error: unknown) => {
			loading = undefined
			throw error
		})

		return loading
	}
}

// Returns a text lowercased with everything but letters and digits removed, so "ASI 2600-MM" matches "asi2600mm".
export function searchKey(text: string) {
	return text.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '')
}

// Returns up to limit models whose text (textOf) holds every word of the query, in catalog order; none for a blank query.
export function searchModels<T>(models: readonly T[], query: string, textOf: (model: T) => string, limit: number = MODEL_SEARCH_LIMIT) {
	const words = query.split(/\s+/).map(searchKey).filter(Boolean)
	const found: T[] = []
	if (words.length === 0) return found

	for (const model of models) {
		const key = searchKey(textOf(model))

		if (words.every((word) => key.includes(word))) {
			found.push(model)
			if (found.length >= limit) break
		}
	}

	return found
}
