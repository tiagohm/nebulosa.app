import { describe, expect, test } from 'bun:test'
import { snapToStep, stepFractionDigits } from './numberinput.step'

describe('stepFractionDigits', () => {
	test('counts the decimal places of the step as written', () => {
		expect(stepFractionDigits(1)).toBe(0)
		expect(stepFractionDigits(5)).toBe(0)
		expect(stepFractionDigits(0.5)).toBe(1)
		expect(stepFractionDigits(0.05)).toBe(2)
		expect(stepFractionDigits(0.001)).toBe(3)
		expect(stepFractionDigits(1e-7)).toBe(7)
		expect(stepFractionDigits(2.5e-7)).toBe(8)
		expect(stepFractionDigits(1e21)).toBe(0)
	})
})

describe('snapToStep', () => {
	test('stepping by a decimal step leaves no floating-point residue', () => {
		expect(snapToStep(0.1 + 0.2, 0.1)).toBe(0.3)
		expect(snapToStep(0.7, 0.1)).toBe(0.7)
		expect(snapToStep(1.15 + 0.05, 0.05)).toBe(1.2)
		expect(snapToStep(0.3 - 0.1, 0.1)).toBe(0.2)

		let v = 0
		for (let i = 0; i < 10; i++) v = snapToStep(v + 0.1, 0.1)
		expect(v).toBe(1)
	})

	test('rounds a typed value to the nearest multiple of the step', () => {
		expect(snapToStep(0.123, 0.01)).toBe(0.12)
		expect(snapToStep(7, 5)).toBe(5)
		expect(snapToStep(-0.04, 0.1)).toBe(0)
		expect(snapToStep(-0.26, 0.1)).toBe(-0.3)
	})

	test('clamps to the bounds, keeping them exact', () => {
		expect(snapToStep(-1, 0.1, 0.05)).toBe(0.05)
		expect(snapToStep(10, 0.1, 0, 2.5)).toBe(2.5)
		expect(snapToStep(1.2, 0.1, 0, 2.5)).toBe(1.2)
	})
})
