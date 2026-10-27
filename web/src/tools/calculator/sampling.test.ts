import { describe, expect, test } from 'bun:test'
import { airyDiskSize, criticalFocusZone, recommendedFocalLength } from 'nebulosa/src/astronomy/formulas'
import { DEFAULT_OPTICS } from '../../sky/framing'
import { DIFFRACTION_EXAMPLE, diffraction, diffractionFromOptics, SAMPLING_EXAMPLE, sampling, samplingFromOptics } from './sampling'

describe('sampling', () => {
	test('classifies the FWHM at the 2 and 3 px boundaries', () => {
		const at = (seeing: string) => {
			const result = sampling({ ...SAMPLING_EXAMPLE, scale: '1', seeing })
			return result.status === 'ready' ? result.value.kind : undefined
		}

		expect(at('1.99')).toBe('undersampled')
		expect(at('2')).toBe('optimal')
		expect(at('3')).toBe('optimal')
		expect(at('3.01')).toBe('oversampled')
	})

	test('the measured FWHM gives the seeing', () => {
		const result = sampling({ ...SAMPLING_EXAMPLE, mode: 'fwhm', scale: '1.5', fwhm: '2.4', seeing: '' })
		expect(result.status === 'ready' && result.value).toMatchObject({ fwhmPixels: 2.4, kind: 'optimal' })
		expect(result.status === 'ready' && result.value.seeing).toBeCloseTo(3.6, 12)
	})

	test('the recommended focal length needs the pixel size and the target', () => {
		const result = sampling({ ...SAMPLING_EXAMPLE, targetSampling: '' })
		expect(result.status === 'ready' && result.value.recommendedFocalLength).toEqual({ status: 'incomplete', missing: ['Target FWHM'] })
		const none = sampling({ ...SAMPLING_EXAMPLE, targetSampling: '', pixelSize: '' })
		expect(none.status === 'ready' && none.value.recommendedFocalLength).toBeUndefined()
		const full = sampling(SAMPLING_EXAMPLE)
		expect(full.status === 'ready' && full.value.recommendedFocalLength).toEqual({ status: 'ready', value: recommendedFocalLength(3.76, 2.5, 2.5) })
	})

	test('only the field of the mode is required', () => {
		expect(sampling({ ...SAMPLING_EXAMPLE, mode: 'fwhm', fwhm: '' })).toEqual({ status: 'incomplete', missing: ['Measured FWHM'] })
		expect(sampling({ ...SAMPLING_EXAMPLE, seeing: '0' })).toEqual({ status: 'invalid', reason: 'Seeing must be greater than 0.' })
	})

	test('imports the image scale and the pixel size', () => {
		expect(samplingFromOptics(DEFAULT_OPTICS)).toEqual({ scale: '1.293', pixelSize: '3.76' })
		expect(samplingFromOptics({ ...DEFAULT_OPTICS, sensor: { kind: 'physical', width: 23, height: 15 } })).toEqual({ scale: '', pixelSize: '' })
	})
})

describe('diffraction', () => {
	test('converts the wavelength from nanometers', () => {
		const result = diffraction(DIFFRACTION_EXAMPLE)
		expect(result).toEqual({ status: 'ready', value: { airyDisk: airyDiskSize(0.55, 5), airyDiskPixels: airyDiskSize(0.55, 5) / 3.76, criticalFocusZone: criticalFocusZone(0.55, 5) } })
	})

	test('the Airy disk in pixels needs the pixel size', () => {
		const result = diffraction({ ...DIFFRACTION_EXAMPLE, pixelSize: '' })
		expect(result.status === 'ready' && result.value.airyDiskPixels).toBeUndefined()
	})

	test('imports the focal ratio only with an aperture', () => {
		expect(diffractionFromOptics(DEFAULT_OPTICS)).toEqual({ focalRatio: '', pixelSize: '3.76' })
		expect(diffractionFromOptics({ ...DEFAULT_OPTICS, aperture: 120, focalMultiplier: 0.8 })).toEqual({ focalRatio: '4', pixelSize: '3.76' })
	})
})
