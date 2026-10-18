import { Database } from 'bun:sqlite'
import { CONSTELLATION_LIST } from 'nebulosa/src/astronomy/coordinates/constellation'
import { CATALOG } from './designations'
import { createSkyCatalogSchema } from './schema'

// In-memory sky catalog with a handful of real objects (J2000 values from the generated catalog), used by
// the sky API tests instead of the generated database.

// Object of the fixture: its row values and its designations as [catalog code, name] pairs.
interface FixtureObject {
	// Object id.
	readonly id: number
	// Stellarium object type.
	readonly type: number
	// Right ascension at J2000 in radians.
	readonly ra: number
	// Declination at J2000 in radians.
	readonly dec: number
	// Visual magnitude, or null.
	readonly magnitude: number | null
	// Constellation.
	readonly constellation: string
	// Major axis in radians, or null.
	readonly majorAxis?: number
	// Designations in source order.
	readonly names: readonly (readonly [number, string])[]
}

// Objects of the fixture: Sirius, Betelgeuse, Pi-2 and Pi-3 Orionis, M 31, M 42, and a PGC galaxy
// without magnitude.
const OBJECTS: readonly FixtureObject[] = [
	{
		id: 32263,
		type: 29,
		ra: 1.7677953696021995,
		dec: -0.291751258517685,
		magnitude: -1.44,
		constellation: 'CMA',
		names: [
			[CATALOG.NAME, 'Sirius'],
			[CATALOG.BAYER, 'Alp'],
			[CATALOG.FLAMSTEED, '9'],
			[CATALOG.HD, '48915'],
			[CATALOG.HR, '2491'],
			[CATALOG.HIP, '32349'],
		],
	},
	{
		id: 27919,
		type: 29,
		ra: 1.5497291,
		dec: 0.1292784,
		magnitude: 0.45,
		constellation: 'ORI',
		names: [
			[CATALOG.NAME, 'Betelgeuse'],
			[CATALOG.BAYER, 'Alp'],
			[CATALOG.FLAMSTEED, '58'],
			[CATALOG.HIP, '27989'],
		],
	},
	{
		id: 22449,
		type: 29,
		ra: 1.2669,
		dec: 0.1221,
		magnitude: 3.19,
		constellation: 'ORI',
		names: [
			[CATALOG.NAME, 'Tabit'],
			[CATALOG.BAYER, 'Pi-3'],
			[CATALOG.FLAMSTEED, '1'],
			[CATALOG.HIP, '22449'],
		],
	},
	{
		id: 22509,
		type: 29,
		ra: 1.2697,
		dec: 0.1563,
		magnitude: 4.35,
		constellation: 'ORI',
		names: [
			[CATALOG.BAYER, 'Pi-2'],
			[CATALOG.FLAMSTEED, '2'],
			[CATALOG.HIP, '22509'],
		],
	},
	{
		id: 1000255,
		type: 1,
		ra: 0.18648332357406616,
		dec: 0.7202755212783813,
		magnitude: 3.4,
		constellation: 'AND',
		majorAxis: 0.055006963976016975,
		names: [
			[CATALOG.NAME, 'Andromeda Galaxy'],
			[CATALOG.NAME, 'Andromeda Nebula'],
			[CATALOG.M, '31'],
			[CATALOG.NGC, '224'],
			[CATALOG.PGC, '2557'],
		],
	},
	{
		id: 1001879,
		type: 18,
		ra: 1.462971568107605,
		dec: -0.09409244358539581,
		magnitude: 4,
		constellation: 'ORI',
		majorAxis: 0.026179938779914945,
		names: [
			[CATALOG.NAME, 'Great Orion Nebula'],
			[CATALOG.NAME, 'Orion Nebula'],
			[CATALOG.M, '42'],
			[CATALOG.NGC, '1976'],
		],
	},
	{ id: 1090000, type: 1, ra: 3.1, dec: 0.2, magnitude: null, constellation: 'LEO', names: [[CATALOG.PGC, '90000']] },
]

// Creates the in-memory fixture catalog.
export function fixtureCatalog() {
	const db = new Database(':memory:')
	createSkyCatalogSchema(db)

	for (const o of OBJECTS) {
		db.run('INSERT INTO objects (id, type, rightAscension, declination, magnitude, constellation, majorAxis) VALUES (?, ?, ?, ?, ?, ?, ?)', [o.id, o.type, o.ra, o.dec, o.magnitude, CONSTELLATION_LIST.indexOf(o.constellation as never), o.majorAxis ?? null])
		const ranks = new Map<number, number>()

		for (const [type, name] of o.names) {
			const rank = ranks.get(type) ?? 0
			ranks.set(type, rank + 1)
			db.run('INSERT INTO names (objectId, type, name, rank) VALUES (?, ?, ?, ?)', [o.id, type, name, rank])
		}
	}

	return db
}
