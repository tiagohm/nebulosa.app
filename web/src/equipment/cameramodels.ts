import type { CameraModel } from 'api'
import type { CfaPattern } from 'nebulosa/src/imaging/model/types'
import { MODEL_SEARCH_LIMIT, modelCatalogLoader, searchModels } from './models'

// Camera model catalog of the Equipment Catalog editor and the calculators: the cameras of the AstroBin equipment
// database and their sensors, bundled as a gzipped JSON file (`bun make:cameras`), loaded once on demand and searched by
// model and sensor name. Only fills the fields of a camera being edited; nothing here talks to AstroBin or to the
// server's API.

// Version of the catalog layout this client reads (CAMERA_MODEL_CATALOG_SCHEMA of the API).
export const SUPPORTED_CAMERA_MODEL_SCHEMA = 1

// CFA pattern given to a color sensor that had none, since AstroBin never gives it: the one most astronomy color
// cameras report.
export const DEFAULT_COLOR_CFA: CfaPattern = 'RGGB'

// Loads the models of the catalog bundled at url once, shared by every caller; a failure rejects, and the next call asks
// again.
export const loadCameraModels = modelCatalogLoader<CameraModel>(SUPPORTED_CAMERA_MODEL_SCHEMA, 'camera model catalog')

// Returns up to limit models whose model or sensor name holds every word of the query, in catalog order; none for a blank
// query.
export function searchCameraModels(models: readonly CameraModel[], query: string, limit: number = MODEL_SEARCH_LIMIT) {
	return searchModels(models, query, (model) => `${model.model} ${model.sensor ?? ''}`, limit)
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
