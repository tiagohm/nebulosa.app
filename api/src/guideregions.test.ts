import { describe, expect, test } from 'bun:test'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { detectStars } from 'nebulosa/src/imaging/stars/detector'
import { mulberry32 } from 'nebulosa/src/math/numerical/random'
import { detectStarsInRegions, guideCrops } from './guideregions'

const WIDTH = 640
const HEIGHT = 480

// A sky of Gaussian noise (sigma 0.01 around 0.1) with Gaussian stars of peak 0.2 and sigma 1.5 px at the positions.
function frame(stars: readonly (readonly [number, number])[]): Image {
	const raw = new Float32Array(WIDTH * HEIGHT)
	const random = mulberry32(5)

	for (let i = 0; i < raw.length; i += 2) {
		const radius = Math.sqrt(-2 * Math.log(1 - random()))
		const angle = 2 * Math.PI * random()
		raw[i] = 0.1 + 0.01 * radius * Math.cos(angle)
		raw[i + 1] = 0.1 + 0.01 * radius * Math.sin(angle)
	}

	for (const [sx, sy] of stars) {
		for (let y = Math.floor(sy) - 10; y <= Math.ceil(sy) + 10; y++) {
			for (let x = Math.floor(sx) - 10; x <= Math.ceil(sx) + 10; x++) raw[y * WIDTH + x] += 0.2 * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.5 ** 2))
		}
	}

	return { raw, header: {}, metadata: { width: WIDTH, height: HEIGHT, channels: 1, pixelCount: WIDTH * HEIGHT, pixelSizeInBytes: 4, bitpix: -32, stride: WIDTH, strideInBytes: WIDTH * 4, bayer: undefined } }
}

describe('crops', () => {
	test('pad each region by what the detector needs, clamp to the frame, and merge until none overlaps', () => {
		// Radius 24 + aperture 4 + padding 12: 40 px on each side of the center.
		expect(guideCrops({ centers: [[100, 100]], radius: 24, minSNR: 0 }, WIDTH, HEIGHT, 4)).toEqual([{ left: 60, top: 60, right: 141, bottom: 141 }])
		expect(guideCrops({ centers: [[10, 470]], radius: 24, minSNR: 0 }, WIDTH, HEIGHT, 4)).toEqual([{ left: 0, top: 430, right: 51, bottom: 480 }])

		// The first two overlap and merge; the union then overlaps the third, which joins it; the fourth stays apart.
		const crops = guideCrops(
			{
				centers: [
					[100, 100],
					[160, 100],
					[230, 130],
					[500, 400],
				],
				radius: 24,
				minSNR: 0,
			},
			WIDTH,
			HEIGHT,
			4,
		)
		expect(crops).toEqual([
			{ left: 60, top: 60, right: 271, bottom: 171 },
			{ left: 460, top: 360, right: 541, bottom: 441 },
		])
		for (const a of crops) for (const b of crops) if (a !== b) expect(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom).toBeFalse()
	})
})

describe('detection in regions', () => {
	test('finds the stars inside the regions where the whole frame finds them, and none outside', () => {
		const stars = [
			[120.3, 90.7],
			[400.6, 300.2],
			[560.1, 60.4],
			[300, 420],
		] as const
		const image = frame(stars)
		const whole = detectStars(image).filter((star) => star.snr >= 5)
		const regions = detectStarsInRegions(image, { centers: [stars[0], stars[1]], radius: 24, minSNR: 0 }).filter((star) => star.snr >= 5)

		expect(regions).toHaveLength(2)
		for (const [x, y] of [stars[0], stars[1]]) {
			const inRegion = regions.find((star) => Math.hypot(star.x - x, star.y - y) < 1)!
			const inWhole = whole.find((star) => Math.hypot(star.x - x, star.y - y) < 1)!
			expect(inRegion.x).toBeCloseTo(inWhole.x, 6)
			expect(inRegion.y).toBeCloseTo(inWhole.y, 6)
			expect(inRegion.flux).toBeCloseTo(inWhole.flux, 6)
			expect(inRegion.snr).toBeCloseTo(inWhole.snr, 6)
		}
	})

	test('keeps only the detections from the minimum SNR of the regions', () => {
		const stars = [
			[120.3, 90.7],
			[400.6, 300.2],
		] as const
		const image = frame(stars)
		const all = detectStarsInRegions(image, { centers: stars, radius: 24, minSNR: 0 })
		const kept = detectStarsInRegions(image, { centers: stars, radius: 24, minSNR: 5 })

		// The noise peaks of the crops are gone, and the stars stay as they were measured.
		expect(all.length).toBeGreaterThan(kept.length)
		expect(kept).toEqual(all.filter((star) => star.snr >= 5))
		expect(kept).toHaveLength(2)
	})

	test('keeps the brightest stars of all the regions', () => {
		const stars = [
			[100, 100],
			[300, 300],
			[500, 200],
		] as const
		const found = detectStarsInRegions(frame(stars), { centers: stars, radius: 24, minSNR: 0 }, { maxStars: 2 })
		expect(found).toHaveLength(2)
		expect(found[0].flux).toBeGreaterThanOrEqual(found[1].flux)
	})
})
