import { expect, test } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { OMM } from 'nebulosa/src/astronomy/orbits/propagation/sgp4'
import { AppDatabase } from './database'
import { canonicalNoradId, MANUAL_SOURCE_KEY, type SatelliteElementSet, type SatelliteObjectInput, type SatelliteSourceState, SatelliteStore, satelliteSearchText } from './satellites.store'

const STATIONS = 'gp:GROUP:STATIONS'
const VISUAL = 'gp:GROUP:VISUAL'

function omm(noradId: string, epoch: string, name = 'OBJECT'): OMM {
	return { OBJECT_NAME: name, OBJECT_ID: '1998-067A', EPOCH: epoch, MEAN_MOTION: 15.5, ECCENTRICITY: 0.0003, INCLINATION: 51.6, RA_OF_ASC_NODE: 14.8, ARG_OF_PERICENTER: 325, MEAN_ANOMALY: 149, NORAD_CAT_ID: noradId, ELEMENT_SET_NO: 999, BSTAR: 0.0002, MEAN_MOTION_DOT: 0.0001, MEAN_MOTION_DDOT: 0 }
}

function elements(noradId: string, epoch: number, sourceKey = STATIONS, kind: SatelliteElementSet['kind'] = 'gp'): SatelliteElementSet {
	return { noradId, kind, sourceKey, epoch, omm: omm(noradId, new Date(epoch).toISOString().slice(0, -1)), digest: `${noradId}-${kind}-${epoch}`, fetchedAt: epoch + 1000 }
}

function source(sourceKey: string, revision: number, at: number): SatelliteSourceState {
	return { sourceKey, provider: 'gp', query: sourceKey.slice(3).replace(':', '='), lastAttemptAt: at, lastSuccessAt: at, nextAllowedAt: at + 7_200_000, failures: 0, recordCount: 2, rejectedCount: 0, revision }
}

const ISS: SatelliteObjectInput = { noradId: '25544', name: 'ISS (ZARYA)', cosparId: '1998-067A' }
const CSS: SatelliteObjectInput = { noradId: '48274', name: 'CSS (TIANHE)', cosparId: '2021-035A' }

function seeded(database = AppDatabase.memory()) {
	const store = new SatelliteStore(database)
	store.publish({ sourceKey: STATIONS, objects: [ISS, CSS], elements: [elements('25544', 1_700_000_000_000), elements('48274', 1_700_000_100_000)], members: ['25544', '48274'], source: source(STATIONS, 1, 1_700_000_200_000), at: 1_700_000_200_000 })
	return store
}

test('search text drops diacritics and case, and NORAD ids drop leading zeros', () => {
	expect(satelliteSearchText('Ñandú Sát')).toBe('nandu sat')
	expect(canonicalNoradId(' 025544 ')).toBe('25544')
	expect(canonicalNoradId('0')).toBe('0')
	expect(canonicalNoradId('25544a')).toBeUndefined()
})

test('a publication is found by NORAD id, international designator, and name', () => {
	const store = seeded()

	expect(store.search({ text: '25544', limit: 10 }).items.map((s) => s.noradId)).toEqual(['25544'])
	expect(store.search({ text: '0025544', limit: 10 }).items.map((s) => s.noradId)).toEqual(['25544'])
	expect(store.search({ text: '2021-035a', limit: 10 }).items.map((s) => s.noradId)).toEqual(['48274'])
	expect(store.search({ text: 'zarya', limit: 10 }).items.map((s) => s.noradId)).toEqual(['25544'])
	expect(store.search({ text: '100%', limit: 10 }).total).toBe(0)

	const [iss] = store.search({ text: 'iss', limit: 10 }).items
	expect(iss).toMatchObject({ noradId: '25544', name: 'ISS (ZARYA)', cosparId: '1998-067A', groups: [STATIONS], elementKind: 'gp', elementEpoch: 1_700_000_000_000 })
	expect(iss.objectType).toBeUndefined()
	expect(store.source(STATIONS)).toEqual(source(STATIONS, 1, 1_700_000_200_000))
})

test('names starting with the text come before names containing it', () => {
	const store = new SatelliteStore(AppDatabase.memory())
	const objects = [
		{ noradId: '3', name: 'COSMOS 2251' },
		{ noradId: '1', name: 'STARLINK-1007' },
		{ noradId: '2', name: 'SL-16 R/B (STARLINK)' },
	]
	store.publish({ sourceKey: 'gp:GROUP:STARLINK', objects, elements: [], at: 1 })

	expect(store.search({ text: 'starlink', limit: 10 }).items.map((s) => s.noradId)).toEqual(['1', '2'])
	expect(store.search({ limit: 2 })).toMatchObject({ total: 3, items: [{ noradId: '3' }, { noradId: '2' }] })
	expect(store.search({ limit: 2, offset: 2 }).items.map((s) => s.noradId)).toEqual(['1'])
})

test('Unicode names and long NORAD ids are kept exactly', () => {
	const store = new SatelliteStore(AppDatabase.memory())
	const objects = [
		{ noradId: '270001', name: 'SÃO PAULO-1' },
		{ noradId: '800000001', name: 'NINE DIGIT' },
	]
	store.publish({ sourceKey: MANUAL_SOURCE_KEY, objects, elements: [elements('800000001', 1_700_000_000_000, MANUAL_SOURCE_KEY, 'manual')], at: 1 })

	expect(store.search({ text: 'sao paulo', limit: 10 }).items[0]).toMatchObject({ noradId: '270001', name: 'SÃO PAULO-1', elementKind: undefined })
	expect(store.elements('800000001')).toMatchObject({ noradId: '800000001', kind: 'manual', omm: { NORAD_CAT_ID: '800000001' } })
	expect(store.object('800000001')?.groups).toEqual([MANUAL_SOURCE_KEY])
	expect(() => store.publish({ sourceKey: MANUAL_SOURCE_KEY, objects: [{ noradId: '025544', name: 'PADDED' }], elements: [], at: 1 })).toThrow()
})

test('filters select groups, types, statuses, and listed ids', () => {
	const store = seeded()
	store.publish({ sourceKey: 'satcat:GROUP:STATIONS', objects: [{ ...ISS, catalog: { objectType: 'payload', opsStatus: '+', owner: 'ISS', launchDate: '1998-11-20', orbitCenter: 'EA', orbitType: 'ORB', periodMinutes: 92.9, apogeeKm: 422, perigeeKm: 415 } }], elements: [], at: 5 })
	store.publish({ sourceKey: VISUAL, objects: [CSS], elements: [], members: ['48274'], at: 6 })

	expect(store.search({ group: VISUAL, limit: 10 }).items.map((s) => s.noradId)).toEqual(['48274'])
	expect(store.search({ objectType: 'payload', limit: 10 }).items.map((s) => s.noradId)).toEqual(['25544'])
	expect(store.search({ opsStatus: '+', limit: 10 }).total).toBe(1)
	expect(store.search({ ids: ['48274', '99999'], limit: 10 }).items.map((s) => s.noradId)).toEqual(['48274'])
	expect(store.search({ ids: [], limit: 10 }).total).toBe(0)
	expect(store.object('25544')).toMatchObject({ objectType: 'payload', periodMinutes: 92.9, metadataSource: 'satcat:GROUP:STATIONS', metadataAt: 5, groups: [STATIONS, 'satcat:GROUP:STATIONS'] })
	expect(store.object('48274')?.groups).toEqual([STATIONS, VISUAL])
	expect(store.groups()).toEqual([
		{ sourceKey: STATIONS, members: 2, confirmedAt: 1_700_000_200_000 },
		{ sourceKey: VISUAL, members: 1, confirmedAt: 6 },
		{ sourceKey: 'satcat:GROUP:STATIONS', members: 1, confirmedAt: 5 },
	])
})

test('a GP refresh never replaces newer elements, and an object leaving a group keeps the rest', () => {
	const store = seeded()
	// The refresh lists only the ISS, with older elements than the stored ones.
	store.publish({ sourceKey: STATIONS, objects: [ISS], elements: [elements('25544', 1_600_000_000_000)], members: ['25544'], source: source(STATIONS, 2, 1_700_000_300_000), at: 1_700_000_300_000 })
	expect(store.elements('25544')?.epoch).toBe(1_700_000_000_000)

	store.publish({ sourceKey: VISUAL, objects: [ISS], elements: [elements('25544', 1_700_000_500_000, VISUAL)], members: ['25544'], at: 1_700_000_600_000 })
	expect(store.elements('25544')).toMatchObject({ epoch: 1_700_000_500_000, sourceKey: VISUAL })

	expect(store.members(STATIONS)).toEqual(['25544'])
	expect(store.object('48274')).toMatchObject({ groups: [], elementKind: 'gp' })
	expect(store.search({ text: 'css', limit: 10 }).total).toBe(1)
})

test('the element source chosen by an operator selects the imported elements', () => {
	const store = seeded()
	store.publish({ sourceKey: MANUAL_SOURCE_KEY, objects: [{ ...ISS, elementSource: 'manual' }], elements: [elements('25544', 1_500_000_000_000, MANUAL_SOURCE_KEY, 'manual')], at: 9 })

	expect(store.elements('25544')?.kind).toBe('manual')
	expect(store.object('25544')).toMatchObject({ elementSource: 'manual', elementKind: 'manual', elementEpoch: 1_500_000_000_000 })
	expect(store.elementSets('25544').map((set) => set.kind)).toEqual(['gp', 'manual'])

	expect(store.setElementSource('25544', undefined)).toBeTrue()
	expect(store.elements('25544')?.kind).toBe('gp')
	expect(store.setElementSource('1', 'gp')).toBeFalse()
	expect(store.elements('1')).toBeUndefined()
})

test('a publication that fails leaves the previous catalog intact', () => {
	const store = seeded()
	const broken = { ...elements('48274', 1_800_000_000_000), omm: undefined as unknown as OMM }
	expect(() => store.publish({ sourceKey: STATIONS, objects: [ISS, CSS], elements: [elements('25544', 1_800_000_000_000), broken], members: ['25544'], source: source(STATIONS, 2, 1_800_000_000_000), at: 1_800_000_000_000 })).toThrow()

	expect(store.elements('25544')?.epoch).toBe(1_700_000_000_000)
	expect(store.members(STATIONS)).toEqual(['25544', '48274'])
	expect(store.source(STATIONS)?.revision).toBe(1)
})

test('a failed download only changes the state of its source', () => {
	const store = seeded()
	const failed = { ...source(STATIONS, 1, 1_700_000_200_000), lastAttemptAt: 1_700_000_900_000, failures: 1, lastStatus: 403, lastError: 'forbidden', nextAllowedAt: 1_700_086_400_000 }
	store.saveSource(failed)

	expect(store.source(STATIONS)).toEqual(failed)
	expect(store.sources()).toEqual([failed])
	expect(store.members(STATIONS)).toEqual(['25544', '48274'])
})

test('the catalog survives a restart', () => {
	const file = join(tmpdir(), `satellites-${Bun.randomUUIDv7()}.sqlite`)

	try {
		const first = new AppDatabase(file, false)
		seeded(first)
		first.close()

		const second = new AppDatabase(file, false)
		const store = new SatelliteStore(second)
		expect(store.search({ text: 'iss', limit: 10 }).items[0]).toMatchObject({ noradId: '25544', elementKind: 'gp' })
		expect(store.elements('48274')?.omm.NORAD_CAT_ID).toBe('48274')
		expect(store.source(STATIONS)?.revision).toBe(1)
		second.close()
	} finally {
		for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true })
	}
})
