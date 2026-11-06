import { describe, expect, test } from 'bun:test'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { detectStars } from 'nebulosa/src/imaging/stars/detector'
import { mulberry32 } from 'nebulosa/src/math/numerical/random'
import { detectStarsInRegions, guideCrops } from './guideregions'

const WIDTH = 640
const HEIGHT = 480

// A sky of Gaussian noise (sigma 0.01 around 0.1) with Gaussian stars of sigma 1.5 px at the positions, of peak 0.2
// unless a third value gives it.
function frame(stars: readonly (readonly [number, number, number?])[]): Image {
	const raw = new Float32Array(WIDTH * HEIGHT)
	const random = mulberry32(5)

	for (let i = 0; i < raw.length; i += 2) {
		const radius = Math.sqrt(-2 * Math.log(1 - random()))
		const angle = 2 * Math.PI * random()
		raw[i] = 0.1 + 0.01 * radius * Math.cos(angle)
		raw[i + 1] = 0.1 + 0.01 * radius * Math.sin(angle)
	}

	for (const [sx, sy, peak = 0.2] of stars) {
		for (let y = Math.floor(sy) - 10; y <= Math.ceil(sy) + 10; y++) {
			for (let x = Math.floor(sx) - 10; x <= Math.ceil(sx) + 10; x++) raw[y * WIDTH + x] += peak * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.5 ** 2))
		}
	}

	return { raw, header: {}, metadata: { width: WIDTH, height: HEIGHT, channels: 1, pixelCount: WIDTH * HEIGHT, pixelSizeInBytes: 4, bitpix: -32, stride: WIDTH, strideInBytes: WIDTH * 4, bayer: undefined } }
}

describe('crops', () => {
	test('pad each region by what the detector needs, clamp to the frame, and merge until none overlaps', () => {
		// Radius 24 + aperture 4 + detection border 16: 44 px on each side of the center.
		expect(guideCrops({ centers: [[100, 100]], radius: 24, minSNR: 0 }, WIDTH, HEIGHT, 4)).toEqual([{ left: 56, top: 56, right: 145, bottom: 145 }])
		expect(guideCrops({ centers: [[10, 470]], radius: 24, minSNR: 0 }, WIDTH, HEIGHT, 4)).toEqual([{ left: 0, top: 426, right: 55, bottom: 480 }])

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
			{ left: 56, top: 56, right: 275, bottom: 175 },
			{ left: 456, top: 356, right: 545, bottom: 445 },
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

	test('keeps only the detections above the minimum SNR of the regions', () => {
		// A star of peak 40 sky deviations and one of 10.
		const stars = [
			[120.3, 90.7, 0.4],
			[400.6, 300.2, 0.1],
		] as const
		const centers = stars.map(([x, y]) => [x, y] as const)
		const image = frame(stars)
		const all = detectStarsInRegions(image, { centers, radius: 24, minSNR: 0 })
		const kept = detectStarsInRegions(image, { centers, radius: 24, minSNR: 30 })

		expect(all).toHaveLength(2)
		expect(all.map((star) => star.snr).sort((a, b) => a - b)[0]).toBeLessThan(30)
		expect(kept).toHaveLength(1)
		expect(Math.hypot(kept[0].x - 120.3, kept[0].y - 90.7)).toBeLessThan(0.5)
		expect(kept[0].snr).toBeGreaterThan(30)
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
