import { describe, expect, test } from 'bun:test'
import type { FileEntry } from 'api'
import { filterLabel, joinPath, nameTaken, sortEntries, splitName } from './files'

describe('join path', () => {
	test('uses the separator of the directory without doubling a trailing one', () => {
		expect(joinPath('/data/images', 'm31.fits')).toBe('/data/images/m31.fits')
		expect(joinPath('/', 'm31.fits')).toBe('/m31.fits')
		expect(joinPath('C:\\Images', 'm31.fits')).toBe('C:\\Images\\m31.fits')
		expect(joinPath('C:\\', 'm31.fits')).toBe('C:\\m31.fits')
	})
})

describe('name taken', () => {
	test('ignores case only on Windows paths', () => {
		expect(nameTaken('C:\\Images', 'darks', ['Darks'])).toBe(true)
		expect(nameTaken('/data', 'darks', ['Darks'])).toBe(false)
		expect(nameTaken('/data', 'Darks', ['Darks'])).toBe(true)
	})
})

describe('sort entries', () => {
	const entries: FileEntry[] = [
		{ name: 'frame10.fit', path: '/f10', directory: false, modifiedAt: '2026-11-21T22:00:00Z' },
		{ name: 'darks', path: '/darks', directory: true, modifiedAt: '2026-11-25T22:00:00Z' },
		{ name: 'frame9.fit', path: '/f9', directory: false, modifiedAt: '2026-11-22T22:00:00Z' },
		{ name: 'bias.fit', path: '/b', directory: false },
	]

	test('orders by name in natural order, directories first', () => {
		expect(sortEntries(entries, { by: 'name', descending: false }).map((e) => e.name)).toEqual(['darks', 'bias.fit', 'frame9.fit', 'frame10.fit'])
		expect(sortEntries(entries, { by: 'name', descending: true }).map((e) => e.name)).toEqual(['darks', 'frame10.fit', 'frame9.fit', 'bias.fit'])
	})

	test('orders by modification time, undated entries last', () => {
		expect(sortEntries(entries, { by: 'modified', descending: true }).map((e) => e.name)).toEqual(['darks', 'frame9.fit', 'frame10.fit', 'bias.fit'])
		expect(sortEntries(entries, { by: 'modified', descending: false }).map((e) => e.name)).toEqual(['darks', 'frame10.fit', 'frame9.fit', 'bias.fit'])
	})
})

describe('split name', () => {
	test('keeps the sequence number and the extension whole', () => {
		expect(splitName('2026-11-21_19-22-21_Camera_LIGHT_0004.fit')).toEqual(['2026-11-21_19-22-21_Camera_LIGHT', '_0004.fit'])
		expect(splitName('m31.fits')).toEqual(['m31.fits', ''])
	})

	test('keeps the last characters when the last separator is far from the end', () => {
		expect(splitName('a_averyveryverylongnamewithoutseparators.fits')).toEqual(['a_averyveryverylongnamewithou', 'tseparators.fits'])
	})
})

describe('filter label', () => {
	test('names the extensions in capitals', () => {
		expect(filterLabel(['fit', 'xisf'])).toBe('FIT, XISF')
	})
})
