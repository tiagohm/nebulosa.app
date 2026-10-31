import { expect, test } from 'bun:test'
import { formatFlux, formatLevel, formatSignal } from './starprofile.format'
import { consecutiveOffsets, plotPoints, plotScales, type StarProfileSamples } from './starprofile.plot'

const HORIZONTAL: StarProfileSamples = { offsets: consecutiveOffsets(-2, 5), values: [0, 1, 4, 1, 0] }
const VERTICAL: StarProfileSamples = { offsets: consecutiveOffsets(-1, 3), values: [0.5, 3, -0.5] }

test('draws the cuts of a guide star as the Guiding panel always did', () => {
	const scales = plotScales([HORIZONTAL, VERTICAL])

	expect(plotPoints(HORIZONTAL, scales)).toBe('4.0,82.2 62.0,62.7 120.0,4.0 178.0,62.7 236.0,82.2')
	expect(plotPoints(VERTICAL, scales)).toBe('62.0,72.4 120.0,23.6 178.0,92.0')
	expect(scales.top).toBe(4)
	expect(scales.sx(0)).toBe(120)
	expect(scales.sy(0)).toBeCloseTo(82.2222, 3)
	expect(scales.sy(scales.top / 2)).toBeCloseTo(43.1111, 3)
})

test('places fractional offsets between the pixels', () => {
	const scales = plotScales([{ offsets: [-1.4, -0.4, 0.6, 1.6], values: [0, 2, 1, 0] }])

	expect(scales.sx(-1.4)).toBe(4)
	expect(scales.sx(1.6)).toBe(236)
	expect(scales.sx(0.1)).toBeCloseTo(120, 6)
})

test('writes intensities in ADU, or in the scale of the source, levels with the offset and differences without', () => {
	const adu = { unit: 'adu', scale: 65535, offset: 0, rescaled: false } as const
	const source = { unit: 'source', scale: 2000, offset: 100, rescaled: true } as const

	expect(formatLevel(0.5, adu)).toBe('32768 ADU')
	expect(formatSignal(0.1, adu)).toBe('6554 ADU')
	expect(formatFlux(2, adu)).toBe('131070 ADU·px')
	expect(formatLevel(0.5, source)).toBe('1100')
	expect(formatSignal(0.5, source)).toBe('1000')
	expect(formatFlux(0.5, source)).toBe('1000·px')
	expect(formatLevel(undefined, adu)).toBe('—')
	expect(formatSignal(undefined, adu)).toBe('—')
	expect(formatFlux(undefined, adu)).toBe('—')
})

test('keeps a flat series inside the plot', () => {
	const { sx, sy } = plotScales([{ offsets: [0], values: [0] }])

	expect(sx(0)).toBe(4)
	expect(Number.isFinite(sy(0))).toBeTrue()
})
