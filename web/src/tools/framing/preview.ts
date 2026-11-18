import type { FramingCutoutRequest, FramingField, FramingFieldRequest } from 'api'
import { type FramePoint, frameHalfExtent, type TangentPoint, toTangentPlane } from '../../framing/geometry'
import { type ApiFetch, ApiResponseError, browserFetch, fetchJson, jsonInit, responseError } from '../../http'

// Layout of the preview of the Framing tool: one north-up gnomonic view of a fixed J2000 center, east on the left, scaled
// so the largest framing, turned by its rotation, fits with a margin. The same view frames the stars and deep-sky objects
// of the catalog (the Mini-Sky) and a hips2fits cutout of a survey, which is a TAN image of the same center whose field
// angle `fov` spans the larger side as the tangent-plane extent 2·tan(fov/2), so the outlines are drawn on either without
// a WCS. Pixel coordinates are CSS pixels of the canvas, origin at its top-left corner, x right and y down.

// Room left around the largest framing, as a factor of its half extent.
export const PREVIEW_MARGIN = 1.25

// Tangent-plane half extent of the view when no framing can be drawn: 1° on the shorter side.
const DEFAULT_HALF_EXTENT = Math.tan(Math.PI / 360)

// Largest side of a requested cutout, in pixels, so a large screen does not ask hips2fits for a huge image.
export const MAX_CUTOUT_SIZE = 1600

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
	// Field angle of the larger side, in radians: the hips2fits `fov` of a cutout of this view.
	readonly fov: number
	// Radius of the cone that holds the whole canvas, in radians: the field asked of the catalog.
	readonly radius: number
}

// Returns the scale of a preview of a canvas size (CSS pixels, both > 0) that fits every frame turned by its rotation
// with PREVIEW_MARGIN; 1° on the shorter side without a frame.
export function previewLayout(width: number, height: number, frames: readonly PreviewFrame[]): PreviewLayout {
	let halfXi = 0
	let halfEta = 0

	for (const frame of frames) {
		const extent = frameHalfExtent(frame.width, frame.height, frame.rotation)
		halfXi = Math.max(halfXi, extent.xi)
		halfEta = Math.max(halfEta, extent.eta)
	}

	const scale = halfXi > 0 && halfEta > 0 ? Math.min(width / 2 / (halfXi * PREVIEW_MARGIN), height / 2 / (halfEta * PREVIEW_MARGIN)) : Math.min(width, height) / 2 / DEFAULT_HALF_EXTENT
	return { width, height, scale, fov: 2 * Math.atan(Math.max(width, height) / scale / 2), radius: Math.atan(Math.hypot(width, height) / scale / 2) }
}

// Returns the canvas point of a point of the tangent plane: east to the left, north up.
export function canvasPoint(layout: Pick<PreviewLayout, 'width' | 'height' | 'scale'>, point: TangentPoint): { readonly x: number; readonly y: number } {
	return { x: layout.width / 2 - point.xi * layout.scale, y: layout.height / 2 - point.eta * layout.scale }
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

// Returns the size in pixels of the cutout of a canvas, at its device pixel ratio, its larger side at most
// MAX_CUTOUT_SIZE.
export function cutoutSize(width: number, height: number, pixelRatio: number) {
	const factor = Math.min(pixelRatio, MAX_CUTOUT_SIZE / Math.max(width, height))
	return { width: Math.max(1, Math.round(width * factor)), height: Math.max(1, Math.round(height * factor)) }
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
