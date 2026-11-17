import { expect, test } from 'bun:test'
import type { CameraModel, CameraModelCatalog } from 'api'
import { cameraModelDescription, loadCameraModels, modelCfa, searchCameraModels } from './cameramodels'
import { searchKey } from './models'

const MODELS: readonly CameraModel[] = [
	{ model: 'QHY 268M', sensor: 'Sony IMX571 (mono)', width: 6280, height: 4210, pixelSize: 3.76, bits: 16, color: false },
	{ model: 'ZWO ASI2600MC Pro', sensor: 'Sony IMX571 (color)', width: 6248, height: 4176, pixelSize: 3.76, bits: 16, color: true },
	{ model: 'ZWO ASI2600MM Pro', sensor: 'Sony IMX571 (mono)', width: 6248, height: 4176, pixelSize: 3.76, bits: 16, color: false },
	{ model: 'ZWO ASI120MM', width: 1280, height: 960 },
]

test('search key keeps only letters and digits', () => {
	expect(searchKey('ASI 2600-MM Pro')).toBe('asi2600mmpro')
})

test('search matches every word in the model or sensor name, in catalog order', () => {
	expect(searchCameraModels(MODELS, 'asi 2600').map((model) => model.model)).toEqual(['ZWO ASI2600MC Pro', 'ZWO ASI2600MM Pro'])
	expect(searchCameraModels(MODELS, 'ASI-2600MM').map((model) => model.model)).toEqual(['ZWO ASI2600MM Pro'])
	expect(searchCameraModels(MODELS, 'imx571 mono').map((model) => model.model)).toEqual(['QHY 268M', 'ZWO ASI2600MM Pro'])
	expect(searchCameraModels(MODELS, 'zwo', 2)).toHaveLength(2)
	expect(searchCameraModels(MODELS, '   ')).toEqual([])
	expect(searchCameraModels(MODELS, 'canon')).toEqual([])
})

test('a mono model clears the CFA, a color one keeps it or takes RGGB, an unknown one keeps it', () => {
	expect(modelCfa({ color: false }, 'BGGR')).toBeUndefined()
	expect(modelCfa({ color: true }, 'BGGR')).toBe('BGGR')
	expect(modelCfa({ color: true }, undefined)).toBe('RGGB')
	expect(modelCfa({}, 'GRBG')).toBe('GRBG')
	expect(modelCfa({}, undefined)).toBeUndefined()
})

test('description lists what the model declares', () => {
	expect(cameraModelDescription(MODELS[1])).toBe('Sony IMX571 (color) · 6248 × 4176 · 3.76 µm · 16 bits · Color')
	expect(cameraModelDescription(MODELS[3])).toBe('1280 × 960')
})

test('loads a gzipped catalog once, and again after a failure', async () => {
	const catalog: CameraModelCatalog = { schema: 1, generatedAt: '2026-11-15T00:00:00Z', source: 'https://www.astrobin.com/', models: MODELS }
	let requests = 0
	let fail = true

	const request = () => {
		requests++
		return Promise.resolve(fail ? new Response('missing', { status: 404 }) : new Response(Bun.gzipSync(JSON.stringify(catalog))))
	}

	await expect(loadCameraModels('/cameras.json.gz', request)).rejects.toThrow('404')
	fail = false
	expect(await loadCameraModels('/cameras.json.gz', request)).toEqual(MODELS)
	expect(await loadCameraModels('/cameras.json.gz', request)).toEqual(MODELS)
	expect(requests).toBe(2)
})
