import type { CameraModel } from 'api'
import cameraModels from '../../assets/cameras.json.gz' with { type: 'file' }
import { cameraModelDescription, loadCameraModels, searchCameraModels } from './cameramodels'
import { ModelSearch } from './ModelSearch'

// Search of the camera model catalog (the cameras of the AstroBin equipment database), in the Equipment Catalog editor and
// the calculators that take a sensor, matching the model and sensor names (ModelSearch).

export interface CameraModelSearchProps {
	// Called with the model chosen.
	readonly onPick: (model: CameraModel) => void
	// Label of the field; "Fill From Model" when absent.
	readonly label?: string
}

// Loads the bundled camera model catalog.
function load() {
	return loadCameraModels(cameraModels)
}

// Field that searches the camera model catalog, with the models that match in a floating list below it.
export function CameraModelSearch({ onPick, label = 'Fill From Model' }: CameraModelSearchProps) {
	return <ModelSearch label={label} placeholder="Search cameras, such as ASI2600MM" load={load} search={searchCameraModels} describe={cameraModelDescription} noMatch="No camera model matches." empty="The camera model catalog is empty; run bun make:cameras to download it." onPick={onPick} />
}
