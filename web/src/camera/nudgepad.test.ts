import { describe, expect, test } from 'bun:test'
import type { MountNudgeDirection } from 'api'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { deg } from 'nebulosa/src/math/units/angle'
import { skyDirections } from '../platesolving/wcs'
import { frameOrientation, orientationStale, PAD_GRID, type PadCell, padMapping } from './nudgepad'

// A TAN solution of a 2000×1000 image, s degrees per pixel, rotated by angle degrees, mirrored when flipped.
function solution({ angle = 0, flipped = false, s = 0.0005, dec = -17 } = {}): FitsHeader {
	const c = Math.cos(deg(angle))
	const n = Math.sin(deg(angle))
	const p = flipped ? 1 : -1
	return { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 1000.5, CRPIX2: 500.5, CRVAL1: 42, CRVAL2: dec, CD1_1: p * s * c, CD1_2: -s * n, CD2_1: p * s * n, CD2_2: s * c, NAXIS1: 2000, NAXIS2: 1000 }
}

// Screen direction of each cell, +Y down.
const CELL_VECTORS: Record<PadCell, readonly [number, number]> = { 'up-left': [-1, -1], up: [0, -1], 'up-right': [1, -1], left: [-1, 0], right: [1, 0], 'down-left': [-1, 1], down: [0, 1], 'down-right': [1, 1] }

// Angle between the sky direction of a mount direction on screen and a cell, in radians.
function offset(header: FitsHeader, direction: MountNudgeDirection, cell: PadCell) {
	const { north, east } = skyDirections(header, { x: 1000, y: 500 })
	const sn = direction.includes('N') ? 1 : direction.includes('S') ? -1 : 0
	const se = direction.includes('E') ? 1 : direction.includes('W') ? -1 : 0
	const x = sn * north!.x + se * east!.x
	const y = sn * north!.y + se * east!.y
	const [cx, cy] = CELL_VECTORS[cell]
	return Math.acos((x * cx + y * cy) / Math.hypot(x, y) / Math.hypot(cx, cy))
}

describe('pad mapping', () => {
	const angles = Array.from({ length: 28 }, (_, i) => i * 13)

	test.each(
		angles.flatMap((angle) => [
			{ angle, flipped: false },
			{ angle, flipped: true },
		]),
	)('moves each cell toward its edge of the frame ($angle°, flipped $flipped)', (options) => {
		const header = solution(options)
		const orientation = frameOrientation(header, 2000, 1000)!
		const mapping = padMapping(orientation)
		const cells = PAD_GRID.filter((cell) => cell !== 'STOP')

		expect(new Set(cells.map((cell) => mapping[cell])).size).toBe(8)
		for (const cell of cells) expect(offset(header, mapping[cell], cell)).toBeLessThanOrEqual(Math.PI / 8 + 1e-6)
		expect(orientation.skew).toBeLessThanOrEqual(Math.PI / 8 + 1e-9)
	})

	test('mirrored frames reflect the compass', () => {
		expect(frameOrientation(solution(), 2000, 1000)!.parity * frameOrientation(solution({ flipped: true }), 2000, 1000)!.parity).toBe(-1)
	})

	test('a solution that cannot be projected gives no orientation', () => {
		expect(frameOrientation({}, 2000, 1000)).toBeUndefined()
	})
})

describe('pier side', () => {
	test('is recorded from the PIERSIDE header only when it names a side', () => {
		expect(frameOrientation(solution(), 2000, 1000, { PIERSIDE: 'WEST' })!.pierSide).toBe('WEST')
		expect(frameOrientation(solution(), 2000, 1000, { PIERSIDE: 'UNKNOWN' })!.pierSide).toBeUndefined()
		expect(frameOrientation(solution(), 2000, 1000)!.pierSide).toBeUndefined()
	})

	test('an orientation is stale only when both sides are known and differ', () => {
		const west = frameOrientation(solution(), 2000, 1000, { PIERSIDE: 'WEST' })!
		const unknown = frameOrientation(solution(), 2000, 1000)!

		expect(orientationStale(west, { hasPierSide: true, pierSide: 'EAST' })).toBe(true)
		expect(orientationStale(west, { hasPierSide: true, pierSide: 'WEST' })).toBe(false)
		expect(orientationStale(west, { hasPierSide: true, pierSide: 'NEITHER' })).toBe(false)
		expect(orientationStale(west, { hasPierSide: false, pierSide: 'EAST' })).toBe(false)
		expect(orientationStale(west, undefined)).toBe(false)
		expect(orientationStale(unknown, { hasPierSide: true, pierSide: 'EAST' })).toBe(false)
	})
})
