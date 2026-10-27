// Catalog of the Calculator tool: the task-oriented calculators it offers, grouped by category in display order. Each
// calculator composes several formulas of nebulosa/src/astronomy/formulas behind one form; a formula is never an entry
// of its own. Only implemented calculators are listed.

// Category of calculators.
export type CalculatorCategory = 'optics'

// Stable id of a calculator.
export type CalculatorId = 'imaging-setup' | 'mosaic'

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
}

// Every calculator in display order; the calculators of a category are consecutive.
export const CALCULATORS: readonly CalculatorDefinition[] = [
	{ id: 'imaging-setup', label: 'Imaging Setup', category: 'optics', description: 'Field of view, image scale, and focal ratio of a telescope or lens with a camera.' },
	{ id: 'mosaic', label: 'Mosaic Estimator', category: 'optics', description: 'Number of panels a rectangular mosaic needs to cover a target.' },
]

// Ids of every calculator in display order.
export const CALCULATOR_IDS: readonly CalculatorId[] = CALCULATORS.map((e) => e.id)

// Returns the definition of a calculator.
export function calculatorDefinition(id: CalculatorId): CalculatorDefinition {
	return CALCULATORS.find((e) => e.id === id) ?? CALCULATORS[0]
}
