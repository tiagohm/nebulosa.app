import { expect, test } from 'bun:test'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { measureStarProfile } from 'nebulosa/src/imaging/stars/profile'
import { moffatProfileValue } from 'nebulosa/src/imaging/stars/profile.moffat'
import { mulberry32 } from 'nebulosa/src/math/numerical/random'
import { cropImage } from './imagedecode'
import type { SampleConversion } from './images'
import { inspectStarRegion, regionAround, regionHalfSize, type StarProfileMeasured, type StarProfileRequest, type StarProfileResult } from './starprofile.analysis'

const SIZE = 256
const IMAGE_ID = 'image'
const FULL_SCALE: SampleConversion = { unit: 'adu', scale: 65535, offset: 0, rescaled: false }
const REQUEST: StarProfileRequest = { x: 0, y: 0, model: 'moments', searchRadius: 8, maximumRadius: 32, minSNR: 5 }

// A star at (x, y), with a peak and a width in pixels: the sigma of a Gaussian, or the alpha of a Moffat of a given beta.
type Star = readonly [x: number, y: number, peak: number, width?: number, beta?: number]

// A sky of 0.1 with noise of a given peak-to-peak range, and stars, as a 16-bit image of size pixels.
function field(stars: readonly Star[], size = SIZE, seed = 11, noise = 0.002): Image {
	const raw = new Float32Array(size * size).fill(0.1)
	const random = mulberry32(seed)
	for (let i = 0; i < raw.length; i++) raw[i] += (random() - 0.5) * noise

	for (const [sx, sy, peak, width = 1.5, beta] of stars) {
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const r2 = (x - sx) ** 2 + (y - sy) ** 2
				raw[y * size + x] += beta === undefined ? peak * Math.exp(-r2 / (2 * width ** 2)) : peak / (1 + r2 / width ** 2) ** beta
			}
		}
	}

	return { raw, header: {}, metadata: { width: size, height: size, channels: 1, pixelCount: size * size, pixelSizeInBytes: 4, bitpix: 16, stride: size, strideInBytes: size * 4, bayer: undefined } }
}

// Inspects an image at a point through a region of it, as the service does.
function inspect(image: Image, x: number, y: number, options: Partial<StarProfileRequest> = {}, conversion = FULL_SCALE): StarProfileResult {
	const request = { ...REQUEST, x, y, ...options }
	const size = { width: image.metadata.width, height: image.metadata.height }
	const rect = regionAround(request, regionHalfSize(request), size)
	return inspectStarRegion(IMAGE_ID, { image: cropImage(image, rect), conversion }, rect, size, request)
}

// Expects a result to be a measured star and returns it.
function measured(result: StarProfileResult): StarProfileMeasured {
	if (result.status !== 'measured') throw new Error(`no star: ${result.reason}`)
	return result
}

test('measures a star on a region as on the whole image', () => {
	const image = field([[120.3, 90.6, 0.4]])
	const result = measured(inspect(image, 123, 88))
	const whole = measureStarProfile(image, { x: 120, y: 91 }, { maximumRadius: 32, minSNR: 5 })

	expect(result.seed).toEqual({ x: 123, y: 88 })
	expect(result.profile.x).toBeCloseTo(whole.x, 5)
	expect(result.profile.y).toBeCloseTo(whole.y, 5)
	expect(result.profile.hfd!).toBeCloseTo(whole.hfd!, 5)
	expect(result.profile.fwhm!).toBeCloseTo(whole.fwhm!, 5)
	expect(result.profile.flux!).toBeCloseTo(whole.flux!, 5)
	expect(result.profile.background!).toBeCloseTo(whole.background!, 5)
	expect(result.profile.flags).toEqual(whole.flags)
	expect(result.profile.valid).toBeTrue()
})

test('a region against the frame edge keeps measuring in pixels of the image', () => {
	const image = field([[240.2, 30.4, 0.4]])
	const { profile } = measured(inspect(image, 240, 30))

	expect(profile.x).toBeCloseTo(240.2, 1)
	expect(profile.y).toBeCloseTo(30.4, 1)
	expect(profile.flags).not.toContain('nearBorder')
})

test('a point on the sky finds no star, whatever the noise', () => {
	for (let seed = 1; seed <= 20; seed++) {
		expect(inspect(field([], SIZE, seed), 128, 128)).toEqual({ status: 'noStar', imageId: IMAGE_ID, seed: { x: 128, y: 128 }, reason: 'noPeak' })
	}
})

test('a star beyond the search radius is not taken', () => {
	expect(inspect(field([[120, 120, 0.8]]), 132, 120)).toMatchObject({ status: 'noStar', reason: 'noPeak' })
})

test('the nearest star wins over a brighter one, and two equally near are ambiguous', () => {
	const image = field([
		[120, 120, 0.3],
		[136, 120, 0.8],
	])

	expect(measured(inspect(image, 124, 120, { searchRadius: 14 })).profile.x).toBeCloseTo(120, 0)
	expect(inspect(image, 128, 120, { searchRadius: 10 })).toMatchObject({ status: 'noStar', reason: 'ambiguous' })
})

test('a faint star beside a brighter one is measured, not that neighbor', () => {
	const image = field([
		[120, 120, 0.1],
		[132, 120, 0.8],
	])

	expect(measured(inspect(image, 123, 120)).profile.x).toBeCloseTo(120, 0)
})

test('a centroid carried away from where it started is ambiguous, not what carried it', () => {
	const image = field([[132, 120, 0.8]])

	expect(inspect(image, 123, 120, { detectedHfd: 6 })).toMatchObject({ status: 'noStar', reason: 'ambiguous' })
})

test('a faint star beside much brighter ones is found', () => {
	const image = field([
		[100, 100, 0.8],
		[160, 100, 0.8],
		[100, 160, 0.8],
		[160, 160, 0.8],
		[130, 130, 0.02],
	])

	expect(measured(inspect(image, 130, 131)).profile.x).toBeCloseTo(130, 0)
})

test('a star where the detector cannot look is measured and flagged', () => {
	const image = field([[3, 120, 0.4]])
	const { profile } = measured(inspect(image, 3, 120))

	expect(profile.x).toBeCloseTo(3, 0)
	expect(profile.flags).toContain('nearBorder')
})

test('the sky where the detector cannot look finds no star', () => {
	for (let seed = 1; seed <= 20; seed++) expect(inspect(field([], SIZE, seed), 3, 128)).toMatchObject({ status: 'noStar', reason: 'noPeak' })
})

test('a star a detection already found skips the search', () => {
	const image = field([[120.3, 90.6, 0.4]])
	expect(measured(inspect(image, 120.3, 90.6, { detectedHfd: 3.5 })).profile.x).toBeCloseTo(120.3, 1)
})

test('a faint star on a real sky keeps its aperture, its size, and its place among its neighbors', () => {
	// Sky noise that keeps the positive samples of an outer band above 1% of the flux, which grew the aperture to its limit.
	const image = field(
		[
			[120, 120, 0.05],
			[150, 112, 0.4],
			[96, 141, 0.3],
			[141, 150, 0.6],
			[92, 96, 0.5],
		],
		SIZE,
		11,
		0.01,
	)

	const { profile } = measured(inspect(image, 121.5, 119))

	expect(Math.hypot(profile.x - 120, profile.y - 120)).toBeLessThan(0.5)
	// A Gaussian of sigma 1.5 px has an HFD of about 3.5 px.
	expect(profile.hfd!).toBeLessThan(5)
	expect(profile.valid).toBeTrue()
})

test('saturation is flagged against the full scale, and unknown after a rescale', () => {
	const image = field([[120, 120, 2, 2]])
	for (let i = 0; i < image.raw.length; i++) image.raw[i] = Math.min(1, image.raw[i])

	const clipped = measured(inspect(image, 120, 120))
	const rescaled = measured(inspect(image, 120, 120, {}, { unit: 'source', scale: 40000, offset: 100, rescaled: true }))

	expect(clipped.profile.flags).toContain('saturated')
	expect(clipped.profile.valid).toBeFalse()
	expect(clipped.saturationKnown).toBeTrue()
	expect(rescaled.profile.flags).not.toContain('saturated')
	expect(rescaled.saturationKnown).toBeFalse()
	expect(rescaled.conversion.scale).toBe(40000)
})

test('the cuts are offsets from the centroid, less the background, through the centre pixel', () => {
	const result = measured(inspect(field([[120.3, 90.6, 0.4]]), 120, 91))
	const { profile, horizontal, vertical } = result
	const centre = horizontal.offsets.findIndex((offset) => Math.abs(offset - (120 - profile.x)) < 1e-6)

	expect(centre).toBeGreaterThan(0)
	expect(horizontal.offsets).toHaveLength(2 * 12 + 1)
	expect(horizontal.values[centre]).toBe(Math.max(...horizontal.values))
	expect(horizontal.values[0]).toBeCloseTo(0, 2)
	expect(vertical.offsets.some((offset) => Math.abs(offset - (91 - profile.y)) < 1e-6)).toBeTrue()
	expect(horizontal.model).toBeUndefined()
})

test('a defocused star gets wider cuts and a wider preview', () => {
	const { profile, horizontal, preview } = measured(inspect(field([[120, 120, 0.3, 7]]), 120, 120))
	const radius = Math.min(32, Math.ceil(2 * profile.hfd!))

	expect(radius).toBeGreaterThan(15)
	expect(horizontal.offsets).toHaveLength(2 * radius + 1)
	expect(preview.width).toBe(2 * radius + 1)
})

test('the preview holds the samples around the star, in pixels of the image', () => {
	const image = field([[120.3, 90.6, 0.4]])
	const { preview } = measured(inspect(image, 120, 91))

	expect(preview).toMatchObject({ left: 120 - 15, top: 91 - 15, width: 31, height: 31 })
	expect(preview.samples).toHaveLength(31 * 31)
	expect(preview.samples[15 * 31 + 15]).toBe(image.raw[91 * SIZE + 120])
})

test('a preview at the frame edge is clipped to the image', () => {
	const { preview } = measured(inspect(field([[5, 120, 0.4]]), 5, 120))

	expect(preview.left).toBe(0)
	expect(preview.width).toBe(5 + 1 + 15)
	expect(preview.samples).toHaveLength(preview.width * preview.height)
})

test('non-finite samples are left out of the cuts and null in the preview', () => {
	const image = field([[120, 120, 0.4]])
	image.raw[120 * SIZE + 125] = Number.NaN
	const { horizontal, preview, profile } = measured(inspect(image, 120, 120))

	expect(profile.flags).toContain('nonFinite')
	expect(horizontal.values.every(Number.isFinite)).toBeTrue()
	expect(horizontal.offsets).toHaveLength(horizontal.values.length)
	expect(preview.samples.filter((sample) => sample === null)).toHaveLength(1)
})

test('the Moffat curve is the accepted fit at the pixels of each cut', () => {
	const result = measured(inspect(field([[120.3, 90.6, 0.4, 2.5, 2.5]]), 120, 91, { model: 'moffat' }))
	const { profile, horizontal, vertical, requestedModel } = result
	const fit = profile.moffat!

	expect(requestedModel).toBe('moffat')
	expect(profile.model).toBe('moffat')
	expect(fit.success).toBeTrue()
	if (!fit.success) return

	expect(fit.centerX).toBeCloseTo(profile.x, 5)
	const background = profile.background!
	const centre = horizontal.offsets.findIndex((offset) => Math.abs(offset - (120 - profile.x)) < 1e-6)
	expect(horizontal.model![centre]).toBeCloseTo(moffatProfileValue(fit, 120, 91) - background, 5)
	expect(horizontal.model![centre]).toBeCloseTo(horizontal.values[centre], 2)
	expect(horizontal.model).toHaveLength(horizontal.values.length)
	expect(vertical.model).toHaveLength(vertical.values.length)
})

test('a rejected Moffat fit falls back to the moments, without a curve', () => {
	const image = field([
		[120, 120, 0.5, 1.5],
		[124, 120, 0.5, 1.5],
	])
	const result = measured(inspect(image, 121, 120, { model: 'moffat' }))

	expect(result.requestedModel).toBe('moffat')
	expect(result.profile.model).toBe('moments')
	expect(result.profile.moffat?.success).toBeFalse()
	expect(result.profile.flags).toContain('poorFit')
	expect(result.horizontal.model).toBeUndefined()
})
