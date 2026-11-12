import { expect, test } from 'bun:test'
import { mountMotion } from './mountActivity'

const still = { parking: false, homing: false, moving: false, slewing: false }

test('a mount without motion flags reports no motion', () => {
	expect(mountMotion(still)).toBeUndefined()
})

test('slewing alone is a goto or flip', () => {
	expect(mountMotion({ ...still, slewing: true })).toBe('Slewing')
})

test('the flag naming the cause wins over the broad slewing flag', () => {
	expect(mountMotion({ ...still, moving: true, slewing: true })).toBe('Moving')
	expect(mountMotion({ ...still, homing: true, slewing: true })).toBe('Homing')
	expect(mountMotion({ ...still, parking: true, slewing: true })).toBe('Parking')
})

test('parking wins over homing, and homing over a manual motion', () => {
	expect(mountMotion({ ...still, parking: true, homing: true })).toBe('Parking')
	expect(mountMotion({ ...still, homing: true, moving: true })).toBe('Homing')
})
