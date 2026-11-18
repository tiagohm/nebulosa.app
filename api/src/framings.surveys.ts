import type { HipsSurvey } from 'nebulosa/src/adapters/sky/hips2fits'

// Layout of the survey catalog the Framing tool offers as the background of its preview: the CDS image surveys served by
// hips2fits that cover the whole sky, with the title and credit each publisher asks for, written by `bun make:surveys`
// into web/assets/hips.surveys.json.gz and read by the web client. Nothing on the server reads it; the layout lives here
// so the generator and the client share it.

// Version of the survey catalog layout; the generator writes it and a reader of another version rejects the file.
export const HIPS_SURVEY_CATALOG_SCHEMA = 1

// Order of the wavelength regimes in the catalog, the optical surveys first.
export const HIPS_SURVEY_REGIMES = ['optical', 'infrared', 'radio', 'uv', 'x-ray', 'gamma-ray'] as const

// Survey catalog file.
export interface HipsSurveyCatalog {
	// Layout version, HIPS_SURVEY_CATALOG_SCHEMA.
	readonly schema: number
	// When the file was generated, ISO 8601.
	readonly generatedAt: string
	// URL of the MocServer the surveys were read from; absent for the empty catalog of `bun make:surveys --empty`.
	readonly source?: string
	// Every survey, by regime in the order of HIPS_SURVEY_REGIMES, then the widest coverage first, then by id.
	readonly surveys: readonly HipsSurvey[]
}

// Orders surveys as the catalog keeps them: by regime in the order of HIPS_SURVEY_REGIMES (an unknown regime last), then
// the widest sky coverage first, then by id. Returns a new array.
export function sortHipsSurveys(surveys: readonly HipsSurvey[]): HipsSurvey[] {
	const rank = (survey: HipsSurvey) => {
		const index = HIPS_SURVEY_REGIMES.indexOf(survey.regime)
		return index < 0 ? HIPS_SURVEY_REGIMES.length : index
	}

	return surveys.toSorted((a, b) => rank(a) - rank(b) || b.skyFraction - a.skyFraction || a.id.localeCompare(b.id))
}
