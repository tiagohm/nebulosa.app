import type { TelescopeModel } from 'api'
import telescopeModels from '../../assets/telescopes.json.gz' with { type: 'file' }
import { ModelSearch } from './ModelSearch'
import { loadTelescopeModels, searchTelescopeModels, telescopeModelDescription } from './telescopemodels'

// Search of the telescope model catalog (the telescopes and lenses of the AstroBin equipment database), in the Equipment
// Catalog editor and the calculators that take optics, matching the model name (ModelSearch).

export interface TelescopeModelSearchProps {
	// Called with the model chosen.
	readonly onPick: (model: TelescopeModel) => void
	// Label of the field; "Fill From Model" when absent.
	readonly label?: string
}

// Loads the bundled telescope model catalog.
function load() {
	return loadTelescopeModels(telescopeModels)
}

// Field that searches the telescope model catalog, with the models that match in a floating list below it.
export function TelescopeModelSearch({ onPick, label = 'Fill From Model' }: TelescopeModelSearchProps) {
	return <ModelSearch label={label} placeholder="Search telescopes, such as Esprit 100" load={load} search={searchTelescopeModels} describe={telescopeModelDescription} noMatch="No telescope model matches." empty="The telescope model catalog is empty; run bun make:telescopes to download it." onPick={onPick} />
}
