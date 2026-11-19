import { expect, test } from 'bun:test'
import { SkyLabelSpace } from './labels'
import type { MovingBody, RenderState } from './types'

// A body whose screen position (pixels) is its right ascension and declination.
function body(id: string, type: MovingBody['type'], x: number, y: number, extra: Partial<MovingBody> = {}): MovingBody {
	return { id, type, name: id, position: { rightAscension: x, declination: y }, ...extra }
}

// Render state of a gnomonic 800 x 600 view at zoom 1 projecting a body at its right ascension and declination in
// pixels, and a context measuring 7 px per character.
function frame(movingBodies: readonly MovingBody[], frameNumber = 1, allSmallBodies = false) {
	const state = {
		frame: frameNumber,
		width: 800,
		height: 600,
		projection: 'gnomonic',
		transform: { k: 1, x: 0, y: 0 },
		theme: { fontFamily: 'sans-serif' },
		stars: { labels: false },
		movingBodies,
		allSmallBodies,
		celestial: { isLayerVisible: () => true },
		projectEquatorialToScreen: (rightAscension: number, declination: number, out: Float32Array) => {
			out[0] = rightAscension
			out[1] = declination
			return true
		},
	} as unknown as RenderState
	const ctx = { font: '', save: () => undefined, restore: () => undefined, measureText: (text: string) => ({ width: text.length * 7 }) } as unknown as CanvasRenderingContext2D
	return { state, ctx }
}

test('planets and looked-for bodies are always named; other asteroids only where they fit and bright enough', () => {
	const bodies = [
		body('Jupiter', 'jupiter', 100, 100),
		body('kernel-overlapping', 'asteroid', 102, 100, { magnitude: 6 }),
		body('kernel-free', 'asteroid', 400, 300, { magnitude: 6 }),
		body('kernel-faint', 'asteroid', 600, 300, { magnitude: 8.5 }),
		body('looked-for', 'asteroid', 103, 101, { magnitude: 20, alwaysVisible: true }),
	]
	const { state, ctx } = frame(bodies)
	const labels = new SkyLabelSpace().place(ctx, state)
	const out = new Float32Array(2)

	expect(labels.movingAt(0, out)).toBeDefined()
	expect(labels.movingAt(1, out)).toBeUndefined()
	expect(labels.movingAt(2, out)).toBeDefined()
	// Magnitude 8.5 is drawn at zoom 1 (limit 9) but not named (limit 7).
	expect(labels.movingAt(3, out)).toBeUndefined()
	// Placed after Jupiter, it moves around its body rather than being left out.
	expect(labels.movingAt(4, out)).toBeDefined()
})

test('drawing every asteroid keeps the faint ones unnamed', () => {
	const { state, ctx } = frame([body('faint', 'asteroid', 400, 300, { magnitude: 20 }), body('bright', 'asteroid', 100, 100, { magnitude: 6 })], 1, true)
	const labels = new SkyLabelSpace().place(ctx, state)
	const out = new Float32Array(2)

	expect(labels.movingAt(0, out)).toBeUndefined()
	expect(labels.movingAt(1, out)).toBeDefined()
})

test('a later frame forgets the names of the bodies that are gone', () => {
	const space = new SkyLabelSpace()
	const out = new Float32Array(2)
	const first = frame([body('Mars', 'mars', 100, 100), body('Venus', 'venus', 400, 300)], 1)
	expect(space.place(first.ctx, first.state).movingAt(1, out)).toBeDefined()

	const second = frame([body('Mars', 'mars', 100, 100)], 2)
	expect(space.place(second.ctx, second.state).movingAt(1, out)).toBeUndefined()
	expect(space.movingAt(0, out)).toBeDefined()
})
