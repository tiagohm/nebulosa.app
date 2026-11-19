import { expect, test } from 'bun:test'
import { sameSkyFrames, type SkyFrame } from './planetarium'

const FRAME: SkyFrame = { id: 'a', name: 'Wide', color: '#f00', optics: { focalLength: 400, focalMultiplier: 1, aperture: 80, rotation: 0, sensor: { kind: 'pixels', width: 6000, height: 4000, pixelSize: 3.76 } } }

test('framings are the same by value, whatever objects hold them', () => {
	const copy: SkyFrame = { ...FRAME, optics: { ...FRAME.optics, sensor: { ...FRAME.optics.sensor } } }
	expect(sameSkyFrames([FRAME], [copy])).toBeTrue()
	expect(sameSkyFrames([FRAME], [])).toBeFalse()
	expect(sameSkyFrames([FRAME], [{ ...copy, name: 'Narrow' }])).toBeFalse()
	expect(sameSkyFrames([FRAME], [{ ...copy, optics: { ...copy.optics, rotation: 90 } }])).toBeFalse()
	expect(sameSkyFrames([FRAME], [{ ...copy, optics: { ...copy.optics, sensor: { kind: 'pixels', width: 6000, height: 4000, pixelSize: 2.4 } } }])).toBeFalse()
})
