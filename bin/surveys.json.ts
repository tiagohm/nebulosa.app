import { type HipsSurvey, type HipsSurveyRegime, hipsSurveys } from 'nebulosa/src/hips2fits'

const REGIME: HipsSurveyRegime[] = ['optical', 'infrared', 'radio', 'uv', 'x-ray', 'gamma-ray']

function hipsSurveyComparator(a: HipsSurvey, b: HipsSurvey) {
	const regime = REGIME.indexOf(a.regime) - REGIME.indexOf(b.regime)
	if (regime !== 0) return regime
	const skyFraction = b.skyFraction - a.skyFraction
	if (skyFraction !== 0) return skyFraction
	return a.id.localeCompare(b.id)
}

const surveys = await hipsSurveys()
await Bun.write('data/hips-surveys.json', JSON.stringify(surveys.sort(hipsSurveyComparator)))
