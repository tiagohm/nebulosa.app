import { describe, expect, test } from 'bun:test'
import { equatorialFromJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { deg, normalizeAngle, toArcmin } from 'nebulosa/src/math/units/angle'
import { proxy } from 'valtio'
import { skyAt } from '../platesolving/wcs'
import { clearImageFootprint, clearSkyCoordinate, imageFootprint, ofDateMatrix, showCoordinateInSky, showFootprintInSky, type SkyImageState, toDate } from './footprint'

// A TAN solution of a 2000×1000 image, 0.001° per pixel.
const SOLUTION: FitsHeader = { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 1000.5, CRPIX2: 500.5, CRVAL1: 83.8, CRVAL2: -5.4, CD1_1: -0.001, CD1_2: 0, CD2_1: 0, CD2_2: 0.001, NAXIS1: 2000, NAXIS2: 1000 }

// 2000-01-01T12:00:00Z and 25 years later, Unix milliseconds.
const J2000_UNIX = Date.UTC(2000, 0, 1, 12)
const LATER = Date.UTC(2025, 0, 1, 12)

describe('frame of date', () => {
	test.each([J2000_UNIX, Date.UTC(2010, 5, 1), LATER, Date.UTC(2040, 11, 31)])('matches the toolkit conversion at %p', (time) => {
		for (const point of [
			[deg(83.8), deg(-5.4)],
			[deg(359.9), deg(89.7)],
			[deg(0.1), deg(-60)],
		] as const) {
			const [ra, dec] = toDate(ofDateMatrix(time), point)
			const [expectedRa, expectedDec] = equatorialFromJ2000(point[0], point[1], timeUnix(time / 1000, true))

			expect(ra).toBeGreaterThanOrEqual(0)
			expect(ra).toBeCloseTo(normalizeAngle(expectedRa), 12)
			expect(dec).toBeCloseTo(expectedDec, 12)
		}
	})

	test('moves a position by precession, so J2000 drawn on a map of 25 years later would be off', () => {
		const point = [deg(83.8), deg(-5.4)] as const
		const [ra, dec] = toDate(ofDateMatrix(LATER), point)

		expect(toArcmin(sphericalSeparation(point[0], point[1], ra, dec))).toBeGreaterThan(15)
	})
})

describe('footprint', () => {
	test('samples the four borders of the image clockwise, closed, around its centre', () => {
		const footprint = imageFootprint(SOLUTION, 'ICRS', { width: 2000, height: 1000 }, 'doc', 'image', 'M42')!

		expect(footprint.outline).toHaveLength(97)
		expect(footprint.outline.at(-1)).toEqual(footprint.outline[0])
		expect(footprint.outline[0]).toEqual(skyAt(SOLUTION, { x: 0, y: 0 }))
		expect(footprint.outline[24]).toEqual(skyAt(SOLUTION, { x: 2000, y: 0 }))
		expect(footprint.outline[48]).toEqual(skyAt(SOLUTION, { x: 2000, y: 1000 }))
		expect(footprint.center).toEqual(skyAt(SOLUTION, { x: 1000, y: 500 })!)
		expect(footprint).toMatchObject({ documentKey: 'doc', imageId: 'image', name: 'M42', frame: 'ICRS' })
	})

	test('is undefined when the solution cannot locate the image', () => {
		expect(imageFootprint({ ...SOLUTION, CTYPE1: 'GLON-CAR' }, 'ICRS', { width: 2000, height: 1000 }, 'doc', 'image', 'M42')).toBeUndefined()
	})
})

describe('handoffs', () => {
	test('number each coordinate request, and a footprint pans to its centre without a mark', () => {
		const state = proxy<SkyImageState>({})
		showCoordinateInSky(state, [1, 0.5], 'A')
		expect(state.intent).toEqual({ seq: 1, rightAscension: 1, declination: 0.5, label: 'A', mark: true })

		const footprint = imageFootprint(SOLUTION, 'ICRS', { width: 2000, height: 1000 }, 'doc', 'image', 'M42')!
		showFootprintInSky(state, footprint)
		expect(state.footprint).toEqual(footprint)
		expect(state.intent).toEqual({ seq: 2, rightAscension: footprint.center[0], declination: footprint.center[1], label: 'M42', mark: false })

		showCoordinateInSky(state, [2, 0], 'B')
		clearSkyCoordinate(state)
		clearImageFootprint(state)
		expect(state).toEqual({ intent: { seq: 3, rightAscension: 2, declination: 0, label: 'B', mark: false }, footprint: undefined })
	})
})
