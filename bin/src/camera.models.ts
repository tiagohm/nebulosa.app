import fs from 'fs/promises'
import { join } from 'path'
import { exit } from 'process'
import { CAMERA_MODEL_CATALOG_SCHEMA, type CameraModel, type CameraModelCatalog } from 'api/equipmentcatalog.models'
import { type AstrobinCamera, type AstrobinEquipment, type AstrobinPage, type AstrobinSensor, BASE_URL, cameras, sensors } from 'nebulosa/src/adapters/imaging/astrobin'

// Generates the camera model catalog the Equipment Catalog editor offers to fill a camera from, web/assets/cameras.json.gz
// (not committed, gzipped): every camera of the AstroBin equipment database whose sensor declares its size in pixels, with that
// sensor's pixel size, ADC bits, and whether it is a color or a mono one, joined through the toolkit's AstroBin client.
// Cameras without a sensor, or whose sensor has no size, are left out, since they fill nothing; models listed twice keep
// the first one. The file is written through a temporary one that only replaces the previous one when everything
// succeeded. With --empty, an empty catalog is written without downloading anything, which is enough to build and test; a
// later run replaces it without --force.
// Usage: bun make:cameras [--force] [--empty]

// Generated file, loaded by web/src/settings/CameraModelSearch.tsx.
const OUTPUT = join(import.meta.dir, '../../web/assets/cameras.json.gz')

// Largest number of pages read from one listing, a guard against a listing that never ends.
const MAX_PAGES = 1000

// Writes a file through a temporary one, so a failed run never leaves a truncated catalog.
async function writeAtomically(path: string, data: Uint8Array) {
	await Bun.write(`${path}.tmp`, data)

	try {
		await fs.rename(`${path}.tmp`, path)
	} catch (error) {
		await fs.rm(`${path}.tmp`, { force: true })
		throw new Error(`Cannot replace ${path}`, { cause: error })
	}
}

// Catalog in place; undefined when there is none or it cannot be read.
async function catalogInPlace() {
	try {
		const catalog = JSON.parse(new TextDecoder().decode(Bun.gunzipSync(await Bun.file(OUTPUT).bytes()))) as CameraModelCatalog
		return catalog.schema === CAMERA_MODEL_CATALOG_SCHEMA ? catalog : undefined
	} catch {
		return undefined
	}
}

// Reads every page of a listing, from page 1 until one names no next page. Throws when a page cannot be read.
async function readAll<T extends AstrobinEquipment>(name: string, page: (index: number) => Promise<AstrobinPage<T> | undefined>) {
	const items: T[] = []

	for (let index = 1; index <= MAX_PAGES; index++) {
		const result = await page(index)
		if (!result) throw new Error(`The page ${index} of the ${name} of AstroBin could not be read`)
		items.push(...result.results)
		console.info(`read ${items.length} of ${result.count} ${name}`)
		if (!result.next) return items
	}

	throw new Error(`The ${name} of AstroBin have more than ${MAX_PAGES} pages`)
}

// Joins brand and name, as AstroBin shows them.
function fullName({ brandName, name }: AstrobinEquipment) {
	return `${brandName ?? ''} ${name}`.trim()
}

// Returns the model a camera describes through its sensor, or undefined when the sensor is unknown or declares no size.
// A pixel size or an ADC bit depth out of range is left out.
function cameraModel(camera: AstrobinCamera, sensor: AstrobinSensor | undefined): CameraModel | undefined {
	if (!sensor || !Number.isInteger(sensor.pixelWidth) || sensor.pixelWidth <= 0 || !Number.isInteger(sensor.pixelHeight) || sensor.pixelHeight <= 0) return undefined
	const pixelSize = sensor.pixelSize ? +sensor.pixelSize : Number.NaN
	const bits = sensor.adc ?? Number.NaN
	const sensorName = fullName(sensor)

	return {
		model: fullName(camera),
		...(sensorName && { sensor: sensorName }),
		width: sensor.pixelWidth,
		height: sensor.pixelHeight,
		...(Number.isFinite(pixelSize) && pixelSize > 0 && { pixelSize }),
		...(Number.isInteger(bits) && bits > 0 && bits <= 32 && { bits }),
		...(sensor.colorOrMono && { color: sensor.colorOrMono === 'C' }),
	}
}

const force = process.argv.includes('--force')
const empty = process.argv.includes('--empty')
const current = await catalogInPlace()

if (!force && current !== undefined) {
	if (empty || current.source !== undefined) {
		console.info(`The camera model catalog (${current.models.length} models) already exists! Use --force to download it again.`)
		exit(0)
	}

	console.info('The camera model catalog is the empty placeholder; downloading the real one...')
}

await fs.mkdir(join(OUTPUT, '..'), { recursive: true })

if (empty) {
	const placeholder: CameraModelCatalog = { schema: CAMERA_MODEL_CATALOG_SCHEMA, generatedAt: new Date().toISOString(), models: [] }
	await writeAtomically(OUTPUT, Bun.gzipSync(JSON.stringify(placeholder)))
	console.info(`written an empty camera model catalog to ${OUTPUT}`)
	exit(0)
}

const sensorById = new Map((await readAll('sensors', sensors)).map((sensor) => [sensor.id, sensor]))
const models = new Map<string, CameraModel>()

for (const camera of await readAll('cameras', cameras)) {
	const model = camera.sensor === null ? undefined : cameraModel(camera, sensorById.get(camera.sensor))
	const key = model?.model.toLowerCase()
	if (model && key && !models.has(key)) models.set(key, model)
}

if (models.size === 0) throw new Error('No camera of AstroBin declares a sensor')

const sorted = [...models.values()].sort((a, b) => a.model.localeCompare(b.model, 'en', { sensitivity: 'base' }))
const catalog: CameraModelCatalog = { schema: CAMERA_MODEL_CATALOG_SCHEMA, generatedAt: new Date().toISOString(), source: BASE_URL, models: sorted }
await writeAtomically(OUTPUT, Bun.gzipSync(JSON.stringify(catalog)))
console.info(`written ${sorted.length} camera models to ${OUTPUT}`)
