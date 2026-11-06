import { DEG2RAD } from 'nebulosa/src/core/constants'
import { assessGuidingCalibration } from 'nebulosa/src/observation/guiding/calibration.quality'
import { GUIDING_CALIBRATION_RECORD_VERSION, type GuidingCalibrationContext, type GuidingCalibrationRecord } from 'nebulosa/src/observation/guiding/calibration.transform'
import type { GuidingCalibrationAxisSolution, GuidingCalibrationResult, GuidingCalibrationSample } from 'nebulosa/src/observation/guiding/calibrator'
import type { GuidingCalibrationEvidence, StoredGuidingCalibration } from './guidingcalibration'

// Saved guiding calibrations for the tests of the selection, the store and the routes: a well-conditioned solution of
// 8 steps per axis, RA along +X and DEC 90° from it at 0.01 px/ms, with its evidence and grade.

// Evidence of the equipment the fixtures were measured with.
export const FIXTURE_EVIDENCE: GuidingCalibrationEvidence = {
	camera: { key: 'camera-hw', name: 'Guide Camera', driver: 'indi_simulator_ccd' },
	guideOutput: { key: 'mount-hw', name: 'Mount', driver: 'indi_simulator_telescope' },
	mount: { key: 'mount-hw', name: 'Mount', driver: 'indi_simulator_telescope' },
	binX: 1,
	binY: 1,
	width: 640,
	height: 480,
	pixelScale: 1.5,
	guideRate: { rightAscension: 0.5, declination: 0.5 },
}

// Mount context the fixtures are measured in by default: declination 10°, east of the pier.
export const FIXTURE_CONTEXT: GuidingCalibrationContext = { declination: 10 * DEG2RAD, pierSide: 'EAST' }

// Returns a valid source record measured in context, its RA rate in px/ms.
export function fixtureRecord(context: GuidingCalibrationContext = FIXTURE_CONTEXT, raRate = 0.01): GuidingCalibrationRecord {
	const ra = axis(0, raRate)
	const dec = axis(90 * DEG2RAD, 0.01)
	const [m00, m01, m10, m11] = [ra.unitX * ra.ratePxPerMs, dec.unitX * dec.ratePxPerMs, ra.unitY * ra.ratePxPerMs, dec.unitY * dec.ratePxPerMs]
	const determinant = m00 * m11 - m01 * m10
	const steps = (leg: GuidingCalibrationSample['leg']) =>
		Array.from({ length: 8 }, (_, i): GuidingCalibrationSample => ({
			leg,
			step: i + 1,
			pulse: 300,
			pulseDirection: leg.startsWith('ra') ? 'WEST' : 'NORTH',
			x: 100 + i * 3,
			y: 100,
			deltaX: 3,
			deltaY: 0,
			netX: (i + 1) * 3,
			netY: 0,
			stepDistance: 3,
			netDistance: (i + 1) * 3,
			projectedDistance: 3,
			orthogonalDistance: 0,
		}))
	const calibration: GuidingCalibrationResult = {
		ra: { ...ra, direction: 'WEST' },
		dec: { ...dec, direction: 'NORTH' },
		imageMotion: [m00, m01, m10, m11],
		imageToAxis: [m11 / determinant, -m01 / determinant, -m10 / determinant, m00 / determinant],
		determinant,
		backlash: 0,
		startX: 100,
		startY: 100,
		decStartX: 100,
		decStartY: 100,
		clearingSteps: 0,
		decReturnSteps: 0,
		warnings: [],
		orthogonalAssumed: false,
		review: { raSamples: steps('raForward'), clearingSamples: [], decSamples: steps('decForward'), decReturnSamples: [], excludedSamples: [], phaseHistory: ['completed'], measuredDec: dec, orthogonalityError: 0 },
	}

	return { version: GUIDING_CALIBRATION_RECORD_VERSION, calibration, context, acquiredAt: 1_700_000_000_000 }
}

// Returns a saved calibration of the fixture equipment, measured in context at createdAt.
export function fixtureCalibration(calibrationId: string, createdAt: number, patch: Partial<Pick<StoredGuidingCalibration, 'disabled' | 'evidence' | 'record'>> = {}): StoredGuidingCalibration {
	const record = patch.record ?? fixtureRecord()
	return { status: 'valid', calibrationId, createdAt, disabled: patch.disabled ?? false, record, evidence: patch.evidence ?? FIXTURE_EVIDENCE, assessment: assessGuidingCalibration(record.calibration) }
}

// Axis solution at angle, in radians from +X, moving rate px/ms over 24 px.
function axis(angle: number, rate: number): GuidingCalibrationAxisSolution {
	return { unitX: Math.cos(angle), unitY: Math.sin(angle), ratePxPerMs: rate, totalTravelPx: 24, totalPulse: 24 / rate, angle, rmsOrthogonalResidualPx: 0.1, negativeProjectionCount: 0 }
}
