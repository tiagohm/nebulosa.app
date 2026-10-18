import { expect, test } from 'bun:test'
import type { CelestialObject } from './celestial/celestial'
import { equatorialOfCelestialObject, hoverLabel, movingBodyId, refKey, refOfCelestialObject, selectionTargets } from './objects'
import { createRequestGuard } from './selection'

const star: CelestialObject = { type: 'star', index: 0, id: 32263, name: 'Sirius', mag: -1.44, rightAscension: 1.77, declination: -0.29 }
const unnamed: CelestialObject = { type: 'star', index: 1, id: 22509, name: '', mag: 4.35, rightAscension: 1.27, declination: 0.16 }
const dso: CelestialObject = { type: 'deepSky', index: 0, object: { id: 1000255, name: 'Andromeda Galaxy', type: 1, magnitude: 3.4, rightAscension: 0.19, declination: 0.72 } }
const mars: CelestialObject = { type: 'movingBody', index: 0, object: { id: 'body:499', type: 'mars', name: 'Mars', magnitude: 0.96, position: { rightAscension: 2.34, declination: 0.32 } } }
const ceres: CelestialObject = { type: 'movingBody', index: 1, object: { id: 'minor:20000001', type: 'asteroid', name: '1 Ceres', position: { rightAscension: 1.95, declination: 0.41 } } }

test('reference keys and moving body ids', () => {
	expect(refKey({ kind: 'catalog', id: 32263 })).toBe('catalog:32263')
	expect(refKey({ kind: 'body', code: '499' })).toBe('body:499')
	expect(refKey({ kind: 'minorBody', spkId: '20000001', designation: '1' })).toBe('minor:20000001')
	expect(movingBodyId({ kind: 'catalog', id: 1 })).toBeUndefined()
	expect(movingBodyId({ kind: 'body', code: '10' })).toBe('body:10')
})

test('references of picked objects', () => {
	expect(refOfCelestialObject(star)).toEqual({ kind: 'catalog', id: 32263 })
	expect(refOfCelestialObject(dso)).toEqual({ kind: 'catalog', id: 1000255 })
	expect(refOfCelestialObject(mars)).toEqual({ kind: 'body', code: '499' })
	expect(refOfCelestialObject(ceres)).toEqual({ kind: 'minorBody', spkId: '20000001', designation: '1 Ceres' })
	expect(refOfCelestialObject({ type: 'constellationLabel', index: 0, label: { name: 'Orion', rightAscension: 1.4, declination: 0.1 } })).toBeUndefined()
})

test('selection targets of references', () => {
	expect(selectionTargets({ kind: 'catalog', id: 32263 }, 'star')).toEqual([{ type: 'star', id: 32263 }])
	expect(selectionTargets({ kind: 'catalog', id: 1000255 })).toEqual([
		{ type: 'star', id: 1000255 },
		{ type: 'deepSky', id: 1000255 },
	])
	expect(selectionTargets({ kind: 'body', code: '499' })).toEqual([{ type: 'movingBody', id: 'body:499' }])
})

test('positions and hover labels of picked objects', () => {
	expect(equatorialOfCelestialObject(dso)).toEqual([0.19, 0.72])
	expect(equatorialOfCelestialObject(mars)).toEqual([2.34, 0.32])

	const names = { typeNames: ['Unknown', 'Galaxy'], starDesignations: ['Alp CMa', 'Pi-2 Ori'] }
	expect(hoverLabel(star, names)).toEqual({ name: 'Sirius', typeName: 'Star · Alp CMa', magnitude: -1.44 })
	expect(hoverLabel(unnamed, names)?.name).toBe('Pi-2 Ori')
	expect(hoverLabel(unnamed, { typeNames: [], starDesignations: [] })?.name).toBe('Star 22509')
	expect(hoverLabel(dso, names)).toEqual({ name: 'Andromeda Galaxy', typeName: 'Galaxy', magnitude: 3.4 })
	expect(hoverLabel(mars, names)).toEqual({ name: 'Mars', typeName: 'Planet', magnitude: 0.96 })
	expect(hoverLabel(ceres, names)?.typeName).toBe('Minor Body')
})

test('a newer request supersedes the previous one', () => {
	const guard = createRequestGuard()
	const a = guard.begin()
	const b = guard.begin()

	expect(a.signal.aborted).toBe(true)
	expect(a.current()).toBe(false)
	expect(b.current()).toBe(true)

	guard.cancel()
	expect(b.signal.aborted).toBe(true)
	expect(b.current()).toBe(false)
})
