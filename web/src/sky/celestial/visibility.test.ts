import { expect, test } from 'bun:test'
import type { MovingBody } from './types'
import { isMovingBodyVisibleAtZoom } from './visibility'

const halley: MovingBody = { id: 'minor:1000036', type: 'comet', name: '1P/Halley', magnitude: 25, position: { rightAscension: 2.2, declination: 0.1 } }

test('faint moving bodies are hidden unless always visible', () => {
	expect(isMovingBodyVisibleAtZoom(halley, 1)).toBeFalse()
	expect(isMovingBodyVisibleAtZoom(halley, 1000)).toBeFalse()
	expect(isMovingBodyVisibleAtZoom({ ...halley, alwaysVisible: true }, 1)).toBeTrue()
	expect(isMovingBodyVisibleAtZoom({ ...halley, magnitude: undefined }, 1)).toBeTrue()
})
