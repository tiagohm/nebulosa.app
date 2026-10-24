import { expect, test } from 'bun:test'
import type { CelestialObject } from './celestial/celestial'
import { isRememberable, type RememberedObject, RememberedObjects, REMEMBERED_SHAPE_TYPE, rememberedOf, rememberedShapeId } from './remembered'

function object(id: number): RememberedObject {
	return { ref: { kind: 'catalog', id }, key: `catalog:${id}`, name: `Star ${id}`, typeName: 'Star', rightAscension: 1, declination: 0.5 }
}

test('forgets the least recently remembered objects beyond the limit', () => {
	const remembered = new RememberedObjects(2)
	expect(remembered.remember(object(1))).toEqual([])
	expect(remembered.remember(object(2))).toEqual([])

	// Remembering the first again makes it the most recent, so the second is forgotten next.
	expect(remembered.remember(remembered.get('catalog:1')!)).toEqual([])
	expect(remembered.remember(object(3)).map((e) => e.key)).toEqual(['catalog:2'])
	expect([...remembered.values()].map((e) => e.key)).toEqual(['catalog:1', 'catalog:3'])
	expect(remembered.size).toBe(2)
})

test('remembers catalog objects and minor bodies only', () => {
	expect(isRememberable({ kind: 'catalog', id: 1 })).toBeTrue()
	expect(isRememberable({ kind: 'minorBody', spkId: '1', designation: '1' })).toBeTrue()
	expect(isRememberable({ kind: 'body', code: '499' })).toBeFalse()
	expect(isRememberable({ kind: 'constellation', code: 'ORI' })).toBeFalse()
	expect(isRememberable({ kind: 'mount', connectionId: 'c', id: 'm' })).toBeFalse()
})

test('remembered object of a picked shape', () => {
	const remembered = object(7)
	const shape: CelestialObject = { type: 'shape', id: rememberedShapeId(remembered.key), shape: { id: rememberedShapeId(remembered.key), type: REMEMBERED_SHAPE_TYPE, coordinate: remembered, data: { key: remembered.key, object: remembered }, render: () => {} } }
	expect(rememberedOf(shape)).toBe(remembered)
	expect(rememberedOf({ ...shape, shape: { ...shape.shape, type: 'other' } })).toBeUndefined()
})
