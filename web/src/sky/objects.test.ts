import { expect, test } from 'bun:test'
import type { CelestialObject } from './celestial/celestial'
import { hoverLabel, movingBodyId, refKey, refOfCelestialObject, selectionTargets } from './objects'
import { type RememberedObject, REMEMBERED_SHAPE_TYPE, rememberedShapeId } from './remembered'
import { createRequestGuard } from './selection'

const star: CelestialObject = { type: 'star', index: 0, id: 32263, name: 'Sirius', mag: -1.44, rightAscension: 1.77, declination: -0.29 }
const unnamed: CelestialObject = { type: 'star', index: 1, id: 22509, name: '', mag: 4.35, rightAscension: 1.27, declination: 0.16 }
const dso: CelestialObject = { type: 'deepSky', index: 0, object: { id: 1000255, name: 'Andromeda Galaxy', type: 1, magnitude: 3.4, rightAscension: 0.19, declination: 0.72 } }
const mars: CelestialObject = { type: 'movingBody', index: 0, object: { id: 'body:499', type: 'mars', name: 'Mars', magnitude: 0.96, position: { rightAscension: 2.34, declination: 0.32 } } }
const names = {
	typeNames: ['Unknown', 'Galaxy'],
	starDesignations: ['Alp CMa', 'Pi-2 Ori'],
	constellationCodes: new Map([
		['Serpens Caput', 'SER'],
		['Serpens Cauda', 'SER'],
		['Orion', 'ORI'],
	]),
}
const ceres: CelestialObject = { type: 'movingBody', index: 1, object: { id: 'minor:20000001', type: 'asteroid', name: '1 Ceres', position: { rightAscension: 1.95, declination: 0.41 } } }

test('reference keys and moving body ids', () => {
	expect(refKey({ kind: 'catalog', id: 32263 })).toBe('catalog:32263')
	expect(refKey({ kind: 'body', code: '499' })).toBe('body:499')
	expect(refKey({ kind: 'minorBody', spkId: '20000001', designation: '1' })).toBe('minor:20000001')
	expect(movingBodyId({ kind: 'catalog', id: 1 })).toBeUndefined()
	expect(movingBodyId({ kind: 'body', code: '10' })).toBe('body:10')
	expect(refKey({ kind: 'constellation', code: 'ORI' })).toBe('constellation:ORI')
	expect(movingBodyId({ kind: 'constellation', code: 'ORI' })).toBeUndefined()
})

test('references of picked objects', () => {
	expect(refOfCelestialObject(star, names)).toEqual({ kind: 'catalog', id: 32263 })
	expect(refOfCelestialObject(dso, names)).toEqual({ kind: 'catalog', id: 1000255 })
	expect(refOfCelestialObject(mars, names)).toEqual({ kind: 'body', code: '499' })
	expect(refOfCelestialObject(ceres, names)).toEqual({ kind: 'minorBody', spkId: '20000001', designation: '1 Ceres' })
	expect(refOfCelestialObject({ type: 'constellationLabel', index: 0, label: { name: 'Serpens Cauda', rightAscension: 4.8, declination: -0.1 } }, names)).toEqual({ kind: 'constellation', code: 'SER' })
	expect(refOfCelestialObject({ type: 'constellationLabel', index: 0, label: { name: 'Nowhere', rightAscension: 0, declination: 0 } }, names)).toBeUndefined()
})

test('selection targets of references', () => {
	expect(selectionTargets({ kind: 'catalog', id: 32263 }, 'star', names)).toEqual([
		{ type: 'star', id: 32263 },
		{ type: 'shape', id: 'remembered:catalog:32263' },
	])
	expect(selectionTargets({ kind: 'catalog', id: 1000255 }, undefined, names)).toEqual([
		{ type: 'star', id: 1000255 },
		{ type: 'deepSky', id: 1000255 },
		{ type: 'shape', id: 'remembered:catalog:1000255' },
	])
	expect(selectionTargets({ kind: 'body', code: '499' }, 'solarSystem', names)).toEqual([{ type: 'movingBody', id: 'body:499' }])
	expect(selectionTargets({ kind: 'constellation', code: 'SER' }, 'constellation', names)).toEqual([
		{ type: 'constellationLabel', id: 'Serpens Caput' },
		{ type: 'constellationLabel', id: 'Serpens Cauda' },
	])
})

test('remembered catalog objects are picked and labeled from their shape', () => {
	const remembered: RememberedObject = { ref: { kind: 'catalog', id: 900001 }, key: 'catalog:900001', name: 'HD 1234', typeName: 'Star', category: 'star', rightAscension: 1, declination: 0.2, magnitude: 9.1 }
	const id = rememberedShapeId(remembered.key)
	const shape: CelestialObject = { type: 'shape', id, shape: { id, type: REMEMBERED_SHAPE_TYPE, coordinate: remembered, data: { key: remembered.key, object: remembered }, render: () => {} } }
	expect(refOfCelestialObject(shape, names)).toEqual({ kind: 'catalog', id: 900001 })
	expect(hoverLabel(shape, names)).toEqual({ name: 'HD 1234', typeName: 'Star', magnitude: 9.1 })
})

test('hover labels of picked objects', () => {
	expect(hoverLabel(star, names)).toEqual({ name: 'Sirius', typeName: 'Star · Alp CMa', magnitude: -1.44 })
	expect(hoverLabel(unnamed, names)?.name).toBe('Pi-2 Ori')
	expect(hoverLabel(unnamed, { ...names, starDesignations: [] })?.name).toBe('Star 22509')
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
