// Outline colour of each framing, read once from the `frame-*` design tokens of `web/src/index.css`, for the canvases that
// draw framings (the Framing preview and the Sky), with the swatch class that shows the same colour in a legend. A
// framing takes the colour of its place in the list (frameColorIndex), so the preview, its legend, and the Sky agree.
// Outside a document (tests) every token reads a neutral gray.

// Number of framing colours, the `frame-1` to `frame-6` tokens.
export const FRAME_COLOR_COUNT = 6

// Swatch class of each framing colour, in token order; written out so Tailwind emits them.
export const FRAME_SWATCHES = ['bg-frame-1', 'bg-frame-2', 'bg-frame-3', 'bg-frame-4', 'bg-frame-5', 'bg-frame-6'] as const

// Value a token reads when no document defines it.
const FALLBACK = '#9c9a92'

// Colours read on first use; the tokens never change while the page runs (the interface is dark only).
let colors: readonly string[] | undefined

// Returns the index, 0 to FRAME_COLOR_COUNT − 1, of the colour of the framing at a place of the list (0 for the first).
export function frameColorIndex(position: number) {
	return ((position % FRAME_COLOR_COUNT) + FRAME_COLOR_COUNT) % FRAME_COLOR_COUNT
}

// Returns the CSS colour of the framing at a place of the list, reading the tokens of the document on first use.
export function frameColor(position: number) {
	if (!colors) {
		const style = typeof document === 'undefined' ? undefined : getComputedStyle(document.documentElement)
		colors = Array.from({ length: FRAME_COLOR_COUNT }, (_, i) => style?.getPropertyValue(`--color-frame-${i + 1}`).trim() || FALLBACK)
	}

	return colors[frameColorIndex(position)]
}

// Returns the swatch class of the framing at a place of the list.
export function frameSwatch(position: number) {
	return FRAME_SWATCHES[frameColorIndex(position)]
}
