import type { CameraModel, CameraModelCatalog } from 'api'
import type { CfaPattern } from 'nebulosa/src/imaging/model/types'
import { type ApiFetch, browserFetch } from '../http'

// Camera model catalog of the Equipment Catalog editor: the cameras of the AstroBin equipment database and their sensors,
// bundled as a gzipped JSON file (`bun make:cameras`), loaded once on demand and searched by model and sensor name. Only
// fills the fields of a camera being edited; nothing here talks to AstroBin or to the server's API.

// Version of the catalog layout this client reads (CAMERA_MODEL_CATALOG_SCHEMA of the API).
export const SUPPORTED_CAMERA_MODEL_SCHEMA = 1

// Largest number of models a search returns.
export const CAMERA_MODEL_SEARCH_LIMIT = 8

// CFA pattern given to a color sensor that had none, since AstroBin never gives it: the one most astronomy color
// cameras report.
export const DEFAULT_COLOR_CFA: CfaPattern = 'RGGB'

// Loading of the catalog, shared by every editor; cleared on a failure so it is asked again.
let loading: Promise<readonly CameraModel[]> | undefined

// Decodes a catalog file, gzipped or already decoded by the server (a gzip stream starts with 1f 8b), and returns its
// models. Throws for a file of another layout version.
async function decodeCatalog(buffer: ArrayBuffer) {
	const bytes = new Uint8Array(buffer)
	const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text() : new TextDecoder().decode(bytes)
	const catalog = JSON.parse(text) as CameraModelCatalog
	if (catalog.schema !== SUPPORTED_CAMERA_MODEL_SCHEMA) throw new Error(`Unsupported camera model catalog version ${catalog.schema}`)
	return catalog.models
}

// Loads the models of the catalog bundled at url once; a failure rejects, and the next call asks again.
export function loadCameraModels(url: string, request: ApiFetch = browserFetch) {
	loading ??= (async () => {
		const response = await request(url)
		if (!response.ok) throw new Error(`The camera model catalog could not be loaded (${response.status})`)
		return decodeCatalog(await response.arrayBuffer())
	})().catch((error: unknown) => {
		loading = undefined
		throw error
	})

	return loading
}

// Returns a text lowercased with everything but letters and digits removed, so "ASI 2600-MM" matches "asi2600mm".
export function searchKey(text: string) {
	return text.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '')
}

// Returns up to limit models whose model or sensor name holds every word of the query, in catalog order; none for a blank
// query.
export function searchCameraModels(models: readonly CameraModel[], query: string, limit: number = CAMERA_MODEL_SEARCH_LIMIT) {
	const words = query.split(/\s+/).map(searchKey).filter(Boolean)
	const found: CameraModel[] = []
	if (words.length === 0) return found

	for (const model of models) {
		const key = searchKey(`${model.model} ${model.sensor ?? ''}`)

		if (words.every((word) => key.includes(word))) {
			found.push(model)
			if (found.length >= limit) break
		}
	}

	return found
}

// Returns the CFA pattern a camera gets from a model: none for a mono sensor, the current one or DEFAULT_COLOR_CFA for a
// color sensor, and the current one when the model does not say.
export function modelCfa(model: Pick<CameraModel, 'color'>, current: CfaPattern | undefined): CfaPattern | undefined {
	if (model.color === false) return undefined
	if (model.color === true) return current ?? DEFAULT_COLOR_CFA
	return current
}

// Returns what a model says of a sensor: its size in pixels, pixel size, bits, and color.
export function cameraModelDescription({ sensor, width, height, pixelSize, bits, color }: CameraModel) {
	return [sensor, `${width} × ${height}`, pixelSize !== undefined && `${pixelSize} µm`, bits !== undefined && `${bits} bits`, color !== undefined && (color ? 'Color' : 'Mono')].filter(Boolean).join(' · ')
}
