import { describe, expect, test } from 'bun:test'
import { joinPath } from './files'

describe('join path', () => {
	test('uses the separator of the directory without doubling a trailing one', () => {
		expect(joinPath('/data/images', 'm31.fits')).toBe('/data/images/m31.fits')
		expect(joinPath('/', 'm31.fits')).toBe('/m31.fits')
		expect(joinPath('C:\\Images', 'm31.fits')).toBe('C:\\Images\\m31.fits')
		expect(joinPath('C:\\', 'm31.fits')).toBe('C:\\m31.fits')
	})
})
