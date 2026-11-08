import { expect, test } from 'bun:test'
import { type PixelRect, pixelRectBetween, rectangleSelection } from './rectangleSelection'

const IMAGE = { width: 100, height: 80 }
const VIEW = { scale: 2, visible: { x: 0, y: 0, width: 100, height: 80 } }

function selection() {
	const events: string[] = []
	const drafts: (PixelRect | undefined)[] = []
	const commits: PixelRect[] = []
	const interaction = rectangleSelection({
		image: () => IMAGE,
		onStart: () => events.push('start'),
		onDraft: (rect) => drafts.push(rect),
		onCommit: (rect) => commits.push(rect),
		onLeave: () => events.push('leave'),
	})
	return { interaction, events, drafts, commits }
}

test('covers the whole pixels of a box, clamped to the image', () => {
	expect(pixelRectBetween({ x: 10.2, y: 5.7 }, { x: 3.5, y: 9.1 }, IMAGE)).toEqual({ left: 3, top: 5, width: 8, height: 5 })
	expect(pixelRectBetween({ x: -5, y: -5 }, { x: 200, y: 200 }, IMAGE)).toEqual({ left: 0, top: 0, width: 100, height: 80 })
	expect(pixelRectBetween({ x: 4, y: 4 }, { x: 4, y: 9 }, IMAGE)).toBeUndefined()
	expect(pixelRectBetween({ x: 120, y: 5 }, { x: 130, y: 9 }, IMAGE)).toBeUndefined()
})

test('a drag inside the image previews and commits the rectangle', () => {
	const { interaction, events, drafts, commits } = selection()
	expect(interaction.onPointerDown({ x: 10.5, y: 10.5 }, VIEW)).toBeTrue()
	interaction.onPointerMove({ x: 20.5, y: 30.5 }, VIEW)
	interaction.onPointerUp({ x: 120, y: 30.5 }, VIEW)
	expect(events).toEqual(['start'])
	expect(drafts).toEqual([undefined, { left: 10, top: 10, width: 11, height: 21 }, undefined])
	expect(commits).toEqual([{ left: 10, top: 10, width: 90, height: 21 }])
})

test('a press outside the image pans, and a click selects nothing', () => {
	const { interaction, commits } = selection()
	expect(interaction.onPointerDown({ x: -1, y: 10 }, VIEW)).toBeFalse()
	expect(interaction.onPointerDown({ x: 10, y: 10 }, VIEW)).toBeTrue()
	interaction.onPointerUp({ x: 11, y: 10 }, VIEW)
	expect(commits).toEqual([])
})

test('a cancel drops the rectangle in progress, then leaves the selection', () => {
	const { interaction, events, drafts, commits } = selection()
	interaction.onPointerDown({ x: 10, y: 10 }, VIEW)
	interaction.onPointerMove({ x: 30, y: 30 }, VIEW)
	interaction.onCancel()
	interaction.onPointerUp({ x: 30, y: 30 }, VIEW)
	expect(drafts.at(-1)).toBeUndefined()
	expect(commits).toEqual([])
	interaction.onCancel()
	expect(events).toEqual(['start', 'leave'])
})
