import { describe, expect, test } from 'bun:test'
import { sensorDiagonalFov } from 'nebulosa/src/astronomy/formulas'
import { toArcmin } from 'nebulosa/src/math/units/angle'
import { DEFAULT_OPTICS, isFraming, type OpticalConfiguration, resolveFraming } from '../../sky/framing'
import { IMAGING_SETUP_EXAMPLE, imagingSetup, imagingSetupFromOptics, MOSAIC_EXAMPLE, mosaic, mosaicFromOptics } from './optics'

const REDUCED: OpticalConfiguration = { focalLength: 800, focalMultiplier: 0.8, aperture: 160, sensor: { kind: 'pixels', width: 4144, height: 2822, pixelSize: 4.63 }, rotation: 120 }
const PHYSICAL: OpticalConfiguration = { focalLength: 400, focalMultiplier: 2, aperture: 0, sensor: { kind: 'physical', width: 23.5, height: 15.6 }, rotation: 0 }

function framingOf(optics: OpticalConfiguration) {
	const framing = resolveFraming(optics)
	if (!isFraming(framing)) throw new Error('incomplete optics')
	return framing
}

describe('imaging setup', () => {
	test('matches Sky Framing for a sensor given by its pixels, with the reducer applied once', () => {
		const result = imagingSetup(imagingSetupFromOptics(REDUCED))
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') return
		expect(result.value.framing).toEqual(framingOf({ ...REDUCED, rotation: 0 }))
		expect(result.value.framing.effectiveFocalLength).toBeCloseTo(640, 10)
		expect(result.value.framing.focalRatio).toBeCloseTo(4, 10)
		expect(result.value.framing.scale).toBeCloseTo(1.492, 3)
		expect(result.value.diagonal).toBeCloseTo(sensorDiagonalFov(Math.hypot(4144 * 0.00463, 2822 * 0.00463), 640), 12)
	})

	test('a sensor given by its physical size has a field but no image scale, and no focal ratio without aperture', () => {
		const result = imagingSetup(imagingSetupFromOptics(PHYSICAL))
		expect(result.status).toBe('ready')
		if (result.status !== 'ready') return
		expect(result.value.framing).toEqual(framingOf(PHYSICAL))
		expect(result.value.framing.scale).toBeUndefined()
		expect(result.value.framing.focalRatio).toBeUndefined()
		expect(toArcmin(result.value.framing.width)).toBeCloseTo(100.98, 2)
	})

	test('the example is the default preset', () => {
		const result = imagingSetup(IMAGING_SETUP_EXAMPLE)
		expect(result.status === 'ready' && result.value.framing).toEqual(framingOf(DEFAULT_OPTICS))
	})

	test('a physical sensor leaves its pixels empty, a pixel sensor fills its physical size', () => {
		expect(imagingSetupFromOptics(PHYSICAL)).toMatchObject({ sensorKind: 'physical', width: '', height: '', pixelSize: '', sensorWidth: '23.5', sensorHeight: '15.6', aperture: '' })
		expect(imagingSetupFromOptics(REDUCED)).toMatchObject({ sensorKind: 'pixels', width: '4144', pixelSize: '4.63', sensorWidth: '19.187', sensorHeight: '13.066' })
	})

	test('optics never entered read as missing, not as zero', () => {
		const draft = imagingSetupFromOptics({ ...REDUCED, focalLength: 0 })
		expect(draft.focalLength).toBe('')
		expect(imagingSetup(draft)).toEqual({ status: 'incomplete', missing: ['Focal length'] })
	})

	test('only the fields of the chosen sensor kind are required', () => {
		const draft = { ...IMAGING_SETUP_EXAMPLE, sensorKind: 'physical' as const, sensorWidth: '', width: '', pixelSize: '' }
		expect(imagingSetup(draft)).toEqual({ status: 'incomplete', missing: ['Sensor width'] })
	})

	test('rejects a fractional resolution and a non-positive factor', () => {
		const result = imagingSetup({ ...IMAGING_SETUP_EXAMPLE, width: '100.5', focalMultiplier: '0' })
		expect(result).toEqual({ status: 'invalid', reason: 'Reducer / Barlow factor must be greater than 0. Width must be a whole number greater than 0.' })
	})
})

describe('mosaic', () => {
	test('counts panels along each axis with the overlap', () => {
		expect(mosaic({ targetWidth: '240', targetHeight: '120', fieldWidth: '120', fieldHeight: '60', overlap: '0' })).toEqual({ status: 'ready', value: { columns: 2, rows: 2, panels: 4 } })
		expect(mosaic({ targetWidth: '240', targetHeight: '120', fieldWidth: '120', fieldHeight: '60', overlap: '10' })).toEqual({ status: 'ready', value: { columns: 3, rows: 3, panels: 9 } })
		expect(mosaic({ targetWidth: '30', targetHeight: '20', fieldWidth: '120', fieldHeight: '60', overlap: '20' })).toEqual({ status: 'ready', value: { columns: 1, rows: 1, panels: 1 } })
	})

	test('an overlap of 100 % or more is invalid', () => {
		expect(mosaic({ ...MOSAIC_EXAMPLE, overlap: '100' })).toEqual({ status: 'invalid', reason: 'Overlap must be at least 0 and less than 100.' })
	})

	test('the field comes from the optics, or is empty when they are incomplete', () => {
		const framing = resolveFraming(DEFAULT_OPTICS)
		expect('width' in framing && Number(mosaicFromOptics(DEFAULT_OPTICS).fieldWidth)).toBeCloseTo('width' in framing ? toArcmin(framing.width) : 0, 2)
		expect(mosaicFromOptics({ ...DEFAULT_OPTICS, focalLength: 0 })).toEqual({ fieldWidth: '', fieldHeight: '' })
	})
})
