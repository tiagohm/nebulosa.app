// Outline colour of each framing, read once from the `frame-*` design tokens of `web/src/index.css`, for the canvases that
// draw framings (the Framing preview and the Sky), with the swatch class that shows the same colour in a legend. A
// saved framing keeps the colour it was given when created (its `color`), so renaming one or adding another never
// repaints it; the Equipment Setup's pseudo-framing, which has none, draws in Starlight Cream (`ink-100`). Outside a
// document (tests) every token reads a neutral gray.

// Number of framing colours, the `frame-1` to `frame-6` tokens (FRAMING_COLOR_COUNT of the API, which checks the range).
export const FRAME_COLOR_COUNT = 6

// Swatch class of each framing colour, in token order; written out so Tailwind emits them.
export const FRAME_SWATCHES = ['bg-frame-1', 'bg-frame-2', 'bg-frame-3', 'bg-frame-4', 'bg-frame-5', 'bg-frame-6'] as const

// Swatch class of the Equipment Setup's pseudo-framing.
const SETUP_SWATCH = 'bg-ink-100'

// Value a token reads when no document defines it.
const FALLBACK = '#9c9a92'

// Colours read on first use, the framing tokens then Starlight Cream; the tokens never change while the page runs (the
// interface is dark only).
let colors: readonly string[] | undefined

// Returns the index, 0 to FRAME_COLOR_COUNT − 1, of a stored colour, folding one out of range into it.
export function frameColorIndex(color: number) {
	const index = Math.trunc(color)
	return ((index % FRAME_COLOR_COUNT) + FRAME_COLOR_COUNT) % FRAME_COLOR_COUNT
}

// Returns the CSS colour of a framing colour, or of the Equipment Setup's for undefined, reading the tokens of the
// document on first use.
export function frameColor(color: number | undefined) {
	if (!colors) {
		const style = typeof document === 'undefined' ? undefined : getComputedStyle(document.documentElement)
		const read = (token: string) => style?.getPropertyValue(token).trim() || FALLBACK
		colors = [...Array.from({ length: FRAME_COLOR_COUNT }, (_, i) => read(`--color-frame-${i + 1}`)), read('--color-ink-100')]
	}

	return colors[color === undefined ? FRAME_COLOR_COUNT : frameColorIndex(color)]
}

// Returns the swatch class of a framing colour, or of the Equipment Setup's for undefined.
export function frameSwatch(color: number | undefined) {
	return color === undefined ? SETUP_SWATCH : FRAME_SWATCHES[frameColorIndex(color)]
}

// Returns the colour to give a new framing: the first of the least used by the framings there are, so the first six
// framings never share one and later ones repeat the rarest.
export function nextFrameColor(used: readonly number[]) {
	const counts = Array.from({ length: FRAME_COLOR_COUNT }, () => 0)
	for (const color of used) counts[frameColorIndex(color)]++
	return counts.indexOf(Math.min(...counts))
}
