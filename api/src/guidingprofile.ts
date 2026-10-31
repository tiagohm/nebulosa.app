import type { Image } from 'nebulosa/src/imaging/model/types'
import { measureStarProfile, type StarProfile } from 'nebulosa/src/imaging/stars/profile'

// Star Profile of a guiding session: the toolkit's moment profile of the guide star measured on the grayscale copy of
// each guide frame (centroid, flux, SNR, HFD, FWHM and its axes, shape, background, noise, peak, quality, and the flags
// of a degraded measurement), with the horizontal and vertical cuts through the star for its plot. Positions are
// 0-based pixel centres of the full frame, the origin at the upper-left sample, x right and y down; intensities are the
// normalized samples of the image ([0, 1] of the full scale for integer frames), and adu converts them to ADU.

// Samples of each cut on either side of the star's centre pixel: wider than the search square of small guide stars, so
// the wings and the sky around them show.
export const GUIDING_PROFILE_HALF_WIDTH = 12

// One cut through the star: consecutive samples along a row or a column, less the local background.
export interface GuidingProfileCut {
	// Offset of the first sample from the star's centre pixel, in pixels; negative is left or up.
	readonly from: number
	// Samples above the background, in normalized units; the frame edge shortens the cut.
	readonly values: readonly number[]
}

// Profile of the guide star of one frame.
export interface GuidingStarProfile extends Omit<StarProfile, 'sourceIndex' | 'moffat'> {
	// Frame the star was measured on.
	readonly frameId: number
	// ADU of one normalized unit: 2^BITPIX - 1 for an integer frame, 1 for a floating one.
	readonly adu: number
	// Cut along the row of the centre pixel, left to right.
	readonly horizontal: GuidingProfileCut
	// Cut along the column of the centre pixel, top to bottom.
	readonly vertical: GuidingProfileCut
}

// Measures the guide star of a frame near position (pixels of the frame) on its mono image, and returns its profile and
// cuts, or undefined when position falls outside the frame.
export function guideStarProfile(image: Image, frameId: number, position: readonly [number, number]): GuidingStarProfile | undefined {
	const { width, height, stride, bitpix } = image.metadata
	if (!(position[0] >= 0 && position[0] < width && position[1] >= 0 && position[1] < height)) return undefined

	const { sourceIndex: _, moffat: __, ...profile } = measureStarProfile(image, { x: position[0], y: position[1] })
	const background = profile.background ?? 0
	const cx = clampPixel(profile.x, width)
	const cy = clampPixel(profile.y, height)

	return {
		...profile,
		frameId,
		adu: bitpix > 0 ? 2 ** bitpix - 1 : 1,
		horizontal: profileCut(cx, width, GUIDING_PROFILE_HALF_WIDTH, background, (x) => image.raw[cy * stride + x]),
		vertical: profileCut(cy, height, GUIDING_PROFILE_HALF_WIDTH, background, (y) => image.raw[y * stride + cx]),
	}
}

// Returns a cut along one axis of size pixels through the pixel center, halfWidth samples on either side, clipped to
// the image, with sample reading the sample at a position along the axis and background taken from each one.
export function profileCut(center: number, size: number, halfWidth: number, background: number, sample: (index: number) => number): GuidingProfileCut {
	const first = Math.max(0, center - halfWidth)
	const last = Math.min(size - 1, center + halfWidth)
	const values: number[] = []
	for (let index = first; index <= last; index++) values.push(sample(index) - background)
	return { from: first - center, values }
}

// Returns the pixel holding a coordinate, within [0, size).
export function clampPixel(coordinate: number, size: number) {
	return Math.min(size - 1, Math.max(0, Math.round(Number.isFinite(coordinate) ? coordinate : 0)))
}
