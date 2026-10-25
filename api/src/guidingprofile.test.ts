import { expect, test } from 'bun:test'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { GUIDING_PROFILE_HALF_WIDTH, guideStarProfile } from './guidingprofile'

const WIDTH = 64
const HEIGHT = 48

// A flat sky of 0.1 with one Gaussian star of peak 0.4 and sigma 1.5 px at (sx, sy), as a 16-bit frame.
function frame(sx: number, sy: number): Image {
	const raw = new Float32Array(WIDTH * HEIGHT).fill(0.1)
	for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) raw[y * WIDTH + x] += 0.4 * Math.exp(-((x - sx) ** 2 + (y - sy) ** 2) / (2 * 1.5 ** 2))
	return { raw, header: {}, metadata: { width: WIDTH, height: HEIGHT, channels: 1, pixelCount: WIDTH * HEIGHT, pixelSizeInBytes: 4, bitpix: 16, stride: WIDTH, strideInBytes: WIDTH * 4, bayer: undefined } }
}

test('measures the guide star and cuts through its centre pixel, less the background', () => {
	const profile = guideStarProfile(frame(30.3, 20.6), 7, [31, 21])!

	expect(profile.frameId).toBe(7)
	expect(profile.adu).toBe(65535)
	expect(profile.x).toBeCloseTo(30.3, 1)
	expect(profile.y).toBeCloseTo(20.6, 1)
	// A Gaussian of sigma 1.5 px has a FWHM of 3.53 px.
	expect(profile.fwhm!).toBeCloseTo(3.53, 0)
	expect(profile.background!).toBeCloseTo(0.1, 3)

	expect(profile.horizontal.from).toBe(-GUIDING_PROFILE_HALF_WIDTH)
	expect(profile.horizontal.values).toHaveLength(2 * GUIDING_PROFILE_HALF_WIDTH + 1)
	// The centre sample is the brightest of the row, and the wings fall to the sky.
	const centre = profile.horizontal.values[GUIDING_PROFILE_HALF_WIDTH]
	expect(Math.max(...profile.horizontal.values)).toBe(centre)
	expect(profile.horizontal.values[0]).toBeCloseTo(0, 3)
	expect(Math.max(...profile.vertical.values)).toBe(profile.vertical.values[-profile.vertical.from])
})

test('a star near the edge shortens its cuts, and a position outside the frame has no profile', () => {
	const profile = guideStarProfile(frame(3, 44), 1, [3, 44])!
	expect(profile.horizontal.from).toBe(-3)
	expect(profile.horizontal.values).toHaveLength(3 + 1 + GUIDING_PROFILE_HALF_WIDTH)
	expect(profile.vertical.values).toHaveLength(GUIDING_PROFILE_HALF_WIDTH + 1 + 3)

	expect(guideStarProfile(frame(30, 20), 1, [-1, 20])).toBeUndefined()
	expect(guideStarProfile(frame(30, 20), 1, [30, HEIGHT])).toBeUndefined()
})
