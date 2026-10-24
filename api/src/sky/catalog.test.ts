import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { catalogObject, catalogStars, renderConstellations, renderDeepSky, renderStars, searchCatalog } from './catalog'
import { fixtureCatalog } from './fixture'
import { assertSkyCatalogSchema } from './schema'

const db = fixtureCatalog()

// 2026-01-01T00:00:00Z, about 26 years after J2000.
const TIME = Date.UTC(2026, 0, 1)

test('catalog stars within a cone', () => {
	// Around Pi-3 Orionis (Tabit), with Pi-2 Orionis about 2° away and Betelgeuse about 16° away.
	const stars = catalogStars(db, 1.2669, 0.1221, 0.05)
	expect(stars.map((e) => e.declination)).toEqual([0.1221, 0.1563])
	expect(stars[0].flux).toBeGreaterThan(stars[1].flux)
	expect(stars[1].flux).toBeCloseTo(0.4 * 10 ** (-0.4 * 0.35), 9)
	expect(catalogStars(db, 1.2669, 0.1221, 0.01)).toHaveLength(1)
	expect(catalogStars(db, 1.2669, 0.1221, 0.05)[0]).not.toBe(stars[0])
})

test('search by designation', () => {
	expect(searchCatalog(db, 'M31').map((e) => e.name)).toEqual(['Andromeda Galaxy'])
	expect(searchCatalog(db, 'ngc 1976').map((e) => e.name)).toEqual(['Great Orion Nebula'])
	expect(searchCatalog(db, 'HIP 32349').map((e) => e.name)).toEqual(['Sirius'])
	expect(searchCatalog(db, 'Alp CMa').map((e) => e.name)).toEqual(['Sirius'])
	expect(searchCatalog(db, 'α Ori').map((e) => e.name)).toEqual(['Betelgeuse'])
	expect(searchCatalog(db, '58 Ori').map((e) => e.name)).toEqual(['Betelgeuse'])
})

test('search bayer components', () => {
	expect(searchCatalog(db, 'Pi Ori').map((e) => e.name)).toEqual(['Tabit', 'Pi-2 Ori'])
	expect(searchCatalog(db, 'Pi2 Ori').map((e) => e.name)).toEqual(['Pi-2 Ori'])
})

test('search by name and alias', () => {
	expect(searchCatalog(db, 'sirius').map((e) => e.name)).toEqual(['Sirius'])
	expect(searchCatalog(db, 'Andromeda Nebula').map((e) => e.name)).toEqual(['Andromeda Galaxy'])
	// Prefix matches come before substring matches, brightest first within each group.
	expect(searchCatalog(db, 'orion').map((e) => e.name)).toEqual(['Great Orion Nebula'])
	expect(searchCatalog(db, 'neb').map((e) => e.name)).toEqual(['Andromeda Galaxy', 'Great Orion Nebula'])
})

test('search result contents', () => {
	const [m31] = searchCatalog(db, 'M 31')
	expect(m31.ref).toEqual({ kind: 'catalog', id: 1000255 })
	expect(m31.category).toBe('deepSky')
	expect(m31.typeName).toBe('Galaxy')
	expect(m31.magnitude).toBe(3.4)
	expect(m31.constellation).toBe('And')
	// The catalog designation is listed before the other proper names.
	expect(m31.designations).toEqual(['M 31', 'Andromeda Nebula', 'NGC 224'])

	const [sirius] = searchCatalog(db, 'Sirius')
	expect(sirius.category).toBe('star')
	expect(sirius.designations[0]).toBe('Alp CMa')
})

test('search without results', () => {
	expect(searchCatalog(db, 'Vega')).toEqual([])
	expect(searchCatalog(db, '   ')).toEqual([])
	expect(searchCatalog(db, '100%')).toEqual([])
})

test('search limit', () => {
	expect(searchCatalog(db, 'Ori', 1)).toHaveLength(1)
})

test('catalog object', () => {
	const m42 = catalogObject(db, 1001879)!
	expect(m42.name).toBe('Great Orion Nebula')
	expect(m42.designations).toEqual(['Orion Nebula', 'M 42', 'NGC 1976'])
	expect(m42.typeName).toBe('HII Region')
	expect(m42.constellation).toBe('Ori')
	expect(m42.constellationName).toBe('Orion')
	expect(m42.majorAxis).toBeCloseTo(0.0261799, 6)
	expect(m42.distance).toBeUndefined()

	const pgc = catalogObject(db, 1090000)!
	expect(pgc.name).toBe('PGC 90000')
	expect(pgc.magnitude).toBeUndefined()

	expect(catalogObject(db, 1)).toBeUndefined()
})

test('render stars at the equator of date', () => {
	const stars = renderStars(db, TIME)
	expect(stars.time).toBe(TIME)
	expect(stars.ids).toEqual([32263, 27919, 22449, 22509])
	expect(stars.names).toEqual(['Sirius', 'Betelgeuse', 'Tabit', ''])
	expect(stars.designations).toEqual(['Alp CMa', 'Alp Ori', 'Pi-3 Ori', 'Pi-2 Ori'])
	expect(stars.mag[0]).toBe(-1.44)
	expect(stars.bv[0]).toBe(0.65)
	// Precession over 26 years moves Sirius about 0.3° east in right ascension.
	const shift = stars.ra[0] - 1.7677953696021995
	expect(shift).toBeGreaterThan(0.0045)
	expect(shift).toBeLessThan(0.006)
})

test('render deep-sky objects', () => {
	const dsos = renderDeepSky(db, TIME)
	// The PGC galaxy has no magnitude and no classic designation, so it is not rendered.
	expect(dsos.ids).toEqual([1000255, 1001879])
	expect(dsos.names).toEqual(['Andromeda Galaxy', 'Great Orion Nebula'])
	expect(dsos.types).toEqual([1, 18])
	expect(dsos.size[0]).toBeCloseTo(189.1, 1)
	expect(dsos.typeNames[18]).toBe('HII Region')
	expect(renderDeepSky(db, TIME, 3.5).ids).toEqual([1000255])
})

test('render constellations', () => {
	const data = renderConstellations({ lines: [[[1.7677953696021995, -0.291751258517685]]], boundaries: [], labels: [{ name: 'Canis Major', rightAscension: 1.8, declination: -0.4 }] }, TIME)
	expect(data.lines[0][0][0]).toBeCloseTo(renderStars(db, TIME).ra[0], 3)
	expect(data.labels[0].name).toBe('Canis Major')
})

test('schema version', () => {
	expect(() => assertSkyCatalogSchema(db)).not.toThrow()
	expect(() => assertSkyCatalogSchema(new Database(':memory:'))).toThrow('Run "bun make:catalog --force"')
})

test('render stars up to a magnitude', () => {
	expect(renderStars(db, TIME, 1).ids).toEqual([32263, 27919])
	expect(renderStars(db, TIME, -2).ids).toEqual([])
})

test('constellation labels carry their code', () => {
	const data = renderConstellations({ lines: [], boundaries: [], labels: [{ name: 'Serpens Cauda', rightAscension: 4.8, declination: -0.1 }] }, TIME)
	expect(data.labels[0].code).toBe('SER')
})
