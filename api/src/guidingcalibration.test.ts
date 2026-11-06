import { describe, expect, test } from 'bun:test'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { assessGuidingCalibration } from 'nebulosa/src/observation/guiding/calibration.quality'
import { equipmentKeyOf, evidenceRejections, type GuidingCalibrationEvidence, selectGuidingCalibration } from './guidingcalibration'
import { FIXTURE_EVIDENCE, fixtureCalibration, fixtureRecord } from './guidingcalibration.fixture'

const OPTIONS = { declinationCompensation: true, reverseDecOutputAfterMeridianFlip: false }
const CONTEXT = { declination: 10 * DEG2RAD, pierSide: 'EAST' } as const

describe('evidence', () => {
	test('matches the same physical equipment and geometry only', () => {
		expect(evidenceRejections(FIXTURE_EVIDENCE, FIXTURE_EVIDENCE)).toEqual([])
		// Names are for people, and a driver unknown on one side is not a difference.
		expect(evidenceRejections(FIXTURE_EVIDENCE, { ...FIXTURE_EVIDENCE, camera: { key: 'camera-hw', name: 'Renamed' } })).toEqual([])

		const changed: GuidingCalibrationEvidence = {
			...FIXTURE_EVIDENCE,
			camera: { ...FIXTURE_EVIDENCE.camera, key: 'other-camera' },
			guideOutput: { ...FIXTURE_EVIDENCE.guideOutput, driver: 'indi_lx200' },
			mount: undefined,
			binX: 2,
			width: 320,
			pixelScale: 1.6,
			guideRate: { rightAscension: 0.9, declination: 0.5 },
		}
		expect(evidenceRejections(FIXTURE_EVIDENCE, changed)).toEqual(['camera', 'guideOutput', 'mount', 'binning', 'frameSize', 'pixelScale', 'guideRate'])
		// Within 1%, the same scale and rate.
		expect(evidenceRejections(FIXTURE_EVIDENCE, { ...FIXTURE_EVIDENCE, pixelScale: 1.505, guideRate: { rightAscension: 0.502, declination: 0.5 } })).toEqual([])
		expect(evidenceRejections(FIXTURE_EVIDENCE, { ...FIXTURE_EVIDENCE, pixelScale: undefined })).toEqual(['pixelScale'])
	})

	test('keys the equipment by its devices', () => {
		expect(equipmentKeyOf(FIXTURE_EVIDENCE)).toBe('camera-hw|mount-hw|mount-hw')
		expect(equipmentKeyOf({ ...FIXTURE_EVIDENCE, mount: undefined })).toBe('camera-hw|mount-hw|')
	})
})

describe('selection', () => {
	test('prefers the best graded usable calibration, then the newest, and lists why the others were set aside', () => {
		const poorRecord = fixtureRecord()
		const poor = { ...fixtureCalibration('poor', 500, { record: poorRecord }), assessment: { ...assessGuidingCalibration(poorRecord.calibration), quality: 'poor' as const } }
		const entries = [
			poor,
			fixtureCalibration('newest-good', 400),
			fixtureCalibration('older-good', 300),
			fixtureCalibration('disabled', 600, { disabled: true }),
			fixtureCalibration('binned', 700, { evidence: { ...FIXTURE_EVIDENCE, binX: 2, binY: 2 } }),
			fixtureCalibration('west', 800, { record: fixtureRecord({ declination: 10 * DEG2RAD }) }),
			{ status: 'invalid' as const, calibrationId: 'broken', createdAt: 900, disabled: false, reason: 'the RA axis is invalid' },
		]

		const selection = selectGuidingCalibration(entries, FIXTURE_EVIDENCE, CONTEXT, OPTIONS)
		expect(selection.selected?.entry.calibrationId).toBe('newest-good')
		expect(selection.selected?.applicability.status).toBe('direct')
		expect(selection.candidates.map(({ calibrationId, status, reasons }) => [calibrationId, status, reasons])).toEqual([
			['newest-good', 'direct', []],
			['older-good', 'direct', []],
			['poor', 'direct', []],
			['broken', 'invalid', ['invalid']],
			['west', 'insufficientEvidence', ['pierSideUnknown']],
			['binned', 'incompatible', ['binning']],
			['disabled', 'disabled', ['disabled']],
		])
	})

	test('transforms a calibration for another declination and side of the pier', () => {
		const selection = selectGuidingCalibration([fixtureCalibration('a', 1)], FIXTURE_EVIDENCE, { declination: 60 * DEG2RAD, pierSide: 'WEST' }, OPTIONS)
		expect(selection.selected?.applicability).toMatchObject({ status: 'transformed', transformations: ['pierFlip', 'declinationCompensation'] })
	})

	test('selects nothing when the mount context requires a new calibration', () => {
		const selection = selectGuidingCalibration([fixtureCalibration('a', 1)], FIXTURE_EVIDENCE, { declination: 89 * DEG2RAD, pierSide: 'EAST' }, OPTIONS)
		expect(selection.selected).toBeUndefined()
		expect(selection.candidates).toEqual([expect.objectContaining({ status: 'requiresRecalibration', reasons: ['declinationNearPole'] })])
	})
})
