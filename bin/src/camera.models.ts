import { CAMERA_MODEL_CATALOG_SCHEMA, type CameraModel } from 'api/equipmentcatalog.models'
import { type AstrobinCamera, type AstrobinSensor, cameras, sensors } from 'nebulosa/src/adapters/imaging/astrobin'
import { fullName, positiveSpec, readAll, runModelCatalog } from './astrobin'

// Generates the camera model catalog the Equipment Catalog editor and the calculators offer to fill a camera from,
// web/assets/cameras.json.gz (not committed, gzipped): every camera of the AstroBin equipment database whose sensor
// declares its size in pixels, with that sensor's pixel size, ADC bits, and whether it is a color or a mono one, joined
// through the toolkit's AstroBin client. Cameras without a sensor, or whose sensor has no size, are left out, since they
// fill nothing; models listed twice keep the first one. The writing, --force, and --empty are those of runModelCatalog.
// Usage: bun make:cameras [--force] [--empty]

// Returns the model a camera describes through its sensor, or undefined when the sensor is unknown or declares no size.
// A pixel size or an ADC bit depth out of range is left out.
function cameraModel(camera: AstrobinCamera, sensor: AstrobinSensor | undefined): CameraModel | undefined {
	if (!sensor || !Number.isInteger(sensor.pixelWidth) || sensor.pixelWidth <= 0 || !Number.isInteger(sensor.pixelHeight) || sensor.pixelHeight <= 0) return undefined
	const pixelSize = positiveSpec(sensor.pixelSize)
	const bits = sensor.adc ?? Number.NaN
	const sensorName = fullName(sensor)

	return {
		model: fullName(camera),
		...(sensorName && { sensor: sensorName }),
		width: sensor.pixelWidth,
		height: sensor.pixelHeight,
		...(pixelSize !== undefined && { pixelSize }),
		...(Number.isInteger(bits) && bits > 0 && bits <= 32 && { bits }),
		...(sensor.colorOrMono && { color: sensor.colorOrMono === 'C' }),
	}
}

await runModelCatalog<CameraModel>({
	// Generated file, loaded by web/src/equipment/CameraModelSearch.tsx.
	output: '../../web/assets/cameras.json.gz',
	schema: CAMERA_MODEL_CATALOG_SCHEMA,
	name: 'camera model',
	command: 'bun make:cameras',
	read: async () => {
		const sensorById = new Map((await readAll('sensors', sensors)).map((sensor) => [sensor.id, sensor]))
		return (await readAll('cameras', cameras)).flatMap((camera) => cameraModel(camera, camera.sensor === null ? undefined : sensorById.get(camera.sensor)) ?? [])
	},
})
