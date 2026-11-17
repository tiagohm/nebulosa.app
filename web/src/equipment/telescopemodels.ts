import type { TelescopeModel } from 'api'
import { formatFocalRatio, formatMillimeters } from '../format'
import { MODEL_SEARCH_LIMIT, modelCatalogLoader, searchModels } from './models'

// Telescope model catalog of the Equipment Catalog editor and the calculators: the telescopes and lenses of the AstroBin
// equipment database with their aperture and focal length, bundled as a gzipped JSON file (`bun make:telescopes`),
// loaded once on demand and searched by model name. Only fills the fields of a telescope or a calculator being edited;
// nothing here talks to AstroBin or to the server's API.

// Version of the catalog layout this client reads (TELESCOPE_MODEL_CATALOG_SCHEMA of the API).
export const SUPPORTED_TELESCOPE_MODEL_SCHEMA = 1

// Loads the models of the catalog bundled at url once, shared by every caller; a failure rejects, and the next call asks
// again.
export const loadTelescopeModels = modelCatalogLoader<TelescopeModel>(SUPPORTED_TELESCOPE_MODEL_SCHEMA, 'telescope model catalog')

// Returns up to limit models whose name holds every word of the query, in catalog order; none for a blank query.
export function searchTelescopeModels(models: readonly TelescopeModel[], query: string, limit: number = MODEL_SEARCH_LIMIT) {
	return searchModels(models, query, (model) => model.model, limit)
}

// Returns what a model says of its optics: its aperture, focal length or zoom range, in millimeters, and the focal ratio
// of the native focal length.
export function telescopeModelDescription({ aperture, focalLength, maxFocalLength }: TelescopeModel) {
	const length = focalLength !== undefined && (maxFocalLength !== undefined ? `${focalLength}–${maxFocalLength} mm FL` : `${focalLength} mm FL`)
	const ratio = aperture !== undefined && focalLength !== undefined && formatFocalRatio(focalLength / aperture)
	return [aperture !== undefined && formatMillimeters(aperture), length, ratio].filter(Boolean).join(' · ')
}
