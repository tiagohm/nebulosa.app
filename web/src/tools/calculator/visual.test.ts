import { describe, expect, test } from 'bun:test'
import { DEFAULT_OPTICS } from '../../sky/framing'
import { APERTURE_COMPARISON_EXAMPLE, apertureComparison, EYEPIECE_EXAMPLE, eyepiece, eyepieceFromOptics } from './visual'

describe('eyepiece', () => {
	test('magnification, exit pupil, true fields, and limits', () => {
		const result = eyepiece({ ...EYEPIECE_EXAMPLE, fieldStop: '27' })
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') return
		expect(result.value.magnification).toBe(40)
		expect(result.value.exitPupil).toBe(5)
		expect(result.value.trueField).toBeCloseTo(1.7, 12)
		expect(result.value.fieldStopTrueField).toBeCloseTo((27 / 1000) * (180 / Math.PI), 12)
		expect(result.value.dawes).toBeCloseTo(0.58, 12)
		expect(result.value.rayleigh).toBeCloseTo(0.69, 12)
		expect(result.value.limitingMagnitude).toBeCloseTo(2.7 + 5 * Math.log10(200), 12)
	})

	test('the apparent field and the field stop are optional', () => {
		const result = eyepiece({ ...EYEPIECE_EXAMPLE, apparentField: '' })
		expect(result.status === 'ready' && result.value).toMatchObject({ trueField: undefined, fieldStopTrueField: undefined })
	})

	test('imports the effective focal length', () => {
		expect(eyepieceFromOptics({ ...DEFAULT_OPTICS, focalMultiplier: 2, aperture: 80 })).toEqual({ focalLength: '1200', aperture: '80' })
		expect(eyepieceFromOptics(DEFAULT_OPTICS)).toEqual({ focalLength: '600', aperture: '' })
	})
})

describe('aperture comparison', () => {
	test('names the larger side, in either order', () => {
		const result = apertureComparison({ apertureA: '100', obstructionA: '', apertureB: '200', obstructionB: '' })
		expect(result).toEqual({ status: 'ready', value: { clear: { ratio: 4, larger: 'B' }, collecting: undefined, sides: { A: { obstruction: undefined, effectiveAperture: 100 }, B: { obstruction: undefined, effectiveAperture: 200 } } } })
	})

	test('equal apertures', () => {
		const result = apertureComparison({ apertureA: '150', obstructionA: '', apertureB: '150', obstructionB: '' })
		expect(result.status === 'ready' && result.value.clear).toEqual({ ratio: 1, larger: undefined })
	})

	test('the obstruction reduces the collecting area', () => {
		const result = apertureComparison(APERTURE_COMPARISON_EXAMPLE)
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') return
		expect(result.value.clear).toEqual({ ratio: 4, larger: 'A' })
		expect(result.value.sides.A.obstruction).toBe(35)
		expect(result.value.sides.A.effectiveAperture).toBeCloseTo(Math.sqrt(200 ** 2 - 70 ** 2), 12)
		expect(result.value.collecting?.larger).toBe('A')
		expect(result.value.collecting?.ratio).toBeCloseTo((200 ** 2 - 70 ** 2) / 100 ** 2, 12)
	})

	test('an obstruction as large as its aperture is invalid', () => {
		expect(apertureComparison({ ...APERTURE_COMPARISON_EXAMPLE, obstructionA: '200' })).toEqual({ status: 'invalid', reason: 'Obstruction A must be smaller than aperture A.' })
	})
})
