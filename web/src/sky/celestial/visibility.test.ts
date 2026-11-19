import { expect, test } from 'bun:test'
import { StellariumObjectType } from 'nebulosa/src/catalogs/stars/stellarium/nebulae'
import type { DeepSkyObject, MovingBody } from './types'
import { densityZoom, isDeepSkyObjectVisibleAtZoom, isMovingBodyVisibleAtZoom, isMovingLabelOptional } from './visibility'

const halley: MovingBody = { id: 'minor:1000036', type: 'comet', name: '1P/Halley', magnitude: 25, position: { rightAscension: 2.2, declination: 0.1 } }

test('faint moving bodies are hidden unless always visible', () => {
	expect(isMovingBodyVisibleAtZoom(halley, 1)).toBeFalse()
	expect(isMovingBodyVisibleAtZoom(halley, 1000)).toBeFalse()
	expect(isMovingBodyVisibleAtZoom({ ...halley, alwaysVisible: true }, 1)).toBeTrue()
	expect(isMovingBodyVisibleAtZoom({ ...halley, magnitude: undefined }, 1)).toBeTrue()
})

test('asteroids and comets reach fainter magnitudes than deep-sky objects as the view zooms in', () => {
	const eros: MovingBody = { id: 'minor:20000433', type: 'asteroid', name: '(433) Eros', magnitude: 15, position: { rightAscension: 1, declination: 0 } }
	expect(isMovingBodyVisibleAtZoom(eros, 1)).toBeFalse()
	expect(isMovingBodyVisibleAtZoom(eros, 16)).toBeTrue()
	expect(isMovingBodyVisibleAtZoom({ ...eros, magnitude: 21 }, 1000)).toBeTrue()
	expect(isMovingBodyVisibleAtZoom({ ...eros, type: 'jupiter', magnitude: 15 }, 16)).toBeFalse()
})

test('only the names of asteroids and comets not looked for are optional', () => {
	expect(isMovingLabelOptional(halley)).toBeTrue()
	expect(isMovingLabelOptional({ ...halley, alwaysVisible: true })).toBeFalse()
	expect(isMovingLabelOptional({ ...halley, type: 'mars' })).toBeFalse()
})

test('a small projection disk counts a proportionally lower zoom', () => {
	expect(densityZoom(1, 360)).toBe(1)
	expect(densityZoom(1, 900)).toBe(1)
	expect(densityZoom(2, 180)).toBe(1)
	expect(densityZoom(1, 10)).toBe(0.35)
})

test('a phone-sized disk draws fewer deep-sky objects than a desktop one at the same zoom', () => {
	const cluster: DeepSkyObject = { id: 1, name: 'NGC 2516', type: StellariumObjectType.UNKNOWN, magnitude: 6.5, rightAscension: 2.09, declination: -1.06 }
	expect(isDeepSkyObjectVisibleAtZoom(cluster, densityZoom(1, 400))).toBeTrue()
	expect(isDeepSkyObjectVisibleAtZoom(cluster, densityZoom(1, 150))).toBeFalse()
	expect(isDeepSkyObjectVisibleAtZoom(cluster, densityZoom(3, 150))).toBeTrue()
})
