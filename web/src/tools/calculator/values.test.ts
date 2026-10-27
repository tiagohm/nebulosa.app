import { describe, expect, test } from 'bun:test'
import { between, differs, formatDuration, formatFixed, newCheck, optional, optionalOutcome, outcome, outcomeMessage, parseNumber, POSITIVE, POSITIVE_INTEGER, positiveText, ready, required } from './values'

describe('parseNumber', () => {
	test('blank text is absent', () => {
		expect(parseNumber('')).toBeUndefined()
		expect(parseNumber('   ')).toBeUndefined()
	})

	test('text that is not a finite number is NaN', () => {
		expect(parseNumber('1e')).toBeNaN()
		expect(parseNumber('NaN')).toBeNaN()
		expect(parseNumber('Infinity')).toBeNaN()
		expect(parseNumber('-Infinity')).toBeNaN()
		expect(parseNumber('abc')).toBeNaN()
	})

	test('reads numbers, with a comma as the decimal separator', () => {
		expect(parseNumber(' 3.76 ')).toBe(3.76)
		expect(parseNumber('3,76')).toBe(3.76)
		expect(parseNumber('-0')).toBe(-0)
		expect(parseNumber('1e3')).toBe(1000)
	})
})

describe('check', () => {
	test('a required field that is empty is missing, one outside its domain is invalid', () => {
		const check = newCheck()
		expect(required(check, 'A', '', POSITIVE)).toBeNaN()
		expect(required(check, 'B', '0', POSITIVE)).toBeNaN()
		expect(required(check, 'C', 'x', POSITIVE)).toBeNaN()
		expect(required(check, 'D', '2.5', POSITIVE_INTEGER)).toBeNaN()
		expect(required(check, 'E', '4', POSITIVE_INTEGER)).toBe(4)
		expect(check).toEqual({ missing: ['A'], invalid: ['B must be greater than 0.', 'C must be a number.', 'D must be a whole number greater than 0.'] })
	})

	test('an optional field that is empty is absent', () => {
		const check = newCheck()
		expect(optional(check, 'A', '', POSITIVE)).toBeUndefined()
		expect(optional(check, 'B', '-1', POSITIVE)).toBeNaN()
		expect(check).toEqual({ missing: [], invalid: ['B must be greater than 0.'] })
	})

	test('between includes or excludes each end', () => {
		expect(between(0, 100, false, true).test(0)).toBe(true)
		expect(between(0, 100, false, true).test(100)).toBe(false)
		expect(between(0, 90, true).test(0)).toBe(false)
		expect(between(0, 90, true).test(90)).toBe(true)
		expect(between(0, 100, false, true).description).toBe('at least 0 and less than 100')
	})

	test('an outcome is invalid before incomplete, and computes nothing until both are clear', () => {
		let calls = 0
		const compute = () => ready(++calls)
		expect(outcome({ missing: ['A'], invalid: ['B must be a number.'] }, compute)).toEqual({ status: 'invalid', reason: 'B must be a number.' })
		expect(outcome({ missing: ['A'], invalid: [] }, compute)).toEqual({ status: 'incomplete', missing: ['A'] })
		expect(calls).toBe(0)
		expect(outcome(newCheck(), compute)).toEqual({ status: 'ready', value: 1 })
	})

	test('an optional outcome is absent while all its fields are empty', () => {
		const read = (texts: readonly string[]) =>
			optionalOutcome(texts, (check) => {
				const a = required(check, 'A', texts[0], POSITIVE)
				const b = required(check, 'B', texts[1], POSITIVE)
				return () => ready(a * b)
			})
		expect(read(['', ' '])).toBeUndefined()
		expect(read(['2', ''])).toEqual({ status: 'incomplete', missing: ['B'] })
		expect(read(['2', '3'])).toEqual({ status: 'ready', value: 6 })
	})

	test('messages explain every outcome without a value', () => {
		expect(outcomeMessage({ status: 'incomplete', missing: ['A', 'B'] })).toBe('Enter A, B.')
		expect(outcomeMessage({ status: 'invalid', reason: 'A must be a number.' })).toBe('A must be a number.')
		expect(outcomeMessage({ status: 'unbounded', explanation: 'No finite limit.' })).toBe('No finite limit.')
	})
})

describe('text', () => {
	test('a non-positive or absent quantity reads as empty', () => {
		expect(positiveText(0)).toBe('')
		expect(positiveText(undefined)).toBe('')
		expect(positiveText(Number.NaN)).toBe('')
		expect(positiveText(3.76)).toBe('3.76')
	})

	test('a draft differs when any field changed', () => {
		expect(differs({ a: '1', b: '2' }, { a: '1', b: '2' })).toBe(false)
		expect(differs({ a: '1', b: '3' }, { a: '1', b: '2' })).toBe(true)
	})
})

describe('format', () => {
	test('never shows a non-finite number', () => {
		expect(formatFixed(Number.NaN, 2)).toBe('—')
		expect(formatFixed(Number.POSITIVE_INFINITY, 2)).toBe('—')
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—')
		expect(formatFixed(1.005, 1)).toBe('1.0')
	})

	test('durations', () => {
		expect(formatDuration(2.5)).toBe('2.50 s')
		expect(formatDuration(42)).toBe('42.0 s')
		expect(formatDuration(245)).toBe('4 min 05 s')
		expect(formatDuration(36000)).toBe('10 h 00 min')
		expect(formatDuration(3 * 3600 + 7 * 60 + 20)).toBe('3 h 07 min')
	})
})
