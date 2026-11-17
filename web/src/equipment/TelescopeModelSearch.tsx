import type { TelescopeModel } from 'api'
import telescopeModels from '../../assets/telescopes.json.gz' with { type: 'file' }
import { ModelSearch } from './ModelSearch'
import { loadTelescopeModels, searchTelescopeModels, telescopeModelDescription } from './telescopemodels'

// Search of the telescope model catalog (the telescopes and lenses of the AstroBin equipment database), in the Equipment
// Catalog editor and the calculators that take optics, matching the model name (ModelSearch): a search of its own, or,
// given a value, the field that edits the model of a telescope.

export interface TelescopeModelSearchProps {
	// Called with the model chosen.
	readonly onPick: (model: TelescopeModel) => void
	// Label of the field; "Fill From Model" when absent.
	readonly label?: string
	// Placeholder of the field; an example to search when absent.
	readonly placeholder?: string
	// Model the field edits; absent for a search of its own.
	readonly value?: string
	// Called with the model typed, when the field edits one.
	readonly onValueChange?: (value: string) => void
}

// Loads the bundled telescope model catalog.
function load() {
	return loadTelescopeModels(telescopeModels)
}

// Field that searches the telescope model catalog, with the models that match in a floating list below it.
export function TelescopeModelSearch({ onPick, label = 'Fill From Model', placeholder = 'Search telescopes, such as Esprit 100', value, onValueChange }: TelescopeModelSearchProps) {
	return (
		<ModelSearch
			label={label}
			placeholder={placeholder}
			value={value}
			onValueChange={onValueChange}
			load={load}
			search={searchTelescopeModels}
			describe={telescopeModelDescription}
			noMatch="No telescope model matches."
			empty="The telescope model catalog is empty; run bun make:telescopes to download it."
			onPick={onPick}
		/>
	)
}
