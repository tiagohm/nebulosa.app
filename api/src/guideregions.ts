import type { Image } from 'nebulosa/src/imaging/model/types'
import { type DetectedStar, type DetectStarOptions, detectStars, STAR_SIGNAL_RADIUS } from 'nebulosa/src/imaging/stars/detector'

// Star detection of a guide frame limited to regions around the stars the guider uses: one square around each center,
// padded by what the detector needs around a star (its border margin, the aperture, and the sky annulus), merged while
// the padded squares overlap, so every star falls in exactly one crop, and clamped to the frame. Each crop is a copy of
// the mono frame the toolkit detector runs on, and the stars it finds are shifted back to the frame. Positions are
// 0-based pixel centres of the full frame, the origin at the upper-left sample, x right and y down.

// Squares around the stars a guiding session uses, and the detections kept inside them.
export interface GuideRegions {
	// Centers of the squares, in pixels of the frame.
	readonly centers: readonly (readonly [number, number])[]
	// Half side of each square, in pixels: how far a star may be from where it was last measured and still be found.
	readonly radius: number
	// Lowest SNR a detection must reach to be kept, raising the detector option's when higher; 0 keeps them all.
	readonly minSNR: number
}

// Rectangle of a crop in pixels of the frame: the first column and row, and the column and row past the last.
export interface CropRect {
	readonly left: number
	readonly top: number
	readonly right: number
	readonly bottom: number
}

// Pixels the detector needs around a star besides its aperture radius: the 4-pixel border it never detects in, the PSF
// kernel, and the sky annulus 1 to 3 pixels beyond the aperture.
const DETECTOR_PADDING = 12

// Returns the crops of the regions in a frame of width x height pixels: each center's square of half side radius,
// padded by the detector's needs for apertures up to maximumRadius pixels, merged while two overlap, and clamped to the
// frame. The crops never overlap one another.
export function guideCrops({ centers, radius }: GuideRegions, width: number, height: number, maximumRadius: number): CropRect[] {
	const half = Math.ceil(radius + maximumRadius + DETECTOR_PADDING)
	let crops: CropRect[] = centers.map(([x, y]) => ({ left: Math.max(0, Math.floor(x) - half), top: Math.max(0, Math.floor(y) - half), right: Math.min(width, Math.floor(x) + half + 1), bottom: Math.min(height, Math.floor(y) + half + 1) }))
	let merged = true

	// A merge can make the union overlap a crop it did not before, so the pass repeats until nothing overlaps.
	while (merged) {
		merged = false
		const next: CropRect[] = []

		for (const crop of crops) {
			const index = next.findIndex((other) => crop.left < other.right && other.left < crop.right && crop.top < other.bottom && other.top < crop.bottom)

			if (index < 0) {
				next.push(crop)
			} else {
				const other = next[index]
				next[index] = { left: Math.min(crop.left, other.left), top: Math.min(crop.top, other.top), right: Math.max(crop.right, other.right), bottom: Math.max(crop.bottom, other.bottom) }
				merged = true
			}
		}

		crops = next
	}

	return crops.filter((crop) => crop.right > crop.left && crop.bottom > crop.top)
}

// Copies a rectangle of a mono image into an image of its own, with the header of the source.
function cropImage(image: Image, { left, top, right, bottom }: CropRect): Image {
	const width = right - left
	const height = bottom - top
	const { raw, metadata } = image
	const copy = raw instanceof Float64Array ? new Float64Array(width * height) : new Float32Array(width * height)
	for (let y = 0; y < height; y++) copy.set(raw.subarray((top + y) * metadata.stride + left, (top + y) * metadata.stride + right), y * width)
	return { ...image, raw: copy, metadata: { ...metadata, width, height, stride: width, pixelCount: width * height, strideInBytes: width * metadata.pixelSizeInBytes } }
}

// Detects the stars of a mono frame inside the crops of the regions with the detector options, shifted to the frame
// and ordered by decreasing flux; maxStars keeps the brightest of all the crops, and the region's minSNR raises the
// option's.
export function detectStarsInRegions(image: Image, regions: GuideRegions, options: Partial<DetectStarOptions> = {}): DetectedStar[] {
	const { width, height } = image.metadata
	const stars: DetectedStar[] = []
	const detection = { ...options, minSNR: Math.max(options.minSNR ?? 0, regions.minSNR) }

	for (const crop of guideCrops(regions, width, height, options.maximumRadius ?? STAR_SIGNAL_RADIUS)) {
		for (const star of detectStars(cropImage(image, crop), detection)) stars.push({ ...star, x: star.x + crop.left, y: star.y + crop.top })
	}

	stars.sort((a, b) => b.flux - a.flux)
	return options.maxStars === undefined ? stars : stars.slice(0, options.maxStars)
}
