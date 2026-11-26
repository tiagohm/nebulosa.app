import { expect, test } from 'bun:test'
import type { Camera, Rotator } from 'nebulosa/src/devices/indi/device'
import { AppDatabase } from './database'
import { RotatorSenseStore } from './rotatorsense.store'

function device(name: string, patch: Partial<Rotator> = {}): Camera & Rotator {
	return { id: name, name, hardwareId: `hw:${name}`, type: 'camera', driver: { executable: 'indi_driver', version: '1' }, reversed: false, ...patch } as unknown as Camera & Rotator
}

test('a sense belongs to its kind, camera, rotator and reverse switch, and is replaced when learned again', () => {
	const store = new RotatorSenseStore(AppDatabase.memory())
	const camera = device('Camera')
	const rotator = device('Rotator')

	expect(store.get('positionAngle', camera, rotator)).toBeUndefined()
	store.learned('positionAngle', camera, rotator, -1, 'FLIPPED', 0.98, 1000)
	expect(store.get('positionAngle', camera, rotator)).toEqual({ sense: -1, parity: 'FLIPPED', gain: 0.98, learnedAt: 1000 })
	expect(store.get('guideImage', camera, rotator)).toBeUndefined()
	expect(store.get('positionAngle', device('Other Camera'), rotator)).toBeUndefined()
	expect(store.get('positionAngle', camera, device('Rotator', { reversed: true }))).toBeUndefined()

	store.confirmed('positionAngle', camera, rotator, 2000)
	expect(store.get('positionAngle', camera, rotator)?.lastUsedAt).toBe(2000)

	store.learned('positionAngle', camera, rotator, 1, undefined, undefined, 3000)
	expect(store.get('positionAngle', camera, rotator)).toEqual({ sense: 1, learnedAt: 3000 })
})

test('the offset is written only on a stored sense, reduced to a half turn, and cleared when the sense is learned again', () => {
	const store = new RotatorSenseStore(AppDatabase.memory())
	const camera = device('Camera')
	const rotator = device('Rotator')
	store.offsetMeasured(camera, rotator, 10, 1000)
	expect(store.get('positionAngle', camera, rotator)).toBeUndefined()

	store.learned('positionAngle', camera, rotator, 1, 'NORMAL', 1, 1000)
	store.offsetMeasured(camera, rotator, -170, 2000)
	expect(store.get('positionAngle', camera, rotator)?.offset).toBeCloseTo(10, 9)
	store.offsetMeasured(camera, rotator, 370, 3000)
	expect(store.get('positionAngle', camera, rotator)?.offset).toBeCloseTo(10, 9)

	store.learned('positionAngle', camera, rotator, -1, 'NORMAL', 1, 4000)
	expect(store.get('positionAngle', camera, rotator)?.offset).toBeUndefined()
})

test('a sense learned with another driver of the rotator is ignored', () => {
	const store = new RotatorSenseStore(AppDatabase.memory())
	const camera = device('Camera')
	const rotator = device('Rotator')
	store.learned('guideImage', camera, rotator, 1, undefined, 1, 1000)
	expect(store.get('guideImage', camera, device('Rotator', { driver: { executable: 'indi_other' } as Rotator['driver'] }))).toBeUndefined()
})
