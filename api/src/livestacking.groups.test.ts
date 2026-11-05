import { describe, expect, test } from 'bun:test'
import type { CalibrationMetadata } from './calibrationlibrary.compatibility'
import { calibrationPolicyId, classifyFilter, filterCalibration, filterGroupOf, frameTarget, geometryKeyOf, missingMetadata, segmentKeyOf } from './livestacking.groups'

// Metadata of a light with fields replaced.
function metadata(patch: Partial<CalibrationMetadata> = {}): CalibrationMetadata {
	const unknown = { value: undefined, evidence: 'unknown' } as const
	const verified = <T extends string | number>(value: T) => ({ value, evidence: 'verified' }) as const

	return {
		cameraName: 'Camera',
		width: 100,
		height: 80,
		channels: 1,
		bitpix: 16,
		exposure: verified(60000000),
		setTemperature: verified(-10),
		sensorTemperature: verified(-9.8),
		gain: verified(100),
		offset: verified(10),
		binX: verified(1),
		binY: verified(1),
		readoutMode: unknown,
		filter: verified('Ha'),
		telescope: unknown,
		focalLength: unknown,
		...patch,
	}
}

describe('live stacking groups', () => {
	test('a filter is the exact trimmed name, None without a wheel, and unclassified when a wheel recorded none', () => {
		expect(filterGroupOf(classifyFilter(' H-alpha ', true))).toBe('H-alpha')
		expect(filterGroupOf(classifyFilter('Ha', false))).toBe('Ha')
		expect(filterGroupOf(classifyFilter(undefined, false))).toBe('None')
		expect(classifyFilter('  ', true)).toEqual({ kind: 'unclassified' })
		expect(filterGroupOf(classifyFilter(undefined, true))).toBeUndefined()
	})

	test('every acquisition setting and the calibration policy separate segments, but temperature does not', () => {
		const base = segmentKeyOf('Ha', metadata(), 'uncalibrated')
		expect(segmentKeyOf('Ha', metadata({ sensorTemperature: { value: -9.2, evidence: 'verified' } }), 'uncalibrated')).toBe(base)

		for (const patch of [
			{ gain: { value: 200, evidence: 'verified' } },
			{ offset: { value: 20, evidence: 'verified' } },
			{ binX: { value: 2, evidence: 'verified' } },
			{ exposure: { value: 120000000, evidence: 'verified' } },
			{ readoutMode: { value: 'High', evidence: 'verified' } },
			{ width: 50 },
			{ originX: 10 },
			{ gain: { value: undefined, evidence: 'unknown' } },
		] as const) {
			expect(segmentKeyOf('Ha', metadata(patch as Partial<CalibrationMetadata>), 'uncalibrated')).not.toBe(base)
		}

		expect(segmentKeyOf('OIII', metadata(), 'uncalibrated')).not.toBe(base)
		expect(segmentKeyOf('Ha', metadata(), calibrationPolicyId({ dark: { masterId: 1, digest: 'a' } }))).not.toBe(base)
	})

	test('a calibration policy is identified by its masters by content, and an empty choice is uncalibrated', () => {
		expect(calibrationPolicyId(undefined)).toBe('uncalibrated')
		expect(calibrationPolicyId({})).toBe('uncalibrated')
		expect(calibrationPolicyId({ dark: { masterId: 1, digest: 'a' } })).not.toBe(calibrationPolicyId({ dark: { masterId: 1, digest: 'b' } }))
		expect(filterCalibration({ filters: { Ha: {} }, otherwise: 'skip' }, 'Ha')).toBeUndefined()
		expect(filterCalibration({ filters: { Ha: { flat: { masterId: 2, digest: 'f' } } }, otherwise: 'skip' }, 'Ha')).toEqual({ flat: { masterId: 2, digest: 'f' } })
	})

	test('the geometry key keeps grids of other sizes, origins, and binnings apart', () => {
		expect(geometryKeyOf(metadata())).toBe(geometryKeyOf(metadata({ gain: { value: 0, evidence: 'verified' } })))
		expect(geometryKeyOf(metadata({ binX: { value: 2, evidence: 'verified' } }))).not.toBe(geometryKeyOf(metadata()))
		expect(geometryKeyOf(metadata({ originY: 4 }))).not.toBe(geometryKeyOf(metadata()))
	})

	test('a frame matches masters with its own settings, exposure in seconds, and sensor temperature', () => {
		expect(frameTarget(metadata())).toEqual({ width: 100, height: 80, channels: 1, binX: 1, binY: 1, gain: 100, offset: 10, exposure: 60, temperature: -9.8, filter: 'Ha' })
		expect(missingMetadata(metadata({ exposure: { value: undefined, evidence: 'unknown' } }))).toBe('The frame does not record its exposure')
		expect(missingMetadata(metadata({ channels: 2 }))).toBe('The frame has no usable image size')
		expect(missingMetadata(metadata())).toBeUndefined()
	})
})
