import { expect, test } from 'bun:test'
import { FRAME_COLOR_COUNT, frameColorIndex, frameSwatch, nextFrameColor } from './palette'

test('a new framing takes the first of the least used colours', () => {
	expect(nextFrameColor([])).toBe(0)
	expect(nextFrameColor([0, 1, 3])).toBe(2)
	expect(nextFrameColor([0, 1, 2, 3, 4, 5])).toBe(0)
	expect(nextFrameColor([0, 0, 1, 2, 3, 4, 5, 1])).toBe(2)
})

test('a colour folds into the tokens, and each camera of the Equipment Setup has its own swatch', () => {
	expect(frameColorIndex(FRAME_COLOR_COUNT + 2)).toBe(2)
	expect(frameColorIndex(-1)).toBe(FRAME_COLOR_COUNT - 1)
	expect(frameSwatch(3)).toBe('bg-frame-4')
	expect(frameSwatch('main')).toBe('bg-ink-100')
	expect(frameSwatch('guide')).toBe('bg-ink-300')
})
