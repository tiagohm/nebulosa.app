import { expect, test } from 'bun:test'
import type { TelescopeModel, TelescopeModelCatalog } from 'api'
import { loadTelescopeModels, searchTelescopeModels, telescopeModelDescription } from './telescopemodels'

const MODELS: readonly TelescopeModel[] = [
	{ model: 'Askar 103APO', aperture: 103, focalLength: 420, maxFocalLength: 700 },
	{ model: 'Sky-Watcher Esprit 100ED', aperture: 100, focalLength: 550 },
	{ model: 'Sky-Watcher Esprit 120ED', aperture: 120, focalLength: 840 },
	{ model: 'William Optics RedCat 51', focalLength: 250 },
]

test('search matches every word in the model name, in catalog order', () => {
	expect(searchTelescopeModels(MODELS, 'esprit').map((model) => model.model)).toEqual(['Sky-Watcher Esprit 100ED', 'Sky-Watcher Esprit 120ED'])
	expect(searchTelescopeModels(MODELS, 'skywatcher 100').map((model) => model.model)).toEqual(['Sky-Watcher Esprit 100ED'])
	expect(searchTelescopeModels(MODELS, 'esprit', 1)).toHaveLength(1)
	expect(searchTelescopeModels(MODELS, ' ')).toEqual([])
})

test('description lists the aperture, the focal length or its range, and the focal ratio', () => {
	expect(telescopeModelDescription(MODELS[1])).toBe('100 mm · 550 mm FL · f/5.5')
	expect(telescopeModelDescription(MODELS[0])).toBe('103 mm · 420–700 mm FL · f/4.1')
	expect(telescopeModelDescription(MODELS[3])).toBe('250 mm FL')
})

test('a catalog of another layout version is refused', async () => {
	const catalog: TelescopeModelCatalog = { schema: 2, generatedAt: '2026-11-17T00:00:00Z', models: MODELS }
	await expect(loadTelescopeModels('/telescopes.json.gz', () => Promise.resolve(new Response(Bun.gzipSync(JSON.stringify(catalog)))))).rejects.toThrow('Unsupported telescope model catalog version 2')
	expect(await loadTelescopeModels('/telescopes.json.gz', () => Promise.resolve(new Response(JSON.stringify({ ...catalog, schema: 1 }))))).toEqual(MODELS)
})
