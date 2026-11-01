import { describe, expect, test } from 'bun:test'
import { type CalibrationMetadata, compareFrames, compatibilityKey, DEFAULT_RECIPE, flatCorrectionMismatch, groupReadiness, matchMaster, recipeFingerprint } from './calibrationlibrary.compatibility'

const unknown = { evidence: 'unknown' } as const
const verified = <T>(value: T) => ({ value, evidence: 'verified' }) as const

function metadata(patch: Partial<CalibrationMetadata> = {}): CalibrationMetadata {
	return {
		cameraId: verified('camera'),
		exposure: verified(180000000),
		setTemperature: verified(-10),
		sensorTemperature: verified(-10.1),
		gain: verified(100),
		offset: verified(50),
		binX: verified(4),
		binY: verified(4),
		readoutMode: verified('RAW16'),
		filter: unknown,
		telescope: unknown,
		focalLength: unknown,
		width: 1000,
		height: 700,
		channels: 1,
		bitpix: 16,
		...patch,
	}
}

describe('keys', () => {
	test('every physical property separates frames', () => {
		const base = compatibilityKey('dark', metadata())

		for (const patch of [{ gain: verified(101) }, { offset: verified(51) }, { binX: verified(2) }, { readoutMode: verified('RAW8') }, { originX: 16 }, { cfa: 'RGGB' }, { bitpix: 8 }, { width: 999 }, { exposure: verified(179900000) }, { setTemperature: verified(-5) }, { cameraId: verified('other') }]) {
			expect(compatibilityKey('dark', metadata(patch))).not.toBe(base)
		}
	})

	test('an unknown value never equals a known one', () => {
		expect(compatibilityKey('dark', metadata({ gain: unknown }))).not.toBe(compatibilityKey('dark', metadata()))
	})

	test('a bias ignores exposure and temperature, and a flat its filter does not', () => {
		expect(compatibilityKey('bias', metadata())).toBe(compatibilityKey('bias', metadata({ exposure: verified(1), setTemperature: verified(0) })))
		expect(compatibilityKey('flat', metadata({ filter: verified('L') }))).not.toBe(compatibilityKey('flat', metadata({ filter: verified('R') })))
	})

	test('a camera name separates unassigned frames without identifying them', () => {
		expect(compatibilityKey('dark', metadata({ cameraId: unknown, cameraName: 'A' }))).not.toBe(compatibilityKey('dark', metadata({ cameraId: unknown, cameraName: 'B' })))
		expect(compatibilityKey('dark', metadata({ cameraName: 'A' }))).toBe(compatibilityKey('dark', metadata({ cameraName: 'B' })))
	})
})

describe('findings', () => {
	test('each mismatch has its own explanation', () => {
		const findings = compareFrames('dark', [metadata(), metadata({ gain: verified(120), exposure: verified(60000000) })])
		expect(findings.filter(({ code }) => code === 'incompatibleFrames').map(({ field }) => field)).toEqual(['gain', 'exposure'])
		expect(findings[0].message).toContain('100, 120')
	})

	test('unknown metadata stays visible and asks for a review', () => {
		const findings = compareFrames('dark', [metadata({ gain: unknown }), metadata({ gain: unknown })])
		expect(findings).toContainEqual({ field: 'gain', code: 'unknownMetadata', severity: 'review', message: 'Gain is unknown' })
		expect(groupReadiness(findings, 2, 0, undefined, true)).toBe('needsReview')
	})

	test('known and unknown values of the same field block', () => {
		expect(compareFrames('dark', [metadata(), metadata({ offset: unknown })])[0].severity).toBe('blocker')
	})

	test('a camera with no setpoint is unverified, never at the setpoint', () => {
		const findings = compareFrames('dark', [metadata({ setTemperature: unknown })])
		expect(findings.map(({ code }) => code)).toContain('unverifiedTemperature')
	})

	test('a wide spread of observed temperatures asks for a review', () => {
		const findings = compareFrames('dark', [metadata(), metadata({ sensorTemperature: verified(-7) })])
		expect(findings.map(({ code }) => code)).toContain('temperatureSpread')
	})

	test('an operator value is shown as declared', () => {
		const findings = compareFrames('bias', [metadata({ gain: { value: 100, evidence: 'operatorDeclared' } })])
		expect(findings.map(({ code }) => code)).toContain('operatorMetadata')
	})

	test('a missing filter of a flat asks for a review', () => {
		expect(compareFrames('flat', [metadata()]).map(({ field }) => field)).toContain('filter')
	})
})

describe('readiness', () => {
	const blocker = { field: 'gain', code: 'incompatibleFrames', severity: 'blocker', message: '' } as const

	test('states are explained in order of what stops a master', () => {
		expect(groupReadiness([], 30, 0, 30, true)).toBe('ready')
		expect(groupReadiness([], 29, 0, 30, true)).toBe('incomplete')
		expect(groupReadiness([], 29, 1, 30, true)).toBe('missingFiles')
		expect(groupReadiness([blocker], 29, 1, 30, true)).toBe('incompatible')
		expect(groupReadiness([], 30, 0, 30, false)).toBe('notSupported')
	})
})

describe('fingerprints', () => {
	test('inputs in another order are the same recipe, and any change is another', () => {
		const a = recipeFingerprint('key', ['a', 'b'], DEFAULT_RECIPE, [])
		expect(recipeFingerprint('key', ['b', 'a'], DEFAULT_RECIPE, [])).toBe(a)
		expect(recipeFingerprint('key', ['a'], DEFAULT_RECIPE, [])).not.toBe(a)
		expect(recipeFingerprint('key', ['a', 'b'], { ...DEFAULT_RECIPE, sigmaHigh: 4 }, [])).not.toBe(a)
		expect(recipeFingerprint('key', ['a', 'b'], DEFAULT_RECIPE, [{ masterId: 'm', revision: 1, digest: 'd' }])).not.toBe(a)
	})
})

describe('flat corrections', () => {
	test('a dark-flat needs the exposure of the flats and ignores their filter', () => {
		const flat = metadata({ exposure: verified(2000000), filter: verified('L') })
		expect(flatCorrectionMismatch('darkFlat', metadata({ exposure: verified(2000000) }), [flat])).toBeUndefined()
		expect(flatCorrectionMismatch('darkFlat', metadata(), [flat])).toContain('exposure')
		expect(flatCorrectionMismatch('bias', metadata(), [flat])).toBeUndefined()
		expect(flatCorrectionMismatch('bias', metadata({ gain: verified(0) }), [flat])).toContain('Gain')
	})
})

describe('matching', () => {
	const target = { cameraId: 'camera', width: 1000, height: 700, channels: 1, binX: 4, binY: 4, gain: 100, offset: 50, readoutMode: 'RAW16', exposure: 180, temperature: -10 }

	test('an exact master matches, and there is no closest match', () => {
		expect(matchMaster('dark', metadata(), target).verdict).toBe('compatible')
		expect(matchMaster('dark', metadata(), { ...target, exposure: 179.9 }).verdict).toBe('incompatible')
		expect(matchMaster('dark', metadata(), { ...target, temperature: -5 }).verdict).toBe('incompatible')
	})

	test('unknown never matches', () => {
		const { verdict, reasons } = matchMaster('dark', metadata({ gain: unknown }), target)
		expect(verdict).toBe('reviewRequired')
		expect(reasons).toEqual(['Gain is unknown'])
	})

	test('a bias ignores exposure', () => {
		expect(matchMaster('bias', metadata({ exposure: verified(0) }), target).verdict).toBe('compatible')
	})
})
