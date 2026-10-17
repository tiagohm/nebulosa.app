// View geometry of the image viewer: how image pixels map to viewport pixels, and the zoom and pan
// operations on that mapping. Image coordinates have their origin at the top-left corner of the first
// pixel, with x growing right and y down, in image pixels; viewport coordinates are CSS pixels from the
// top-left corner of the viewport.

// Width and height, in pixels.
export interface Size {
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
}

// Point, in the pixels of its coordinate space.
export interface Point {
	// Horizontal coordinate, growing right.
	readonly x: number
	// Vertical coordinate, growing down.
	readonly y: number
}

// Mapping from image to viewport coordinates: viewport = image × scale + offset.
export interface ViewTransform {
	// Viewport pixels per image pixel; 1 shows the image at actual size.
	readonly scale: number
	// Viewport x of the image origin, in viewport pixels.
	readonly x: number
	// Viewport y of the image origin, in viewport pixels.
	readonly y: number
}

// Smallest scale, in viewport pixels per image pixel: a 64-fold reduction.
export const MIN_SCALE = 1 / 64

// Largest scale, in viewport pixels per image pixel: each image pixel 32 viewport pixels wide.
export const MAX_SCALE = 32

// Scale factor of one zoom-in step; zoom-out divides by it.
export const ZOOM_STEP = 1.25

// Identity transform, used before the viewport is measured.
export const IDENTITY: ViewTransform = { scale: 1, x: 0, y: 0 }

// Restricts a scale to [MIN_SCALE, MAX_SCALE].
export function clampScale(scale: number): number {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

// Returns the transform that shows an image at a scale, centered in the viewport.
export function centered(image: Size, viewport: Size, scale: number): ViewTransform {
	const s = clampScale(scale)
	return { scale: s, x: (viewport.width - image.width * s) / 2, y: (viewport.height - image.height * s) / 2 }
}

// Returns the transform that fits the whole image in the viewport, centered. An empty image or viewport
// gives the actual size.
export function fit(image: Size, viewport: Size): ViewTransform {
	if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return centered(image, viewport, 1)
	return centered(image, viewport, Math.min(viewport.width / image.width, viewport.height / image.height))
}

// Scales the view by factor around a viewport point, which keeps showing the same image point.
export function zoomAt(view: ViewTransform, factor: number, at: Point): ViewTransform {
	const scale = clampScale(view.scale * factor)
	const ratio = scale / view.scale
	return { scale, x: at.x - (at.x - view.x) * ratio, y: at.y - (at.y - view.y) * ratio }
}

// Moves the image by a distance in viewport pixels.
export function panBy(view: ViewTransform, dx: number, dy: number): ViewTransform {
	return { scale: view.scale, x: view.x + dx, y: view.y + dy }
}

// Returns the image point under a viewport point.
export function toImage(view: ViewTransform, point: Point): Point {
	return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale }
}

// Returns the integer coordinates of the image pixel containing an image point, or undefined when the
// point is outside the image.
export function pixelAt(image: Size, point: Point): Point | undefined {
	const x = Math.floor(point.x)
	const y = Math.floor(point.y)
	return x >= 0 && y >= 0 && x < image.width && y < image.height ? { x, y } : undefined
}
