import { detectStars, STAR_SIGNAL_RADIUS } from 'nebulosa/src/imaging/stars/detector'
import { measureStarProfile, type StarProfile, type StarProfileModel } from 'nebulosa/src/imaging/stars/profile'
import { moffatProfileValue, type MoffatProfileFit } from 'nebulosa/src/imaging/stars/profile.moffat'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import { clamp } from 'nebulosa/src/math/numerical/math'
import { clampPixel, profileCut } from './guidingprofile'
import type { DocumentSize, ImageRect, ImageRegion, SampleConversion } from './images'

// Measurement of the star a person pointed at, on a grayscale region of an image (ImageStore.detectionRegion), run on a
// worker of its own (starprofile.worker.ts). The toolkit's detectStars finds the star nearest the point in the region
// and measureStarProfile measures it, so no star is ever taken from the brightest sample of the region, and nothing here
// computes a profile of its own. The region holds everything both read, so a star away from the frame edges measures as
// it would on the whole image. Positions are 0-based pixel centres of the whole image, the origin at the upper-left
// sample, x right and y down; intensities are the normalized samples of the image, which conversion turns into the
// scale of its source.

// Pixels from the edge of an image inside which detectStars finds no candidate: its margin of 4 pixels plus its kernel.
const DETECTION_EDGE = 8

// Radius of the signal aperture of a star, in HFDs: about twice its FWHM, which holds all but its faint wings. The size
// comes from the detector because the profile cannot find it on a real sky: it grows an aperture until the positive
// samples of its outer band fall below 1% of the flux, which their noise alone keeps above that on all but bright stars,
// so the aperture would reach its limit, take in the neighbors, and carry the centroid away.
const APERTURE_HFDS = 2

// Radius of the signal aperture of a star measured where the detector cannot look, in pixels: nothing says how large it
// is, and it is cut by the frame edge anyway.
const EDGE_APERTURE_RADIUS = 8

// Passes of the profile over the aperture: the first one recentres it on the star, the second one measures it there. Any
// more only walk the centroid towards what is brighter around it.
const MEASUREMENT_PASSES = 2

// Signal of the brightest sample of a star measured where the detector cannot look, in background deviations: well
// above the noise peak of an aperture of any size, whose flux-based SNR grows with the aperture and proves nothing.
const EDGE_MIN_PEAK = 6

// Smallest HFD of a star measured where the detector cannot look, in pixels: as for the detector, below it is a hot pixel.
const EDGE_MIN_HFD = 1

// Sample at or above which a pixel counts as saturated, in normalized samples: the full scale, less the rounding of the
// luminance of a saturated color pixel.
const SATURATION_LEVEL = 1 - 1e-9

// Fewest samples of each cut on either side of the star's centre pixel, as those of a guide star.
const MIN_CUT_HALF_WIDTH = 12

// Fewest pixels of the preview on either side of the star's centre pixel.
const MIN_PREVIEW_RADIUS = 15

// Most pixels of each cut and of the preview on either side of the star's centre pixel, the largest aperture of a star.
const MAX_SAMPLE_RADIUS = 32

// Distance within which two candidates are as near a point as each other, in pixels: nothing tells which one was meant.
const AMBIGUOUS_DISTANCE = 1

// What to measure and how.
export interface StarProfileRequest {
	// Column of the point, in pixels of the image.
	readonly x: number
	// Row of the point, in pixels of the image.
	readonly y: number
	// HFD a star detection measured for a star at the point, in pixels, so the search for one is skipped; it is measured
	// all the same.
	readonly detectedHfd?: number
	// Requested model; a Moffat fit that is rejected falls back to the moments.
	readonly model: StarProfileModel
	// Distance from the point a star is looked for within, in pixels.
	readonly searchRadius: number
	// Largest signal-aperture radius, in pixels; both the detector and the aperture of the star stop there.
	readonly maximumRadius: number
	// Minimum SNR of a candidate star and of a valid profile.
	readonly minSNR: number
}

// One cut through the star: samples along a row or a column, in order, without the non-finite ones.
export interface StarProfileCut {
	// Position of each sample from the star's centroid, in pixels; fractional, negative is left or up.
	readonly offsets: readonly number[]
	// Each sample above the background of the profile, in normalized units.
	readonly values: readonly number[]
	// The accepted Moffat fit at the position of each sample, above the same background; absent without one.
	readonly model?: readonly number[]
}

// Samples around the star, as measured, for its preview.
export interface StarProfilePreview {
	// Column of the first sample, in pixels of the image.
	readonly left: number
	// Row of the first sample, in pixels of the image.
	readonly top: number
	// Width, in pixels.
	readonly width: number
	// Height, in pixels.
	readonly height: number
	// Normalized samples in rows from the top, each left to right; null for a non-finite one.
	readonly samples: readonly (number | null)[]
}

// Why no star was measured near a point: nothing credible is near it, or nothing tells which of two stars was meant.
export type StarProfileNoStarReason = 'noPeak' | 'ambiguous'

// Profile of a star, in pixels of the image.
export type StarProfileMeasurement = Omit<StarProfile, 'sourceIndex'>

// Star measured near a point; it may still be degraded or invalid, as its flags say.
export interface StarProfileMeasured {
	readonly status: 'measured'
	// Id of the image document measured.
	readonly imageId: string
	// Point asked about, in pixels of the image.
	readonly seed: Readonly<Point>
	// Model requested, which profile.model differs from when its fit was rejected.
	readonly requestedModel: StarProfileModel
	// Profile of the star.
	readonly profile: StarProfileMeasurement
	// Cut along the row of the centre pixel, left to right.
	readonly horizontal: StarProfileCut
	// Cut along the column of the centre pixel, top to bottom.
	readonly vertical: StarProfileCut
	// Samples around the star.
	readonly preview: StarProfilePreview
	// Conversion of the intensities to the scale of the source.
	readonly conversion: SampleConversion
	// Whether a saturated sample can be told at all: the read of a rescaled image set its brightest pixel to 1, so the
	// full scale of its source is unknown.
	readonly saturationKnown: boolean
}

// No star measured near a point.
export interface StarProfileNoStar {
	readonly status: 'noStar'
	// Id of the image document.
	readonly imageId: string
	// Point asked about, in pixels of the image.
	readonly seed: Readonly<Point>
	// Why.
	readonly reason: StarProfileNoStarReason
}

// Outcome of a measurement.
export type StarProfileResult = StarProfileMeasured | StarProfileNoStar

// Request to the star profile worker: the region it owns from now on, and what to measure on it.
export interface StarProfileWorkerRequest {
	// Id of the request, echoed by the response.
	readonly id: number
	// Id of the image document.
	readonly imageId: string
	// Grayscale region of the image.
	readonly region: ImageRegion
	// Where the region lies in the image.
	readonly rect: ImageRect
	// Size of the image, in pixels.
	readonly size: DocumentSize
	// What to measure and how.
	readonly request: StarProfileRequest
}

// Response of the star profile worker.
export type StarProfileWorkerResponse = { readonly id: number; readonly status: 'completed'; readonly result: StarProfileResult } | { readonly id: number; readonly status: 'failed'; readonly error: string }

// Returns the pixels a region must reach on every side of a point, so that nothing the measurement reads is left out:
// a star up to searchRadius from the point, its centroid up to searchRadius from there (see inspectStarRegion), an
// aperture of maximumRadius, and its sky annulus 3 pixels beyond, plus one. The frame edges alone can then flag it.
export function regionHalfSize({ searchRadius, maximumRadius }: Pick<StarProfileRequest, 'searchRadius' | 'maximumRadius'>): number {
	return 2 * searchRadius + maximumRadius + 4
}

// Returns the rectangle reaching halfSize pixels on every side of a point inside an image, clipped to the image.
export function regionAround({ x, y }: Readonly<Point>, halfSize: number, { width, height }: DocumentSize): ImageRect {
	const left = clamp(Math.round(x) - halfSize, 0, width - 1)
	const top = clamp(Math.round(y) - halfSize, 0, height - 1)
	const right = clamp(Math.round(x) + halfSize, 0, width - 1)
	const bottom = clamp(Math.round(y) + halfSize, 0, height - 1)
	return { left, top, width: right - left + 1, height: bottom - top + 1 }
}

// Star found near a point: where it is, in pixels of the region, and its HFD, in pixels.
interface Candidate extends Readonly<Point> {
	readonly hfd: number
}

// Returns the radius of the aperture that measures a star of a given HFD, or one found nowhere, in pixels.
function apertureRadius(candidate: Candidate | undefined, maximumRadius: number): number {
	const radius = candidate ? Math.max(STAR_SIGNAL_RADIUS, Math.ceil(APERTURE_HFDS * candidate.hfd)) : EDGE_APERTURE_RADIUS
	return Math.min(radius, maximumRadius)
}

// Returns an image the detector can read: itself, or a copy with its non-finite samples set to 0, since the running sums
// of the detector would carry one of them over every star after it. The profile still measures the samples as they are.
function finiteImage(image: ImageRegion['image']): ImageRegion['image'] {
	return image.raw.every(Number.isFinite) ? image : { ...image, raw: image.raw.map((value) => (Number.isFinite(value) ? value : 0)) }
}

// Returns the detected star nearest a point of a region and within searchRadius, undefined when there is none, or
// ambiguous when another one is about as near.
function nearestCandidate(image: ImageRegion['image'], point: Readonly<Point>, { searchRadius, maximumRadius, minSNR }: StarProfileRequest): Candidate | 'ambiguous' | undefined {
	const stars = detectStars(finiteImage(image), { minSNR, maximumRadius, scoreGapTrim: false })
	const near = stars.map((star) => ({ star, distance: Math.hypot(star.x - point.x, star.y - point.y) })).filter(({ distance }) => distance <= searchRadius)
	near.sort((a, b) => a.distance - b.distance)
	if (near.length > 1 && near[1].distance - near[0].distance < AMBIGUOUS_DISTANCE) return 'ambiguous'
	return near[0]?.star
}

// Returns whether a point of an image is where detectStars cannot find the star that may be there.
function nearFrameEdge({ x, y }: Readonly<Point>, { width, height }: DocumentSize, searchRadius: number): boolean {
	return Math.min(x, y, width - 1 - x, height - 1 - y) < searchRadius + DETECTION_EDGE
}

// Returns whether a profile measured at a point the detector cannot reach stands out as a star.
function isEdgeStar({ hfd, peak, deviation }: StarProfile): boolean {
	return hfd !== undefined && hfd >= EDGE_MIN_HFD && peak !== undefined && deviation !== undefined && peak >= EDGE_MIN_PEAK * deviation
}

// Returns a fit moved from the pixels of a region to those of the image.
function fitInImage(fit: MoffatProfileFit | undefined, left: number, top: number): MoffatProfileFit | undefined {
	return fit?.success ? { ...fit, centerX: fit.centerX + left, centerY: fit.centerY + top } : fit
}

// Measures the star nearest a point of an image on a region of it around that point (regionAround with regionHalfSize),
// whose rect and image size locate it. A star that detectStars finds is measured in an aperture of the size it found
// (apertureRadius); one nearer the frame edge than it can look is measured at the point itself and kept only if it
// stands out (isEdgeStar). A measured centroid that wandered
// more than searchRadius from where it started followed something else, and is reported as ambiguous, which is also what
// keeps it inside the region. Saturation is judged against the full scale, unless the read rescaled the image.
export function inspectStarRegion(imageId: string, { image, conversion }: ImageRegion, rect: ImageRect, size: DocumentSize, request: StarProfileRequest): StarProfileResult {
	const { model, maximumRadius, minSNR, searchRadius, detectedHfd } = request
	const seed = { x: request.x, y: request.y }
	const point = { x: seed.x - rect.left, y: seed.y - rect.top }
	const candidate = detectedHfd === undefined ? nearestCandidate(image, point, request) : { ...point, hfd: detectedHfd }

	if (candidate === 'ambiguous') return { status: 'noStar', imageId, seed, reason: 'ambiguous' }
	if (!candidate && !nearFrameEdge(seed, size, searchRadius)) return { status: 'noStar', imageId, seed, reason: 'noPeak' }

	const start = candidate ?? point
	const saturationKnown = !conversion.rescaled
	const radius = apertureRadius(candidate, maximumRadius)
	const { sourceIndex: _, ...profile } = measureStarProfile(image, start, { model, initialRadius: radius, maximumRadius: radius, maxIterations: MEASUREMENT_PASSES, minSNR, saturationLevel: saturationKnown ? SATURATION_LEVEL : Number.MAX_VALUE })

	if (profile.hfd === undefined || (!candidate && !isEdgeStar(profile))) return { status: 'noStar', imageId, seed, reason: 'noPeak' }
	if (Math.hypot(profile.x - start.x, profile.y - start.y) > searchRadius) return { status: 'noStar', imageId, seed, reason: 'ambiguous' }

	const { width, height, stride } = image.metadata
	const background = profile.background ?? 0
	const fit = profile.moffat?.success ? profile.moffat : undefined
	const cx = clampPixel(profile.x, width)
	const cy = clampPixel(profile.y, height)
	const cutHalfWidth = clamp(Math.ceil(2 * profile.hfd), MIN_CUT_HALF_WIDTH, MAX_SAMPLE_RADIUS)
	const previewRadius = clamp(Math.ceil(2 * profile.hfd), MIN_PREVIEW_RADIUS, MAX_SAMPLE_RADIUS)

	// Builds the cut along one axis from the samples at each position, with the model at the same pixels.
	function cut(center: number, centroid: number, length: number, sample: (index: number) => number, modelAt: (index: number) => number): StarProfileCut {
		const { from, values } = profileCut(center, length, cutHalfWidth, background, sample)
		const offsets: number[] = []
		const finite: number[] = []
		const predicted: number[] = []

		for (let i = 0; i < values.length; i++) {
			if (!Number.isFinite(values[i])) continue
			offsets.push(center + from + i - centroid)
			finite.push(values[i])
			if (fit) predicted.push(modelAt(center + from + i) - background)
		}

		return { offsets, values: finite, ...(fit && { model: predicted }) }
	}

	const previewLeft = Math.max(0, cx - previewRadius)
	const previewTop = Math.max(0, cy - previewRadius)
	const previewWidth = Math.min(width - 1, cx + previewRadius) - previewLeft + 1
	const previewHeight = Math.min(height - 1, cy + previewRadius) - previewTop + 1
	const samples: (number | null)[] = []

	for (let y = previewTop; y < previewTop + previewHeight; y++) {
		for (let x = previewLeft; x < previewLeft + previewWidth; x++) {
			const value = image.raw[y * stride + x]
			samples.push(Number.isFinite(value) ? value : null)
		}
	}

	return {
		status: 'measured',
		imageId,
		seed,
		requestedModel: model,
		profile: { ...profile, x: profile.x + rect.left, y: profile.y + rect.top, moffat: fitInImage(profile.moffat, rect.left, rect.top) },
		horizontal: cut(
			cx,
			profile.x,
			width,
			(x) => image.raw[cy * stride + x],
			(x) => moffatProfileValue(fit!, x, cy),
		),
		vertical: cut(
			cy,
			profile.y,
			height,
			(y) => image.raw[y * stride + cx],
			(y) => moffatProfileValue(fit!, cx, y),
		),
		preview: { left: previewLeft + rect.left, top: previewTop + rect.top, width: previewWidth, height: previewHeight, samples },
		conversion,
		saturationKnown,
	}
}
