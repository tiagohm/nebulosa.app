import type { FramingCutoutRequest, FramingField, FramingFieldRequest } from 'api'
import { type FramePoint, frameHalfExtent, fromTangentPlane, type TangentPoint, toTangentPlane } from '../../framing/geometry'
import { type ApiFetch, ApiResponseError, browserFetch, fetchJson, jsonInit, responseError } from '../../http'

// Layout of the preview of the Framing tool: one north-up gnomonic view of a fixed J2000 center, east on the left, scaled
// so the largest framing, turned by its rotation, fits with a margin. The same view frames the stars and deep-sky objects
// of the catalog (the Mini-Sky) and a hips2fits cutout of a survey, which is a TAN image of the same center whose field
// angle `fov` spans the larger side as the tangent-plane extent 2·tan(fov/2), so the outlines are drawn on either without
// a WCS. Turning a framing changes the scale of the view, so the cutout and the catalog field are asked for the canvas at
// the smallest scale any rotation of the fitted framings gives, with the detail of the largest one, and the cutout is
// cropped to the view: two TAN images of the same center and orientation differ only by a linear scale of the tangent
// plane, so the crop is exact and turning a framing asks for nothing. Every framing is centered on the view, so the top
// edge of one points from the center of the canvas along its position angle, where its rotation handle sits. Pixel
// coordinates are CSS pixels of the canvas, origin at its top-left corner, x right and y down.

// Room left around the largest framing, as a factor of its half extent.
export const PREVIEW_MARGIN = 1.25

// Tangent-plane half extent of the view when no framing can be drawn: 1° on the shorter side.
const DEFAULT_HALF_EXTENT = Math.tan(Math.PI / 360)

// Largest side of a requested cutout, in pixels, so a large screen does not ask hips2fits for a huge image.
export const MAX_CUTOUT_SIZE = 1600

// Fraction of the detail of a fresh cutout below which a cutout already read is asked again, in (0, 1]: a canvas grown a
// little reuses its cutout, magnified by at most 1/CUTOUT_DETAIL_SLACK.
export const CUTOUT_DETAIL_SLACK = 0.8

// Relative tolerance of the comparison of tangent-plane extents, so rounding never refuses a cutout of the same view.
const EXTENT_TOLERANCE = 1e-6

// Field of view of a framing drawn in the preview.
export interface PreviewFrame {
	// Angular width, in radians.
	readonly width: number
	// Angular height, in radians.
	readonly height: number
	// Position angle of the top edge, north through east, in radians.
	readonly rotation: number
}

// Scale of the preview for a canvas size.
export interface PreviewLayout {
	// Width of the canvas, in CSS pixels.
	readonly width: number
	// Height of the canvas, in CSS pixels.
	readonly height: number
	// Pixels per tangent-plane unit.
	readonly scale: number
	// Smallest scale any rotation of the same frames gives, in pixels per tangent-plane unit (at most scale): the canvas
	// at this scale covers the view of every rotation, so it is the extent of a cutout and of the catalog field.
	readonly coverScale: number
	// Largest scale any rotation of the same frames gives, in pixels per tangent-plane unit (at least scale): the detail
	// a cutout needs for every rotation.
	readonly detailScale: number
	// Radius of the cone that holds the whole canvas at coverScale, in radians: the field asked of the catalog.
	readonly radius: number
}

// Returns the scale of a preview of a canvas size (CSS pixels, both > 0) that fits every frame turned by its rotation
// with PREVIEW_MARGIN, 1° on the shorter side without a frame, and the bounds of that scale over every rotation of the
// frames: a frame's half extent along either axis lies between its smaller half side and its half diagonal.
export function previewLayout(width: number, height: number, frames: readonly PreviewFrame[]): PreviewLayout {
	let halfXi = 0
	let halfEta = 0
	let halfDiagonal = 0
	let halfSide = 0

	for (const frame of frames) {
		const extent = frameHalfExtent(frame.width, frame.height, frame.rotation)
		const halfWidth = Math.tan(frame.width / 2)
		const halfHeight = Math.tan(frame.height / 2)
		halfXi = Math.max(halfXi, extent.xi)
		halfEta = Math.max(halfEta, extent.eta)
		halfDiagonal = Math.max(halfDiagonal, Math.hypot(halfWidth, halfHeight))
		halfSide = Math.max(halfSide, Math.min(halfWidth, halfHeight))
	}

	const shorter = Math.min(width, height) / 2

	if (halfXi <= 0 || halfEta <= 0) {
		const scale = shorter / DEFAULT_HALF_EXTENT
		return { width, height, scale, coverScale: scale, detailScale: scale, radius: Math.atan(Math.hypot(width, height) / scale / 2) }
	}

	const scale = Math.min(width / 2 / (halfXi * PREVIEW_MARGIN), height / 2 / (halfEta * PREVIEW_MARGIN))
	const coverScale = Math.min(scale, shorter / (halfDiagonal * PREVIEW_MARGIN))
	const detailScale = Math.max(scale, shorter / (halfSide * PREVIEW_MARGIN))
	return { width, height, scale, coverScale, detailScale, radius: Math.atan(Math.hypot(width, height) / coverScale / 2) }
}

// Returns the canvas point of a point of the tangent plane: east to the left, north up.
export function canvasPoint(layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>, point: TangentPoint): { readonly x: number; readonly y: number } {
	return { x: layout.width / 2 - point.xi * layout.scale, y: layout.height / 2 - point.eta * layout.scale }
}

// Returns the J2000 position (radians) of a canvas point of a view of a center: the inverse of projectPosition.
export function skyPosition(layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>, center: FramePoint, x: number, y: number): FramePoint {
	const xi = (layout.width / 2 - x) / layout.scale
	const eta = (layout.height / 2 - y) / layout.scale
	return fromTangentPlane(center.rightAscension, Math.sin(center.declination), Math.cos(center.declination), xi, eta)
}

// Returns the position angle, in degrees in [0, 360) from north through east, of the direction from the center of the
// canvas to a canvas point; 0 at the center itself.
export function positionAngleAt(layout: Pick<PreviewLayout, 'width' | 'height'>, x: number, y: number) {
	const dx = x - layout.width / 2
	const dy = y - layout.height / 2
	if (dx === 0 && dy === 0) return 0
	// North is up (−y) and east is left (−x).
	const angle = (Math.atan2(-dx, -dy) * 180) / Math.PI
	return (angle + 360) % 360
}

// Distance in CSS pixels between the top edge of a framing and its rotation handle, outside the outline.
export const HANDLE_OFFSET = 14

// Returns the canvas point of the rotation handle of a framing of an angular height (radians, below π) turned by a
// position angle (radians): HANDLE_OFFSET pixels beyond the middle of its top edge.
export function rotationHandle(layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>, height: number, rotation: number) {
	const distance = Math.tan(height / 2) * layout.scale + HANDLE_OFFSET
	return { x: layout.width / 2 - Math.sin(rotation) * distance, y: layout.height / 2 - Math.cos(rotation) * distance }
}

// Returns a rotation in degrees snapped to a step (degrees, > 0) and brought into [0, 360).
export function snapRotation(degrees: number, step: number) {
	const snapped = Math.round(degrees / step) * step
	return Number((((snapped % 360) + 360) % 360).toFixed(6))
}

// Box of a label drawn on the canvas, in CSS pixels.
export interface LabelBox {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

// Places a label among the ones already placed (changed in place): false, placing nothing, when it would overlap one of
// them or leave a canvas of a width and height, so crowded names are left out rather than drawn over each other.
export function placeLabel(placed: LabelBox[], box: LabelBox, width: number, height: number) {
	if (box.x < 0 || box.y < 0 || box.x + box.width > width || box.y + box.height > height) return false
	if (placed.some((other) => box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height)) return false
	placed.push(box)
	return true
}

// Returns the canvas point of a J2000 position seen from the center; undefined for a position the plane cannot show.
export function projectPosition(layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>, center: FramePoint, position: FramePoint) {
	const point = toTangentPlane(center, position)
	return point && canvasPoint(layout, point)
}

// Returns the canvas angle, in radians clockwise from +x, of a direction on the sky given by its position angle from north
// through east, as canvas ellipses take the rotation of their first axis.
export function canvasAngle(positionAngle: number) {
	return Math.atan2(-Math.cos(positionAngle), -Math.sin(positionAngle))
}

// Returns the radius in CSS pixels of a star of a magnitude in a field down to a magnitude limit: 0.6 px at the limit,
// growing by 0.6 px a magnitude, at most 6 px.
export function starRadius(magnitude: number, magnitudeLimit: number) {
	return Math.min(6, Math.max(0.6, 0.6 + 0.6 * (magnitudeLimit - magnitude)))
}

// Survey cutout of a view: the request and the part of the tangent plane its pixels hold.
export interface CutoutView {
	// Survey and center it was asked for: a cutout of another origin is never drawn.
	readonly origin: string
	// Request of the cutout route.
	readonly request: FramingCutoutRequest
	// Tangent-plane half extent it covers along the right ascension axis (east left); the image holds at least this.
	readonly halfXi: number
	// Tangent-plane half extent it covers along the declination axis (north up); the image holds at least this.
	readonly halfEta: number
	// Image pixels per tangent-plane unit.
	readonly pixelScale: number
}

// Rectangle of a cutout image, in image pixels from its top-left corner.
export interface CutoutCrop {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

// Returns the cutout a view of a survey and a center asks for: the canvas at coverScale with the detail of detailScale
// at a device pixel ratio (> 0), its larger side at most MAX_CUTOUT_SIZE pixels; the same for every rotation of the
// fitted frames.
export function cutoutView(survey: string, center: FramePoint, layout: Pick<PreviewLayout, 'width' | 'height' | 'coverScale' | 'detailScale'>, pixelRatio: number): CutoutView {
	const halfXi = layout.width / 2 / layout.coverScale
	const halfEta = layout.height / 2 / layout.coverScale
	const larger = Math.max(halfXi, halfEta)
	const largerPixels = Math.max(1, Math.round(Math.min(2 * larger * layout.detailScale * pixelRatio, MAX_CUTOUT_SIZE)))
	// hips2fits spans the larger side with the field angle; the shorter side is rounded up so it still covers the canvas.
	const pixelScale = largerPixels / (2 * larger)
	const width = halfXi >= halfEta ? largerPixels : Math.max(1, Math.ceil(2 * halfXi * pixelScale - EXTENT_TOLERANCE))
	const height = halfXi >= halfEta ? Math.max(1, Math.ceil(2 * halfEta * pixelScale - EXTENT_TOLERANCE)) : largerPixels
	const request = { survey, rightAscension: center.rightAscension, declination: center.declination, fov: 2 * Math.atan(larger), width, height }
	return { origin: cutoutOrigin(survey, center), request, halfXi, halfEta, pixelScale }
}

// Returns the origin of the cutouts of a survey around a center (J2000, radians), rounded so a center typed again is the
// same one.
export function cutoutOrigin(survey: string, center: FramePoint) {
	return `${survey}:${center.rightAscension.toFixed(7)}:${center.declination.toFixed(7)}`
}

// Whether a cutout holds the whole canvas of a view of an origin, so it can be drawn cropped to it.
export function cutoutCovers(cutout: CutoutView, origin: string, layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>) {
	const tolerance = 1 + EXTENT_TOLERANCE
	return cutout.origin === origin && layout.width / 2 / layout.scale <= cutout.halfXi * tolerance && layout.height / 2 / layout.scale <= cutout.halfEta * tolerance
}

// Whether a cutout already read serves a wanted one, so it is not asked again: the same origin, at least its extent, and
// at least CUTOUT_DETAIL_SLACK of its detail.
export function cutoutSuffices(cutout: CutoutView, wanted: CutoutView) {
	const tolerance = 1 + EXTENT_TOLERANCE
	return cutout.origin === wanted.origin && wanted.halfXi <= cutout.halfXi * tolerance && wanted.halfEta <= cutout.halfEta * tolerance && cutout.pixelScale >= wanted.pixelScale * CUTOUT_DETAIL_SLACK
}

// Returns the rectangle of a cutout that a view of its origin shows: the canvas extent at the view's scale, centered on
// the image.
export function cutoutCrop(cutout: CutoutView, layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>): CutoutCrop {
	const width = (layout.width / layout.scale) * cutout.pixelScale
	const height = (layout.height / layout.scale) * cutout.pixelScale
	return { x: (cutout.request.width - width) / 2, y: (cutout.request.height - height) / 2, width, height }
}

// Returns the query string of the cutout route for a request.
export function cutoutQuery({ survey, rightAscension, declination, fov, width, height }: FramingCutoutRequest) {
	return new URLSearchParams({ survey, ra: `${rightAscension}`, dec: `${declination}`, fov: `${fov}`, width: `${width}`, height: `${height}` }).toString()
}

// Reads the catalog objects of the cone of a preview.
export function fetchField(request: FramingFieldRequest, signal?: AbortSignal, fetch: ApiFetch = browserFetch) {
	return fetchJson<FramingField>({ fetch }, '/api/framings/field', jsonInit('POST', request, signal))
}

// Reads the hips2fits cutout of a preview as an image blob; rejects with the server's reason when the service fails.
export async function fetchCutout(request: FramingCutoutRequest, signal?: AbortSignal, fetch: ApiFetch = browserFetch) {
	const response = await fetch(`/api/framings/cutout?${cutoutQuery(request)}`, { signal })
	if (!response.ok) throw new ApiResponseError(await responseError(response), response.status)
	return await response.blob()
}
