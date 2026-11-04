import { expect, test } from 'bun:test'
import { normalizeImport, normalizeOmmRecords, normalizeSatcatRecords, ommDigest, ommEpochMillis } from './satellites.elements'

const ISS_LINE1 = '1 25544U 98067A   23231.51768399  .00014050  00000+0  25837-3 0  9996'
const ISS_LINE2 = '2 25544  51.6415  14.7889 0003559 325.3396 149.4637 15.49477580411611'

// CelesTrak GP JSON of the ISS at the epoch of the TLE above: numbers, and the redundant OMM metadata omitted.
const ISS_GP = {
	OBJECT_NAME: 'ISS (ZARYA)',
	OBJECT_ID: '1998-067A',
	EPOCH: '2023-08-19T12:25:27.896736',
	MEAN_MOTION: 15.4947758,
	ECCENTRICITY: 0.0003559,
	INCLINATION: 51.6415,
	RA_OF_ASC_NODE: 14.7889,
	ARG_OF_PERICENTER: 325.3396,
	MEAN_ANOMALY: 149.4637,
	EPHEMERIS_TYPE: 0,
	CLASSIFICATION_TYPE: 'U',
	NORAD_CAT_ID: 25544,
	ELEMENT_SET_NO: 999,
	REV_AT_EPOCH: 41161,
	BSTAR: 0.00025837,
	MEAN_MOTION_DOT: 0.0001405,
	MEAN_MOTION_DDOT: 0,
	OBJECT_TYPE: 'PAYLOAD',
}

test('OMM epochs are read to the millisecond in UTC', () => {
	expect(ommEpochMillis('2023-08-19T12:25:27.896736')).toBe(Date.UTC(2023, 7, 19, 12, 25, 27, 897))
	expect(ommEpochMillis('2023-08-19T12:25:27Z')).toBe(Date.UTC(2023, 7, 19, 12, 25, 27))
	expect(ommEpochMillis('2023-08-19 12:25:27')).toBeNaN()
})

test('GP records become canonical OMMs whatever the representation of their numbers', () => {
	const strings = Object.fromEntries(Object.entries(ISS_GP).map(([key, value]) => [key, `${value}`]))
	const { records, rejected } = normalizeOmmRecords([ISS_GP, { ...strings, NORAD_CAT_ID: '025544' }])
	expect(rejected).toEqual([])
	// The second record is the same set: the later one replaces the earlier.
	expect(records).toHaveLength(1)
	const [iss] = records
	expect(iss).toMatchObject({ noradId: '25544', name: 'ISS (ZARYA)', cosparId: '1998-067A', epoch: Date.UTC(2023, 7, 19, 12, 25, 27, 897) })
	expect(iss.omm).toEqual({
		OBJECT_NAME: 'ISS (ZARYA)',
		OBJECT_ID: '1998-067A',
		EPOCH: '2023-08-19T12:25:27.896736',
		CLASSIFICATION_TYPE: 'U',
		NORAD_CAT_ID: '25544',
		MEAN_MOTION: 15.4947758,
		ECCENTRICITY: 0.0003559,
		INCLINATION: 51.6415,
		RA_OF_ASC_NODE: 14.7889,
		ARG_OF_PERICENTER: 325.3396,
		MEAN_ANOMALY: 149.4637,
		EPHEMERIS_TYPE: 0,
		ELEMENT_SET_NO: 999,
		REV_AT_EPOCH: 41161,
		BSTAR: 0.00025837,
		MEAN_MOTION_DOT: 0.0001405,
		MEAN_MOTION_DDOT: 0,
	})
	expect(iss.digest).toBe(ommDigest(iss.omm))
	expect(iss.digest).toMatch(/^[0-9a-f]{64}$/)
	expect(normalizeOmmRecords([strings]).records[0].digest).toBe(iss.digest)
})

test('records failing validation are left out with their reason', () => {
	const { records, rejected } = normalizeOmmRecords([{ ...ISS_GP, NORAD_CAT_ID: 270001 }, { ...ISS_GP, NORAD_CAT_ID: 800000001, REF_FRAME: 'GCRF' }, { ...ISS_GP, NORAD_CAT_ID: 3, MEAN_MOTION: 17.5 }, { ...ISS_GP, NORAD_CAT_ID: 4, EPOCH: 'yesterday' }, 'not an object', null])
	expect(records.map((record) => record.noradId)).toEqual(['270001'])
	expect(rejected).toEqual([
		{ index: 1, noradId: '800000001', error: 'referenceFrame' },
		{ index: 2, noradId: '3', error: 'propagation' },
		{ index: 3, noradId: '4', error: 'epoch' },
		{ index: 4, noradId: undefined, error: 'malformed' },
		{ index: 5, noradId: undefined, error: 'malformed' },
	])
})

test('SATCAT records keep only what the catalog publishes', () => {
	const { records, rejected } = normalizeSatcatRecords([
		{
			OBJECT_NAME: 'ISS (ZARYA)',
			OBJECT_ID: '1998-067A',
			NORAD_CAT_ID: 25544,
			OBJECT_TYPE: 'PAY',
			OPS_STATUS_CODE: '+',
			OWNER: 'ISS',
			LAUNCH_DATE: '1998-11-20',
			LAUNCH_SITE: 'TYMSC',
			DECAY_DATE: null,
			PERIOD: 92.9,
			INCLINATION: 51.64,
			APOGEE: 422,
			PERIGEE: 415,
			RCS: null,
			DATA_STATUS_CODE: null,
			ORBIT_CENTER: 'EA',
			ORBIT_TYPE: 'ORB',
		},
		{ OBJECT_NAME: 'SL-16 R/B', OBJECT_ID: '1990-046B', NORAD_CAT_ID: '20625', OBJECT_TYPE: 'R/B', OPS_STATUS_CODE: '', DECAY_DATE: '', PERIOD: '', ORBIT_CENTER: 'EA', ORBIT_TYPE: 'ORB' },
		{ OBJECT_NAME: '', NORAD_CAT_ID: 1 },
	])
	expect(records).toEqual([
		{ noradId: '25544', name: 'ISS (ZARYA)', cosparId: '1998-067A', catalog: { objectType: 'payload', opsStatus: '+', owner: 'ISS', launchDate: '1998-11-20', decayDate: undefined, orbitCenter: 'EA', orbitType: 'ORB', periodMinutes: 92.9, apogeeKm: 422, perigeeKm: 415 } },
		{ noradId: '20625', name: 'SL-16 R/B', cosparId: '1990-046B', catalog: { objectType: 'rocketBody', opsStatus: undefined, owner: undefined, launchDate: undefined, decayDate: undefined, orbitCenter: 'EA', orbitType: 'ORB', periodMinutes: undefined, apogeeKm: undefined, perigeeKm: undefined } },
	])
	expect(rejected).toEqual([{ index: 2, noradId: '1', error: 'malformed' }])
})

test('imported TLE sets become the same canonical elements as the GP record', () => {
	const batch = normalizeImport(`ISS (ZARYA)\n${ISS_LINE1}\n${ISS_LINE2}\n`)!
	expect(batch.rejected).toEqual([])
	const [iss] = batch.records
	const gp = normalizeOmmRecords([ISS_GP]).records[0]
	expect(iss).toMatchObject({ noradId: '25544', name: 'ISS (ZARYA)', cosparId: '1998-067A', epoch: gp.epoch })
	expect(iss.omm).toEqual({ ...gp.omm, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 41161 })

	// Three-line form, two-line form without a name, and an Alpha-5 catalog number.
	const alpha5 = (line: string) => {
		const edited = `${line.slice(0, 2)}A0001${line.slice(7, 68)}`
		let sum = 0
		for (const c of edited) sum += c === '-' ? 1 : /\d/.test(c) ? +c : 0
		return edited + (sum % 10)
	}
	const many = normalizeImport(`0 ISS (ZARYA)\n${ISS_LINE1}\n${ISS_LINE2}\n${alpha5(ISS_LINE1)}\n${alpha5(ISS_LINE2)}\n`)!
	expect(many.records.map((record) => [record.noradId, record.name])).toEqual([
		['25544', 'ISS (ZARYA)'],
		['100001', '100001'],
	])
})

test('imports report bad TLE sets and OMM records, and refuse other text', () => {
	const corrupted = `${ISS_LINE1.slice(0, 68)}0`
	expect(normalizeImport(`${corrupted}\n${ISS_LINE2}`)).toEqual({ records: [], rejected: [{ index: 0, noradId: '25544', error: 'checksum' }] })
	expect(normalizeImport(JSON.stringify(ISS_GP))?.records).toHaveLength(1)
	expect(normalizeImport(JSON.stringify([ISS_GP, { ...ISS_GP, ECCENTRICITY: 1.5 }]))?.rejected).toEqual([{ index: 1, noradId: '25544', error: 'eccentricity' }])
	expect(normalizeImport('{ not json')).toBeUndefined()
	expect(normalizeImport('hello')).toBeUndefined()
})
