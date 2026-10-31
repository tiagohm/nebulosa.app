import { describe, expect, test } from 'bun:test'
import { type GestureEvent, type GestureState, IDLE_GESTURE, isPanning, routeGesture } from './interaction'

const TOLERANCE = 4

// Applies events in order and returns the last state and every effect.
function run(events: readonly GestureEvent[], state: GestureState = IDLE_GESTURE) {
	const effects = []

	for (const event of events) {
		const step = routeGesture(state, event, TOLERANCE)
		state = step.state
		effects.push(step.effect)
	}

	return { state, effects }
}

const at = (x: number, y = 0) => ({ x, y })

describe('pan', () => {
	test('a press released within the tolerance is a click', () => {
		const { state, effects } = run([
			{ type: 'down', id: 1, at: at(0), tool: false },
			{ type: 'move', id: 1, at: at(3) },
			{ type: 'up', id: 1 },
		])

		expect(effects).toEqual([undefined, 'pan', 'click'])
		expect(state).toEqual(IDLE_GESTURE)
	})

	test('a drag is never a click', () => {
		const { effects } = run([
			{ type: 'down', id: 1, at: at(0), tool: false },
			{ type: 'move', id: 1, at: at(10) },
			{ type: 'move', id: 1, at: at(1) },
			{ type: 'up', id: 1 },
		])

		expect(effects).toEqual([undefined, 'pan', 'pan', undefined])
	})

	test('a cancelled press is not a click', () => {
		expect(
			run([
				{ type: 'down', id: 1, at: at(0), tool: false },
				{ type: 'cancel', id: 1 },
			]).effects,
		).toEqual([undefined, undefined])
	})

	test('moves without a press are hovers', () => {
		expect(run([{ type: 'move', id: 1, at: at(0) }]).effects).toEqual(['hover'])
	})
})

describe('dragging', () => {
	const down: GestureEvent = { type: 'down', id: 1, at: at(0), tool: false }

	test('a press is not a drag until it leaves the tolerance, and a release ends it', () => {
		expect(isPanning(IDLE_GESTURE)).toBeFalse()
		expect(isPanning(run([down]).state)).toBeFalse()
		expect(isPanning(run([down, { type: 'move', id: 1, at: at(TOLERANCE) }]).state)).toBeFalse()
		expect(isPanning(run([down, { type: 'move', id: 1, at: at(TOLERANCE + 1) }]).state)).toBeTrue()
		expect(isPanning(run([down, { type: 'move', id: 1, at: at(TOLERANCE + 1) }, { type: 'up', id: 1 }]).state)).toBeFalse()
	})

	test('a press the tool took never drags the image', () => {
		expect(
			isPanning(
				run([
					{ ...down, tool: true },
					{ type: 'move', id: 1, at: at(50) },
				]).state,
			),
		).toBeFalse()
	})

	test('a pinch does not drag the image', () => {
		expect(isPanning(run([down, { type: 'down', id: 2, at: at(10), tool: false }]).state)).toBeFalse()
	})
})

describe('tool', () => {
	test('owns the press it took, including a press that does not move', () => {
		const { effects } = run([
			{ type: 'down', id: 1, at: at(0), tool: true },
			{ type: 'move', id: 1, at: at(20) },
			{ type: 'up', id: 1 },
			{ type: 'down', id: 2, at: at(0), tool: true },
			{ type: 'up', id: 2 },
		])

		expect(effects).toEqual([undefined, 'toolMove', 'toolUp', undefined, 'toolUp'])
	})

	test('is cancelled by a second pointer, which pinches until every pointer is lifted', () => {
		const { state, effects } = run([
			{ type: 'down', id: 1, at: at(0), tool: true },
			{ type: 'move', id: 1, at: at(10) },
			{ type: 'down', id: 2, at: at(50), tool: false },
			{ type: 'move', id: 2, at: at(60) },
			{ type: 'up', id: 2 },
			{ type: 'move', id: 1, at: at(30) },
			{ type: 'up', id: 1 },
		])

		expect(effects).toEqual([undefined, 'toolMove', 'toolCancel', 'pinch', undefined, 'pinch', undefined])
		expect(state).toEqual(IDLE_GESTURE)
	})

	test('is cancelled by a cancelled or lost pointer', () => {
		expect(
			run([
				{ type: 'down', id: 1, at: at(0), tool: true },
				{ type: 'cancel', id: 1 },
			]).effects,
		).toEqual([undefined, 'toolCancel'])
	})
})

describe('pinch', () => {
	test('a second pointer during a pan pinches and never clicks', () => {
		const { effects } = run([
			{ type: 'down', id: 1, at: at(0), tool: false },
			{ type: 'down', id: 2, at: at(40), tool: false },
			{ type: 'up', id: 1 },
			{ type: 'up', id: 2 },
		])

		expect(effects).toEqual([undefined, 'pinch', undefined, undefined])
	})

	test('ignores a pointer pressed twice', () => {
		const first = run([{ type: 'down', id: 1, at: at(0), tool: false }])

		expect(routeGesture(first.state, { type: 'down', id: 1, at: at(0), tool: false }, TOLERANCE)).toEqual({ state: first.state, effect: undefined })
	})
})
