import { describe, expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { createFramingRoutes, FIELD_MAX_DEEP_SKY, FIELD_MAX_STARS, type FramingEvent, type FramingSaveRequest, FramingService, FramingStore, fieldMagnitudeLimit } from './framings'
import type { FieldQuery } from './sky/catalog'

const DEG = Math.PI / 180

const REFRACTOR: FramingSaveRequest = {
	name: 'Refractor + ASI2600',
	optics: {
		telescope: { source: 'model', model: 'William Optics RedCat 51', focalLength: 250, aperture: 51, focalMultiplier: 1 },
		camera: { source: 'setup', role: 'MAIN_CAMERA', sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 } },
	},
	rotation: 90,
	revision: 0,
}

function setup() {
	const events: FramingEvent[] = []
	const queries: FieldQuery[] = []
	const store = new FramingStore(AppDatabase.memory())
	const service = new FramingService({
		store,
		field: (query) => {
			queries.push(query)
			return { stars: [], deepSky: [], truncated: false }
		},
		listener: (event) => events.push(event),
	})
	return { store, service, events, queries, routes: createFramingRoutes(service) }
}

describe('store', () => {
	test('creates, reads back, and edits with a new revision', () => {
		const { store } = setup()
		expect(store.save('f1', REFRACTOR, 1000)).toEqual({ status: 'saved', framing: { id: 'f1', name: REFRACTOR.name, optics: REFRACTOR.optics, rotation: 90, revision: 1, createdAt: 1000, updatedAt: 1000 } })
		expect(store.save('f1', { ...REFRACTOR, name: '  Renamed  ', rotation: 12.5, revision: 1 }, 2000)).toMatchObject({ status: 'saved', framing: { name: 'Renamed', rotation: 12.5, revision: 2, createdAt: 1000, updatedAt: 2000 } })
		expect(store.list()).toEqual([store.get('f1')!])
	})

	test('refuses an outdated revision and keeps the stored framing', () => {
		const { store } = setup()
		store.save('f1', REFRACTOR)
		const stored = store.get('f1')!
		expect(store.save('f1', { ...REFRACTOR, name: 'Stale', revision: 0 })).toEqual({ status: 'conflict', current: stored })
		expect(store.save('f2', { ...REFRACTOR, revision: 4 })).toEqual({ status: 'conflict', current: null })
		expect(store.get('f1')).toEqual(stored)
	})

	test('refuses a name another framing has without regard to case', () => {
		const { store } = setup()
		store.save('f1', REFRACTOR)
		expect(store.save('f2', { ...REFRACTOR, name: 'refractor + asi2600 ' })).toEqual({ status: 'nameTaken' })
		expect(store.save('f1', { ...REFRACTOR, name: 'REFRACTOR + ASI2600', revision: 1 })).toMatchObject({ status: 'saved' })
	})

	test('lists by name, duplicates, and removes from the stored revision', () => {
		const { store } = setup()
		store.save('b', { ...REFRACTOR, name: 'Wide' })
		store.save('a', { ...REFRACTOR, name: 'narrow' })
		expect(store.list().map((e) => e.name)).toEqual(['narrow', 'Wide'])

		expect(store.duplicate('b', 'c', 'Wide copy', 5000)).toMatchObject({ status: 'saved', framing: { id: 'c', name: 'Wide copy', optics: REFRACTOR.optics, revision: 1, createdAt: 5000 } })
		expect(store.duplicate('b', 'd', 'narrow')).toEqual({ status: 'nameTaken' })
		expect(store.duplicate('b', 'a', 'Other')).toMatchObject({ status: 'conflict', current: { id: 'a' } })
		expect(store.duplicate('x', 'e', 'Other')).toEqual({ status: 'notFound' })

		expect(store.remove('a', 2)).toMatchObject({ status: 'conflict', current: { id: 'a' } })
		expect(store.remove('a', 1)).toEqual({ status: 'removed' })
		expect(store.remove('a', 1)).toEqual({ status: 'notFound' })
	})
})

describe('routes', () => {
	test('save, list, conflict, name, duplicate, and delete publish only what committed', async () => {
		const { routes, events } = setup()
		const put = (id: string, body: unknown) => routes['/api/framings/:id'].PUT(Object.assign(new Request(`http://localhost/api/framings/${id}`, { method: 'PUT', body: JSON.stringify(body) }), { params: { id } }) as never)

		const created = await put('f1', REFRACTOR)
		expect(created.status).toBe(200)
		expect(await created.json()).toMatchObject({ id: 'f1', revision: 1 })

		const stale = await put('f1', REFRACTOR)
		expect(stale.status).toBe(409)
		expect(await stale.json()).toMatchObject({ code: 'conflict', framing: { id: 'f1', revision: 1 } })

		const taken = await put('f2', REFRACTOR)
		expect(taken.status).toBe(409)
		expect(await taken.json()).toMatchObject({ code: 'nameTaken' })

		const list = routes['/api/framings'].GET()
		expect(await list.json()).toMatchObject({ framings: [{ id: 'f1' }] })

		const duplicate = await routes['/api/framings/:id/duplicate'].POST(Object.assign(new Request('http://localhost/api/framings/f1/duplicate', { method: 'POST', body: JSON.stringify({ id: 'f2', name: 'Copy' }) }), { params: { id: 'f1' } }) as never)
		expect(duplicate.status).toBe(200)

		const remove = (revision: number) => routes['/api/framings/:id'].DELETE(Object.assign(new Request(`http://localhost/api/framings/f1?revision=${revision}`, { method: 'DELETE' }), { params: { id: 'f1' } }) as never)
		expect(remove(3).status).toBe(409)
		expect(remove(1).status).toBe(204)
		expect(remove(1).status).toBe(404)

		expect(events.map((e) => (e.type === 'framing:updated' ? `${e.type} ${e.framing.id}` : `${e.type} ${e.id}`))).toEqual(['framing:updated f1', 'framing:updated f2', 'framing:removed f1'])
	})

	test('field asks the catalog for the cone with the limits of its radius', async () => {
		const { routes, queries } = setup()
		const body = { rightAscension: 1.2, declination: -0.3, radius: 2 * DEG }
		const response = await routes['/api/framings/field'].POST(new Request('http://localhost/api/framings/field', { method: 'POST', body: JSON.stringify(body) }) as never)
		const magnitudeLimit = fieldMagnitudeLimit(2 * DEG)

		expect(await response.json()).toEqual({ stars: [], deepSky: [], truncated: false, magnitudeLimit })
		expect(queries).toHaveLength(1)
		expect(queries[0]).toMatchObject({ ...body, magnitudeLimit, maxStars: FIELD_MAX_STARS, maxDeepSky: FIELD_MAX_DEEP_SKY })
		expect(queries[0].time).toBeNumber()
	})
})

test('field magnitude limit follows the radius within its bounds', () => {
	expect(fieldMagnitudeLimit(1 * DEG)).toBeCloseTo(9, 12)
	expect(fieldMagnitudeLimit(10 * DEG)).toBeCloseTo(6.5, 12)
	expect(fieldMagnitudeLimit(0.1 * DEG)).toBeCloseTo(11.5, 12)
	expect(fieldMagnitudeLimit(90 * DEG)).toBe(6)
	expect(fieldMagnitudeLimit(1e-6)).toBe(14)
})
