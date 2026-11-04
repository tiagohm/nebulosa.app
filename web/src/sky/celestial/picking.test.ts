import { expect, test } from 'bun:test'
import { isPickableLayerId, movingBodyLayerId, objectLayerId } from './picking'
import type { MovingBody } from './types'

function body(type: MovingBody['type']): MovingBody {
	return { id: type, type, position: { rightAscension: 0, declination: 0 } }
}

test('artificial satellites have a layer of their own', () => {
	expect(movingBodyLayerId('satellite')).toBe('satellites')
	expect(movingBodyLayerId('mars')).toBe('movingBodies')
	expect(movingBodyLayerId('comet')).toBe('movingBodies')
	expect(objectLayerId({ type: 'movingBody', index: 0, object: body('satellite') })).toBe('satellites')
	expect(objectLayerId({ type: 'movingBody', index: 0, object: body('asteroid') })).toBe('movingBodies')
	expect(isPickableLayerId('satellites')).toBe(true)
})
