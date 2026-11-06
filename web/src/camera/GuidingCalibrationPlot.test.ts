import { expect, test } from 'bun:test'
import type { GuidingSessionCalibration } from 'api'
import { calibrationPlotExtent, calibrationSampleLabel } from './GuidingCalibrationPlot'

type Calibration = GuidingSessionCalibration['record']['calibration']
type Sample = Calibration['review']['raSamples'][number]

function step(leg: Sample['leg'], index: number, x: number, y: number, patch: Partial<Sample> = {}): Sample {
	return { leg, step: index, pulse: 650, pulseDirection: leg.startsWith('ra') ? 'WEST' : 'NORTH', x, y, deltaX: 0, deltaY: 0, netX: 0, netY: 0, stepDistance: 0, netDistance: 0, projectedDistance: 0, orthogonalDistance: 0, ...patch }
}

function calibration(review: Partial<Calibration['review']>): Calibration {
	return {
		startX: 100,
		startY: 100,
		decStartX: 102,
		decStartY: 100,
		review: { raSamples: [], clearingSamples: [], decSamples: [], decReturnSamples: [], excludedSamples: [], phaseHistory: [], orthogonalityError: 0, ...review },
	} as unknown as Calibration
}

test('the plot holds every step around the start, at least 5 px, with a margin', () => {
	expect(calibrationPlotExtent(calibration({}))).toBeCloseTo(5.5, 12)
	expect(calibrationPlotExtent(calibration({ raSamples: [step('raForward', 1, 120, 100)], excludedSamples: [step('decForward', 1, 100, 70)] }))).toBeCloseTo(33, 12)
})

test('a step names its leg, pulse, frame, position and why it was left out', () => {
	expect(calibrationSampleLabel(step('raForward', 2, 103.25, 99.5, { frameId: 7 }))).toBe('RA out step 2: west 650 ms, frame 7, x 103.3 px, y 99.5 px')
	expect(calibrationSampleLabel(step('decForward', 1, 102, 100, { excluded: 'backlash' }))).toBe('DEC out step 1: north 650 ms, x 102.0 px, y 100.0 px, left out: DEC backlash')
})
