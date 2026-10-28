import { expect, test } from 'bun:test'
import { normalizeLongitude, normalizeLunarFeatures } from './features'

// A Gazetteer center-point record with the fields the normalization reads.
function record(name: string, id: number, type: string, lat: string, lon: string, extra: Record<string, string> = {}) {
	return { name, clean_name: name, type, center_lat: lat, center_lon: lon, approval: 'Adopted by IAU', approvaldt: '1935/01/01 00:00:00', diameter: '96.07', origin: 'An origin.', link: `http://planetarynames.wr.usgs.gov/Feature/${id}`, ...extra }
}

test('longitudes east of 180° become negative, once', () => {
	expect(normalizeLongitude(339.9214)).toBeCloseTo(-20.0786, 10)
	expect(normalizeLongitude(59.1037)).toBeCloseTo(59.1037, 10)
	expect(normalizeLongitude(180)).toBe(-180)
	expect(normalizeLongitude(360)).toBe(0)
	expect(normalizeLongitude(-20)).toBe(-20)
})

test('keeps adopted names with their diacritics, category, flags, and fields, sorted by id', () => {
	const { rows, audit } = normalizeLunarFeatures([
		record('Tycho', 6163, 'Crater, craters', '-43.2958', '348.7847', { diameter: '85.29377', origin: 'Tycho Brahe; Danish astronomer (1546-1601).' }),
		record('Copernicus A', 8421, 'Satellite Feature', '9.5224', '341.0997', { approvaldt: '2006/01/01 00:00:00' }),
		record('Ångström', 233, 'Crater, craters', '29.88', '318.12', { origin: '' }),
		record('Rima Hadley', 5064, 'Rima, rimae', '25.7159', '3.1467', { diameter: '' }),
		record('Mare Crisium', 3671, 'Mare, maria', '16.1774', '59.1037'),
	])

	expect(rows).toEqual([
		[233, 'Ångström', 'Crater, craters', 'crater', 0, 29.88, -41.88, 96.07, 1935, null],
		[3671, 'Mare Crisium', 'Mare, maria', 'mare', 2, 16.1774, 59.1037, 96.07, 1935, 'An origin.'],
		[5064, 'Rima Hadley', 'Rima, rimae', 'rima', 2, 25.7159, 3.1467, null, 1935, 'An origin.'],
		[6163, 'Tycho', 'Crater, craters', 'crater', 0, -43.2958, -11.2153, 85.2938, 1935, 'Tycho Brahe; Danish astronomer (1546-1601).'],
		[8421, 'Copernicus A', 'Satellite Feature', 'crater', 1, 9.5224, -18.9003, 96.07, 2006, 'An origin.'],
	])
	expect(audit).toMatchObject({ records: 5, features: 5, rejected: [] })
})

test('reports records left out, and fails on a status or descriptor it does not know', () => {
	const { rows, audit } = normalizeLunarFeatures([
		record('Tycho', 6163, 'Crater, craters', '-43.3', '348.8'),
		record('Tycho', 6164, 'Crater, craters', '-43.3', '348.8'),
		record('Twin', 6163, 'Crater, craters', '1', '1'),
		record('Nowhere', 7000, 'Crater, craters', '', '1'),
		record('Old', 7001, 'Crater, craters', '1', '1', { approval: 'Dropped, disallowed' }),
		record('No id', 0, 'Crater, craters', '1', '1', { link: '' }),
	])

	expect(rows.map((row) => row[1])).toEqual(['Tycho'])
	expect(audit.rejected.map((e) => [e.name, e.reason])).toEqual([
		['Tycho', 'duplicateName'],
		['Twin', 'duplicateId'],
		['Nowhere', 'missingCoordinates'],
		['Old', 'notApproved'],
		['No id', 'missingId'],
	])

	expect(() => normalizeLunarFeatures([record('X', 1, 'Crater, craters', '1', '1', { approval: 'Pending' })])).toThrow('unknown approval status')
	expect(() => normalizeLunarFeatures([record('X', 1, 'Fossa, fossae', '1', '1')])).toThrow('unknown descriptor')
})
