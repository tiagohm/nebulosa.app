// Catalog of the Calculator tool: the task-oriented calculators it offers, grouped by category in display order. Each
// calculator composes several formulas of nebulosa/src/astronomy/formulas behind one form; a formula is never an entry
// of its own. Only implemented calculators are listed.

// Category of calculators.
export type CalculatorCategory = 'optics' | 'sampling' | 'exposure' | 'visual' | 'atmosphere'

// Stable id of a calculator.
export type CalculatorId = 'imaging-setup' | 'mosaic' | 'sampling' | 'diffraction' | 'exposure-planner' | 'star-trailing' | 'eyepiece' | 'aperture-comparison' | 'airmass' | 'dew'

// Definition of a calculator.
export interface CalculatorDefinition {
	// Stable id.
	readonly id: CalculatorId
	// Display name.
	readonly label: string
	// Category it is listed under.
	readonly category: CalculatorCategory
	// One-sentence description of what it computes.
	readonly description: string
}

// Display name of each category.
export const CATEGORY_LABELS: Readonly<Record<CalculatorCategory, string>> = {
	optics: 'Optics & Field of View',
	sampling: 'Sampling & Focus',
	exposure: 'Exposure & Integration',
	visual: 'Visual Observation',
	atmosphere: 'Atmosphere & Conditions',
}

// Every calculator in display order; the calculators of a category are consecutive.
export const CALCULATORS: readonly CalculatorDefinition[] = [
	{ id: 'imaging-setup', label: 'Imaging Setup', category: 'optics', description: 'Field of view, image scale, and focal ratio of a telescope or lens with a camera.' },
	{ id: 'mosaic', label: 'Mosaic Estimator', category: 'optics', description: 'Number of panels a rectangular mosaic needs to cover a target.' },
	{ id: 'sampling', label: 'Sampling', category: 'sampling', description: 'Stellar FWHM in pixels for a seeing and image scale, and the focal length for a target sampling.' },
	{ id: 'diffraction', label: 'Diffraction & Focus', category: 'sampling', description: 'Airy disk and critical focus zone of a focal ratio.' },
	{ id: 'exposure-planner', label: 'Exposure Planner', category: 'exposure', description: 'Total integration or frames needed, with the idealized gain of stacking.' },
	{ id: 'star-trailing', label: 'Star Trailing', category: 'exposure', description: 'Sidereal drift of an untracked star and the longest exposure within a trail budget.' },
	{ id: 'eyepiece', label: 'Eyepiece & Telescope', category: 'visual', description: 'Magnification, exit pupil, true field, and resolving limits of an eyepiece.' },
	{ id: 'aperture-comparison', label: 'Aperture Comparison', category: 'visual', description: 'Light grasp of two apertures, clear and with their central obstructions.' },
	{ id: 'airmass', label: 'Airmass & Visibility Effects', category: 'atmosphere', description: 'Airmass, extinction, and refraction at an altitude.' },
	{ id: 'dew', label: 'Dew Conditions', category: 'atmosphere', description: 'Dew point and dew risk, humidity from a dew point, or frost point.' },
]

// Ids of every calculator in display order.
export const CALCULATOR_IDS: readonly CalculatorId[] = CALCULATORS.map((e) => e.id)

// Returns the definition of a calculator.
export function calculatorDefinition(id: CalculatorId): CalculatorDefinition {
	return CALCULATORS.find((e) => e.id === id) ?? CALCULATORS[0]
}
