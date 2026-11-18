import type { HipsSurveyCatalog } from 'api'
import type { HipsSurvey } from 'nebulosa/src/adapters/sky/hips2fits'
import { bundledCatalogLoader } from '../equipment/models'

// Survey catalog of the preview of the Framing tool: the all-sky image surveys hips2fits serves, with the title and credit
// each publisher asks for, bundled as a gzipped JSON file (`bun make:surveys`) and loaded once on demand. Nothing here
// asks the MocServer.

// Version of the catalog layout this client reads (HIPS_SURVEY_CATALOG_SCHEMA of the API).
export const SUPPORTED_SURVEY_SCHEMA = 1

// Survey shown first: the colored Digitized Sky Survey, an optical all-sky survey at about 1″ per pixel.
export const DEFAULT_SURVEY = 'CDS/P/DSS2/color'

// Loads the surveys of the catalog bundled at url once, shared by every caller; a failure rejects, and the next call asks
// again.
export const loadHipsSurveys = bundledCatalogLoader<HipsSurvey>(SUPPORTED_SURVEY_SCHEMA, 'survey catalog', 'surveys' satisfies keyof HipsSurveyCatalog)

// Returns the name of a survey for a list: its title, or its id without one.
export function surveyName(survey: Pick<HipsSurvey, 'id' | 'title'>) {
	return survey.title ?? survey.id
}

// Returns the regime of a survey for the heading of its group, such as "Optical" or "X-ray".
export function surveyRegime(survey: Pick<HipsSurvey, 'regime'>) {
	return survey.regime === 'uv' ? 'Ultraviolet' : survey.regime.charAt(0).toUpperCase() + survey.regime.slice(1)
}
