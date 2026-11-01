import { describe, expect, test } from 'bun:test'
import type { DigitalImage } from 'nebulosa/src/imaging/model/types'
import { generateSyntheticFlatImage } from 'nebulosa/src/imaging/synthetic/flat'
import { advanceTemperatureTrace, advanceThermalHold, assessDarkFrame, type DarkFrameBaseline, type DarkFrameExpectation, type DarkFrameHeader, type DarkPlaneMeasurement, measureDarkImage, startTemperatureTrace } from './darklibrarywizard.analysis'

const EXPECTED: DarkFrameExpectation = { exposure: 60, gain: 100, offset: 10, binX: 1, binY: 1, width: 64, height: 48 }
const HEADER: DarkFrameHeader = { frameType: 'Dark Frame', exposure: 60, gain: 100, offset: 10, temperature: -10, binning: { x: 1, y: 1 }, width: 64, height: 48 }

function plane(patch: Partial<DarkPlaneMeasurement> = {}): DarkPlaneMeasurement {
	return { plane: 'mono', median: 500, mad: 8, nonFinite: 0, clipped: 0, tileSpread: 12, ...patch }
}

function baseline(frames: number, patch: Partial<DarkPlaneMeasurement> = {}): DarkFrameBaseline {
	return { frames: Array.from({ length: frames }, () => [plane(patch)]) }
}

// A dark of 64 x 48 pixels at a constant pedestal, in DN, changed by edit.
function dark(edit: (raw: DigitalImage['raw'], width: number, height: number) => void = () => {}, level = 500): DigitalImage {
	const image: DigitalImage = { ...generateSyntheticFlatImage({ width: 64, height: 48, bias: level, signal: 0, vignetting: 0, lowerClip: 0, upperClip: 65535, quantizationStep: 1 }), digitalRange: [0, 65535] }
	edit(image.raw, 64, 48)
	return image
}

describe('frame measurement', () => {
	test('reports the level, dispersion, and spatial spread of a plane in DN', () => {
		const [measured] = measureDarkImage(dark()).planes
		expect(measured).toMatchObject({ plane: 'mono', median: 500, nonFinite: 0 })
		expect(measured.tileSpread).toBe(0)
	})

	test('a bright corner of amp glow and scattered hot pixels raise no suspicion', () => {
		const image = dark((raw, width, height) => {
			for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) raw[y * width + x] = 2500 - 200 * (x + y)
			for (let i = 7; i < width * height; i += 301) raw[i] = 65535
		})

		const measured = measureDarkImage(image)
		const reference = baseline(5, { tileSpread: measured.planes[0].tileSpread, mad: 1 })
		expect(assessDarkFrame({ ...measured, header: HEADER }, EXPECTED, reference).suspicions).toEqual([])
	})

	test('a frame flooded by light is suspicious', () => {
		const measured = measureDarkImage(dark((raw) => raw.fill(65535, 0, raw.length / 4)))
		expect(assessDarkFrame({ ...measured, header: HEADER }, EXPECTED, baseline(0)).suspicions).toContain('saturation')
	})

	test('a broad gradient of light breaks the baseline of the group', () => {
		const measured = measureDarkImage(
			dark((raw, width, height) => {
				for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * width + x] += 3 * x
			}),
		)

		expect(assessDarkFrame({ ...measured, header: HEADER }, EXPECTED, baseline(5, { tileSpread: 2, mad: 1 })).suspicions).toEqual(expect.arrayContaining(['levelExcursion', 'structureChange']))
	})
})

describe('frame assessment', () => {
	test('a frame like its group passes', () => {
		expect(assessDarkFrame({ header: HEADER, planes: [plane()] }, EXPECTED, baseline(5))).toEqual({ rejections: [], suspicions: [], notes: ['temperatureUnverified'] })
	})

	test('what the header proves wrong rejects the frame', () => {
		const rejected = (header: Partial<DarkFrameHeader>) => assessDarkFrame({ header: { ...HEADER, ...header }, planes: [plane()] }, EXPECTED, baseline(0)).rejections
		expect(rejected({ frameType: 'Light Frame' })).toEqual(['frameTypeMismatch'])
		expect(rejected({ exposure: 30 })).toEqual(['exposureMismatch'])
		expect(rejected({ gain: 200 })).toEqual(['gainMismatch'])
		expect(rejected({ offset: 50 })).toEqual(['offsetMismatch'])
		expect(rejected({ binning: { x: 2, y: 2 } })).toEqual(['binningMismatch'])
		expect(rejected({ width: 32 })).toEqual(['geometryMismatch'])
	})

	test('a driver that omits a keyword is not accused of a mismatch', () => {
		const assessment = assessDarkFrame({ header: { width: 64, height: 48 }, planes: [plane()] }, EXPECTED, baseline(0))
		expect(assessment.rejections).toEqual([])
		expect(assessment.notes).toEqual(['frameTypeUnverified', 'exposureUnverified', 'gainUnverified', 'offsetUnverified', 'binningUnverified', 'temperatureUnverified'])
	})

	test('a width a driver trimmed passes, but must stay the same across the group', () => {
		const header = { ...HEADER, width: 56 }
		expect(assessDarkFrame({ header, planes: [plane()] }, EXPECTED, baseline(0)).rejections).toEqual([])
		expect(assessDarkFrame({ header, planes: [plane()] }, EXPECTED, { ...baseline(0), size: { width: 64, height: 48 } }).rejections).toEqual(['geometryMismatch'])
	})

	test('non-finite samples reject the frame', () => {
		expect(assessDarkFrame({ header: HEADER, planes: [plane({ nonFinite: 1 })] }, EXPECTED, baseline(0)).rejections).toEqual(['nonFiniteSamples'])
	})

	test('a level below the baseline is no light, and the first frames have no baseline', () => {
		expect(assessDarkFrame({ header: HEADER, planes: [plane({ median: 100 })] }, EXPECTED, baseline(5)).suspicions).toEqual([])
		expect(assessDarkFrame({ header: HEADER, planes: [plane({ median: 5000 })] }, EXPECTED, baseline(2)).suspicions).toEqual([])
		expect(assessDarkFrame({ header: HEADER, planes: [plane({ median: 5000 })] }, EXPECTED, baseline(3)).suspicions).toEqual(['levelExcursion'])
	})

	test('a level above what a shorter exposure allows is suspicious, whatever the pedestal', () => {
		const shorter = { exposure: 30, levels: { mono: 500 } }
		expect(assessDarkFrame({ header: HEADER, planes: [plane({ median: 900 })] }, EXPECTED, { frames: [], shorter }).suspicions).toEqual([])
		expect(assessDarkFrame({ header: HEADER, planes: [plane({ median: 2000 })] }, EXPECTED, { frames: [], shorter }).suspicions).toEqual(['exposureBound'])
	})

	test('a long excursion rejects the frame, and a short one only notes it', () => {
		const trace = (outOfTolerance: number) => ({ start: -10, end: -10, minimum: -10, maximum: -9, outOfTolerance, at: 0 })
		expect(assessDarkFrame({ header: HEADER, planes: [plane()] }, EXPECTED, baseline(0), trace(7), -10).rejections).toEqual(['temperatureExcursion'])
		expect(assessDarkFrame({ header: HEADER, planes: [plane()] }, EXPECTED, baseline(0), trace(2), -10)).toMatchObject({ rejections: [], notes: ['temperatureTransient'] })
		expect(assessDarkFrame({ header: HEADER, planes: [plane()] }, EXPECTED, baseline(0), trace(0), -10).notes).toEqual([])
	})

	test('an uncontrolled camera is not held to a tolerance', () => {
		expect(assessDarkFrame({ header: HEADER, planes: [plane()] }, EXPECTED, baseline(0), { start: 20, end: 25, minimum: 20, maximum: 25, outOfTolerance: 60, at: 0 }).rejections).toEqual([])
	})
})

describe('temperature', () => {
	test('the hold starts inside the tolerance, survives silence, and restarts when a reading leaves it', () => {
		const hold = (since: number | undefined, temperature: number, now: number) => advanceThermalHold(since, temperature, -10, 0.5, now)
		expect(hold(undefined, -5, 0)).toBeUndefined()
		expect(hold(undefined, -9.6, 1000)).toBe(1000)
		// The driver said nothing for a minute: the reading stands, because it reports only changes.
		expect(hold(1000, -9.6, 61000)).toBe(1000)
		expect(hold(1000, -9, 62000)).toBeUndefined()
	})

	test('a trace counts the time a reading stood out of tolerance', () => {
		let trace = startTemperatureTrace(-10, 0, 3)
		trace = advanceTemperatureTrace(trace, -9, 1000, 0, -10, 0.5)
		trace = advanceTemperatureTrace(trace, -9, 3000, 2, -10, 0.5)
		trace = advanceTemperatureTrace(trace, -10, 4000, 0, -10, 0.5)
		expect(trace).toMatchObject({ start: -10, end: -10, minimum: -10, maximum: -9, outOfTolerance: 3, age: 0 })
	})
})
